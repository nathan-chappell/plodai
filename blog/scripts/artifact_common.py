from __future__ import annotations

from pathlib import Path
import shutil

import plotly.graph_objects as go


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
ARTICLE_SLUG = "15-03-2026-the-theoretical-justification-of-neural-networks"
DEFAULT_OUTPUT_DIR = (
    REPO_ROOT
    / "frontend"
    / "public"
    / "blog-assets"
    / "theoretical-justification-of-neural-networks"
)

FIGURE_STYLE = {
    "paper_bgcolor": "#f7f8fb",
    "plot_bgcolor": "#ffffff",
    "font": {"family": "Aptos, Segoe UI, Helvetica, Arial, sans-serif", "color": "#1f2937", "size": 14},
}


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def clean_output_dir(path: Path) -> None:
    if not path.exists():
        return
    for child in path.iterdir():
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()


def write_figure(
    figure: go.Figure,
    *,
    output_dir: Path,
    stem: str,
    write_html: bool,
) -> list[str]:
    ensure_dir(output_dir)
    png_path = output_dir / f"{stem}.png"
    width = figure.layout.width or 1400
    height = figure.layout.height or 900
    figure.write_image(png_path, width=width, height=height, scale=2)
    written = [png_path.name]
    if write_html:
        html_path = output_dir / f"{stem}.html"
        figure.write_html(html_path, include_plotlyjs="cdn", full_html=True)
        written.append(html_path.name)
    return written
