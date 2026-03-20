import json
from pathlib import Path
import sys

from matplotlib.figure import Figure
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
    assert payload.counting_bits == demo.PRECISION_COUNT_BITS
    assert payload.initial_left_stack == "0" * (demo.PRECISION_COUNT_BITS - 1)
    assert payload.initial_right_stack == "0"
    assert len(payload.states) > 200
    assert payload.step_labels[0] == "start"
    assert "carry L" in payload.step_labels
    assert "return R" in payload.step_labels
    assert len(payload.milestone_step_indexes) == len(demo.PRECISION_MILESTONE_COUNTS)
    assert [summary.lag for summary in payload.lag_summaries] == [1, 2, 4]


def test_precision_states_stay_within_depth_cover_intervals() -> None:
    payload = demo.build_precision_story_payload()

    assert all(
        precision_story.state_lies_within_depth_cover(
            state, depth=demo.PRECISION_DUST_DEPTH
        )
        for state in payload.states
    )


def test_precision_story_figure_uses_matplotlib_layout_and_precision_annotations() -> None:
    figure = demo.build_precision_story_figure(demo.build_precision_story_payload())

    assert isinstance(figure, Figure)
    assert len(figure.axes) == 2
    assert figure._suptitle is not None
    axis_text = [text.get_text() for text in figure.axes[0].texts]
    assert "Binary counting sweep through Cantor dust" in figure._suptitle.get_text()
    assert axis_text == []
    assert figure.axes[1].get_title(loc="left") == "Step distance by lag"
    assert figure.axes[1].get_xlabel() == "Euclidean step distance"


def test_article_uses_repo_relative_asset_links() -> None:
    article = Path(
        "blog/15-03-2026-the-theoretical-justification-of-neural-networks/article.md"
    ).read_text(encoding="utf-8")

    assert "../../frontend/public/blog-assets/theoretical-justification-of-neural-networks/mlp-sine-story.svg" in article
    assert "../../frontend/public/blog-assets/theoretical-justification-of-neural-networks/stack-cantor-dust-story.svg" in article
    assert "../../frontend/public/blog-assets/theoretical-justification-of-neural-networks/rnn-training-story.svg" in article
    assert "](/blog-assets/theoretical-justification-of-neural-networks/" not in article


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
    assert demo.phase_epoch_schedule(2) == [2, 2]
    assert demo.phase_batch_schedule() == [8, 16]
    assert demo.build_publication_checkpoint_epochs(2) == [0, 1, 2, 3, 4]
    assert demo.checkpoint_label(0, 2) == "Random init"
    assert demo.checkpoint_label(2, 2) == "After phase 1"
    assert demo.checkpoint_label(4, 2) == "After phase 2"


def test_phase_learning_rate_decays_with_cosine_restarts() -> None:
    phase_1_start = demo.phase_learning_rate(phase_index=0, epoch_in_phase=1, epochs_in_phase=6, lr_start=0.0015, lr_end=0.0002)
    phase_1_end = demo.phase_learning_rate(phase_index=0, epoch_in_phase=6, epochs_in_phase=6, lr_start=0.0015, lr_end=0.0002)
    phase_2_start = demo.phase_learning_rate(phase_index=1, epoch_in_phase=1, epochs_in_phase=6, lr_start=0.0015, lr_end=0.0002)
    phase_2_end = demo.phase_learning_rate(phase_index=1, epoch_in_phase=6, epochs_in_phase=6, lr_start=0.0015, lr_end=0.0002)

    assert phase_1_start > phase_1_end > 0.0002
    assert phase_2_start < phase_1_start
    assert phase_2_end == pytest.approx(0.0002)


def test_phase_builders_use_article_length_regimes() -> None:
    phase_1_examples = demo.build_phase_epoch_examples(
        phase_spec=demo.RNN_PHASE_SPECS[0],
        epoch_index=1,
        total_examples=20,
        seed=7,
    )
    phase_2_examples = demo.build_phase_epoch_examples(
        phase_spec=demo.RNN_PHASE_SPECS[1],
        epoch_index=1,
        total_examples=20,
        seed=17,
    )

    assert {len(example.text) for example in phase_1_examples} <= {2, 4, 6, 8, 20}
    assert 20 in {len(example.text) for example in phase_1_examples}
    assert {len(example.text) for example in phase_2_examples} <= {10, 20, 30}


