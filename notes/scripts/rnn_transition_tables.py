from __future__ import annotations

from csv import DictWriter
from pathlib import Path

from notes.scripts.artifact_common import ensure_dir
from notes.scripts.rnn_transition_selection import SelectedTrajectory


def summary_table_rows(
    selected: tuple[SelectedTrajectory, ...],
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for item in selected:
        trajectory = item.trajectory
        phase_scores = list(trajectory.phase_scores)
        rows.append(
            {
                "role": item.role,
                "example_id": trajectory.label,
                "literal": trajectory.text,
                "family_type": trajectory.family_type,
                "initial_score": f"{phase_scores[0]:.3f}",
                "phase_1_score": f"{phase_scores[1]:.3f}",
                "phase_2_score": f"{phase_scores[2]:.3f}",
                "net_change": f"{trajectory.net_change:+.3f}",
                "steepest_checkpoint": trajectory.max_step_checkpoint,
                "local_window_change": f"{trajectory.local_window_change:.3f}",
                "concentration": f"{trajectory.concentration:.3f}",
                "note": item.note,
            }
        )
    return rows


def write_summary_csv(
    *, rows: list[dict[str, object]], output_dir: Path, stem: str
) -> list[str]:
    ensure_dir(output_dir)
    output_path = output_dir / f"{stem}.csv"
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    return [output_path.name]
