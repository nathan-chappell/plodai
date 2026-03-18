from dataclasses import replace
import json
from pathlib import Path
import random
import sys

import pytest
import torch
from typer.testing import CliRunner

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import blog.scripts.neural_dynamics_artifacts as demo


def make_probe_trajectory(
    probe: demo.ProbeSpec,
    correctness: tuple[bool, ...],
    probabilities: tuple[float, ...],
) -> demo.ProbeTrajectory:
    epochs = tuple(index * 10 for index in range(len(correctness)))
    return demo.ProbeTrajectory(
        probe=probe,
        actual_valid=demo.is_balanced_parentheses(probe.text),
        epochs=epochs,
        probabilities=probabilities,
        correctness=correctness,
        turn_pattern=demo.compress_boolean_runs(list(correctness)),
        flip_epochs=tuple(
            epochs[index + 1]
            for index in range(len(correctness) - 1)
            if correctness[index] != correctness[index + 1]
        ),
    )


def test_balanced_parentheses_validator() -> None:
    assert demo.is_balanced_parentheses("(())()")
    assert not demo.is_balanced_parentheses("(()")
    assert not demo.is_balanced_parentheses("())(")


def test_valid_prefix_invalid_validator_and_sampler() -> None:
    assert demo.is_valid_prefix_invalid("()(()(")
    assert not demo.is_valid_prefix_invalid("(())()")
    assert not demo.is_valid_prefix_invalid("())(()")

    sampled = demo.sample_valid_prefix_invalid_sequence(random.Random(7), 20)
    assert len(sampled) == 20
    assert demo.is_valid_prefix_invalid(sampled)
    assert not demo.is_balanced_parentheses(sampled)
    assert demo.min_prefix_balance(sampled) >= 0
    assert demo.terminal_balance(sampled) > 0


def test_corruption_invalid_validator_excludes_balanced_and_prefix_cases() -> None:
    assert demo.is_corruption_invalid("(())))(())")
    assert not demo.is_corruption_invalid("()(()(")
    assert not demo.is_corruption_invalid(")((()))(")
    assert not demo.is_corruption_invalid("(())()")


def test_rnn_publication_defaults_match_requested_refresh() -> None:
    assert demo.RNN_HIDDEN_SIZE == 8
    assert demo.RNN_NUM_LAYERS == 2
    assert demo.DEFAULT_PHASE_EPOCHS == 10
    assert demo.DEFAULT_RANDOM_PHASE_EPOCHS == 10
    assert demo.DEFAULT_COUNTEREXAMPLE_PHASE_EPOCHS == 20
    assert demo.DEFAULT_BATCH_SIZE == 16
    assert demo.DEFAULT_TRAIN_SAMPLES == 64
    assert demo.DEFAULT_RANDOM_COHORT_SIZE == 768
    assert demo.DEFAULT_COUNTEREXAMPLE_COHORT_SIZE == 64
    assert demo.DEFAULT_RNN_LR == pytest.approx(0.001)


def test_parse_mlp_shape_accepts_single_and_multiple_layers() -> None:
    assert demo.parse_mlp_shape("32") == (32,)
    assert demo.parse_mlp_shape("32, 32") == (32, 32)


def test_retained_support_builder_returns_explicit_baseline_and_shock_pool() -> None:
    support = demo.build_retained_support(
        random_cohort_size=80,
        counterexample_cohort_size=20,
        seed=7,
    )
    assert set(support) == {
        demo.SUPPORT_COHORT_RANDOM,
        demo.SUPPORT_COHORT_OFF_BY_ONE,
        demo.SUPPORT_COHORT_BALANCED,
        demo.SUPPORT_COHORT_VALID_PREFIX,
    }
    assert len(support[demo.SUPPORT_COHORT_RANDOM]) == 80
    assert len(support[demo.SUPPORT_COHORT_OFF_BY_ONE]) == 20
    assert len(support[demo.SUPPORT_COHORT_BALANCED]) == 20
    assert len(support[demo.SUPPORT_COHORT_VALID_PREFIX]) == 20
    assert sum(len(examples) for examples in support.values()) == 140


