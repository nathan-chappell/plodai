from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
import math
from typing import Literal

import matplotlib

matplotlib.use("Agg")
from matplotlib import pyplot as plt
from matplotlib.axes import Axes
from matplotlib.collections import PatchCollection
from matplotlib.figure import Figure
from matplotlib.lines import Line2D
from matplotlib.patches import Rectangle

from blog.scripts.artifact_common import (
    DEFAULT_OUTPUT_DIR,
    STATIC_FIGURE_BG,
    STATIC_PANEL_BG,
    STATIC_SECONDARY_INK,
    STATIC_SPINE_INK,
    STATIC_TEXT_INK,
    clean_output_dir,
    apply_static_rcparams,
    font_kwargs,
    style_static_axis,
    write_matplotlib_figure,
)

import typer


app = typer.Typer(
    help="Generate the Cantor-dust precision story figure for the theoretical-justification post."
)
PRECISION_STORY_MODE = "two_stack_cantor4"
PRECISION_IMAGE_STEM = "stack-cantor-dust-story"
PRECISION_DUST_DEPTH = 6
PRECISION_COUNT_BITS = 6
PRECISION_INITIAL_LEFT_STACK = "0" * (PRECISION_COUNT_BITS - 1)
PRECISION_INITIAL_RIGHT_STACK = "0"
PRECISION_ZOOM_DEPTHS: tuple[int, int] = (2, 6)
PRECISION_DUST_FILL = "#193143"
PRECISION_DUST_BORDER = "#355666"
PRECISION_PATH_COLOR = "#d1b296"
PRECISION_MARKER_COLOR = "#dfe8f2"
PRECISION_GUIDE_INK = "#c8d0d8"
PRECISION_TEXT_INK = STATIC_TEXT_INK
PRECISION_SUBTEXT_INK = STATIC_SECONDARY_INK
PRECISION_LAGS: tuple[int, ...] = (1, 2, 4)
PRECISION_MILESTONE_COUNTS: tuple[int, ...] = (0, 1, 2, 4, 8, 32, 63)
FONT_STACK = ["Ubuntu", "DejaVu Sans", "Liberation Sans"]


@dataclass(frozen=True)
class PrecisionOperation:
    action: Literal["write", "move_left", "move_right"]
    label: str
    bit: int | None = None


@dataclass(frozen=True)
class TwoStackTapeState:
    left_stack: str
    right_stack: str


@dataclass(frozen=True)
class PrecisionStoryState:
    step_index: int
    operation_label: str
    left_stack: str
    right_stack: str
    tape_snapshot: str
    x_left: float
    x_right: float


@dataclass(frozen=True)
class PrecisionZoomSpec:
    label: str
    depth: int
    focus_step: int
    x_range: tuple[float, float]
    y_range: tuple[float, float]


@dataclass(frozen=True)
class PrecisionLagSummary:
    lag: int
    distances: tuple[float, ...]


@dataclass(frozen=True)
class PrecisionStoryPayload:
    encoding: str
    dust_depth: int
    counting_bits: int
    initial_left_stack: str
    initial_right_stack: str
    states: tuple[PrecisionStoryState, ...]
    step_labels: tuple[str, ...]
    milestone_step_indexes: tuple[int, ...]
    lag_summaries: tuple[PrecisionLagSummary, ...]


@dataclass(frozen=True)
class PrecisionVertexLabel:
    anchor_state: PrecisionStoryState
    step_indexes: tuple[int, ...]
    text: str


def precision_story_operations() -> tuple[PrecisionOperation, ...]:
    operations: list[PrecisionOperation] = []
    current_state = TwoStackTapeState(
        left_stack=PRECISION_INITIAL_LEFT_STACK,
        right_stack=PRECISION_INITIAL_RIGHT_STACK,
    )
    for _target in range(1, 2**PRECISION_COUNT_BITS):
        while current_state.right_stack[0] == "1":
            operation = PrecisionOperation(action="write", label="write 0", bit=0)
            current_state = apply_precision_operation(current_state, operation)
            operations.append(operation)
            move_left = PrecisionOperation(action="move_left", label="carry L", bit=None)
            current_state = apply_precision_operation(current_state, move_left)
            operations.append(move_left)
        operation = PrecisionOperation(action="write", label="write 1", bit=1)
        current_state = apply_precision_operation(current_state, operation)
        operations.append(operation)
        while len(current_state.right_stack) > 1:
            move_right = PrecisionOperation(
                action="move_right", label="return R", bit=None
            )
            current_state = apply_precision_operation(current_state, move_right)
            operations.append(move_right)
    return tuple(operations)


