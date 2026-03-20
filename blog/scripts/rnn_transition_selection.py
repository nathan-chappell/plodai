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
    background: tuple[ProbeTrajectoryMetrics, ...]
    all_trajectories: tuple[ProbeTrajectoryMetrics, ...]
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
        "Valid control: longer held-out balanced string with clear nested structure, "
        "preferring high depth, low drift, and correct acceptance throughout; "
        "off-by-one shock: longer held-out off-by-one counterexample with the strongest move "
        "toward correct rejection, preferring actual boundary crossings; "
        "repair case: held-out valid-prefix or balanced-invalid example with large change near "
        "the decision boundary, preferring visibly almost-valid structure."
    )


def watchlist_mode() -> str:
    return "curated_long_held_out_plus_balanced_background"


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


def _held_out_probe_trajectories(
    result: ResultLike,
    *,
    is_valid_fn: Callable[[str], bool],
) -> tuple[ProbeTrajectoryMetrics, ...]:
    from blog.scripts.neural_dynamics_artifacts import (
        PhasedTorchRNN,
        build_story_response_row,
        load_model_parameters,
    )

    probes = _candidate_pool(result)
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


def build_curated_probe_bundle(
    result: ResultLike,
    *,
    is_valid_fn: Callable[[str], bool],
    background_per_family: int = 24,
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

    repair_candidates = [
        probe
        for probe in trajectories
        if probe.probe_kind in {PHASE_KIND_VALID_PREFIX, PHASE_KIND_BALANCED_INVALID}
    ]
    repair_case = sorted(
        repair_candidates,
        key=lambda probe: (
            not probe.correctness[-1],
            probe.probe_kind != PHASE_KIND_VALID_PREFIX,
            -bool(probe.flip_epochs),
            -probe.local_window_change,
            probe.min_boundary_distance,
            -len(probe.text),
            probe.text,
        ),
    )[0]

    selected = (
        SelectedTrajectory(
            role="valid control",
            note="ordinary balanced control with deep nesting and stable acceptance",
            trajectory=valid_control,
        ),
        SelectedTrajectory(
            role="off-by-one shock",
            note="one-close mismatch that initially looks plausible but should be rejected",
            trajectory=off_by_one,
        ),
        SelectedTrajectory(
            role="repair case",
            note="almost-valid counterexample whose structure invites a late repair",
            trajectory=repair_case,
        ),
    )

    selected_labels = {item.trajectory.label for item in selected}
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

    return CuratedProbeBundle(
        selected=selected,
        background=tuple(background),
        all_trajectories=tuple(trajectories),
        watchlist_mode=watchlist_mode(),
    )
