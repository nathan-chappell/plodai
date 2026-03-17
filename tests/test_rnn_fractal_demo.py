from pathlib import Path
from typing import TypeAlias

from typer.testing import CliRunner

import blog.scripts.rnn_fractal_demo as demo

BLOG_IMAGE_DIR = Path(
    "blog/15-03-2026-the-theoretical-justification-of-neural-networks/images/rnn-fractal-demo"
)
TrainingHistory: TypeAlias = list[demo.TrainingHistoryRow]
TraceSequences: TypeAlias = list[demo.TraceSequence]


def test_balanced_parentheses_validators() -> None:
    assert demo.is_balanced_parentheses("(())()")
    assert not demo.is_balanced_parentheses("(()")
    assert not demo.is_balanced_parentheses("())(")


def test_symbolic_dust_shape() -> None:
    points = demo.symbolic_dust(depth=4, digits=(0, 2), base=3)
    assert points.shape[1] == 2
    assert points.shape[0] == 16 * 16


def test_encode_batch_shapes() -> None:
    vocab = demo.build_vocab("()")
    tokens, lengths = demo.encode_batch(["()", "(())"], vocab)
    assert tokens.shape[0] == 2
    assert lengths.tolist() == [3, 5]


def test_sample_dataset_respects_complexity_bounds() -> None:
    sequences, _ = demo.sample_dataset(
        demo.LANGUAGES["balanced_parentheses"],
        n_samples=128,
        min_complexity=3,
        max_complexity=5,
        seed=7,
    )
    complexities = [
        demo.sequence_complexity(demo.LANGUAGES["balanced_parentheses"], seq)
        for seq in sequences
    ]
    assert min(complexities) >= 3
    assert max(complexities) <= 5


def test_sample_dataset_accepts_exact_complexity_sampler() -> None:
    sampler = demo.build_truncated_exponential_sampler(
        mean=4.0,
        min_complexity=2,
        max_complexity=6,
    )
    sequences, _ = demo.sample_dataset(
        demo.LANGUAGES["balanced_parentheses"],
        n_samples=64,
        min_complexity=2,
        max_complexity=6,
        seed=7,
        complexity_sampler=sampler,
    )
    complexities = [
        demo.sequence_complexity(demo.LANGUAGES["balanced_parentheses"], seq)
        for seq in sequences
    ]
    assert min(complexities) >= 2
    assert max(complexities) <= 6


def test_sample_dataset_is_label_balanced() -> None:
    _, labels = demo.sample_dataset(
        demo.LANGUAGES["balanced_parentheses"],
        n_samples=101,
        min_complexity=1,
        max_complexity=6,
        seed=7,
    )
    valid = int(labels.sum().item())
    invalid = labels.shape[0] - valid
    assert abs(valid - invalid) <= 1


def test_build_trace_sequences_accepts_literal_strings() -> None:
    sequences: TraceSequences = demo.build_trace_sequences(
        demo.LANGUAGES["balanced_parentheses"],
        trace_inputs=("(()())", "((()))", "()()()"),
        seed=7,
    )
    assert [label for label, _ in sequences] == [
        "valid-1 (c=3)",
        "valid-2 (c=3)",
        "valid-3 (c=3)",
    ]
    assert [sequence for _, sequence in sequences] == ["(()())", "((()))", "()()()"]


def test_characteristic_parenthesis_strings_starts_with_expected_order() -> None:
    assert demo.characteristic_parenthesis_strings(8) == [
        "()",
        "(())",
        "(",
        "()()",
        "((()))",
        ")",
        "(()())",
        "(())()",
    ]


def test_train_history_uses_post_epoch_evaluation() -> None:
    spec = demo.LANGUAGES["balanced_parentheses"]
    vocab = demo.build_vocab(spec.alphabet)
    train_sequences, train_labels = demo.sample_dataset(
        spec,
        n_samples=64,
        min_complexity=1,
        max_complexity=6,
        seed=7,
    )
    model = demo.StackedElmanRNN(
        vocab_size=len(vocab), embedding_dim=4, hidden_sizes=(4, 2)
    )
    history, _, _ = demo.train_model(
        model,
        spec,
        train_sequences,
        train_labels,
        train_sequences,
        train_labels,
        train_sequences,
        train_labels,
        vocab,
        epochs=1,
        batch_size=8,
        lr=0.003,
    )
    typed_history: TrainingHistory = history
    eval_loss, eval_acc = demo.evaluate_model(
        model, train_sequences, train_labels, vocab
    )
    assert typed_history[-1]["train_loss"] == eval_loss
    assert typed_history[-1]["train_acc"] == eval_acc