def test_phase_support_uses_large_random_baseline_and_small_cumulative_shock() -> None:
    phases = demo.build_training_phases(
        random_phase_epochs=5,
        counterexample_phase_epochs=10,
        random_cohort_size=80,
        counterexample_cohort_size=20,
        lr_start=0.08,
        lr_end=0.02,
    )
    support = demo.build_retained_support(
        random_cohort_size=80,
        counterexample_cohort_size=20,
        seed=7,
    )

    phase_1 = demo.materialize_phase_examples(support, phases[0])
    phase_2 = demo.materialize_phase_examples(support, phases[1])

    assert len(phases) == 2
    assert phases[0].cohort_sizes == (80, 0, 0, 0)
    assert phases[1].cohort_sizes == (80, 20, 20, 20)
    assert phases[0].support_size == 80
    assert phases[1].support_size == 140
    assert len(phase_1) == 80
    assert len(phase_2) == 140
    assert {example.text for example in phase_1}.issubset({example.text for example in phase_2})
    assert demo.random_baseline_cohort_size(20) == 240
    assert demo.counterexample_phase_epochs(5) == 10


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
    assert traces[0].shape[2] == 8


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
    trajectories = demo.build_probe_trajectories(result)
    highlighted = demo.select_highlighted_probe_trajectories(trajectories)
    selection = demo.select_trace_story_probes(result, flips)
    payload = demo.build_trace_grid_payload(
        model_builder=lambda: demo.TinyTraceRNN(hidden_size=demo.RNN_HIDDEN_SIZE, num_layers=demo.RNN_NUM_LAYERS),
        checkpoints=checkpoints,
        phase_spans=result.phase_spans,
        trace_probes=selection.selected_probes,
    )

    assert payload.phase_epochs == [1, 3]
    assert payload.phase_labels == [
        "After phase 1: random baseline",
        "After phase 2: add counterexamples",
    ]
    assert len(payload.probe_labels) == 3
    assert len(payload.cells) == 6
    assert len(payload.cells[0].raw_points[0]) == 8
    assert len(payload.cells[0].projected_points[0]) == 3
    assert len(payload.backgrounds) == 2
    assert len(payload.landmarks) == 6
    assert payload.projection_mode == "pca_top_layer_3d"
    assert payload.axis_labels[0].startswith("PC1")
    assert payload.axis_labels[1].startswith("PC2")
    assert payload.axis_labels[2].startswith("PC3")
    assert len(payload.explained_variance) == 3
    assert len(payload.backgrounds[0].projected_points) == len(payload.backgrounds[0].probabilities)
    assert selection.focus_probe.short_label in (
        {probe.short_label for probe in result.story_probes}
        | {probe.short_label for probe in demo.RESPONSE_PROBES}
    )
    if highlighted:
        assert selection.focus_probe.short_label == highlighted[0].probe.short_label
    assert payload.probe_labels == [probe.label for probe in selection.selected_probes]
    assert all(trajectory.probe.short_label in {probe.short_label for probe in result.story_probes} for trajectory in highlighted)


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
    assert len(payload.phase_epochs) == 2
    for background in payload.backgrounds:
        assert background.projected_points
        assert len(background.projected_points) == len(background.probabilities)
        assert len(background.projected_points[0]) == 3
        assert all(0.0 <= probability <= 1.0 for probability in background.probabilities)


def test_response_probe_pool_has_expected_story_samples() -> None:
    labels = {probe.short_label for probe in demo.RESPONSE_PROBES}
    assert len(demo.RESPONSE_PROBES) == 96
    assert {"10O10", "20B10", "30P4", "10V4", "20R4"} <= labels


def test_story_probe_pool_covers_all_binary_strings_of_length_10() -> None:
    assert len(demo.STORY_PROBES) == 2 ** 10
    assert len({probe.text for probe in demo.STORY_PROBES}) == 2 ** 10
    assert all(len(probe.text) == 10 for probe in demo.STORY_PROBES)
    assert sum(1 for probe in demo.STORY_PROBES if probe.probe_kind == "valid") == 42


def test_candidate_probe_pool_is_deterministic_and_family_specific() -> None:
    off_by_one_pool = demo.build_probe_candidate_pool(length=20, probe_kind=demo.PHASE_KIND_OFF_BY_ONE, pool_size=24)
    assert off_by_one_pool == demo.build_probe_candidate_pool(length=20, probe_kind=demo.PHASE_KIND_OFF_BY_ONE, pool_size=24)
    assert off_by_one_pool
    assert all(demo.is_corruption_invalid(text) for text in off_by_one_pool)

    balanced_pool = demo.build_probe_candidate_pool(length=20, probe_kind=demo.PHASE_KIND_BALANCED, pool_size=24)
    assert balanced_pool
    assert all(demo.is_balanced_invalid(text) for text in balanced_pool)

    prefix_pool = demo.build_probe_candidate_pool(length=20, probe_kind=demo.PHASE_KIND_VALID_PREFIX, pool_size=24)
    assert prefix_pool
    assert all(demo.is_valid_prefix_invalid(text) for text in prefix_pool)