def test_run_rnn_experiment_returns_phased_shock_story_metadata(
    small_rnn_result: demo.RNNExperimentResult,
) -> None:
    result = small_rnn_result
    assert result.seed == 7
    assert result.model_mode == demo.RNN_MODEL_MODE
    assert result.language == demo.TARGET_LANGUAGE
    assert result.architecture["module"] == "torch.RNN"
    assert result.architecture["nonlinearity"] == "tanh"
    assert result.architecture["hidden_size"] == 4
    assert result.architecture["num_layers"] == 2
    assert result.checkpoint_labels[0] == "Random init"
    assert result.checkpoint_labels[-1] == "After phase 2"
    assert result.phase_epoch_schedule == [2, 2]
    assert result.phase_batch_schedule == [8, 16]
    assert result.phase_family_mix == [
        {"random": 1.0},
        {"random": 0.25, "off_by_one": 0.25, "valid_prefix": 0.25, "balanced_invalid": 0.25},
    ]
    assert len(result.metrics) == len(result.checkpoint_epochs)
    assert len(result.story_response_history) == len(result.checkpoint_epochs)
    assert len(result.story_response_history[0]) == len(result.story_probes)
    assert [span["phase_kind"] for span in result.phase_spans] == [
        demo.PHASE_KIND_PRETRAIN,
        demo.PHASE_KIND_SHOCK,
    ]
    assert sorted(result.checkpoint_states) == result.checkpoint_epochs
    assert len(result.training_texts) > 0


def test_curated_probe_bundle_uses_long_held_out_examples(
    small_rnn_result: demo.RNNExperimentResult,
) -> None:
    from blog.scripts.rnn_transition_selection import build_curated_probe_bundle

    bundle = build_curated_probe_bundle(
        small_rnn_result,
        is_valid_fn=demo.is_balanced_parentheses,
    )

    assert [item.role for item in bundle.selected] == [
        "off-by-one example",
    ]
    assert bundle.ordinary_reference.actual_valid
    assert len(bundle.background) == 96
    assert all(len(item.trajectory.text) in {20, 30} for item in bundle.selected)
    assert all(
        item.trajectory.text not in small_rnn_result.training_texts
        for item in bundle.selected
    )
    assert bundle.boundary_reference.label not in {
        item.trajectory.label for item in bundle.selected
    }
    assert bundle.watchlist_mode == "curated_long_held_out_plus_balanced_background"


def test_build_transition_figure_includes_trace_panels_and_endpoint_context(
    small_rnn_result: demo.RNNExperimentResult,
) -> None:
    import matplotlib.pyplot as plt

    from blog.scripts.rnn_transition_matplotlib import build_transition_figure
    from blog.scripts.rnn_transition_metrics import (
        TransitionMetricsBundle,
        assess_transition,
        build_transition_metrics,
    )
    from blog.scripts.rnn_transition_selection import build_curated_probe_bundle

    bundle = build_curated_probe_bundle(
        small_rnn_result,
        is_valid_fn=demo.is_balanced_parentheses,
    )
    metrics = build_transition_metrics(
        small_rnn_result, is_valid_fn=demo.is_balanced_parentheses
    )
    assessment = assess_transition(
        TransitionMetricsBundle(
            trajectories=bundle.all_trajectories,
            family_series=metrics.family_series,
            phase_epochs=metrics.phase_epochs,
            boundary_family_labels=metrics.boundary_family_labels,
            boundary_family_size=metrics.boundary_family_size,
        ),
        representative_counterexample=bundle.selected[0].trajectory,
        representative_ordinary=bundle.ordinary_reference,
        representative_boundary=bundle.boundary_reference,
    )

    figure = build_transition_figure(
        result=small_rnn_result,
        selected=bundle.selected,
        background=bundle.background,
        phase_spans=small_rnn_result.phase_spans,
        assessment=assessment,
    )

    assert isinstance(figure, Figure)
    assert len(figure.axes) == 4
    assert any(axis.collections for axis in figure.axes[:2])
    assert any(axis.patches for axis in figure.axes[:2])
    assert figure.axes[-1].get_ylabel() == "p(valid)"
    assert any("Watched probe" in text.get_text() for text in figure.axes[2].texts)
    assert any(
        float(collection.get_linewidths()[0]) == 0.0
        for collection in figure.axes[0].collections
        if len(collection.get_linewidths()) > 0
    )
    assert any(
        float(collection.get_linewidths()[0]) >= 0.9
        for collection in figure.axes[0].collections
        if len(collection.get_linewidths()) > 0
    )
    plt.close(figure)

