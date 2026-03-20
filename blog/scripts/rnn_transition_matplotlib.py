from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import math

import matplotlib

matplotlib.use("Agg")
from matplotlib import pyplot as plt
from matplotlib.axes import Axes
from matplotlib.colors import LinearSegmentedColormap, Normalize
from matplotlib.figure import Figure
from matplotlib.lines import Line2D
import torch

from blog.scripts.artifact_common import (
    STATIC_ACCENT_INK,
    STATIC_FIELD_INK,
    STATIC_FIGURE_BG,
    STATIC_GUIDE_INK,
    STATIC_MAIN_INK,
    STATIC_PANEL_BG,
    STATIC_SECONDARY_INK,
    STATIC_SPINE_INK,
    STATIC_TEXT_INK,
    apply_static_rcparams,
    font_kwargs,
    style_static_axis,
    write_matplotlib_figure,
)
from blog.scripts.rnn_transition_metrics import TransitionAssessment, ProbeTrajectoryMetrics
from blog.scripts.rnn_transition_selection import SelectedTrajectory


BOUNDARY_EMPHASIS_K = 20.0
MAIN_INK = STATIC_MAIN_INK
SECONDARY_INK = STATIC_SECONDARY_INK
ACCENT_INK = STATIC_ACCENT_INK
GUIDE_INK = STATIC_GUIDE_INK
SPINE_INK = STATIC_SPINE_INK
BACKGROUND_FIELD_INK = STATIC_FIELD_INK
LOCAL_NEIGHBOR_INK = "#6f8da8"
TRACE_COLORS = ("#dd6b5f",)
ACCEPT_FILL = (0.51, 0.65, 0.54, 0.15)
ACCEPT_EDGE = "#78b97c"
PROBABILITY_CMAP = LinearSegmentedColormap.from_list(
    "muted_probability",
    ("#d35f53", "#b7c0aa", "#6fc17a"),
)
PROBABILITY_NORM = Normalize(vmin=0.0, vmax=1.0)


@dataclass(frozen=True, kw_only=True)
class TraceCurve2D:
    role: str
    text: str
    probability: float
    actual_valid: bool
    predicted_valid: bool
    correct: bool
    points: tuple[tuple[float, float], ...]


@dataclass(frozen=True, kw_only=True)
class BackgroundState2D:
    probability: float
    point: tuple[float, float]
    is_endpoint: bool


@dataclass(frozen=True, kw_only=True)
class TracePanel2D:
    phase_label: str
    curves: tuple[TraceCurve2D, ...]
    background_points: tuple[BackgroundState2D, ...]
    acceptance_region: tuple[tuple[float, float], ...]
    x_range: tuple[float, float]
    y_range: tuple[float, float]


def _style_axis(ax: Axes, *, hide_ticks: bool = False) -> None:
    style_static_axis(ax, hide_ticks=hide_ticks)


def _phase_guides(ax: Axes, phase_spans: list[dict[str, object]]) -> None:
    for index, span in enumerate(phase_spans):
        start_epoch = float(span["start_epoch"])
        end_epoch = float(span["end_epoch"])
        ax.axvspan(
            start_epoch,
            end_epoch,
            ymin=0.0,
            ymax=0.055,
            color="#18212a",
            linewidth=0,
            zorder=0,
        )
        if index > 0:
            ax.axvline(start_epoch, color=GUIDE_INK, linewidth=0.8, zorder=1)
        ax.text(
            0.5 * (start_epoch + end_epoch),
            0.022,
            str(span["label"]).replace("Phase 1: ", "").replace("Phase 2: ", ""),
            transform=ax.get_xaxis_transform(),
            ha="center",
            va="bottom",
            **font_kwargs(size=8.5, color=STATIC_SECONDARY_INK),
        )


def _transition_band(
    ax: Axes, selected: tuple[SelectedTrajectory, ...], assessment: TransitionAssessment
) -> None:
    if assessment.classification == "absent":
        return
    counterexample_like = [
        item for item in selected if item.trajectory.family_type != "ordinary"
    ]
    if not counterexample_like:
        return
    center = sum(
        item.trajectory.max_step_checkpoint for item in counterexample_like
    ) / len(counterexample_like)
    width = 8 if assessment.classification == "abrupt" else 14
    ax.axvspan(
        center - width / 2.0,
        center + width / 2.0,
        color="#2a1f1b",
        alpha=0.18,
        linewidth=0,
        zorder=0,
    )
    ax.text(
        center,
        0.93,
        "transition window",
        transform=ax.get_xaxis_transform(),
        ha="center",
        va="bottom",
        **font_kwargs(size=8.6, color=ACCENT_INK),
    )


