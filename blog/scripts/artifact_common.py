from __future__ import annotations

from pathlib import Path
import shutil

from matplotlib.figure import Figure
from matplotlib.axes import Axes
from matplotlib import pyplot as plt


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
STATIC_FONT_STACK = ["Ubuntu", "DejaVu Sans", "Liberation Sans"]
STATIC_FIGURE_BG = "#0a0f13"
STATIC_PANEL_BG = "#101720"
STATIC_TEXT_INK = "#ecf2f8"
STATIC_MAIN_INK = "#8fb7de"
STATIC_SECONDARY_INK = "#c4d0db"
STATIC_ACCENT_INK = "#d1af92"
STATIC_GUIDE_INK = "#2c3742"
STATIC_SPINE_INK = "#91a2b5"
STATIC_FIELD_INK = "#66788a"


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


def write_matplotlib_figure(
    figure: Figure,
    *,
    output_dir: Path,
    stem: str,
    formats: tuple[str, ...] = ("svg",),
    dpi: int = 320,
) -> list[str]:
    ensure_dir(output_dir)
    written: list[str] = []
    for extension in formats:
        output_path = output_dir / f"{stem}.{extension}"
        save_kwargs = {
            "facecolor": figure.get_facecolor(),
            "bbox_inches": "tight",
        }
        if extension == "png":
            save_kwargs["dpi"] = dpi
        figure.savefig(output_path, **save_kwargs)
        written.append(output_path.name)
    return written


def apply_static_rcparams() -> None:
    plt.rcdefaults()
    plt.rcParams["font.family"] = STATIC_FONT_STACK
    plt.rcParams["svg.fonttype"] = "none"


def font_kwargs(*, size: float, color: str) -> dict[str, object]:
    return {"fontfamily": STATIC_FONT_STACK, "fontsize": size, "color": color}


def style_static_axis(
    ax: Axes,
    *,
    hide_ticks: bool = False,
    show_left_bottom_only: bool = True,
) -> None:
    ax.set_facecolor(STATIC_PANEL_BG)
    for spine_name, spine in ax.spines.items():
        spine.set_visible(
            not show_left_bottom_only or spine_name in {"left", "bottom"}
        )
        spine.set_linewidth(0.75)
        spine.set_color(STATIC_SPINE_INK)
    ax.tick_params(axis="both", colors=STATIC_SECONDARY_INK, width=0.6, labelsize=9)
    for label in ax.get_xticklabels() + ax.get_yticklabels():
        label.set_fontfamily(STATIC_FONT_STACK)
    if hide_ticks:
        ax.set_xticks([])
        ax.set_yticks([])