def test_render_rnn_transition_report_produces_static_report_bundle(
    small_rnn_result: demo.RNNExperimentResult,
    tmp_path: Path,
) -> None:
    from blog.scripts.rnn_transition_report import render_rnn_transition_report

    manifest = render_rnn_transition_report(
        small_rnn_result,
        output_dir=tmp_path,
        is_valid_fn=demo.is_balanced_parentheses,
    )

    assert manifest["report_backend"] == "matplotlib"
    assert manifest["report_layout"] == "trace_panels_plus_transition_field"
    assert manifest["transition_classification"] in {"abrupt", "gradual", "absent"}
    assert len(manifest["representative_probes"]) == 1
    assert manifest["watchlist_mode"] == "curated_long_held_out_plus_balanced_background"
    assert manifest["background_probe_count"] == 96
    assert (
        manifest["trace_panel_background_mode"]
        == "held_out_state_cloud_plus_endpoints"
    )
    assert len(manifest["curated_probe_notes"]) == 1
    assert manifest["trace_marker_mode"] == "start_end_only"
    assert manifest["story_value_transform"] == "boundary_emphasized_probability_nonlinear"
    assert manifest["figure_background"] == "dark_slate"
    assert manifest["summary_table_files"] == ["rnn-transition-summary.csv"]
    assert (tmp_path / "rnn-training-story.svg").exists()
    assert (tmp_path / "rnn-transition-summary.csv").exists()
    assert (tmp_path / "rnn-transition-metrics.json").exists()
    assert (tmp_path / "rnn-transition-assessment.md").exists()
    assert not (tmp_path / "rnn-transition-summary.svg").exists()


def test_parse_mlp_shape_accepts_single_and_multiple_layers() -> None:
    assert mlp_story.parse_mlp_shape("32") == (32,)
    assert mlp_story.parse_mlp_shape("32, 32") == (32, 32)


def test_mlp_story_epoch_selector_uses_fixed_story_checkpoints() -> None:
    assert mlp_story.mlp_story_epochs(400) == [0, 30, 200, 400]
    assert mlp_story.mlp_story_epochs(40) == [0, 30, 40]
    assert mlp_story.mlp_story_epochs(400, reorganization_epoch=275) == [
        0,
        30,
        200,
        275,
        400,
    ]


def test_detect_mlp_reorganization_epoch_is_deterministic() -> None:
    loss_history = [0.30 - (0.0004 * epoch) for epoch in range(400)]
    loss_history[274] = 0.205

    epoch, score = mlp_story.detect_mlp_reorganization_epoch(loss_history)

    assert epoch == 275
    assert score > 0.03