def validate_binary_stack(stack: str) -> str:
    if any(bit not in {"0", "1"} for bit in stack):
        raise ValueError("Binary stacks may contain only 0 and 1.")
    return stack


def encode_binary_cantor_stack(stack: str) -> float:
    validate_binary_stack(stack)
    encoded = 0.0
    for index, bit in enumerate(stack, start=1):
        encoded += ((2 * int(bit)) + 1) * (4.0 ** (-index))
    return encoded


def cantor_stack_top(encoded: float, *, tolerance: float = 1e-12) -> int:
    if encoded <= tolerance:
        raise ValueError("Cannot read the top bit of an empty Cantor-encoded stack.")
    scaled = 4.0 * encoded
    if scaled < 2.0 - tolerance:
        return 0
    return 1


def cantor_stack_push(encoded: float, bit: int) -> float:
    if bit not in {0, 1}:
        raise ValueError("Cantor push expects a binary bit.")
    return ((2 * bit) + 1 + encoded) / 4.0


def cantor_stack_pop(encoded: float, *, tolerance: float = 1e-12) -> float:
    bit = cantor_stack_top(encoded, tolerance=tolerance)
    remainder = (4.0 * encoded) - ((2 * bit) + 1)
    if abs(remainder) <= tolerance:
        return 0.0
    return remainder


def decode_binary_cantor_stack(
    encoded: float, *, tolerance: float = 1e-12, max_bits: int = 64
) -> str:
    if encoded < -tolerance:
        raise ValueError("Encoded stack must be non-negative.")
    bits: list[str] = []
    remainder = encoded
    for _ in range(max_bits):
        if remainder <= tolerance:
            return "".join(bits)
        bit = cantor_stack_top(remainder, tolerance=tolerance)
        bits.append(str(bit))
        remainder = cantor_stack_pop(remainder, tolerance=tolerance)
    raise ValueError("Encoded stack did not terminate within max_bits.")


def format_two_stack_tape_snapshot(state: TwoStackTapeState) -> str:
    head_symbol = state.right_stack[0] if state.right_stack else "0"
    right_tail = state.right_stack[1:] if state.right_stack else ""
    return f"{state.left_stack[::-1]}[{head_symbol}]{right_tail}"


def write_tape_head(state: TwoStackTapeState, bit: int) -> TwoStackTapeState:
    if bit not in {0, 1}:
        raise ValueError("write_tape_head expects a binary bit.")
    if not state.right_stack:
        raise ValueError("Cannot write to an empty right stack.")
    return TwoStackTapeState(
        left_stack=state.left_stack, right_stack=f"{bit}{state.right_stack[1:]}"
    )


def move_tape_head_right(state: TwoStackTapeState) -> TwoStackTapeState:
    if len(state.right_stack) < 2:
        raise ValueError(
            "move_tape_head_right requires at least two symbols on the right stack."
        )
    return TwoStackTapeState(
        left_stack=state.right_stack[0] + state.left_stack,
        right_stack=state.right_stack[1:],
    )


def move_tape_head_left(state: TwoStackTapeState) -> TwoStackTapeState:
    if not state.left_stack:
        raise ValueError("move_tape_head_left requires a non-empty left stack.")
    return TwoStackTapeState(
        left_stack=state.left_stack[1:],
        right_stack=state.left_stack[0] + state.right_stack,
    )


def apply_precision_operation(
    state: TwoStackTapeState, operation: PrecisionOperation
) -> TwoStackTapeState:
    if operation.action == "write":
        assert operation.bit is not None
        return write_tape_head(state, operation.bit)
    if operation.action == "move_left":
        return move_tape_head_left(state)
    if operation.action == "move_right":
        return move_tape_head_right(state)
    raise ValueError(f"Unhandled precision operation: {operation.action}")