def _quantile(values: list[float], q: float) -> float:
    if not values:
        return 0.5
    ordered = sorted(values)
    position = min(len(ordered) - 1, max(0, int(round(q * (len(ordered) - 1)))))
    return float(ordered[position])


def _clip_series(
    values: tuple[float, ...], lower: float, upper: float
) -> tuple[float, ...]:
    return tuple(min(upper, max(lower, value)) for value in values)


def _label_endpoints(
    ax: Axes,
    selected: tuple[SelectedTrajectory, ...],
    y_values: list[float],
    x_value: float,
) -> None:
    ordered = sorted(zip(y_values, selected, strict=True), key=lambda item: item[0])
    adjusted: list[float] = []
    minimum_gap = 0.055
    for y_value, _item in ordered:
        adjusted_y = y_value if not adjusted else max(y_value, adjusted[-1] + minimum_gap)
        adjusted.append(adjusted_y)
    for index in range(len(adjusted) - 2, -1, -1):
        adjusted[index] = min(adjusted[index], adjusted[index + 1] - minimum_gap)
    for adjusted_y, (y_value, item) in zip(adjusted, ordered, strict=True):
        ax.annotate(
            _endpoint_role_label(item),
            xy=(x_value, y_value),
            xytext=(x_value + 2.8, adjusted_y),
            textcoords="data",
            ha="left",
            va="center",
            **font_kwargs(size=8.0, color=STATIC_TEXT_INK),
            bbox={
                "boxstyle": "round,pad=0.18",
                "facecolor": STATIC_PANEL_BG,
                "edgecolor": "#33414e",
                "linewidth": 0.7,
            },
            arrowprops={
                "arrowstyle": "-",
                "linewidth": 0.6,
                "color": GUIDE_INK,
                "shrinkA": 0,
                "shrinkB": 0,
            },
        )


def _fallback_secondary_axis(
    pc1: torch.Tensor, right_vectors: torch.Tensor
) -> torch.Tensor:
    for index in range(1, right_vectors.shape[0]):
        candidate = right_vectors[index].to(dtype=torch.float32)
        orthogonal = candidate - torch.dot(candidate, pc1) * pc1
        norm = torch.linalg.vector_norm(orthogonal)
        if norm > 1e-6:
            return orthogonal / norm
    basis = torch.eye(len(pc1), dtype=torch.float32)
    for index in range(basis.shape[0]):
        candidate = basis[index]
        orthogonal = candidate - torch.dot(candidate, pc1) * pc1
        norm = torch.linalg.vector_norm(orthogonal)
        if norm > 1e-6:
            return orthogonal / norm
    raise ValueError("Unable to build a secondary projection axis.")


def _fit_trace_projection(
    points: list[list[float]],
    *,
    accept_center: torch.Tensor,
    watched_endpoint: torch.Tensor,
) -> tuple[torch.Tensor, torch.Tensor]:
    tensor = torch.tensor(points, dtype=torch.float32)
    mean = tensor.mean(dim=0)
    centered = tensor - mean
    _, _singular_values, right_vectors = torch.linalg.svd(
        centered, full_matrices=False
    )
    pc1 = right_vectors[0].to(dtype=torch.float32)
    pc1 = pc1 / torch.linalg.vector_norm(pc1).clamp(min=1e-12)

    separation = watched_endpoint.to(dtype=torch.float32) - accept_center.to(
        dtype=torch.float32
    )
    projected_separation = separation - torch.dot(separation, pc1) * pc1
    projected_norm = torch.linalg.vector_norm(projected_separation)
    if projected_norm <= 1e-6:
        secondary = _fallback_secondary_axis(pc1, right_vectors)
    else:
        secondary = projected_separation / projected_norm
    if torch.dot(separation, secondary) < 0:
        secondary = -secondary
    basis = torch.stack((pc1, secondary), dim=1)
    return mean, basis


