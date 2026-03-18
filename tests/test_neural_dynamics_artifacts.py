import json
from pathlib import Path
import random
import sys

import pytest
import torch
from typer.testing import CliRunner

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import blog.scripts.neural_dynamics_artifacts as demo


def test_balanced_parentheses_validator() -> None:
    assert demo.is_balanced_parentheses("(())()")
    assert not demo.is_balanced_parentheses("(()")
    assert not demo.is_balanced_parentheses("())(")


def test_parse_mlp_shape_accepts_single_and_multiple_layers() -> None:
    assert demo.parse_mlp_shape("32") == (32,)
    assert demo.parse_mlp_shape("32, 32") == (32, 32)


def test_retained_support_builder_returns_fixed_sixty_example_pool() -> None:
    support = demo.build_retained_support(cohort_size=20, seed=7)
    assert set(support) == {
        demo.SUPPORT_COHORT_RANDOM,
        demo.SUPPORT_COHORT_OFF_BY_ONE,
        demo.SUPPORT_COHORT_BALANCED,
    }
    assert len(support[demo.SUPPORT_COHORT_RANDOM]) == 20
    assert len(support[demo.SUPPORT_COHORT_OFF_BY_ONE]) == 20
    assert len(support[demo.SUPPORT_COHORT_BALANCED]) == 20
    assert sum(len(examples) for examples in support.values()) == 60


def test_phase_support_is_fixed_and_weights_are_cumulative() -> None:
    phases = demo.build_training_phases(
        phase_epochs=5,
        train_samples=20,
        lr_start=0.08,
        lr_end=0.02,
    )
    support = demo.build_retained_support(cohort_size=20, seed=7)

    phase_1 = demo.materialize_phase_examples(support, phases[0])
    phase_2 = demo.materialize_phase_examples(support, phases[1])
    phase_3 = demo.materialize_phase_examples(support, phases[2])

    assert phases[0].cohort_weights == (1.0, 0.0, 0.0)
    assert phases[1].cohort_weights == (1.0, 1.0, 0.0)
    assert phases[2].cohort_weights == (1.0, 1.0, 1.0)
    assert len(phase_1) == 20
    assert len(phase_2) == 40
    assert len(phase_3) == 60
    assert {example.text for example in phase_1}.issubset({example.text for example in phase_2})
    assert {example.text for example in phase_2}.issubset({example.text for example in phase_3})


def test_evaluation_sets_use_only_lengths_10_20_30() -> None:
    evaluation_sets = demo.build_evaluation_sets(test_samples=24, seed=7)
    assert set(evaluation_sets) == {10, 20, 30}
    for length, examples in evaluation_sets.items():
        assert len(examples) == 24
        assert all(len(example.text) == length for example in examples)


def test_trace_rnn_returns_two_layer_four_state_traces() -> None:
    tokens, lengths = demo.encode_sequences(["()()" * 5, "((()))" * 3 + "()"])
    model = demo.TinyTraceRNN(hidden_size=demo.RNN_HIDDEN_SIZE, num_layers=demo.RNN_NUM_LAYERS)
    logits, traces = model(tokens, lengths, capture_traces=True)
    assert logits.shape == (2,)
    assert traces is not None
    assert len(traces) == demo.RNN_NUM_LAYERS
    assert traces[0].shape[0] == 2
    assert traces[0].shape[2] == 4


