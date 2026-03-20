from __future__ import annotations

from dataclasses import dataclass
import statistics
from typing import Any, Callable, Literal, Protocol, Sequence


class ProbeLike(Protocol):
    label: str
    text: str
    probe_kind: str
    short_label: str


class MetricLike(Protocol):
    epoch: int
    eval_10_acc: float
    eval_20_acc: float
    eval_30_acc: float
    eval_50_acc: float
    off_by_one_acc: float
    valid_prefix_acc: float
    balanced_invalid_acc: float


class ResultLike(Protocol):
    metrics: Sequence[MetricLike]
    story_probes: Sequence[ProbeLike]
    story_response_history: Sequence[Sequence[float]]
    phase_spans: Sequence[dict[str, Any]]


@dataclass(frozen=True, kw_only=True)
class ProbeTrajectoryMetrics:
    label: str
    text: str
    probe_kind: str
    actual_valid: bool
    family_type: Literal["ordinary", "counterexample", "near-boundary"]
    epochs: tuple[int, ...]
    probabilities: tuple[float, ...]
    correctness: tuple[bool, ...]
    phase_scores: tuple[float, ...]
    net_change: float
    total_variation: float
    max_step_checkpoint: int
    max_step_change: float
    local_window_change: float
    concentration: float
    min_boundary_distance: float
    flip_epochs: tuple[int, ...]


@dataclass(frozen=True, kw_only=True)
class BehavioralSeries:
    label: str
    family_type: Literal["ordinary", "counterexample", "near-boundary"]
    epochs: tuple[int, ...]
    values: tuple[float, ...]
    phase_scores: tuple[float, ...]
    net_change: float
    total_variation: float
    max_step_checkpoint: int
    max_step_change: float
    concentration: float


@dataclass(frozen=True, kw_only=True)
class TransitionMetricsBundle:
    trajectories: tuple[ProbeTrajectoryMetrics, ...]
    family_series: tuple[BehavioralSeries, ...]
    phase_epochs: tuple[int, ...]
    boundary_family_labels: tuple[str, ...]
    boundary_family_size: int


@dataclass(frozen=True, kw_only=True)
class TransitionAssessment:
    classification: Literal["abrupt", "gradual", "absent"]
    measured_facts: tuple[str, ...]
    interpretation: tuple[str, ...]
    uncertainty: tuple[str, ...]


def _phase_endpoint_epochs(result: ResultLike) -> tuple[int, ...]:
    return (0, *(int(span["end_epoch"]) for span in result.phase_spans))


def _phase_scores(
    values: Sequence[float], epochs: Sequence[int], phase_epochs: Sequence[int]
) -> tuple[float, ...]:
    index_by_epoch = {epoch: index for index, epoch in enumerate(epochs)}
    return tuple(float(values[index_by_epoch[epoch]]) for epoch in phase_epochs)


def _transition_window(
    values: Sequence[float], epochs: Sequence[int]
) -> tuple[int, float, float, float, tuple[int, ...]]:
    if len(values) < 2:
        return int(epochs[0]), 0.0, 0.0, 0.0, ()
    deltas = [
        float(right - left) for left, right in zip(values[:-1], values[1:], strict=True)
    ]
    absolute_deltas = [abs(delta) for delta in deltas]
    max_index = max(range(len(absolute_deltas)), key=absolute_deltas.__getitem__)
    total_variation = float(sum(absolute_deltas))
    concentration = (
        0.0
        if total_variation <= 1e-12
        else float(absolute_deltas[max_index] / total_variation)
    )
    left_index = max(0, max_index - 1)
    right_index = min(len(values) - 1, max_index + 1)
    local_window_change = abs(float(values[right_index] - values[left_index]))
    flip_epochs = tuple(
        int(epochs[index + 1])
        for index, (left, right) in enumerate(zip(values[:-1], values[1:], strict=True))
        if (left - 0.5) * (right - 0.5) < 0
    )
    return (
        int(epochs[max_index + 1]),
        float(absolute_deltas[max_index]),
        float(local_window_change),
        float(concentration),
        flip_epochs,
    )