def test_train_model_can_refresh_training_data_each_epoch() -> None:
    spec = demo.LANGUAGES["balanced_parentheses"]
    vocab = demo.build_vocab(spec.alphabet)
    base_sequences, base_labels = demo.sample_dataset(
        spec,
        n_samples=32,
        min_complexity=1,
        max_complexity=4,
        seed=7,
    )
    seen_epochs: list[int] = []

    def factory(epoch: int) -> tuple[list[str], demo.torch.Tensor]:
        seen_epochs.append(epoch)
        return demo.sample_dataset(
            spec,
            n_samples=32,
            min_complexity=1,
            max_complexity=4,
            seed=100 + epoch,
        )

    model = demo.StackedElmanRNN(
        vocab_size=len(vocab), embedding_dim=4, hidden_sizes=(4, 2)
    )
    demo.train_model(
        model,
        spec,
        base_sequences,
        base_labels,
        base_sequences,
        base_labels,
        base_sequences,
        base_labels,
        vocab,
        epochs=3,
        batch_size=8,
        lr=0.003,
        train_dataset_factory=factory,
    )
    assert seen_epochs == [1, 2, 3]


def test_stacked_rnn_supports_arbitrary_hidden_layers() -> None:
    vocab = demo.build_vocab("()")
    tokens, lengths = demo.encode_batch(["()", "(())"], vocab)

    one_layer = demo.StackedElmanRNN(
        vocab_size=len(vocab), embedding_dim=6, hidden_sizes=(5,)
    )
    one_layer_out = one_layer(tokens, lengths, capture_states=True)
    assert one_layer_out["logits"].shape == (2,)
    assert one_layer_out["final_hidden"].shape == (2, 5)
    assert len(one_layer_out["layer_traces"]) == 1

    three_layer = demo.StackedElmanRNN(
        vocab_size=len(vocab), embedding_dim=6, hidden_sizes=(7, 5, 3)
    )
    three_layer_out = three_layer(tokens, lengths, capture_states=True)
    assert three_layer_out["logits"].shape == (2,)
    assert three_layer_out["final_hidden"].shape == (2, 3)
    assert len(three_layer_out["layer_traces"]) == 3


def test_layered_symbolic_dust_stays_on_fractal_grid() -> None:
    points, levels = demo.sample_layered_symbolic_dust(
        depth=6, digits=(0, 2), base=3, seed=7, base_points=8
    )
    assert points.shape[0] == levels.shape[0]
    assert points.ndim == 2
    assert levels.min().item() == 1
    assert levels.max().item() == 6
    assert float(points.min().item()) >= 0.0
    assert float(points.max().item()) <= 1.0


def test_dust_cli_writes_file(tmp_path: Path) -> None:
    runner = CliRunner()
    result = runner.invoke(
        demo.app,
        [
            "dust",
            "--output-dir",
            str(tmp_path),
            "--depth",
            "4",
            "--points",
            "128",
            "--base",
            "3",
            "--digits",
            "0,2",
        ],
    )
    assert result.exit_code == 0, result.output
    assert any(path.suffix == ".png" for path in tmp_path.iterdir())


def test_train_cli_smoke(tmp_path: Path) -> None:
    runner = CliRunner()
    result = runner.invoke(
        demo.app,
        [
            "train",
            "--language",
            "balanced_parentheses",
            "--output-dir",
            str(tmp_path),
            "--train-samples",
            "80",
            "--test-samples",
            "80",
            "--length-mean",
            "3",
            "--epochs",
            "1",
            "--batch-size",
            "16",
            "--embedding-dim",
            "4",
            "--hidden-sizes",
            "4,2",
            "--trace-output-dir",
            str(tmp_path / "trace-clouds"),
        ],
    )
    assert result.exit_code == 0, result.output
    assert (tmp_path / "balanced_parentheses-training-curves.png").exists()
    assert (tmp_path / "balanced_parentheses-response-bifurcation.png").exists()
    assert (tmp_path / "run-metadata.json").exists()
    assert (
        tmp_path
        / "trace-clouds"
        / "balanced_parentheses-trace-valid-1-c10-epoch-001.png"
    ).exists()


