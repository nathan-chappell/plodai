import random
from pathlib import Path
import sys

from typer.testing import CliRunner

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import blog.scripts.neural_dynamics_artifacts as demo


def test_balanced_parentheses_validator() -> None:
    assert demo.is_balanced_parentheses("(())()")
    assert not demo.is_balanced_parentheses("(()")
    assert not demo.is_balanced_parentheses("())(")


def test_valid_sampler_respects_exact_length() -> None:
    rng = random.Random(7)
    text = demo.sample_valid_sequence_of_length(rng, 12)
    assert len(text) == 12
    assert demo.is_balanced_parentheses(text)


def test_parse_mlp_shape_accepts_single_and_multiple_layers() -> None:
    assert demo.parse_mlp_shape("32") == (32,)
    assert demo.parse_mlp_shape("32, 32") == (32, 32)


def test_invalid_sampler_supports_named_modes() -> None:
    rng = random.Random(7)
    for kind in demo.INVALID_KIND_ORDER:
        example = demo.sample_invalid_sequence(rng, 20, kind=kind)
        assert len(example.text) == 20
        assert example.kind == kind
        assert example.label == 0
        assert not demo.is_balanced_parentheses(example.text)


def test_balanced_invalid_sampler_preserves_net_balance() -> None:
    rng = random.Random(13)
    text = demo.sample_balanced_invalid_sequence(rng, 12)
    assert len(text) == 12
    assert demo.terminal_balance(text) == 0
    assert demo.is_balanced_invalid(text)


def test_exact_length_phase_sampler_uses_requested_length_and_modes() -> None:
    examples = demo.sample_exact_length_examples(
        total_examples=24,
        length=20,
        invalid_kinds=(demo.INVALID_KIND_RANDOM, demo.INVALID_KIND_CORRUPTION),
        seed=7,
        family="cohort-20",
    )
    assert len(examples) == 24
    assert all(len(example.text) == 20 for example in examples)
    assert sum(example.label for example in examples) == 12
    invalid_kinds = {example.kind for example in examples if example.label == 0}
    assert demo.INVALID_KIND_RANDOM in invalid_kinds
    assert demo.INVALID_KIND_CORRUPTION in invalid_kinds


def test_training_blocks_are_cumulative_and_budgeted() -> None:
    blocks = demo.build_training_blocks(block_epochs=5, train_samples=64)
    assert len(blocks) == 9
    assert sum(block.epochs for block in blocks) == 45
    assert blocks[0].active_lengths == (20,)
    assert blocks[3].active_lengths == (20, 50)
    assert blocks[-1].active_lengths == (20, 50, 100)
    assert blocks[-1].phase_kind == demo.PHASE_KIND_BALANCED


def test_evaluation_sets_cover_all_families_and_balanced_slice() -> None:
    evaluation_sets, balanced_examples = demo.build_evaluation_sets(test_samples=24, seed=7)
    assert set(evaluation_sets) == {family.key for family in demo.EVALUATION_FAMILIES}
    assert len(evaluation_sets["cohort-20"]) == 24
    assert len(evaluation_sets["very-long"]) == 24
    assert len(balanced_examples) == 24
    assert all(example.kind == demo.INVALID_KIND_BALANCED for example in balanced_examples)


def test_trace_rnn_returns_per_layer_traces() -> None:
    tokens, lengths = demo.encode_sequences(["()()", "((()))"])

    one_layer = demo.TinyTraceRNN(num_layers=1)
    logits, traces = one_layer(tokens, lengths, capture_traces=True)
    assert logits.shape == (2,)
    assert traces is not None
    assert len(traces) == 1
    assert traces[0].shape == (2, 6, 4)

    two_layer = demo.TinyTraceRNN(num_layers=2)
    logits, traces = two_layer(tokens, lengths, capture_traces=True)
    assert logits.shape == (2,)
    assert traces is not None
    assert len(traces) == 2
    assert traces[0].shape == (2, 6, 4)
    assert traces[1].shape == (2, 6, 4)


def test_aha_scoring_and_epoch_selection() -> None:
    metrics = [
        demo.MetricRow(0, "initial", 0.7, 0.5, 0.48, 0.5, 0.5, 0.5, 0.4, 0.3),
        demo.MetricRow(1, "20/random", 0.6, 0.7, 0.58, 0.55, 0.5, 0.5, 0.4, 0.35),
        demo.MetricRow(2, "50/balanced", 0.5, 0.8, 0.72, 0.7, 0.65, 0.72, 0.55, 0.8),
        demo.MetricRow(3, "100/balanced", 0.4, 0.85, 0.8, 0.75, 0.7, 0.86, 0.7, 0.9),
    ]
    response_history = [
        [0.1, 0.2],
        [0.11, 0.2],
        [0.8, 0.9],
        [0.81, 0.91],
    ]
    demo.score_aha_moments(metrics, response_history)
    selected = demo.select_trace_epochs(metrics, phase_boundary_epochs=(1, 2), top_k=2)
    assert metrics[2].aha_score > metrics[1].aha_score
    assert selected == [0, 1, 2, 3]


def test_response_and_trace_probes_cover_balanced_invalid_and_very_long() -> None:
    response_probes = demo.RESPONSE_PROBES
    trace_probes = demo.TRACE_PROBES
    assert any(probe.family == "very-long" for probe in response_probes)
    assert any(probe.probe_kind == demo.PHASE_KIND_BALANCED for probe in response_probes)
    assert any(probe.probe_kind == "transition" for probe in trace_probes)
    assert all(len(probe.text) >= 38 for probe in trace_probes)


def test_generate_mlp_cli_smoke(tmp_path: Path) -> None:
    runner = CliRunner()
    result = runner.invoke(
        demo.app,
        [
            "generate",
            "--target",
            "mlp",
            "--output-dir",
            str(tmp_path),
            "--mlp-epochs",
            "6",
            "--mlp-batch-size",
            "32",
            "--no-html",
        ],
    )
    assert result.exit_code == 0, result.output
    assert (tmp_path / "mlp-sine-approximation-snapshots.png").exists()
    assert (tmp_path / "mlp-sine-loss.png").exists()
    assert (tmp_path / "manifest.json").exists()


def test_generate_rnn_cli_smoke(tmp_path: Path) -> None:
    runner = CliRunner()
    result = runner.invoke(
        demo.app,
        [
            "generate",
            "--target",
            "rnn",
            "--output-dir",
            str(tmp_path),
            "--rnn-block-epochs",
            "1",
            "--rnn-train-samples",
            "32",
            "--rnn-test-samples",
            "24",
            "--no-html",
            "--no-trace-images",
        ],
    )
    assert result.exit_code == 0, result.output
    assert (tmp_path / "rnn-dataset-diversity.png").exists()
    assert (tmp_path / "rnn-1layer-training-story.png").exists()
    assert (tmp_path / "rnn-2layer-training-story.png").exists()
    assert (tmp_path / "manifest.json").exists()