def precision_story_state(
    step_index: int, operation_label: str, state: TwoStackTapeState
) -> PrecisionStoryState:
    return PrecisionStoryState(
        step_index=step_index,
        operation_label=operation_label,
        left_stack=state.left_stack,
        right_stack=state.right_stack,
        tape_snapshot=format_two_stack_tape_snapshot(state),
        x_left=encode_binary_cantor_stack(state.left_stack),
        x_right=encode_binary_cantor_stack(state.right_stack),
    )


def clamp_window(center: float, *, span: float) -> tuple[float, float]:
    half = span / 2.0
    lower = max(0.0, center - half)
    upper = min(1.0, center + half)
    if upper - lower >= span:
        return lower, upper
    if lower <= 0.0:
        return 0.0, min(1.0, span)
    return max(0.0, 1.0 - span), 1.0


@lru_cache(maxsize=None)
def cantor_intervals(depth: int) -> tuple[tuple[float, float], ...]:
    if depth < 0:
        raise ValueError("depth must be non-negative.")
    intervals: tuple[tuple[float, float], ...] = ((0.0, 1.0),)
    for _ in range(depth):
        next_intervals: list[tuple[float, float]] = []
        for start, end in intervals:
            width = (end - start) / 4.0
            next_intervals.append((start + width, start + (2.0 * width)))
            next_intervals.append((start + (3.0 * width), end))
        intervals = tuple(next_intervals)
    return intervals


def stack_cover_interval(stack: str, *, depth: int) -> tuple[float, float]:
    prefix = stack[:depth]
    if not prefix:
        return 0.0, 1.0
    lower = encode_binary_cantor_stack(prefix)
    width = 4.0 ** (-len(prefix))
    return lower, lower + width


def state_lies_within_depth_cover(
    state: PrecisionStoryState, *, depth: int, tolerance: float = 1e-12
) -> bool:
    left_lower, left_upper = stack_cover_interval(state.left_stack, depth=depth)
    right_lower, right_upper = stack_cover_interval(state.right_stack, depth=depth)
    return (
        left_lower - tolerance <= state.x_left <= left_upper + tolerance
        and right_lower - tolerance <= state.x_right <= right_upper + tolerance
    )


def add_cantor_scaffold(axis: Axes, *, depths: tuple[int, ...] = (1, 2, 3, 4)) -> None:
    for layer_depth in depths:
        rectangles = [
            Rectangle((x0, y0), x1 - x0, y1 - y0)
            for x0, x1 in cantor_intervals(layer_depth)
            for y0, y1 in cantor_intervals(layer_depth)
        ]
        collection = PatchCollection(
            rectangles,
            facecolor="none",
            edgecolor=PRECISION_DUST_BORDER,
            linewidth=0.45 - (0.06 * min(layer_depth, 3)),
            alpha=max(0.12, 0.24 - (0.04 * layer_depth)),
            zorder=0,
        )
        axis.add_collection(collection)
    for grid_fraction in (0.25, 0.5, 0.75):
        axis.axvline(
            grid_fraction,
            color=(0.57, 0.64, 0.72, 0.12),
            linewidth=0.55,
            zorder=0,
        )
        axis.axhline(
            grid_fraction,
            color=(0.57, 0.64, 0.72, 0.12),
            linewidth=0.55,
            zorder=0,
        )


def build_precision_story_payload() -> PrecisionStoryPayload:
    current_state = TwoStackTapeState(
        left_stack=PRECISION_INITIAL_LEFT_STACK,
        right_stack=PRECISION_INITIAL_RIGHT_STACK,
    )
    states = [precision_story_state(0, "start", current_state)]
    milestone_steps = {0: 0}
    current_value = 0
    for step_index, operation in enumerate(precision_story_operations(), start=1):
        current_state = apply_precision_operation(current_state, operation)
        states.append(precision_story_state(step_index, operation.label, current_state))
        tape_bits = current_state.left_stack[::-1] + current_state.right_stack
        if len(current_state.right_stack) == 1:
            new_value = int(tape_bits, 2)
            if new_value != current_value:
                current_value = new_value
                milestone_steps[current_value] = step_index
    lag_summaries = tuple(
        PrecisionLagSummary(
            lag=lag,
            distances=tuple(
                math.dist(
                    (states[index].x_left, states[index].x_right),
                    (states[index + lag].x_left, states[index + lag].x_right),
                )
                for index in range(len(states) - lag)
            ),
        )
        for lag in PRECISION_LAGS
    )
    return PrecisionStoryPayload(
        encoding=PRECISION_STORY_MODE,
        dust_depth=PRECISION_DUST_DEPTH,
        counting_bits=PRECISION_COUNT_BITS,
        initial_left_stack=PRECISION_INITIAL_LEFT_STACK,
        initial_right_stack=PRECISION_INITIAL_RIGHT_STACK,
        states=tuple(states),
        step_labels=tuple(state.operation_label for state in states),
        milestone_step_indexes=tuple(
            milestone_steps[count] for count in PRECISION_MILESTONE_COUNTS
        ),
        lag_summaries=lag_summaries,
    )