def test_train_cli_rejects_invalid_length_mean(tmp_path: Path) -> None:
    runner = CliRunner()
    result = runner.invoke(
        demo.app,
        [
            "train",
            "--language",
            "balanced_parentheses",
            "--output-dir",
            str(tmp_path),
            "--length-mean",
            "0",
            "--epochs",
            "1",
            "--trace-output-dir",
            str(tmp_path / "trace-clouds"),
        ],
    )
    assert result.exit_code != 0
    assert "length-mean must be positive" in result.output


def test_generate_blog_artifacts_for_one_language() -> None:
    print("[artifacts] preparing output directory", flush=True)
    BLOG_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    for path in BLOG_IMAGE_DIR.glob("*.png"):
        path.unlink()
    for path in BLOG_IMAGE_DIR.glob("*.json"):
        path.unlink()
    runner = CliRunner()

    print("[artifacts] rendering layered dust", flush=True)
    dust = runner.invoke(
        demo.app,
        [
            "dust",
            "--output-dir",
            str(BLOG_IMAGE_DIR),
            "--depth",
            "10",
            "--points",
            "1000",
            "--base",
            "3",
            "--digits",
            "0,2",
            "--title",
            "Cantor-style symbolic dust",
        ],
    )
    assert dust.exit_code == 0, dust.output

    print("[artifacts] rendering sampled dust", flush=True)
    sampled_dust = runner.invoke(
        demo.app,
        [
            "dust",
            "--output-dir",
            str(BLOG_IMAGE_DIR),
            "--depth",
            "10",
            "--points",
            "1000",
            "--base",
            "3",
            "--digits",
            "0,2",
            "--no-layered",
            "--prefix-depth",
            "4",
            "--title",
            "Cantor-style symbolic dust (sampled)",
        ],
    )
    assert sampled_dust.exit_code == 0, sampled_dust.output

    print("[artifacts] training balanced_parentheses model", flush=True)
    train = runner.invoke(
        demo.app,
        [
            "train",
            "--language",
            "balanced_parentheses",
            "--output-dir",
            str(BLOG_IMAGE_DIR),
            "--train-samples",
            "64",
            "--test-samples",
            "100",
            "--length-mean",
            "40",
            "--epochs",
            "100",
            "--batch-size",
            "8",
            "--lr",
            "0.1",
            "--embedding-dim",
            "1",
            "--hidden-sizes",
            "8,8,8",
            "--trace-input-complexities",
             "((((())))),()()()()(),((())))(((",
            "--seed",
            "7",
            "--trace-output-dir",
            str(BLOG_IMAGE_DIR),
        ],
    )
    assert train.exit_code == 0, train.output

    print("[artifacts] verifying generated files", flush=True)
    expected = [
        BLOG_IMAGE_DIR / "dust-depth10-base3-digits02-layered-basepts64.png",
        BLOG_IMAGE_DIR / "dust-depth10-base3-digits02-points1000-prefix4.png",
        BLOG_IMAGE_DIR / "balanced_parentheses-training-curves.png",
        BLOG_IMAGE_DIR / "balanced_parentheses-dataset-distribution.png",
        BLOG_IMAGE_DIR / "balanced_parentheses-response-bifurcation.png",
        BLOG_IMAGE_DIR / "balanced_parentheses-run-metadata.json",
        BLOG_IMAGE_DIR / "run-metadata.json",
    ]
    for path in expected:
        assert path.exists(), f"missing artifact: {path}"
        assert path.stat().st_size > 0, f"empty artifact: {path}"

    trace_paths = sorted(
        BLOG_IMAGE_DIR.glob("balanced_parentheses-trace-*-epoch-*.png")
    )
    assert trace_paths, "expected at least one trace artifact"
    print(f"[artifacts] done ({len(trace_paths)} trace images)", flush=True)