def _project_points(
    points: list[list[float]], *, mean: torch.Tensor, basis: torch.Tensor
) -> tuple[tuple[float, float], ...]:
    tensor = torch.tensor(points, dtype=torch.float32)
    projected = (tensor - mean) @ basis
    return tuple((float(point[0].item()), float(point[1].item())) for point in projected)


def _boundary_emphasis_transform(probability: float) -> float:
    centered = probability - 0.5
    if abs(centered) <= 1e-12:
        return 0.5
    numerator = math.log1p(BOUNDARY_EMPHASIS_K * abs(centered))
    denominator = 2.0 * math.log1p(0.5 * BOUNDARY_EMPHASIS_K)
    return 0.5 + (math.copysign(numerator / denominator, centered))


def _transform_series(values: tuple[float, ...]) -> tuple[float, ...]:
    return tuple(_boundary_emphasis_transform(value) for value in values)


def _project_acceptance_region(
    *,
    center: torch.Tensor,
    radius: float,
    mean: torch.Tensor,
    basis: torch.Tensor,
    steps: int = 96,
) -> tuple[tuple[float, float], ...]:
    projected_center = (center.to(dtype=torch.float32) - mean) @ basis
    _, singular_values, right_vectors = torch.linalg.svd(basis, full_matrices=False)
    ellipse_points: list[tuple[float, float]] = []
    for step in range(steps + 1):
        theta = (2.0 * math.pi * step) / steps
        unit = torch.tensor([math.cos(theta), math.sin(theta)], dtype=torch.float32)
        offset = radius * (unit * singular_values) @ right_vectors
        point = projected_center + offset
        ellipse_points.append((float(point[0].item()), float(point[1].item())))
    return tuple(ellipse_points)