def build_probe_trajectories(
    result: ResultLike,
    *,
    is_valid_fn: Callable[[str], bool],
) -> tuple[ProbeTrajectoryMetrics, ...]:
    epochs = tuple(int(metric.epoch) for metric in result.metrics)
    phase_epochs = _phase_endpoint_epochs(result)
    trajectories: list[ProbeTrajectoryMetrics] = []
    for probe_index, probe in enumerate(result.story_probes):
        probabilities = tuple(
            float(row[probe_index]) for row in result.story_response_history
        )
        actual_valid = bool(is_valid_fn(probe.text))
        correctness = tuple((value >= 0.5) == actual_valid for value in probabilities)
        (
            max_step_checkpoint,
            max_step_change,
            local_window_change,
            concentration,
            flip_epochs,
        ) = _transition_window(probabilities, epochs)
        trajectories.append(
            ProbeTrajectoryMetrics(
                label=str(probe.short_label),
                text=str(probe.text),
                probe_kind=str(probe.probe_kind),
                actual_valid=actual_valid,
                family_type="ordinary" if actual_valid else "counterexample",
                epochs=epochs,
                probabilities=probabilities,
                correctness=correctness,
                phase_scores=_phase_scores(probabilities, epochs, phase_epochs),
                net_change=float(probabilities[-1] - probabilities[0]),
                total_variation=float(
                    sum(
                        abs(right - left)
                        for left, right in zip(
                            probabilities[:-1], probabilities[1:], strict=True
                        )
                    )
                ),
                max_step_checkpoint=max_step_checkpoint,
                max_step_change=max_step_change,
                local_window_change=local_window_change,
                concentration=concentration,
                min_boundary_distance=float(
                    min(abs(value - 0.5) for value in probabilities)
                ),
                flip_epochs=flip_epochs,
            )
        )
    return tuple(trajectories)


def _boundary_family(
    trajectories: Sequence[ProbeTrajectoryMetrics], *, size: int
) -> tuple[ProbeTrajectoryMetrics, ...]:
    ordered = sorted(
        trajectories,
        key=lambda item: (
            -len(item.flip_epochs),
            item.min_boundary_distance,
            -item.local_window_change,
            item.text,
        ),
    )
    return tuple(ordered[: min(size, len(ordered))])


def build_behavioral_series(
    result: ResultLike,
    *,
    trajectories: Sequence[ProbeTrajectoryMetrics],
    boundary_family_size: int = 12,
) -> tuple[tuple[BehavioralSeries, ...], tuple[str, ...]]:
    epochs = tuple(int(metric.epoch) for metric in result.metrics)
    phase_epochs = _phase_endpoint_epochs(result)
    broad_rule_values = tuple(
        float(
            statistics.fmean(
                (
                    metric.eval_10_acc,
                    metric.eval_20_acc,
                    metric.eval_30_acc,
                    metric.eval_50_acc,
                )
            )
        )
        for metric in result.metrics
    )
    counterexample_values = tuple(
        float(
            statistics.fmean(
                (
                    metric.off_by_one_acc,
                    metric.valid_prefix_acc,
                    metric.balanced_invalid_acc,
                )
            )
        )
        for metric in result.metrics
    )
    boundary_family = _boundary_family(trajectories, size=boundary_family_size)
    boundary_values = []
    for checkpoint_index in range(len(epochs)):
        boundary_values.append(
            float(
                statistics.fmean(
                    1.0 if probe.correctness[checkpoint_index] else 0.0
                    for probe in boundary_family
                )
            )
        )
    series_specs = (
        ("broad rule family", "ordinary", broad_rule_values),
        ("counterexample family", "counterexample", counterexample_values),
        ("near-boundary probe family", "near-boundary", tuple(boundary_values)),
    )
    rendered: list[BehavioralSeries] = []
    for label, family_type, values in series_specs:
        (
            max_step_checkpoint,
            max_step_change,
            _local_window_change,
            concentration,
            _flip_epochs,
        ) = _transition_window(values, epochs)
        rendered.append(
            BehavioralSeries(
                label=label,
                family_type=family_type,
                epochs=epochs,
                values=tuple(float(value) for value in values),
                phase_scores=_phase_scores(values, epochs, phase_epochs),
                net_change=float(values[-1] - values[0]),
                total_variation=float(
                    sum(
                        abs(right - left)
                        for left, right in zip(values[:-1], values[1:], strict=True)
                    )
                ),
                max_step_checkpoint=max_step_checkpoint,
                max_step_change=max_step_change,
                concentration=concentration,
            )
        )
    return tuple(rendered), tuple(probe.label for probe in boundary_family)