def precision_step_color_map(
    payload: PrecisionStoryPayload,
) -> dict[int, tuple[float, float, float, float]]:
    colormap = plt.get_cmap("cividis")
    positions = [
        index / max(1, len(payload.states) - 1) for index in range(len(payload.states))
    ]
    return {
        state.step_index: colormap(position)
        for state, position in zip(payload.states, positions, strict=True)
    }


def _state_for_count(payload: PrecisionStoryPayload, count: int) -> PrecisionStoryState:
    milestone_index = PRECISION_MILESTONE_COUNTS.index(count)
    return payload.states[payload.milestone_step_indexes[milestone_index]]


def _carry_state_before_count(
    payload: PrecisionStoryPayload, count: int
) -> PrecisionStoryState:
    target_step = _state_for_count(payload, count).step_index
    for state in reversed(payload.states[: target_step + 1]):
        if state.operation_label == "carry L":
            return state
    return _state_for_count(payload, count)


def _first_state_after_step(
    payload: PrecisionStoryPayload, *, start_step: int, operation_label: str
) -> PrecisionStoryState:
    for state in payload.states:
        if state.step_index <= start_step:
            continue
        if state.operation_label == operation_label:
            return state
    return payload.states[-1]


def _precision_marker_states(
    payload: PrecisionStoryPayload,
) -> tuple[tuple[str, str, PrecisionStoryState], ...]:
    carry_state = _carry_state_before_count(payload, 8)
    return_state = _first_state_after_step(
        payload,
        start_step=carry_state.step_index,
        operation_label="return R",
    )
    return (
        ("start", "s", payload.states[0]),
        ("carry", "o", carry_state),
        ("return", "D", return_state),
        ("final", "X", payload.states[-1]),
    )


def select_precision_label_step_indexes(payload: PrecisionStoryPayload) -> set[int]:
    operations = precision_story_operations()
    label_step_indexes = {0, payload.states[-1].step_index}
    for step_index, operation in enumerate(operations, start=1):
        if operation.action == "write":
            label_step_indexes.add(step_index)
    return label_step_indexes


def add_precision_path_trace(
    axis: Axes,
    *,
    payload: PrecisionStoryPayload,
    show_text: bool,
    selected_step_indexes: tuple[int, ...] | None = None,
    line_width: float = 2.3,
    marker_size: float = 32.0,
    text_color: str = "#f8fafc",
) -> None:
    step_color_map = precision_step_color_map(payload)
    if selected_step_indexes is None:
        states = list(payload.states)
    else:
        selected = set(selected_step_indexes)
        states = [state for state in payload.states if state.step_index in selected]
    xs = [state.x_left for state in states]
    ys = [state.x_right for state in states]
    axis.plot(xs, ys, color=(1.0, 1.0, 1.0, 0.86), linewidth=line_width + 1.6, zorder=2)
    axis.plot(xs, ys, color=(0.06, 0.09, 0.16, 0.46), linewidth=line_width, zorder=3)
    axis.scatter(
        xs,
        ys,
        s=marker_size,
        c=[step_color_map[state.step_index] for state in states],
        edgecolors="white",
        linewidths=0.8,
        zorder=4,
    )
    if show_text:
        for state in states:
            axis.text(
                state.x_left,
                state.x_right + 0.013,
                str(state.step_index),
                ha="center",
                va="bottom",
                fontsize=8,
                color=text_color,
                fontfamily="STIXGeneral",
                zorder=5,
            )