def _trace_support(
    result,
    *,
    selected: tuple[SelectedTrajectory, ...],
    global_background: tuple[ProbeTrajectoryMetrics, ...],
) -> tuple[TracePanel2D, ...]:
    from blog.scripts.neural_dynamics_artifacts import (
        PhasedTorchRNN,
        RNN_ACCEPT_ANCHOR,
        RNN_ACCEPT_RADIUS,
        acceptance_probability,
        load_model_parameters,
    )

    phase_epochs = [int(span["end_epoch"]) for span in result.phase_spans]
    phase_labels = [f"After phase {index}" for index in range(1, len(phase_epochs) + 1)]
    raw_panel_curves: list[tuple[str, list[dict[str, object]], list[dict[str, object]]]] = []
    all_points: list[list[float]] = [RNN_ACCEPT_ANCHOR.tolist()]
    watched_endpoint: torch.Tensor | None = None
    model = PhasedTorchRNN()
    model.eval()
    selected_texts = [item.trajectory.text for item in selected]
    background_texts = [item.text for item in global_background]
    for phase_epoch, phase_label in zip(phase_epochs, phase_labels, strict=True):
        load_model_parameters(model, result.checkpoint_states[phase_epoch])
        selected_states, selected_traces = model(selected_texts, capture_traces=True)
        assert selected_traces is not None
        selected_probabilities = acceptance_probability(selected_states).tolist()
        panel_curves: list[dict[str, object]] = []
        for item, probability, raw_trace in zip(
            selected,
            selected_probabilities,
            selected_traces.tolist(),
            strict=True,
        ):
            trimmed_points = raw_trace[: len(item.trajectory.text)]
            if (
                phase_epoch == phase_epochs[-1]
                and item.trajectory.label == selected[0].trajectory.label
                and trimmed_points
            ):
                watched_endpoint = torch.tensor(trimmed_points[-1], dtype=torch.float32)
            panel_curves.append(
                {
                    "role": item.role,
                    "text": item.trajectory.text,
                    "actual_valid": item.trajectory.actual_valid,
                    "predicted_valid": probability >= 0.5,
                    "correct": (probability >= 0.5) == item.trajectory.actual_valid,
                    "probability": float(probability),
                    "raw_points": trimmed_points,
                }
            )
            all_points.extend(trimmed_points)
        _, background_traces = model(background_texts, capture_traces=True)
        assert background_traces is not None
        raw_background: list[dict[str, object]] = []
        for probe, raw_trace in zip(
            global_background, background_traces.tolist(), strict=True
        ):
            trimmed_points = raw_trace[: len(probe.text)]
            probabilities = acceptance_probability(
                torch.tensor(trimmed_points, dtype=torch.float32)
            ).tolist()
            for point_index, (point, probability) in enumerate(
                zip(trimmed_points, probabilities, strict=True)
            ):
                raw_background.append(
                    {
                        "probability": float(probability),
                        "raw_point": point,
                        "is_endpoint": point_index == len(trimmed_points) - 1,
                    }
                )
                all_points.append(point)
        raw_panel_curves.append((phase_label, panel_curves, raw_background))

    if watched_endpoint is None:
        watched_endpoint = RNN_ACCEPT_ANCHOR.to(dtype=torch.float32)
    mean, basis = _fit_trace_projection(
        all_points,
        accept_center=RNN_ACCEPT_ANCHOR,
        watched_endpoint=watched_endpoint,
    )
    acceptance_region = _project_acceptance_region(
        center=RNN_ACCEPT_ANCHOR,
        radius=RNN_ACCEPT_RADIUS,
        mean=mean,
        basis=basis,
    )
    all_projected_points = list(acceptance_region)
    rendered_panels: list[TracePanel2D] = []
    for phase_label, panel_curves, raw_background in raw_panel_curves:
        rendered_curves: list[TraceCurve2D] = []
        for curve in panel_curves:
            projected_points = _project_points(
                curve["raw_points"],
                mean=mean,
                basis=basis,
            )
            all_projected_points.extend(projected_points)
            rendered_curves.append(
                TraceCurve2D(
                    role=str(curve["role"]),
                    text=str(curve["text"]),
                    probability=float(curve["probability"]),
                    actual_valid=bool(curve["actual_valid"]),
                    predicted_valid=bool(curve["predicted_valid"]),
                    correct=bool(curve["correct"]),
                    points=projected_points,
                )
            )
        background_points: list[BackgroundState2D] = []
        for point in raw_background:
            projected_point = _project_points(
                [point["raw_point"]],
                mean=mean,
                basis=basis,
            )[0]
            all_projected_points.append(projected_point)
            background_points.append(
                BackgroundState2D(
                    probability=float(point["probability"]),
                    point=projected_point,
                    is_endpoint=bool(point["is_endpoint"]),
                )
            )
        rendered_panels.append(
            TracePanel2D(
                phase_label=phase_label,
                curves=tuple(rendered_curves),
                background_points=tuple(background_points),
                acceptance_region=acceptance_region,
                x_range=(0.0, 0.0),
                y_range=(0.0, 0.0),
            )
        )

    xs = [point[0] for point in all_projected_points]
    ys = [point[1] for point in all_projected_points]
    x_center = 0.5 * (min(xs) + max(xs))
    y_center = 0.5 * (min(ys) + max(ys))
    span = max(max(xs) - min(xs), max(ys) - min(ys), 1e-6)
    half_span = 0.56 * span
    x_range = (x_center - half_span, x_center + half_span)
    y_range = (y_center - half_span, y_center + half_span)
    final_panels = tuple(
        TracePanel2D(
            phase_label=panel.phase_label,
            curves=panel.curves,
            background_points=panel.background_points,
            acceptance_region=panel.acceptance_region,
            x_range=x_range,
            y_range=y_range,
        )
        for panel in rendered_panels
    )
    return final_panels


def _trace_endpoint_color(curve: TraceCurve2D) -> str:
    if curve.correct and curve.actual_valid:
        return "#7ac884"
    if curve.correct:
        return "#d2ab68"
    return "#da695e"


def _endpoint_role_label(item: SelectedTrajectory) -> str:
    phase_1_correct = bool(item.trajectory.correctness[2])
    phase_2_correct = bool(item.trajectory.correctness[-1])
    if phase_1_correct and phase_2_correct:
        suffix = "stable"
    elif (not phase_1_correct) and phase_2_correct:
        suffix = "corrected"
    elif phase_1_correct and (not phase_2_correct):
        suffix = "regressed"
    else:
        suffix = "misclassified"
    return f"{item.role} ({suffix})"


