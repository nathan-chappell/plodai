import json
from pathlib import Path
import sys

import pytest
import torch
from typer.testing import CliRunner

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import blog.scripts.mlp_story_artifacts as mlp_story
import blog.scripts.neural_dynamics_artifacts as demo
import blog.scripts.precision_story_artifacts as precision_story


@pytest.fixture(scope="module")
def small_rnn_result() -> demo.RNNExperimentResult:
    return demo.run_rnn_experiment(
        seed=7,
        phase_epochs=2,
        train_samples=12,
        test_samples=12,
        lr_start=demo.DEFAULT_RNN_LR_START,
        lr_end=demo.DEFAULT_RNN_LR_END,
    )


def test_balanced_parentheses_family_predicates() -> None:
    assert demo.is_balanced_parentheses("(())")
    assert demo.is_off_by_one_invalid("(()(()))))")
    assert demo.is_valid_prefix_invalid("(()()(((")
    assert demo.is_balanced_invalid(")(()())(")


def test_balanced_parentheses_family_samplers_are_constructive() -> None:
    rng = demo.random.Random(7)
    valid = demo.sample_valid_sequence_of_length(rng, 10)
    off_by_one = demo.sample_off_by_one_invalid_sequence(rng, 10)
    valid_prefix = demo.sample_valid_prefix_invalid_sequence(rng, 10)
    balanced_invalid = demo.sample_balanced_invalid_sequence(rng, 10)

    assert demo.is_balanced_parentheses(valid)
    assert demo.is_off_by_one_invalid(off_by_one)
    assert demo.is_valid_prefix_invalid(valid_prefix)
    assert demo.is_balanced_invalid(balanced_invalid)


def test_orchestrator_delegates_mlp_and_precision_stories_to_separate_scripts() -> None:
    assert demo.render_mlp_assets is mlp_story.render_mlp_assets
    assert demo.render_precision_assets is precision_story.render_precision_assets
    assert demo.build_precision_story_payload is precision_story.build_precision_story_payload
    assert demo.build_precision_story_figure is precision_story.build_precision_story_figure


def test_precision_story_payload_uses_curated_two_stack_sequence() -> None:
    payload = demo.build_precision_story_payload()

    assert payload.encoding == demo.PRECISION_STORY_MODE
    assert payload.dust_depth == demo.PRECISION_DUST_DEPTH
    assert payload.initial_left_stack == ""
    assert payload.initial_right_stack == "101011001110010110100111001011010011010111001011"
    assert len(payload.states) == 30
    assert payload.step_labels[0] == "start"
    assert payload.step_labels[-1] == "move R"


def test_precision_story_figure_uses_2d_panels_and_precision_annotations() -> None:
    figure = demo.build_precision_story_figure(demo.build_precision_story_payload())

    assert all(trace.type != "scatter3d" for trace in figure.data)
    assert {trace.type for trace in figure.data} == {"scatter"}
    assert len(figure.layout.images) == 1
    assert any("10-bit tape windows" in annotation.text for annotation in figure.layout.annotations)
    assert any("[0]" in annotation.text or "[1]" in annotation.text for annotation in figure.layout.annotations)
    assert any("Finite picture, infinite claim" in annotation.text for annotation in figure.layout.annotations)


def test_story_probe_pool_uses_balanced_family_slice() -> None:
    assert len(demo.STORY_PROBES) == 128
    assert len([probe for probe in demo.STORY_PROBES if probe.probe_kind == "valid"]) == 32
    assert len([probe for probe in demo.STORY_PROBES if probe.probe_kind == demo.PHASE_KIND_OFF_BY_ONE]) == 32
    assert len([probe for probe in demo.STORY_PROBES if probe.probe_kind == demo.PHASE_KIND_VALID_PREFIX]) == 32
    assert len([probe for probe in demo.STORY_PROBES if probe.probe_kind == demo.PHASE_KIND_BALANCED_INVALID]) == 32


def test_acceptance_probability_uses_fixed_ball_geometry() -> None:
    anchor = demo.RNN_ACCEPT_ANCHOR.unsqueeze(0)
    boundary = demo.RNN_ACCEPT_ANCHOR.clone()
    boundary[1] = demo.RNN_ACCEPT_RADIUS
    outside = demo.RNN_ACCEPT_ANCHOR.clone()
    outside[1] = demo.RNN_ACCEPT_RADIUS + 0.35
    probabilities = demo.acceptance_probability(torch.stack([anchor.squeeze(0), boundary, outside], dim=0)).tolist()
    assert probabilities[0] > 0.99
    assert pytest.approx(probabilities[1], rel=0.0, abs=1e-6) == 0.5
    assert probabilities[2] < 0.05


