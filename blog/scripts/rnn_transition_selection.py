from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from blog.scripts.rnn_transition_metrics import (
    ProbeTrajectoryMetrics,
    ResultLike,
    TransitionMetricsBundle,
    build_probe_trajectories,
)


@dataclass(frozen=True, kw_only=True)
class SelectedTrajectory:
    role: str
    note: str
    trajectory: ProbeTrajectoryMetrics


@dataclass(frozen=True, kw_only=True)
class CuratedProbeBundle:
    selected: tuple[SelectedTrajectory, ...]
    local_neighbors: tuple[ProbeTrajectoryMetrics, ...]
    global_background: tuple[ProbeTrajectoryMetrics, ...]
    all_trajectories: tuple[ProbeTrajectoryMetrics, ...]
    ordinary_reference: ProbeTrajectoryMetrics
    boundary_reference: ProbeTrajectoryMetrics
    watchlist_mode: str


@dataclass(frozen=True)
class _SyntheticProbe:
    label: str
    text: str
    probe_kind: str
    short_label: str


@dataclass(frozen=True)
class _SyntheticResult:
    metrics: tuple[Any, ...]
    story_probes: tuple[_SyntheticProbe, ...]
    story_response_history: tuple[tuple[float, ...], ...]
    phase_spans: tuple[dict[str, Any], ...]


def representative_selection_rule() -> str:
    return (
        "Off-by-one example: longer held-out off-by-one counterexample with the strongest move "
        "toward correct rejection, preferring actual boundary crossings; "
        "ordinary support: longer held-out balanced string with clear nested structure, "
        "preferring high depth, low drift, and correct acceptance throughout; "
        "near-boundary support: chosen separately from the held-out pool for assessment only, "
        "using boundary distance, flips, and local change rather than visual prominence."
    )


def watchlist_mode() -> str:
    return "corrected_off_by_one_single_flip_neighborhood_plus_faint_global_field"


def select_representative_trajectories(
    metrics: TransitionMetricsBundle,
) -> tuple[SelectedTrajectory, ...]:
    trajectories = list(metrics.trajectories)
    ordinary_candidates = [probe for probe in trajectories if probe.actual_valid]
    ordinary = sorted(
        ordinary_candidates,
        key=lambda probe: (
            not probe.correctness[-1],
            probe.total_variation,
            -probe.probabilities[-1],
            probe.text,
        ),
    )[0]

    invalid_candidates = [probe for probe in trajectories if not probe.actual_valid]
    counterexample = sorted(
        invalid_candidates,
        key=lambda probe: (
            not probe.correctness[-1],
            -(probe.probabilities[0] - probe.probabilities[-1]),
            -probe.local_window_change,
            -probe.concentration,
            probe.text,
        ),
    )[0]

    remainder = [
        probe
        for probe in trajectories
        if probe.label not in {ordinary.label, counterexample.label}
    ]
    boundary = sorted(
        remainder,
        key=lambda probe: (
            -len(probe.flip_epochs),
            probe.min_boundary_distance,
            -probe.local_window_change,
            probe.text,
        ),
    )[0]

    return (
        SelectedTrajectory(
            role="ordinary stable",
            note="high-confidence valid control with low total variation",
            trajectory=ordinary,
        ),
        SelectedTrajectory(
            role="counterexample shift",
            note="largest measured move toward correct rejection",
            trajectory=counterexample,
        ),
        SelectedTrajectory(
            role="near-boundary",
            note="closest sustained approach to the decision boundary, preferring flips",
            trajectory=boundary,
        ),
    )


def _max_depth(text: str) -> int:
    depth = 0
    max_depth = 0
    for char in text:
        depth += 1 if char == "(" else -1
        max_depth = max(max_depth, depth)
    return max_depth