def _probe_status_note(item: SelectedTrajectory) -> str:
    phase_1_correct = bool(item.trajectory.correctness[2])
    phase_2_correct = bool(item.trajectory.correctness[-1])
    if phase_1_correct and phase_2_correct:
        return "correct at both phase endpoints"
    if (not phase_1_correct) and phase_2_correct:
        return "wrong after phase 1, corrected after phase 2"
    if phase_1_correct and (not phase_2_correct):
        return "correct after phase 1, wrong after phase 2"
    return "misclassified at both phase endpoints"


def _draw_probe_identification_panel(
    ax: Axes, *, selected: tuple[SelectedTrajectory, ...]
) -> None:
    ax.set_facecolor(STATIC_PANEL_BG)
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)

    ax.text(
        0.0,
        0.98,
        "Watched probe",
        transform=ax.transAxes,
        ha="left",
        va="top",
        **font_kwargs(size=10.0, color=STATIC_TEXT_INK),
    )
    ax.scatter(
        [0.02],
        [0.84],
        transform=ax.transAxes,
        s=26,
        marker="s",
        facecolors=(1.0, 1.0, 1.0, 0.10),
        edgecolors=(1.0, 1.0, 1.0, 0.95),
        linewidths=0.82,
        clip_on=False,
    )
    ax.text(
        0.08,
        0.84,
        "start",
        transform=ax.transAxes,
        ha="left",
        va="center",
        **font_kwargs(size=8.0, color=STATIC_SECONDARY_INK),
    )
    ax.scatter(
        [0.36],
        [0.84],
        transform=ax.transAxes,
        s=34,
        facecolors="#dfe8f2",
        edgecolors=(1.0, 1.0, 1.0, 0.95),
        linewidths=0.82,
        clip_on=False,
    )
    ax.text(
        0.42,
        0.84,
        "end",
        transform=ax.transAxes,
        ha="left",
        va="center",
        **font_kwargs(size=8.0, color=STATIC_SECONDARY_INK),
    )

    y_positions = (0.56,) if len(selected) == 1 else (0.66, 0.34)
    for y_pos, color, item in zip(y_positions, TRACE_COLORS, selected, strict=True):
        ax.add_line(
            Line2D(
                [0.0, 0.12],
                [y_pos, y_pos],
                transform=ax.transAxes,
                color=color,
                linewidth=1.4,
                solid_capstyle="round",
            )
        )
        ax.text(
            0.16,
            y_pos + 0.06,
            item.role,
            transform=ax.transAxes,
            ha="left",
            va="center",
            **font_kwargs(size=8.9, color=STATIC_TEXT_INK),
            bbox={
                "boxstyle": "round,pad=0.20",
                "facecolor": STATIC_PANEL_BG,
                "edgecolor": "#33414e",
                "linewidth": 0.8,
            },
        )
        ax.text(
            0.16,
            y_pos - 0.01,
            item.trajectory.text,
            transform=ax.transAxes,
            ha="left",
            va="center",
            **font_kwargs(size=8.1, color=STATIC_SECONDARY_INK),
        )
        ax.text(
            0.16,
            y_pos - 0.12,
            _probe_status_note(item),
            transform=ax.transAxes,
            ha="left",
            va="center",
            **font_kwargs(size=7.7, color=STATIC_SECONDARY_INK),
        )
        ax.text(
            0.16,
            y_pos - 0.22,
            item.note,
            transform=ax.transAxes,
            ha="left",
            va="center",
            **font_kwargs(size=7.6, color=STATIC_SECONDARY_INK),
        )