def build_precision_story_figure(payload: PrecisionStoryPayload) -> Figure:
    apply_static_rcparams()
    figure = plt.figure(figsize=(8.8, 7.8))
    figure.patch.set_facecolor(STATIC_FIGURE_BG)
    grid = figure.add_gridspec(1, 1)
    axis = figure.add_subplot(grid[0, 0])
    style_static_axis(axis)

    add_cantor_scaffold(axis)
    xs = [state.x_left for state in payload.states]
    ys = [state.x_right for state in payload.states]
    axis.plot(
        xs,
        ys,
        color=PRECISION_PATH_COLOR,
        linewidth=0.86,
        alpha=0.96,
        zorder=3,
    )

    milestone_specs = list(_precision_marker_states(payload))
    legend_handles = []
    legend_labels = []
    for label, marker, state in milestone_specs:
        axis.scatter(
            [state.x_left],
            [state.x_right],
            s=32 if label != "final" else 42,
            marker=marker,
            color=PRECISION_MARKER_COLOR,
            edgecolors=PRECISION_PATH_COLOR,
            linewidths=0.62,
            zorder=4,
        )
        legend_handles.append(
            Line2D(
                [0],
                [0],
                marker=marker,
                linestyle="",
                markerfacecolor=PRECISION_MARKER_COLOR,
                markeredgecolor=PRECISION_PATH_COLOR,
                markeredgewidth=0.62,
                markersize=5.5 if label != "final" else 6.2,
            )
        )
        legend_labels.append(label)
    axis.legend(
        legend_handles,
        legend_labels,
        frameon=False,
        fontsize=7.1,
        labelcolor=PRECISION_SUBTEXT_INK,
        loc="upper right",
        borderpad=0.1,
        handletextpad=0.4,
        handlelength=0.8,
    )

    axis.set_xlim(0.0, 1.0)
    axis.set_ylim(0.0, 1.0)
    axis.set_aspect("equal", adjustable="box")
    axis.set_xlabel(
        "q(L) · left-stack coordinate",
        fontsize=10.5,
        fontfamily=FONT_STACK,
        color=PRECISION_TEXT_INK,
    )
    axis.set_ylabel(
        "q(R) · right-stack coordinate",
        fontsize=10.5,
        fontfamily=FONT_STACK,
        color=PRECISION_TEXT_INK,
    )
    axis.tick_params(axis="both", labelsize=9.5, colors=PRECISION_SUBTEXT_INK, width=0.6)
    for label in axis.get_xticklabels() + axis.get_yticklabels():
        label.set_fontfamily(FONT_STACK)

    figure.suptitle(
        "Binary counting sweep through Cantor dust",
        x=0.12,
        y=0.95,
        ha="left",
        fontsize=12.8,
        fontfamily=FONT_STACK,
        color=PRECISION_TEXT_INK,
    )
    figure.subplots_adjust(left=0.11, right=0.89, top=0.90, bottom=0.12)
    return figure


def render_precision_assets(*, output_dir: Path) -> dict[str, object]:
    payload = build_precision_story_payload()
    figure = build_precision_story_figure(payload)
    files = write_matplotlib_figure(
        figure,
        output_dir=output_dir,
        stem=PRECISION_IMAGE_STEM,
    )
    plt.close(figure)
    return {
        "files": files,
        "encoding": payload.encoding,
        "dust_depth": payload.dust_depth,
        "counting_bits": payload.counting_bits,
        "initial_left_stack": payload.initial_left_stack,
        "initial_right_stack": payload.initial_right_stack,
        "step_labels": list(payload.step_labels),
        "lag_distance_lags": [summary.lag for summary in payload.lag_summaries],
        "milestone_step_indexes": list(payload.milestone_step_indexes),
        "label_mode": "milestone_markers_only",
    }


@app.command()
def generate(
    output_dir: Path = typer.Option(
        DEFAULT_OUTPUT_DIR,
        help="Directory where article-facing assets should be written.",
    ),
    clean: bool = typer.Option(
        True,
        "--clean/--no-clean",
        help="Whether to clear the output directory before generating fresh artifacts.",
    ),
) -> None:
    if clean:
        clean_output_dir(output_dir)
    render_precision_assets(output_dir=output_dir)


def main() -> None:
    app()


if __name__ == "__main__":
    main()
