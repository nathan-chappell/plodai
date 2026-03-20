from __future__ import annotations

from csv import DictWriter
from dataclasses import asdict
import json
from pathlib import Path
from typing import Callable

from blog.scripts.artifact_common import ensure_dir
from blog.scripts.rnn_transition_matplotlib import render_transition_figure
from blog.scripts.rnn_transition_metrics import (
    TransitionMetricsBundle,
    assess_transition,
    build_transition_metrics,
)
from blog.scripts.rnn_transition_selection import (
    build_curated_probe_bundle,
    representative_selection_rule,
)
from blog.scripts.rnn_transition_tables import summary_table_rows, write_summary_csv


def _write_family_metrics_csv(
    metrics: TransitionMetricsBundle, *, output_dir: Path, stem: str
) -> list[str]:
    output_path = ensure_dir(output_dir) / f"{stem}.csv"
    rows: list[dict[str, object]] = []
    for series in metrics.family_series:
        for epoch, value in zip(series.epochs, series.values, strict=True):
            rows.append(
                {
                    "series": series.label,
                    "family_type": series.family_type,
                    "epoch": epoch,
                    "value": f"{value:.6f}",
                }
            )
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    return [output_path.name]


def _write_probe_metrics_csv(
    metrics: TransitionMetricsBundle, *, output_dir: Path, stem: str
) -> list[str]:
    output_path = ensure_dir(output_dir) / f"{stem}.csv"
    rows: list[dict[str, object]] = []
    for trajectory in metrics.trajectories:
        for epoch, probability, correct in zip(
            trajectory.epochs,
            trajectory.probabilities,
            trajectory.correctness,
            strict=True,
        ):
            rows.append(
                {
                    "probe_id": trajectory.label,
                    "literal": trajectory.text,
                    "probe_kind": trajectory.probe_kind,
                    "actual_valid": trajectory.actual_valid,
                    "epoch": epoch,
                    "p_valid": f"{probability:.6f}",
                    "correct": int(correct),
                }
            )
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    return [output_path.name]


def _write_report_json(
    metrics: TransitionMetricsBundle,
    *,
    selection_rows: list[dict[str, object]],
    assessment_text: dict[str, object],
    output_dir: Path,
    stem: str,
) -> list[str]:
    output_path = ensure_dir(output_dir) / f"{stem}.json"
    payload = {
        "selection_rule": representative_selection_rule(),
        "phase_epochs": list(metrics.phase_epochs),
        "boundary_family_labels": list(metrics.boundary_family_labels),
        "boundary_family_size": metrics.boundary_family_size,
        "family_series": [asdict(series) for series in metrics.family_series],
        "probe_trajectories": [
            asdict(trajectory) for trajectory in metrics.trajectories
        ],
        "selection_rows": selection_rows,
        "assessment": assessment_text,
    }
    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return [output_path.name]


def _write_assessment(
    *,
    assessment_text: dict[str, object],
    output_dir: Path,
    stem: str,
) -> list[str]:
    output_path = ensure_dir(output_dir) / f"{stem}.md"
    lines = [
        f"# Transition Assessment: {assessment_text['classification']}",
        "",
        "## Measured Facts",
        *(f"- {item}" for item in assessment_text["measured_facts"]),
        "",
        "## Interpretation",
        *(f"- {item}" for item in assessment_text["interpretation"]),
        "",
        "## Uncertainty",
        *(f"- {item}" for item in assessment_text["uncertainty"]),
        "",
    ]
    output_path.write_text("\n".join(lines), encoding="utf-8")
    return [output_path.name]


def render_rnn_transition_report(
    result,
    *,
    output_dir: Path,
    is_valid_fn: Callable[[str], bool],
) -> dict[str, object]:
    metrics = build_transition_metrics(result, is_valid_fn=is_valid_fn)
    curated = build_curated_probe_bundle(result, is_valid_fn=is_valid_fn)
    assessment_metrics = TransitionMetricsBundle(
        trajectories=curated.all_trajectories,
        family_series=metrics.family_series,
        phase_epochs=metrics.phase_epochs,
        boundary_family_labels=metrics.boundary_family_labels,
        boundary_family_size=metrics.boundary_family_size,
    )
    assessment = assess_transition(
        assessment_metrics,
        representative_counterexample=curated.selected[0].trajectory,
        representative_ordinary=curated.ordinary_reference,
        representative_boundary=curated.boundary_reference,
    )
    selection_rows = summary_table_rows(curated.selected)
    assessment_text = {
        "classification": assessment.classification,
        "measured_facts": list(assessment.measured_facts),
        "interpretation": list(assessment.interpretation),
        "uncertainty": list(assessment.uncertainty),
    }

    files: list[str] = []
    files.extend(
        render_transition_figure(
            result=result,
            selected=curated.selected,
            background=curated.background,
            phase_spans=result.phase_spans,
            assessment=assessment,
            output_dir=output_dir,
            stem="rnn-training-story",
        )
    )
    files.extend(
        write_summary_csv(
            rows=selection_rows, output_dir=output_dir, stem="rnn-transition-summary"
        )
    )
    files.extend(
        _write_family_metrics_csv(
            metrics, output_dir=output_dir, stem="rnn-transition-family-metrics"
        )
    )
    files.extend(
        _write_probe_metrics_csv(
            metrics, output_dir=output_dir, stem="rnn-transition-probe-trajectories"
        )
    )
    files.extend(
        _write_report_json(
            metrics,
            selection_rows=selection_rows,
            assessment_text=assessment_text,
            output_dir=output_dir,
            stem="rnn-transition-metrics",
        )
    )
    files.extend(
        _write_assessment(
            assessment_text=assessment_text,
            output_dir=output_dir,
            stem="rnn-transition-assessment",
        )
    )

    return {
        "files": files,
        "report_backend": "matplotlib",
        "report_style": "restrained_academic_print",
        "report_layout": "trace_panels_plus_transition_field",
        "story_plot_sampling": "curated_watchlist_plus_balanced_background",
        "story_plot_probe_count": len(curated.selected) + len(curated.background),
        "story_value_transform": "boundary_emphasized_probability_nonlinear",
        "figure_background": "dark_slate",
        "selection_rule": representative_selection_rule(),
        "representative_probes": [
            {
                "role": item.role,
                "note": item.note,
                "probe": asdict(item.trajectory),
            }
            for item in curated.selected
        ],
        "watchlist_mode": curated.watchlist_mode,
        "curated_probe_roles": [item.role for item in curated.selected],
        "curated_probe_texts": [item.trajectory.text for item in curated.selected],
        "curated_probe_notes": [item.note for item in curated.selected],
        "background_probe_count": len(curated.background),
        "trace_panel_background_mode": "held_out_state_cloud_plus_endpoints",
        "trace_marker_mode": "start_end_only",
        "transition_classification": assessment.classification,
        "summary_table_files": ["rnn-transition-summary.csv"],
        "supporting_metrics_files": [
            "rnn-transition-family-metrics.csv",
            "rnn-transition-probe-trajectories.csv",
            "rnn-transition-metrics.json",
            "rnn-transition-assessment.md",
        ],
        "boundary_family_labels": list(metrics.boundary_family_labels),
        "phase_behavior": [asdict(series) for series in metrics.family_series],
        "assessment": assessment_text,
    }