def test_probe_trajectory_scoring_prefers_late_recoveries() -> None:
    late = demo.score_probe_probability_trajectory(
        [0.64, 0.61, 0.59, 0.51, 0.42],
        actual_valid=False,
        checkpoint_epochs=[0, 10, 20, 30, 40],
    )
    early = demo.score_probe_probability_trajectory(
        [0.64, 0.44, 0.41, 0.33, 0.24],
        actual_valid=False,
        checkpoint_epochs=[0, 10, 20, 30, 40],
    )
    assert late > early


def test_probability_to_sigma_clips_and_preserves_sign() -> None:
    assert demo.probability_to_sigma(0.5) == pytest.approx(0.0)
    assert demo.probability_to_sigma(0.8413447460685429) == pytest.approx(1.0, abs=1e-3)
    assert demo.probability_to_sigma(0.15865525393145707) == pytest.approx(-1.0, abs=1e-3)
    assert demo.probability_to_sigma(1.0) == demo.probability_to_sigma(1.0 - demo.SIGMA_CLIP_PROBABILITY)
    assert demo.probability_to_sigma(0.0) == demo.probability_to_sigma(demo.SIGMA_CLIP_PROBABILITY)
    assert demo.probability_to_sigma(0.99) > 0
    assert demo.probability_to_sigma(0.01) < 0


def test_select_highlighted_probe_trajectories_prefers_multi_turn_patterns() -> None:
    simple = make_probe_trajectory(
        demo.RESPONSE_PROBES[0],
        (False, True, True, True, True),
        (0.62, 0.44, 0.41, 0.39, 0.38),
    )
    multi_turn = make_probe_trajectory(
        demo.RESPONSE_PROBES[1],
        (True, False, True, True, True),
        (0.18, 0.62, 0.46, 0.58, 0.61),
    )
    oscillating = make_probe_trajectory(
        demo.RESPONSE_PROBES[2],
        (False, True, False, True, False),
        (0.63, 0.43, 0.58, 0.42, 0.61),
    )

    selected = demo.select_highlighted_probe_trajectories(
        [simple, multi_turn, oscillating],
        limit=2,
    )

    assert [trajectory.probe.short_label for trajectory in selected] == [
        oscillating.probe.short_label,
        multi_turn.probe.short_label,
    ]
    assert all(trajectory.turn_count >= 2 for trajectory in selected)


def test_trace_figure_uses_status_colors_and_emphasized_region_map() -> None:
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
        trace_probes=demo.select_trace_story_probes(result, demo.build_probe_flips(result)).selected_probes,
    )
    figure = demo.build_trace_figure(payload)

    background_trace = next(
        trace
        for trace in figure.data
        if trace.type == "scatter3d" and "sigma(valid)" in str(trace.hovertemplate) and "map point" in str(trace.hovertemplate)
    )
    trace_path = next(
        trace
        for trace in figure.data
        if trace.type == "scatter3d" and getattr(trace, "mode", "") == "lines+markers+text" and "phase=" in str(trace.hovertemplate)
    )
    layout_dict = figure.to_dict()["layout"]
    scene_names = [key for key in layout_dict if key.startswith("scene")]
    anchor_labels = {str(step) for step in demo.trace_anchor_steps(len(payload.cells[0].projected_points))}
    rendered_labels = {label for label in trace_path.text if label}
    frame_axes = [
        trace for trace in figure.data if trace.type == "scatter3d" and getattr(trace, "meta", None) == "frame-axis"
    ]

    assert isinstance(background_trace.marker.size, tuple)
    assert min(background_trace.marker.size) < max(background_trace.marker.size)
    assert max(background_trace.marker.size) < 12
    assert background_trace.marker.opacity == 0.24
    assert background_trace.marker.cmin == -demo.TRACE_SIGMA_RANGE
    assert background_trace.marker.cmax == demo.TRACE_SIGMA_RANGE
    assert background_trace.marker.colorbar.title.text == "sigma(valid)"
    assert trace_path.line.dash == "dot"
    assert trace_path.line.color in {"#2a9d55", "#ca8a04", "#dc2626"}
    assert isinstance(trace_path.marker.size, tuple)
    assert min(trace_path.marker.size) < max(trace_path.marker.size)
    assert rendered_labels == anchor_labels
    assert len(frame_axes) == len(payload.phase_labels) * len(payload.probe_labels) * 3
    assert len(scene_names) == len(payload.phase_labels) * len(payload.probe_labels)
    assert any("Shared PCA axes:" in annotation.text for annotation in figure.layout.annotations)
    assert any("negative sigma = reject-leaning" in annotation.text for annotation in figure.layout.annotations)
    for scene_name in scene_names:
        scene = layout_dict[scene_name]
        assert scene["xaxis"]["title"]["text"] == ""
        assert scene["yaxis"]["title"]["text"] == ""
        assert scene["zaxis"]["title"]["text"] == ""
        assert scene["xaxis"]["showbackground"] is True
        assert scene["yaxis"]["showbackground"] is True
        assert scene["zaxis"]["showbackground"] is True


