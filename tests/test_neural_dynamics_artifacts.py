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


def test_invalid_sampler_supports_all_named_modes() -> None:
    rng = random.Random(7)
    for kind in demo.INVALID_KIND_ORDER:
        example = demo.sample_invalid_sequence(rng, 11, kind=kind)
        assert len(example.text) == 11
        assert example.kind == kind
        assert example.label == 0
        assert not demo.is_balanced_parentheses(example.text)


def test_phase2_sampler_respects_short_long_quota_split() -> None:
    examples = demo.sample_phase2_examples(
        total_examples=100,
        mean_length=40.0,
        short_ratio=0.6,
        short_length_max=demo.SHORT_LENGTH_MAX,
        max_length=demo.DEFAULT_MAX_LENGTH,
        seed=7,
    )
    short_count = sum(1 for example in examples if len(example.text) <= demo.SHORT_LENGTH_MAX)
    long_count = len(examples) - short_count
    assert short_count == 60
    assert long_count == 40


def test_phase2_sampler_supports_all_short_rollout() -> None:
    examples = demo.sample_phase2_examples(
        total_examples=24,
        mean_length=40.0,
        short_ratio=1.0,
        short_length_max=18,
        max_length=18,
        seed=11,
    )
    assert len(examples) == 24
    assert all(len(example.text) <= 18 for example in examples)


def test_tiny_trace_rnn_returns_per_layer_traces() -> None:
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
        demo.MetricRow(0, "initial", 0.7, 0.5, 0.7, 0.5, 0.7, 0.5),
        demo.MetricRow(1, "warmup", 0.6, 0.7, 0.6, 0.7, 0.6, 0.52),
        demo.MetricRow(2, "shock", 0.5, 0.8, 0.5, 0.82, 0.5, 0.9),
        demo.MetricRow(3, "shock", 0.4, 0.85, 0.4, 0.86, 0.4, 0.92),
    ]
    response_history = [
        [0.1, 0.2],
        [0.11, 0.2],
        [0.8, 0.9],
        [0.81, 0.91],
    ]
    demo.score_aha_moments(metrics, response_history)
    selected = demo.select_trace_epochs(metrics, warmup_end_epoch=1, top_k=2)
    assert metrics[2].aha_score > metrics[1].aha_score
    assert selected == [0, 1, 2, 3]


def test_curriculum_phase_epoch_budget_is_conserved() -> None:
    phases = demo.build_curriculum_phases(total_epochs=11, max_length=demo.DEFAULT_MAX_LENGTH)
    assert sum(phase.epochs for phase in phases) == 11
    assert phases[0].label == "rollout short strings"
    assert phases[-1].label == "shock full distribution"


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
            "--rnn-warmup-max-epochs",
            "2",
            "--rnn-phase2-epochs",
            "2",
            "--rnn-train-samples",
            "64",
            "--rnn-test-samples",
            "32",
            "--max-length",
            "120",
            "--no-html",
            "--no-trace-images",
        ],
    )
    assert result.exit_code == 0, result.output
    assert (tmp_path / "rnn-dataset-diversity.png").exists()
    assert (tmp_path / "rnn-training-metrics.png").exists()
    assert (tmp_path / "rnn-response-bifurcation.png").exists()
    assert (tmp_path / "manifest.json").exists()