def _draw_trace_panel(ax: Axes, panel: TracePanel2D) -> None:
    _style_axis(ax, hide_ticks=True)
    accept_x = [point[0] for point in panel.acceptance_region]
    accept_y = [point[1] for point in panel.acceptance_region]
    ax.fill(
        accept_x,
        accept_y,
        facecolor=ACCEPT_FILL,
        edgecolor=ACCEPT_EDGE,
        linewidth=1.0,
        zorder=1,
    )
    if panel.x_range[0] < 0.0 < panel.x_range[1]:
        ax.axvline(0.0, color=GUIDE_INK, linewidth=0.6, zorder=0)
    if panel.y_range[0] < 0.0 < panel.y_range[1]:
        ax.axhline(0.0, color=GUIDE_INK, linewidth=0.6, zorder=0)

    if panel.background_points:
        interior_points = [point for point in panel.background_points if not point.is_endpoint]
        endpoint_points = [point for point in panel.background_points if point.is_endpoint]
        if interior_points:
            ax.scatter(
                [point.point[0] for point in interior_points],
                [point.point[1] for point in interior_points],
                c=[point.probability for point in interior_points],
                cmap=PROBABILITY_CMAP,
                norm=PROBABILITY_NORM,
                s=10,
                alpha=0.42,
                linewidths=0.0,
                zorder=2,
            )
        ax.scatter(
            [point.point[0] for point in endpoint_points],
            [point.point[1] for point in endpoint_points],
            c=[point.probability for point in endpoint_points],
            cmap=PROBABILITY_CMAP,
            norm=PROBABILITY_NORM,
            s=22,
            alpha=0.95,
            linewidths=0.0,
            edgecolors="none",
            zorder=3,
        )
        legend_x = (0.62, 0.73, 0.84)
        legend_vals = (0.0, 0.5, 1.0)
        ax.text(
            0.62,
            0.96,
            "p(valid)",
            transform=ax.transAxes,
            ha="left",
            va="top",
            **font_kwargs(size=7.8, color=STATIC_SECONDARY_INK),
        )
        for x_pos, value in zip(legend_x, legend_vals, strict=True):
            ax.scatter(
                [x_pos],
                [0.90],
                transform=ax.transAxes,
                s=18,
                color=PROBABILITY_CMAP(PROBABILITY_NORM(value)),
                edgecolors="none",
                linewidths=0.0,
                zorder=7,
                clip_on=False,
            )
            ax.text(
                x_pos + 0.02,
                0.90,
                f"{value:.1f}",
                transform=ax.transAxes,
                ha="left",
                va="center",
                **font_kwargs(size=7.1, color=STATIC_SECONDARY_INK),
            )

    for index, curve in enumerate(panel.curves):
        color = TRACE_COLORS[index % len(TRACE_COLORS)]
        xs = [point[0] for point in curve.points]
        ys = [point[1] for point in curve.points]
        ax.plot(xs, ys, color=color, linewidth=0.56, alpha=0.98, zorder=4)
        ax.scatter(
            [xs[0]],
            [ys[0]],
            s=38,
            marker="s",
            facecolors=(1.0, 1.0, 1.0, 0.12),
            edgecolors=(1.0, 1.0, 1.0, 0.95),
            linewidths=1.0,
            zorder=5,
        )
        ax.scatter(
            [xs[-1]],
            [ys[-1]],
            s=58,
            facecolors=_trace_endpoint_color(curve),
            edgecolors=(1.0, 1.0, 1.0, 0.95),
            linewidths=1.0,
            zorder=6,
        )
    ax.set_xlim(*panel.x_range)
    ax.set_ylim(*panel.y_range)
    ax.set_aspect("equal", adjustable="box")
    ax.set_title(panel.phase_label, loc="left", **font_kwargs(size=10.5, color=STATIC_TEXT_INK))