def test_probe_flips_and_trace_payload_use_displayed_probe_pool() -> None:
    result, checkpoints = demo.run_rnn_experiment(
        seed=7,
        phase_epochs=1,
        train_samples=4,
        test_samples=24,
        lr_start=0.08,
        lr_end=0.02,
    )
    flips = demo.build_probe_flips(result)
    highlighted = demo.select_highlighted_probe_flips(
        flips,
        confusion_to_epoch=demo.probe_checkpoint_epochs(result)[2],
    )
    selection = demo.select_trace_story_probes(result, flips)
    payload = demo.build_trace_grid_payload(
        model_builder=lambda: demo.TinyTraceRNN(hidden_size=demo.RNN_HIDDEN_SIZE, num_layers=demo.RNN_NUM_LAYERS),
        checkpoints=checkpoints,
        phase_spans=result.phase_spans,
        trace_probes=selection.selected_probes,
    )

    assert payload.phase_epochs == [1, 2, 3]
    assert payload.phase_labels == [
        "After phase 1: random",
        "After phase 2: add off-by-one",
        "After phase 3: add balanced-invalid",
    ]
    assert len(payload.probe_labels) == 3
    assert len(payload.cells) == 9
    assert len(payload.cells[0].raw_points[0]) == 4
    assert len(payload.cells[0].projected_points[0]) == 2
    assert len(payload.backgrounds) == 3
    assert payload.projection_mode == "pca_top_layer"
    assert payload.axis_labels[0].startswith("PC1")
    assert payload.axis_labels[1].startswith("PC2")
    assert len(payload.backgrounds[0].projected_points) == len(payload.backgrounds[0].probabilities)
    assert selection.focus_probe.short_label in {probe.short_label for probe in demo.RESPONSE_PROBES}
    assert payload.probe_labels == [probe.label for probe in selection.selected_probes]
    assert all(flip.probe.short_label in {probe.short_label for probe in demo.RESPONSE_PROBES} for flip in highlighted)


def test_trace_background_probabilities_cover_plotted_states() -> None:
    result, checkpoints = demo.run_rnn_experiment(
        seed=7,
        phase_epochs=1,
        train_samples=4,
        test_samples=24,
        lr_start=0.08,
        lr_end=0.02,
    )
    payload = demo.build_trace_grid_payload(
        model_builder=lambda: demo.TinyTraceRNN(hidden_size=demo.RNN_HIDDEN_SIZE, num_layers=demo.RNN_NUM_LAYERS),
        checkpoints=checkpoints,
        phase_spans=result.phase_spans,
        trace_probes=demo.RESPONSE_PROBES[:3],
    )
    assert len(payload.phase_epochs) == 3
    for background in payload.backgrounds:
        assert background.projected_points
        assert len(background.projected_points) == len(background.probabilities)
        assert all(0.0 <= probability <= 1.0 for probability in background.probabilities)


def test_mlp_story_epoch_selector_uses_fixed_story_checkpoints() -> None:
    selected = demo.mlp_story_epochs(400)
    assert selected == [0, 30, 200, 400]

    short_run = demo.mlp_story_epochs(40)
    assert short_run == [0, 30, 40]


def test_render_mlp_assets_uses_fixed_publication_shape(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    xs = torch.zeros((2, 1))
    ys = torch.zeros((2, 1))

    def fake_run_mlp_training(*, epochs: int, batch_size: int, seed: int, hidden_layers: tuple[int, ...]) -> demo.MLPTrainingRun:
        return demo.MLPTrainingRun(
            hidden_layers=hidden_layers,
            loss_history=[0.01],
            predictions_by_epoch={0: xs, 1: xs},
            xs=xs,
            ys=ys,
        )

    monkeypatch.setattr(demo, "run_mlp_training", fake_run_mlp_training)
    manifest = demo.render_mlp_assets(
        output_dir=tmp_path,
        write_html=False,
        seed=7,
        mlp_epochs=4,
        mlp_batch_size=8,
        mlp_shape="32",
    )
    assert manifest["published_shape"] == [32]
    assert "attempted_shape" not in manifest
    assert "loss_threshold" not in manifest


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
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["mlp"]["published_shape"] == [32]


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
            "4",
            "--rnn-test-samples",
            "24",
            "--no-html",
            "--no-trace-images",
        ],
    )
    assert result.exit_code == 0, result.output
    assert (tmp_path / "rnn-training-story.png").exists()
    assert (tmp_path / "manifest.json").exists()
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["rnn"]["trace_projection_mode"] == "pca_top_layer"