def build_transition_metrics(
    result: ResultLike,
    *,
    is_valid_fn: Callable[[str], bool],
    boundary_family_size: int = 12,
) -> TransitionMetricsBundle:
    trajectories = build_probe_trajectories(result, is_valid_fn=is_valid_fn)
    family_series, boundary_family_labels = build_behavioral_series(
        result,
        trajectories=trajectories,
        boundary_family_size=boundary_family_size,
    )
    return TransitionMetricsBundle(
        trajectories=trajectories,
        family_series=family_series,
        phase_epochs=_phase_endpoint_epochs(result),
        boundary_family_labels=boundary_family_labels,
        boundary_family_size=min(boundary_family_size, len(trajectories)),
    )


def assess_transition(
    metrics: TransitionMetricsBundle,
    *,
    representative_counterexample: ProbeTrajectoryMetrics,
    representative_ordinary: ProbeTrajectoryMetrics,
    representative_boundary: ProbeTrajectoryMetrics,
) -> TransitionAssessment:
    ordinary_population = [
        probe for probe in metrics.trajectories if probe.actual_valid
    ]
    counterexample_population = [
        probe for probe in metrics.trajectories if not probe.actual_valid
    ]
    ordinary_mean_step = float(
        statistics.fmean(probe.max_step_change for probe in ordinary_population)
    )
    counterexample_mean_step = float(
        statistics.fmean(probe.max_step_change for probe in counterexample_population)
    )
    counterexample_mean_concentration = float(
        statistics.fmean(probe.concentration for probe in counterexample_population)
    )
    counterexample_window = max(
        probe.max_step_checkpoint for probe in counterexample_population
    ) - min(probe.max_step_checkpoint for probe in counterexample_population)

    if (
        counterexample_mean_step > ordinary_mean_step * 1.75
        and counterexample_mean_concentration >= 0.55
        and counterexample_window <= 20
    ):
        classification: Literal["abrupt", "gradual", "absent"] = "abrupt"
    elif (
        counterexample_mean_step > ordinary_mean_step * 1.15
        and counterexample_mean_concentration >= 0.32
    ):
        classification = "gradual"
    else:
        classification = "absent"

    measured_facts = (
        f"The representative counterexample {representative_counterexample.label} changes by {representative_counterexample.net_change:+.3f} in p(valid), with its steepest checkpoint-to-checkpoint move ending at epoch {representative_counterexample.max_step_checkpoint}.",
        f"The ordinary probe {representative_ordinary.label} changes by {representative_ordinary.net_change:+.3f} overall and has total variation {representative_ordinary.total_variation:.3f}.",
        f"The near-boundary probe {representative_boundary.label} comes within {representative_boundary.min_boundary_distance:.3f} of the decision boundary and flips at epochs {list(representative_boundary.flip_epochs) or '[]'}.",
        f"Across the whole probe pool, mean counterexample step size is {counterexample_mean_step:.3f} versus {ordinary_mean_step:.3f} for ordinary probes.",
    )
    interpretation = (
        "A bifurcation-like interpretation is warranted only if counterexample change is concentrated into a narrow checkpoint window and clearly exceeds the ordinary-family background drift.",
        f"On these measurements the transition is classified as {classification}.",
        "The classification is driven by the concentration of counterexample changes and their separation from ordinary-probe movement, not by the appearance of the plot alone.",
    )
    uncertainty = (
        "The checkpoints are sparse publication checkpoints rather than every optimization step, so any narrow event could be broader or sharper between samples.",
        "The representative probes are selected by explicit metrics, but a different probe pool or seed could shift which examples look most illustrative.",
        "This is evidence for a phase-specific learning transition, not a proof of a dynamical bifurcation in the formal systems sense.",
    )
    return TransitionAssessment(
        classification=classification,
        measured_facts=measured_facts,
        interpretation=interpretation,
        uncertainty=uncertainty,
    )