def _candidate_pool(
    result: ResultLike,
) -> tuple[_SyntheticProbe, ...]:
    from blog.scripts.neural_dynamics_artifacts import (
        PHASE_KIND_BALANCED_INVALID,
        PHASE_KIND_OFF_BY_ONE,
        PHASE_KIND_VALID_PREFIX,
        ProbeSpec,
        RNN_FAMILY_LENGTH,
        sample_balanced_invalid_sequence,
        sample_examples_by_builder,
        sample_off_by_one_invalid_sequence,
        sample_valid_prefix_invalid_sequence,
        sample_valid_sequence_of_length,
    )

    del ProbeSpec  # imported for locality/documentation only
    assert hasattr(result, "training_texts")
    assert hasattr(result, "seed")
    excluded = set(getattr(result, "training_texts"))
    base_seed = int(getattr(result, "seed")) + 20_000
    lengths = (RNN_FAMILY_LENGTH, 30)
    per_family_total = 48
    per_length = (per_family_total // 2, per_family_total - (per_family_total // 2))
    families: tuple[tuple[str, str, Callable[..., str]], ...] = (
        ("V", "valid", sample_valid_sequence_of_length),
        ("O", PHASE_KIND_OFF_BY_ONE, sample_off_by_one_invalid_sequence),
        ("P", PHASE_KIND_VALID_PREFIX, sample_valid_prefix_invalid_sequence),
        ("B", PHASE_KIND_BALANCED_INVALID, sample_balanced_invalid_sequence),
    )
    probes: list[_SyntheticProbe] = []
    for family_index, (prefix, kind, builder) in enumerate(families):
        family_examples: list[Any] = []
        for length_index, (length, total_examples) in enumerate(
            zip(lengths, per_length, strict=True)
        ):
            family_examples.extend(
                sample_examples_by_builder(
                    total_examples=total_examples,
                    length=length,
                    builder=builder,
                    label=1 if kind == "valid" else 0,
                    kind=kind,
                    family=f"held-out-{kind}-{length}",
                    seed=base_seed + (family_index * 1000) + (length_index * 100),
                    exclude_texts=excluded,
                    allow_repeats=False,
                )
            )
        for index, example in enumerate(family_examples, start=1):
            probes.append(
                _SyntheticProbe(
                    label=f"{prefix}{index:02d}",
                    text=example.text,
                    probe_kind=example.kind,
                    short_label=f"{prefix}{index:02d}",
                )
            )
    return tuple(probes)


def _probe_trajectories_for_probes(
    result: ResultLike,
    probes: tuple[_SyntheticProbe, ...],
    *,
    is_valid_fn: Callable[[str], bool],
) -> tuple[ProbeTrajectoryMetrics, ...]:
    from blog.scripts.neural_dynamics_artifacts import (
        PhasedTorchRNN,
        build_story_response_row,
        load_model_parameters,
    )

    if not probes:
        return ()
    model = PhasedTorchRNN()
    model.eval()
    texts = [probe.text for probe in probes]
    history: list[tuple[float, ...]] = []
    checkpoint_states = getattr(result, "checkpoint_states")
    for epoch in [metric.epoch for metric in result.metrics]:
        load_model_parameters(model, checkpoint_states[int(epoch)])
        history.append(tuple(build_story_response_row(model, texts)))
    synthetic_result = _SyntheticResult(
        metrics=tuple(result.metrics),
        story_probes=probes,
        story_response_history=tuple(history),
        phase_spans=tuple(result.phase_spans),
    )
    return build_probe_trajectories(synthetic_result, is_valid_fn=is_valid_fn)


def _held_out_probe_trajectories(
    result: ResultLike,
    *,
    is_valid_fn: Callable[[str], bool],
) -> tuple[ProbeTrajectoryMetrics, ...]:
    return _probe_trajectories_for_probes(
        result,
        _candidate_pool(result),
        is_valid_fn=is_valid_fn,
    )


def _classify_probe_kind(text: str) -> str:
    from blog.scripts.neural_dynamics_artifacts import (
        INVALID_KIND_RANDOM,
        PHASE_KIND_BALANCED_INVALID,
        PHASE_KIND_OFF_BY_ONE,
        PHASE_KIND_VALID_PREFIX,
        is_balanced_invalid,
        is_balanced_parentheses,
        is_off_by_one_invalid,
        is_valid_prefix_invalid,
    )

    if is_balanced_parentheses(text):
        return "valid"
    if is_off_by_one_invalid(text):
        return PHASE_KIND_OFF_BY_ONE
    if is_valid_prefix_invalid(text):
        return PHASE_KIND_VALID_PREFIX
    if is_balanced_invalid(text):
        return PHASE_KIND_BALANCED_INVALID
    return INVALID_KIND_RANDOM


def _single_flip_neighbor_probes(
    *,
    watched_text: str,
    exclude_texts: set[str],
) -> tuple[_SyntheticProbe, ...]:
    seen = set(exclude_texts)
    probes: list[_SyntheticProbe] = []
    for index, char in enumerate(watched_text, start=1):
        flipped = ")" if char == "(" else "("
        candidate = watched_text[: index - 1] + flipped + watched_text[index:]
        if candidate in seen:
            continue
        seen.add(candidate)
        label = f"N{len(probes) + 1:02d}"
        probes.append(
            _SyntheticProbe(
                label=label,
                text=candidate,
                probe_kind=_classify_probe_kind(candidate),
                short_label=label,
            )
        )
    return tuple(probes)


def _trajectory_distance(
    probe: ProbeTrajectoryMetrics, reference: ProbeTrajectoryMetrics
) -> float:
    return float(
        sum(
            abs(left - right)
            for left, right in zip(
                probe.probabilities, reference.probabilities, strict=True
            )
        )
    )


def build_curated_probe_bundle(
    result: ResultLike,
    *,
    is_valid_fn: Callable[[str], bool],
    background_per_family: int = 24,
    local_neighbor_count: int = 10,
) -> CuratedProbeBundle:
    from blog.scripts.neural_dynamics_artifacts import (
        PHASE_KIND_BALANCED_INVALID,
        PHASE_KIND_OFF_BY_ONE,
        PHASE_KIND_VALID_PREFIX,
    )

    trajectories = list(_held_out_probe_trajectories(result, is_valid_fn=is_valid_fn))
    valid_candidates = [probe for probe in trajectories if probe.actual_valid]
    valid_control = sorted(
        valid_candidates,
        key=lambda probe: (
            not probe.correctness[-1],
            -len(probe.text),
            -_max_depth(probe.text),
            probe.total_variation,
            -probe.probabilities[-1],
            probe.text,
        ),
    )[0]

    off_by_one_candidates = [
        probe for probe in trajectories if probe.probe_kind == PHASE_KIND_OFF_BY_ONE
    ]
    off_by_one = sorted(
        off_by_one_candidates,
        key=lambda probe: (
            not probe.correctness[-1],
            -bool(probe.flip_epochs),
            -(probe.probabilities[0] - probe.probabilities[-1]),
            -probe.local_window_change,
            probe.min_boundary_distance,
            -len(probe.text),
            probe.text,
        ),
    )[0]

    selected = (
        SelectedTrajectory(
            role="off-by-one example",
            note="one extra close parenthesis",
            trajectory=off_by_one,
        ),
    )

    selected_labels = {item.trajectory.label for item in selected}
    boundary_reference = sorted(
        [probe for probe in trajectories if probe.label not in selected_labels],
        key=lambda probe: (
            -len(probe.flip_epochs),
            probe.min_boundary_distance,
            -probe.local_window_change,
            probe.text,
        ),
    )[0]
    per_family: dict[str, list[ProbeTrajectoryMetrics]] = {
        "valid": [],
        PHASE_KIND_OFF_BY_ONE: [],
        PHASE_KIND_VALID_PREFIX: [],
        PHASE_KIND_BALANCED_INVALID: [],
    }
    for probe in trajectories:
        if probe.label in selected_labels:
            continue
        if probe.actual_valid:
            per_family["valid"].append(probe)
        else:
            per_family[probe.probe_kind].append(probe)

    background: list[ProbeTrajectoryMetrics] = []
    for family_key, bucket in per_family.items():
        ordered = sorted(
            bucket,
            key=lambda probe: (
                probe.min_boundary_distance,
                -probe.local_window_change,
                -len(probe.flip_epochs),
                -len(probe.text),
                probe.text,
            ),
        )
        background.extend(ordered[: min(background_per_family, len(ordered))])

    local_neighbor_candidates = _probe_trajectories_for_probes(
        result,
        _single_flip_neighbor_probes(
            watched_text=off_by_one.text,
            exclude_texts=set(getattr(result, "training_texts")) | {off_by_one.text},
        ),
        is_valid_fn=is_valid_fn,
    )
    local_neighbors = tuple(
        sorted(
            local_neighbor_candidates,
            key=lambda probe: (
                _trajectory_distance(probe, off_by_one),
                probe.min_boundary_distance,
                -probe.local_window_change,
                abs(probe.probabilities[-1] - off_by_one.probabilities[-1]),
                probe.text,
            ),
        )[: min(local_neighbor_count, len(local_neighbor_candidates))]
    )

    return CuratedProbeBundle(
        selected=selected,
        local_neighbors=local_neighbors,
        global_background=tuple(background),
        all_trajectories=tuple(trajectories),
        ordinary_reference=valid_control,
        boundary_reference=boundary_reference,
        watchlist_mode=watchlist_mode(),
    )