def test_render_mlp_assets_uses_fixed_publication_shape(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    xs = torch.zeros((2, 1))
    ys = torch.zeros((2, 1))

    def fake_run_mlp_training(*, epochs: int, batch_size: int, seed: int, hidden_layers: tuple[int, ...]) -> mlp_story.MLPTrainingRun:
        predictions_by_epoch = {epoch: xs for epoch in range(epochs + 1)}
        loss_history = [0.08, 0.07, 0.075, 0.05]
        return mlp_story.MLPTrainingRun(
            hidden_layers=hidden_layers,
            loss_history=loss_history,
            predictions_by_epoch=predictions_by_epoch,
            xs=xs,
            ys=ys,
        )

    monkeypatch.setattr(mlp_story, "run_mlp_training", fake_run_mlp_training)
    manifest = demo.render_mlp_assets(
        output_dir=tmp_path,
        seed=7,
        mlp_epochs=4,
        mlp_batch_size=8,
        mlp_shape="32",
    )
    assert manifest["seed"] == 7
    assert manifest["published_shape"] == [32]
    assert "mlp-sine-story.svg" in manifest["files"]
    assert manifest["selected_epochs"] == [0, 4]
    assert manifest["reorganization_epoch"] == 4
    assert manifest["reorganization_score"] >= 0.0


def test_generate_mlp_cli_smoke(tmp_path: Path) -> None:
    runner = CliRunner()
    result = runner.invoke(
        demo.app,
        ["generate", "--target", "mlp", "--output-dir", str(tmp_path), "--mlp-epochs", "8", "--mlp-batch-size", "32"],
    )
    assert result.exit_code == 0, result.output
    assert (tmp_path / "mlp-sine-story.svg").exists()
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["seed"] == {"shared": None, "mlp": 7, "rnn": 1337}
    assert manifest["mlp"]["seed"] == 7
    assert manifest["mlp"]["published_shape"] == [32, 32]


def test_generate_precision_cli_smoke(tmp_path: Path) -> None:
    runner = CliRunner()
    result = runner.invoke(
        demo.app,
        ["generate", "--target", "precision", "--output-dir", str(tmp_path)],
    )

    assert result.exit_code == 0, result.output
    assert (tmp_path / "stack-cantor-dust-story.svg").exists()
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["precision"]["encoding"] == demo.PRECISION_STORY_MODE
    assert manifest["precision"]["dust_depth"] == demo.PRECISION_DUST_DEPTH
    assert manifest["precision"]["counting_bits"] == demo.PRECISION_COUNT_BITS
    assert manifest["precision"]["lag_distance_lags"] == [1, 2, 4]
    assert manifest["precision"]["label_mode"] == "milestone_markers_only"


def test_generate_all_manifest_includes_precision_section(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(demo, "render_mlp_assets", lambda **_: {"files": ["mlp-sine-story.svg"]})
    monkeypatch.setattr(
        demo,
        "render_precision_assets",
        lambda **_: {
            "files": ["stack-cantor-dust-story.svg"],
            "encoding": demo.PRECISION_STORY_MODE,
            "dust_depth": demo.PRECISION_DUST_DEPTH,
            "counting_bits": demo.PRECISION_COUNT_BITS,
            "initial_left_stack": demo.PRECISION_INITIAL_LEFT_STACK,
            "initial_right_stack": demo.PRECISION_INITIAL_RIGHT_STACK,
            "step_labels": ["start"],
            "lag_distance_lags": [1, 2, 4],
            "milestone_step_indexes": [0],
        },
    )
    monkeypatch.setattr(demo, "render_rnn_assets", lambda **_: {"files": ["rnn-training-story.svg"]})

    runner = CliRunner()
    result = runner.invoke(
        demo.app,
        ["generate", "--target", "all", "--output-dir", str(tmp_path)],
    )

    assert result.exit_code == 0, result.output
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["seed"] == {"shared": None, "mlp": 7, "rnn": 1337}
    assert manifest["mlp"]["files"] == ["mlp-sine-story.svg"]
    assert manifest["precision"]["files"] == ["stack-cantor-dust-story.svg"]
    assert manifest["rnn"]["files"] == ["rnn-training-story.svg"]


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
        ],
    )
    assert result.exit_code == 0, result.output
    assert (tmp_path / "rnn-training-story.svg").exists()
    assert (tmp_path / "rnn-transition-summary.csv").exists()
    assert (tmp_path / "rnn-transition-family-metrics.csv").exists()
    assert (tmp_path / "rnn-transition-probe-trajectories.csv").exists()
    assert (tmp_path / "rnn-transition-metrics.json").exists()
    assert (tmp_path / "rnn-transition-assessment.md").exists()
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["seed"] == {"shared": None, "mlp": 7, "rnn": 1337}
    assert manifest["rnn"]["seed"] == 1337
    assert manifest["rnn"]["model_mode"] == demo.RNN_MODEL_MODE
    assert manifest["rnn"]["language"] == demo.TARGET_LANGUAGE
    assert manifest["rnn"]["architecture"]["module"] == "torch.RNN"
    assert manifest["rnn"]["architecture"]["nonlinearity"] == "tanh"
    assert manifest["rnn"]["architecture"]["hidden_size"] == 4
    assert manifest["rnn"]["architecture"]["num_layers"] == 2
    assert manifest["rnn"]["dynamics"] == "phased_resampled_counterexample_shocks"
    assert manifest["rnn"]["optimizer"] == "adamw"
    assert manifest["rnn"]["learning_rate_schedule"] == "phase_restart_cosine_decay"
    assert manifest["rnn"]["story_plot_sampling"] == "curated_watchlist_plus_balanced_background"
    assert manifest["rnn"]["story_plot_probe_count"] == 97
    assert manifest["rnn"]["report_backend"] == "matplotlib"
    assert manifest["rnn"]["report_layout"] == "trace_panels_plus_transition_field"
    assert manifest["rnn"]["story_value_transform"] == "boundary_emphasized_probability_nonlinear"
    assert manifest["rnn"]["figure_background"] == "dark_slate"
    assert len(manifest["rnn"]["representative_probes"]) == 1
    assert manifest["rnn"]["watchlist_mode"] == "curated_long_held_out_plus_balanced_background"
    assert manifest["rnn"]["curated_probe_roles"] == [
        "off-by-one example",
    ]
    assert len(manifest["rnn"]["curated_probe_texts"]) == 1
    assert len(manifest["rnn"]["curated_probe_notes"]) == 1
    assert manifest["rnn"]["background_probe_count"] == 96
    assert (
        manifest["rnn"]["trace_panel_background_mode"]
        == "held_out_state_cloud_plus_endpoints"
    )
    assert manifest["rnn"]["trace_marker_mode"] == "start_end_only"
    assert "rnn-transition-summary.csv" in manifest["rnn"]["summary_table_files"]
    assert "rnn-transition-metrics.json" in manifest["rnn"]["supporting_metrics_files"]
    assert manifest["rnn"]["phase_schedule"] == [
        "Phase 1: short strings + some random length-20",
        "Phase 2: introduce counterexamples",
    ]
    assert manifest["rnn"]["phase_epoch_schedule"] == [1, 1]
    assert manifest["rnn"]["phase_batch_schedule"] == [8, 16]
