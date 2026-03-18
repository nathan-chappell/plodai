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
    text = demo.sample_valid_sequence_of_length(rng, 20)
    assert len(text) == 20
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
    text = demo.sample_balanced_invalid_sequence(rng, 20)
    assert len(text) == 20
    assert demo.terminal_balance(text) == 0
    assert demo.is_balanced_invalid(text)


def test_phase_builder_returns_three_phases_and_budget() -> None:
    phases = demo.build_training_phases(
        phase_epochs=5,
        train_samples=512,
        lr_start=0.08,
        lr_end=0.02,
    )
    assert len(phases) == 3
    assert sum(phase.epochs for phase in phases) == 15
    assert phases[0].invalid_kinds == (demo.INVALID_KIND_RANDOM,)
    assert phases[1].invalid_kinds == (demo.INVALID_KIND_RANDOM, demo.INVALID_KIND_CORRUPTION)
    assert phases[2].invalid_kinds == (
        demo.INVALID_KIND_RANDOM,
        demo.INVALID_KIND_CORRUPTION,
        demo.INVALID_KIND_BALANCED,
    )


def test_phase_sampling_uses_cumulative_even_invalid_mix() -> None:
    phase = demo.build_training_phases(
        phase_epochs=5,
        train_samples=512,
        lr_start=0.08,
        lr_end=0.02,
    )[-1]
    examples = demo.sample_exact_length_examples(
        total_examples=120,
        length=20,
        invalid_weights=phase.invalid_weights,
        invalid_kinds=phase.invalid_kinds,
        seed=7,
        family="phase-3",
    )
    assert all(len(example.text) == 20 for example in examples)
    invalid_examples = [example for example in examples if example.label == 0]
    counts = {kind: sum(example.kind == kind for example in invalid_examples) for kind in phase.invalid_kinds}
    assert counts[demo.INVALID_KIND_RANDOM] == 20
    assert counts[demo.INVALID_KIND_CORRUPTION] == 20
    assert counts[demo.INVALID_KIND_BALANCED] == 20


def test_evaluation_sets_use_only_lengths_10_20_30() -> None:
    evaluation_sets = demo.build_evaluation_sets(test_samples=24, seed=7)
    assert set(evaluation_sets) == {10, 20, 30}
    for length, examples in evaluation_sets.items():
        assert len(examples) == 24
        assert all(len(example.text) == length for example in examples)


def test_trace_rnn_returns_single_layer_four_state_traces() -> None:
    tokens, lengths = demo.encode_sequences(["()()" * 5, "((()))" * 3 + "()"])
    model = demo.TinyTraceRNN(hidden_size=4, num_layers=1)
    logits, traces = model(tokens, lengths, capture_traces=True)
    assert logits.shape == (2,)
    assert traces is not None
    assert len(traces) == 1
    assert traces[0].shape[0] == 2
    assert traces[0].shape[2] == 4


def test_trace_payload_keeps_raw_hidden_state_points() -> None:
    result, checkpoints = demo.run_rnn_experiment(
        seed=7,
        phase_epochs=1,
        train_samples=32,
        test_samples=24,
        lr_start=0.08,
        lr_end=0.02,
    )
    payload = demo.build_trace_grid_payload(
        model_builder=lambda: demo.TinyTraceRNN(hidden_size=4, num_layers=1),
        checkpoints=checkpoints,
        phase_spans=result.phase_spans,
        trace_probes=demo.TRACE_PROBES,
    )
    assert payload.phase_epochs == [1, 2, 3]
    assert len(payload.phase_labels) == 3
    assert len(payload.probe_labels) == len(demo.TRACE_PROBES)
    assert len(payload.cells) == 3 * len(demo.TRACE_PROBES)
    assert len(payload.cells[0].points[0]) == 4


def test_mlp_story_epoch_selector_uses_fixed_story_checkpoints() -> None:
    selected = demo.mlp_story_epochs(400)
    assert selected == [0, 30, 200, 400]

    short_run = demo.mlp_story_epochs(40)
    assert short_run == [0, 30, 40]


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
            "8",
            "--mlp-batch-size",
            "32",
            "--no-html",
        ],
    )
    assert result.exit_code == 0, result.output
    assert (tmp_path / "mlp-sine-story.png").exists()
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
            "--rnn-phase-epochs",
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
    assert (tmp_path / "rnn-training-story.png").exists()
    assert (tmp_path / "manifest.json").exists()