def build_transition_figure(
    *,
    result,
    selected: tuple[SelectedTrajectory, ...],
    local_neighbors: tuple[ProbeTrajectoryMetrics, ...],
    global_background: tuple[ProbeTrajectoryMetrics, ...],
    phase_spans: list[dict[str, object]],
    assessment: TransitionAssessment,
) -> Figure:
    apply_static_rcparams()
    trace_panels = _trace_support(
        result,
        selected=selected,
        global_background=global_background,
    )

    fig = plt.figure(figsize=(13.1, 7.7))
    fig.patch.set_facecolor(STATIC_FIGURE_BG)
    grid = fig.add_gridspec(
        2,
        3,
        height_ratios=[1.0, 0.95],
        width_ratios=[1.0, 1.0, 0.78],
        hspace=0.32,
        wspace=0.18,
    )
    trace_axes = [fig.add_subplot(grid[0, 0]), fig.add_subplot(grid[0, 1])]
    info_ax = fig.add_subplot(grid[0, 2])
    line_ax = fig.add_subplot(grid[1, :])

    for axis, panel in zip(trace_axes, trace_panels, strict=True):
        _draw_trace_panel(axis, panel)
    _draw_probe_identification_panel(info_ax, selected=selected)

    _style_axis(line_ax)
    line_ax.set_title(
        "Corrected off-by-one neighborhood across checkpoints",
        loc="left",
        **font_kwargs(size=10.5, color=STATIC_TEXT_INK),
        pad=8,
    )
    epochs = selected[0].trajectory.epochs
    selected_endpoint_values: list[float] = []
    for item in selected:
        selected_endpoint_values.append(item.trajectory.probabilities[-1])

    for trajectory in global_background:
        values = _transform_series(trajectory.probabilities)
        line_ax.plot(
            epochs,
            values,
            color=BACKGROUND_FIELD_INK,
            linewidth=0.62,
            alpha=0.10,
            zorder=1,
        )

    for trajectory in local_neighbors:
        values = _transform_series(trajectory.probabilities)
        line_ax.plot(
            epochs,
            values,
            color=LOCAL_NEIGHBOR_INK,
            linewidth=0.92,
            alpha=0.46,
            zorder=3,
        )

    for index, item in enumerate(selected):
        color = TRACE_COLORS[index % len(TRACE_COLORS)]
        values = _transform_series(item.trajectory.probabilities)
        line_ax.plot(epochs, values, color=color, linewidth=1.35, zorder=4)
        line_ax.scatter(
            [epochs[-1]],
            [values[-1]],
            s=12,
            color=color,
            zorder=5,
        )

    _phase_guides(line_ax, phase_spans)
    _transition_band(line_ax, selected, assessment)
    line_ax.axhline(
        _boundary_emphasis_transform(0.5),
        color=GUIDE_INK,
        linewidth=0.8,
        linestyle=(0, (2.0, 2.0)),
        zorder=1,
    )
    line_ax.axhspan(
        _boundary_emphasis_transform(0.45),
        _boundary_emphasis_transform(0.55),
        color="#16301f",
        alpha=0.04,
        zorder=0,
    )
    line_ax.axhline(
        _boundary_emphasis_transform(0.45),
        color="#305c3f",
        linewidth=0.55,
        alpha=0.65,
        zorder=1,
    )
    line_ax.axhline(
        _boundary_emphasis_transform(0.55),
        color="#5a3c32",
        linewidth=0.55,
        alpha=0.65,
        zorder=1,
    )
    line_ax.set_xlim(min(epochs), max(epochs) + 22)
    line_ax.set_ylim(0.0, 1.0)
    tick_probs = (0.0, 0.25, 0.45, 0.5, 0.55, 0.75, 1.0)
    line_ax.set_yticks([_boundary_emphasis_transform(value) for value in tick_probs])
    line_ax.set_yticklabels([f"{value:.2f}".rstrip("0").rstrip(".") for value in tick_probs])
    line_ax.set_xlabel("checkpoint epoch", **font_kwargs(size=10.0, color=STATIC_TEXT_INK))
    line_ax.set_ylabel("p(valid)", **font_kwargs(size=10.0, color=STATIC_TEXT_INK))
    _label_endpoints(
        line_ax,
        selected,
        list(_transform_series(tuple(selected_endpoint_values))),
        max(epochs),
    )

    fig.suptitle(
        "Held-out phase endpoints and watched probe transitions",
        x=0.07,
        y=0.95,
        ha="left",
        **font_kwargs(size=12.0, color=STATIC_TEXT_INK),
    )
    fig.subplots_adjust(left=0.07, right=0.975, top=0.88, bottom=0.12)
    return fig


def render_transition_figure(
    *,
    result,
    selected: tuple[SelectedTrajectory, ...],
    local_neighbors: tuple[ProbeTrajectoryMetrics, ...],
    global_background: tuple[ProbeTrajectoryMetrics, ...],
    phase_spans: list[dict[str, object]],
    assessment: TransitionAssessment,
    output_dir: Path,
    stem: str,
) -> list[str]:
    fig = build_transition_figure(
        result=result,
        selected=selected,
        local_neighbors=local_neighbors,
        global_background=global_background,
        phase_spans=phase_spans,
        assessment=assessment,
    )
    written = write_matplotlib_figure(
        fig,
        output_dir=output_dir,
        stem=stem,
    )
    plt.close(fig)
    return written