def test_story_figure_uses_linear_lines_left_aligned_phase_boundaries_and_turn_annotations() -> None:
    result, _ = demo.run_rnn_experiment(
        seed=7,
        phase_epochs=1,
        train_samples=4,
        test_samples=24,
        lr_start=demo.DEFAULT_RNN_LR,
        lr_end=demo.DEFAULT_RNN_LR,
    )
    trajectories = demo.build_probe_trajectories(
        result,
        probes=result.story_probes,
        response_history=result.story_response_history,
    )
    interesting = next(trajectory for trajectory in trajectories if trajectory.ever_wrong)
    stable = next(trajectory for trajectory in trajectories if not trajectory.ever_wrong)
    highlighted = replace(
        interesting,
        turn_pattern=(True, False, True),
        flip_epochs=(2, 3),
    )
    figure = demo.build_rnn_story_figure(
        result,
        focus_short_label=highlighted.probe.short_label,
        highlighted_trajectories=[highlighted],
    )

    interesting_trace = next(
        trace for trace in figure.data if getattr(trace, "mode", "") == "lines" and highlighted.probe.short_label in str(trace.hovertemplate)
    )
    stable_trace = next(
        trace for trace in figure.data if getattr(trace, "mode", "") == "lines" and stable.probe.short_label in str(trace.hovertemplate)
    )
    phase_boundaries = sorted(
        shape.x0 for shape in figure.layout.shapes if shape.type == "line" and shape.x0 == shape.x1
    )
    annotations = [annotation.text for annotation in figure.layout.annotations]

    assert interesting_trace.line.shape in (None, "linear")
    assert stable_trace.line.shape in (None, "linear")
    assert interesting_trace.line.dash == "dash"
    assert stable_trace.line.dash == "solid"
    assert interesting_trace.opacity > stable_trace.opacity
    assert interesting_trace.line.width > stable_trace.line.width
    assert interesting_trace.line.color in demo.STORY_STATUS_COLORS.values()
    assert stable_trace.line.color in demo.STORY_STATUS_COLORS.values()
    assert figure.layout.yaxis2.title.text == "sigma(valid)"
    assert phase_boundaries == [2]
    assert any("<b>P1 · random baseline</b>" == text for text in annotations)
    assert any("<b>P2 · add counterexamples</b>" == text for text in annotations)
    assert any("bottom axis uses signed sigma units" in text for text in annotations)
    assert any("C = correct, I = incorrect" in text for text in annotations)
    assert any("all 1024 binary strings of length 10" in text for text in annotations)
    assert any("C -> I -> C" in text for text in annotations)


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
    assert manifest["rnn"]["trace_projection_mode"] == "pca_top_layer_3d"
    assert len(manifest["rnn"]["phases"]) == 2
    assert demo.SUPPORT_COHORT_VALID_PREFIX in manifest["rnn"]["support_cohorts"]
    assert manifest["rnn"]["batch_size"] == 16
    assert manifest["rnn"]["optimizer"] == "adam"
    assert manifest["rnn"]["learning_rate"] == pytest.approx(0.001)
    assert manifest["rnn"]["phase_count"] == 2
    assert manifest["rnn"]["phase_epoch_split"] == [1, 2]
    assert manifest["rnn"]["random_cohort_size"] == 48
    assert manifest["rnn"]["counterexample_cohort_size"] == 4
    assert manifest["rnn"]["cohort_size"] == 48
    assert manifest["rnn"]["retained_support_size"] == 60
    assert "highlighted_probe_trajectories" in manifest["rnn"]
    assert manifest["rnn"]["story_probe_mode"] == "all_binary_strings_length_10"
    assert manifest["rnn"]["story_probe_count"] == 1024
    assert len(manifest["rnn"]["trace_phase_epochs"]) == 2
    assert len(manifest["rnn"]["trace_phase_labels"]) == 2
    assert len(manifest["rnn"]["trace_axis_labels"]) == 3
    assert len(manifest["rnn"]["trace_explained_variance"]) == 3