def test_publication_checkpoint_epochs_cover_three_training_phases() -> None:
    assert demo.phase_epoch_schedule(2) == [2, 4, 4]
    assert demo.phase_batch_schedule() == [8, 16, 32]
    assert demo.build_publication_checkpoint_epochs(2) == [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    assert demo.checkpoint_label(0, 2) == "Random init"
    assert demo.checkpoint_label(2, 2) == "After phase 1"
    assert demo.checkpoint_label(6, 2) == "After phase 2"
    assert demo.checkpoint_label(10, 2) == "After phase 3"


def test_phase_learning_rate_decays_with_cosine_restarts() -> None:
    phase_1_start = demo.phase_learning_rate(phase_index=0, epoch_in_phase=1, epochs_in_phase=6, lr_start=0.0015, lr_end=0.00015)
    phase_1_end = demo.phase_learning_rate(phase_index=0, epoch_in_phase=6, epochs_in_phase=6, lr_start=0.0015, lr_end=0.00015)
    phase_2_start = demo.phase_learning_rate(phase_index=1, epoch_in_phase=1, epochs_in_phase=6, lr_start=0.0015, lr_end=0.00015)
    phase_3_end = demo.phase_learning_rate(phase_index=2, epoch_in_phase=6, epochs_in_phase=6, lr_start=0.0015, lr_end=0.00015)

    assert phase_1_start > phase_1_end > 0.00015
    assert phase_2_start < phase_1_start
    assert phase_3_end == pytest.approx(0.00015)


def test_run_rnn_experiment_returns_phased_shock_story_metadata(
    small_rnn_result: demo.RNNExperimentResult,
) -> None:
    result = small_rnn_result
    assert result.model_mode == demo.RNN_MODEL_MODE
    assert result.language == demo.TARGET_LANGUAGE
    assert result.architecture["module"] == "torch.RNN"
    assert result.architecture["nonlinearity"] == "tanh"
    assert result.architecture["hidden_size"] == 4
    assert result.architecture["num_layers"] == 2
    assert result.checkpoint_labels[0] == "Random init"
    assert result.checkpoint_labels[-1] == "After phase 3"
    assert result.phase_epoch_schedule == [2, 4, 4]
    assert result.phase_batch_schedule == [8, 16, 32]
    assert result.phase_family_mix == [
        {"random": 1.0},
        {"random": 0.5, "off_by_one": 0.5},
        {"random": 0.25, "off_by_one": 0.25, "valid_prefix": 0.25, "balanced_invalid": 0.25},
    ]
    assert len(result.metrics) == len(result.checkpoint_epochs)
    assert len(result.story_response_history) == len(result.checkpoint_epochs)
    assert len(result.story_response_history[0]) == len(result.story_probes)
    assert [span["phase_kind"] for span in result.phase_spans] == [
        demo.PHASE_KIND_PRETRAIN,
        demo.PHASE_KIND_SHOCK,
        demo.PHASE_KIND_REINFORCE,
    ]
    assert sorted(result.checkpoint_states) == result.checkpoint_epochs


def test_trace_selection_and_payload_use_four_rows_and_literal_headers(
    small_rnn_result: demo.RNNExperimentResult,
) -> None:
    selection = demo.select_trace_story_probes(small_rnn_result)
    payload = demo.build_trace_grid_payload(result=small_rnn_result, trace_selection=selection)

    assert payload.phase_labels == ["Random init", "After phase 1", "After phase 2", "After phase 3"]
    assert payload.phase_epochs == [0, 2, 6, 10]
    assert payload.probe_role_labels == ["Valid control", "Off-by-one shock", "Valid-prefix repair"]
    assert len(payload.probe_texts) == 3
    assert all(set(text) <= {"(", ")"} for text in payload.probe_texts)
    assert payload.projection_mode == "oblique_pca_2d"
    assert len(payload.cells) == 12
    assert len(payload.acceptance_region) == 73


def test_story_figure_has_three_rows_and_family_probe_annotation(
    small_rnn_result: demo.RNNExperimentResult,
) -> None:
    figure = demo.build_rnn_story_figure(small_rnn_result)

    family_traces = [
        trace
        for trace in figure.data
        if getattr(trace, "yaxis", "") == "y2"
        and getattr(trace, "name", "") in {"off-by-one", "valid-prefix", "balanced-invalid"}
    ]
    sigma_traces = [trace for trace in figure.data if getattr(trace, "yaxis", "") == "y3"]

    assert family_traces
    assert sigma_traces
    assert all(trace.line.dash == "dash" for trace in family_traces)
    assert figure.layout.yaxis3.title.text == "sigma(valid) · boundary zoom"
    assert any("128 fixed length-10 probes" in annotation.text for annotation in figure.layout.annotations)


def test_trace_figure_uses_2d_subplots_with_acceptance_ellipse(
    small_rnn_result: demo.RNNExperimentResult,
) -> None:
    payload = demo.build_trace_grid_payload(
        result=small_rnn_result,
        trace_selection=demo.select_trace_story_probes(small_rnn_result),
    )
    figure = demo.build_trace_figure(payload)

    path_trace = next(
        trace
        for trace in figure.data
        if trace.type == "scatter" and getattr(trace, "mode", "") == "lines+markers"
    )
    acceptance_trace = next(
        trace
        for trace in figure.data
        if trace.type == "scatter" and getattr(trace, "fill", None) == "toself"
    )

    assert all(trace.type != "scatter3d" for trace in figure.data)
    assert path_trace.line.color in demo.STORY_STATUS_COLORS.values()
    assert acceptance_trace.fillcolor == "rgba(74,222,128,0.18)"
    assert any("Valid control: ((((()))))"[:12] in annotation.text or "Valid control: " in annotation.text for annotation in figure.layout.annotations)


def test_parse_mlp_shape_accepts_single_and_multiple_layers() -> None:
    assert mlp_story.parse_mlp_shape("32") == (32,)
    assert mlp_story.parse_mlp_shape("32, 32") == (32, 32)


def test_mlp_story_epoch_selector_uses_fixed_story_checkpoints() -> None:
    assert mlp_story.mlp_story_epochs(400) == [0, 30, 200, 400]
    assert mlp_story.mlp_story_epochs(40) == [0, 30, 40]


def test_render_mlp_assets_uses_fixed_publication_shape(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
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

    monkeypatch.setattr(mlp_story, "run_mlp_training", fake_run_mlp_training)
    manifest = demo.render_mlp_assets(
        output_dir=tmp_path,
        write_html=False,
        seed=7,
        mlp_epochs=4,
        mlp_batch_size=8,
        mlp_shape="32",
    )
    assert manifest["published_shape"] == [32]


def test_generate_mlp_cli_smoke(tmp_path: Path) -> None:
    runner = CliRunner()
    result = runner.invoke(
        demo.app,
        ["generate", "--target", "mlp", "--output-dir", str(tmp_path), "--mlp-epochs", "8", "--mlp-batch-size", "32", "--no-html"],
    )
    assert result.exit_code == 0, result.output
    assert (tmp_path / "mlp-sine-story.png").exists()
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["mlp"]["published_shape"] == [32, 32]


def test_generate_precision_cli_smoke(tmp_path: Path) -> None:
    runner = CliRunner()
    result = runner.invoke(
        demo.app,
        ["generate", "--target", "precision", "--output-dir", str(tmp_path), "--no-html"],
    )

    assert result.exit_code == 0, result.output
    assert (tmp_path / "stack-cantor-dust-story.png").exists()
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["precision"]["encoding"] == demo.PRECISION_STORY_MODE
    assert manifest["precision"]["dust_depth"] == demo.PRECISION_DUST_DEPTH


def test_generate_all_manifest_includes_precision_section(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(demo, "render_mlp_assets", lambda **_: {"files": ["mlp-sine-story.png"]})
    monkeypatch.setattr(
        demo,
        "render_precision_assets",
        lambda **_: {
            "files": ["stack-cantor-dust-story.png"],
            "encoding": demo.PRECISION_STORY_MODE,
            "dust_depth": demo.PRECISION_DUST_DEPTH,
            "initial_left_stack": demo.PRECISION_INITIAL_LEFT_STACK,
            "initial_right_stack": demo.PRECISION_INITIAL_RIGHT_STACK,
            "step_labels": ["start"],
            "zoom_depths": list(demo.PRECISION_ZOOM_DEPTHS),
        },
    )
    monkeypatch.setattr(demo, "render_rnn_assets", lambda **_: {"files": ["rnn-training-story.png"]})

    runner = CliRunner()
    result = runner.invoke(
        demo.app,
        ["generate", "--target", "all", "--output-dir", str(tmp_path), "--no-html", "--no-trace-images"],
    )

    assert result.exit_code == 0, result.output
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["mlp"]["files"] == ["mlp-sine-story.png"]
    assert manifest["precision"]["files"] == ["stack-cantor-dust-story.png"]
    assert manifest["rnn"]["files"] == ["rnn-training-story.png"]


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
            "8",
            "--no-html",
            "--no-trace-images",
        ],
    )
    assert result.exit_code == 0, result.output
    assert (tmp_path / "rnn-training-story.png").exists()
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["rnn"]["model_mode"] == demo.RNN_MODEL_MODE
    assert manifest["rnn"]["language"] == demo.TARGET_LANGUAGE
    assert manifest["rnn"]["architecture"]["module"] == "torch.RNN"
    assert manifest["rnn"]["architecture"]["nonlinearity"] == "tanh"
    assert manifest["rnn"]["architecture"]["hidden_size"] == 4
    assert manifest["rnn"]["architecture"]["num_layers"] == 2
    assert manifest["rnn"]["dynamics"] == "phased_resampled_counterexample_shocks"
    assert manifest["rnn"]["optimizer"] == "adamw"
    assert manifest["rnn"]["learning_rate_schedule"] == "phase_restart_cosine_decay"
    assert manifest["rnn"]["story_plot_sampling"] == "deterministic_family_balanced_slice"
    assert manifest["rnn"]["acceptance_region_shape"] == "projected_ball_ellipse"
    assert manifest["rnn"]["trace_projection_mode"] == "oblique_pca_2d"
    assert manifest["rnn"]["phase_schedule"] == [
        "Phase 1: random baseline",
        "Phase 2: add off-by-one",
        "Phase 3: add valid-prefix + balanced-invalid",
    ]
    assert manifest["rnn"]["phase_epoch_schedule"] == [1, 2, 2]
    assert manifest["rnn"]["phase_batch_schedule"] == [8, 16, 32]
