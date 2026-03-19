from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
import math
from typing import Literal

try:
    from blog.scripts.artifact_common import DEFAULT_OUTPUT_DIR, FIGURE_STYLE, clean_output_dir, write_figure
except ModuleNotFoundError:
    from artifact_common import DEFAULT_OUTPUT_DIR, FIGURE_STYLE, clean_output_dir, write_figure

from PIL import Image, ImageDraw
from plotly.colors import sample_colorscale
import plotly.graph_objects as go
import typer


app = typer.Typer(help="Generate the Cantor-dust precision story figure for the theoretical-justification post.")
PRECISION_STORY_MODE = "two_stack_cantor4"
PRECISION_IMAGE_STEM = "stack-cantor-dust-story"
PRECISION_DUST_DEPTH = 6
PRECISION_INITIAL_LEFT_STACK = ""
PRECISION_INITIAL_RIGHT_STACK = "101011001110010110100111001011010011010111001011"
PRECISION_ZOOM_DEPTHS: tuple[int, int] = (2, 6)
PRECISION_DUST_BACKGROUND = "#f6f7f3"
PRECISION_DUST_FILL = "#bae6fd"
PRECISION_DUST_BORDER = "#0f766e"
PRECISION_PATH_COLOR = "#9a3412"
PRECISION_STEP_COLORS = [
    "#1d4ed8",
    "#2563eb",
    "#0f766e",
    "#16a34a",
    "#65a30d",
    "#ca8a04",
    "#ea580c",
    "#dc2626",
    "#be123c",
]
PRECISION_STORY_OPERATIONS = (
    ("write", "write 0", 0),
    ("move_right", "move R", None),
    ("move_right", "move R", None),
    ("write", "write 1", 1),
    ("move_right", "move R", None),
    ("move_right", "move R", None),
    ("write", "write 0", 0),
    ("move_right", "move R", None),
    ("move_right", "move R", None),
    ("write", "write 1", 1),
    ("move_right", "move R", None),
    ("move_right", "move R", None),
    ("write", "write 0", 0),
    ("move_left", "move L", None),
    ("move_left", "move L", None),
    ("write", "write 1", 1),
    ("move_left", "move L", None),
    ("move_left", "move L", None),
    ("write", "write 0", 0),
    ("move_left", "move L", None),
    ("move_left", "move L", None),
    ("write", "write 1", 1),
    ("move_right", "move R", None),
    ("move_right", "move R", None),
    ("write", "write 0", 0),
    ("move_right", "move R", None),
    ("move_right", "move R", None),
    ("write", "write 1", 1),
    ("move_right", "move R", None),
)


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
class PrecisionStoryPayload:
    encoding: str
    dust_depth: int
    initial_left_stack: str
    initial_right_stack: str
    states: tuple[PrecisionStoryState, ...]
    step_labels: tuple[str, ...]
    zooms: tuple[PrecisionZoomSpec, ...]


@dataclass(frozen=True)
class PrecisionVertexLabel:
    anchor_state: PrecisionStoryState
    step_indexes: tuple[int, ...]
    text: str


def precision_story_operations() -> tuple[PrecisionOperation, ...]:
    return tuple(PrecisionOperation(action=action, label=label, bit=bit) for action, label, bit in PRECISION_STORY_OPERATIONS)


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


def decode_binary_cantor_stack(encoded: float, *, tolerance: float = 1e-12, max_bits: int = 64) -> str:
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
    return TwoStackTapeState(left_stack=state.left_stack, right_stack=f"{bit}{state.right_stack[1:]}")


def move_tape_head_right(state: TwoStackTapeState) -> TwoStackTapeState:
    if len(state.right_stack) < 2:
        raise ValueError("move_tape_head_right requires at least two symbols on the right stack.")
    return TwoStackTapeState(left_stack=state.right_stack[0] + state.left_stack, right_stack=state.right_stack[1:])


def move_tape_head_left(state: TwoStackTapeState) -> TwoStackTapeState:
    if not state.left_stack:
        raise ValueError("move_tape_head_left requires a non-empty left stack.")
    return TwoStackTapeState(left_stack=state.left_stack[1:], right_stack=state.left_stack[0] + state.right_stack)


def apply_precision_operation(state: TwoStackTapeState, operation: PrecisionOperation) -> TwoStackTapeState:
    if operation.action == "write":
        assert operation.bit is not None
        return write_tape_head(state, operation.bit)
    if operation.action == "move_left":
        return move_tape_head_left(state)
    if operation.action == "move_right":
        return move_tape_head_right(state)
    raise ValueError(f"Unhandled precision operation: {operation.action}")


def precision_story_state(step_index: int, operation_label: str, state: TwoStackTapeState) -> PrecisionStoryState:
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


def render_cantor_dust_image(
    *,
    depth: int,
    size: int,
    x_range: tuple[float, float],
    y_range: tuple[float, float],
) -> Image.Image:
    image = Image.new("RGBA", (size, size), (246, 247, 243, 255))
    pixels = image.load()
    for row in range(size):
        mix = row / max(1, size - 1)
        red = int(246 - (6 * mix))
        green = int(247 - (4 * mix))
        blue = int(243 + (10 * mix))
        for col in range(size):
            pixels[col, row] = (red, green, blue, 255)
    draw = ImageDraw.Draw(image)
    x_min, x_max = x_range
    y_min, y_max = y_range
    x_span = max(1e-12, x_max - x_min)
    y_span = max(1e-12, y_max - y_min)
    for layer_depth in range(1, depth + 1):
        intervals = cantor_intervals(layer_depth)
        fill_alpha = 28 + (layer_depth * 10)
        outline_alpha = 40 + (layer_depth * 20)
        fill = (186, 230, 253, min(148, fill_alpha))
        outline = (15, 118, 110, min(210, outline_alpha))
        for x0, x1 in intervals:
            if x1 <= x_min or x0 >= x_max:
                continue
            clipped_x0 = max(x0, x_min)
            clipped_x1 = min(x1, x_max)
            for y0, y1 in intervals:
                if y1 <= y_min or y0 >= y_max:
                    continue
                clipped_y0 = max(y0, y_min)
                clipped_y1 = min(y1, y_max)
                pixel_x0 = int(math.floor(((clipped_x0 - x_min) / x_span) * size))
                pixel_x1 = int(math.ceil(((clipped_x1 - x_min) / x_span) * size))
                pixel_y0 = int(math.floor(((y_max - clipped_y1) / y_span) * size))
                pixel_y1 = int(math.ceil(((y_max - clipped_y0) / y_span) * size))
                draw.rectangle(
                    [pixel_x0, pixel_y0, max(pixel_x0 + 1, pixel_x1), max(pixel_y0 + 1, pixel_y1)],
                    fill=fill,
                    outline=outline,
                )
    for grid_fraction in (0.25, 0.5, 0.75):
        grid_x = int(round(((grid_fraction - x_min) / x_span) * size))
        grid_y = int(round(((y_max - grid_fraction) / y_span) * size))
        if 0 <= grid_x < size:
            draw.line([(grid_x, 0), (grid_x, size)], fill=(148, 163, 184, 36), width=1)
        if 0 <= grid_y < size:
            draw.line([(0, grid_y), (size, grid_y)], fill=(148, 163, 184, 36), width=1)
    return image


def build_precision_story_payload() -> PrecisionStoryPayload:
    current_state = TwoStackTapeState(left_stack=PRECISION_INITIAL_LEFT_STACK, right_stack=PRECISION_INITIAL_RIGHT_STACK)
    states = [precision_story_state(0, "start", current_state)]
    for step_index, operation in enumerate(precision_story_operations(), start=1):
        current_state = apply_precision_operation(current_state, operation)
        states.append(precision_story_state(step_index, operation.label, current_state))
    early_state = states[8]
    late_state = states[-6]
    zoom_depths = PRECISION_ZOOM_DEPTHS
    zooms = (
        PrecisionZoomSpec(
            label="Level-2 zoom · the walk first branches",
            depth=zoom_depths[0],
            focus_step=early_state.step_index,
            x_range=clamp_window(early_state.x_left, span=3.2 * (4.0 ** (-zoom_depths[0]))),
            y_range=clamp_window(early_state.x_right, span=3.2 * (4.0 ** (-zoom_depths[0]))),
        ),
        PrecisionZoomSpec(
            label="Level-6 zoom · the same move, much deeper",
            depth=zoom_depths[1],
            focus_step=late_state.step_index,
            x_range=clamp_window(late_state.x_left, span=9.5 * (4.0 ** (-zoom_depths[1]))),
            y_range=clamp_window(late_state.x_right, span=9.5 * (4.0 ** (-zoom_depths[1]))),
        ),
    )
    return PrecisionStoryPayload(
        encoding=PRECISION_STORY_MODE,
        dust_depth=PRECISION_DUST_DEPTH,
        initial_left_stack=PRECISION_INITIAL_LEFT_STACK,
        initial_right_stack=PRECISION_INITIAL_RIGHT_STACK,
        states=tuple(states),
        step_labels=tuple(state.operation_label for state in states),
        zooms=zooms,
    )


def add_precision_path_trace(
    figure: go.Figure,
    *,
    payload: PrecisionStoryPayload,
    axis_suffix: str,
    show_text: bool,
    selected_step_indexes: tuple[int, ...] | None = None,
    line_width: float = 4.0,
    marker_size: float = 12.0,
    text_color: str = "#f8fafc",
) -> None:
    step_color_map = precision_step_color_map(payload)
    if selected_step_indexes is None:
        states = list(payload.states)
    else:
        selected = set(selected_step_indexes)
        states = [state for state in payload.states if state.step_index in selected]
    customdata = [
        [state.step_index, state.operation_label, state.left_stack, state.right_stack, state.tape_snapshot, state.x_left, state.x_right]
        for state in states
    ]
    halo_trace = go.Scatter(
        x=[state.x_left for state in states],
        y=[state.x_right for state in states],
        mode="lines",
        line={"color": "rgba(248,250,252,0.88)", "width": line_width + 2.0},
        hoverinfo="skip",
        showlegend=False,
    )
    halo_trace.update(xaxis=f"x{axis_suffix}", yaxis=f"y{axis_suffix}")
    figure.add_trace(halo_trace)
    path_trace = go.Scatter(
        x=[state.x_left for state in states],
        y=[state.x_right for state in states],
        mode="lines",
        line={"color": "rgba(15,23,42,0.55)", "width": line_width},
        hoverinfo="skip",
        showlegend=False,
    )
    path_trace.update(xaxis=f"x{axis_suffix}", yaxis=f"y{axis_suffix}")
    figure.add_trace(path_trace)
    trace = go.Scatter(
        x=[state.x_left for state in states],
        y=[state.x_right for state in states],
        mode="markers+text" if show_text else "markers",
        text=[str(state.step_index) for state in states] if show_text else None,
        textposition="top center",
        textfont={"color": text_color, "size": 12 if show_text else 10},
        marker={
            "size": marker_size,
            "color": [step_color_map[state.step_index] for state in states],
            "line": {"color": "#ffffff", "width": 1.6},
        },
        customdata=customdata,
        hovertemplate=(
            "step %{customdata[0]}<br>"
            "operation=%{customdata[1]}<br>"
            "L=%{customdata[2]}<br>"
            "R=%{customdata[3]}<br>"
            "tape=%{customdata[4]}<br>"
            "x_L=%{customdata[5]:.6f}<br>"
            "x_R=%{customdata[6]:.6f}<extra></extra>"
        ),
        showlegend=False,
    )
    trace.update(xaxis=f"x{axis_suffix}", yaxis=f"y{axis_suffix}")
    figure.add_trace(trace)


def precision_step_color_map(payload: PrecisionStoryPayload) -> dict[int, str]:
    sample_positions = [index / max(1, len(payload.states) - 1) for index in range(len(payload.states))]
    sampled = sample_colorscale(PRECISION_STEP_COLORS, sample_positions)
    return {state.step_index: color for state, color in zip(payload.states, sampled, strict=True)}


def paper_rect(
    *,
    x0: float,
    y0: float,
    x1: float,
    y1: float,
    fillcolor: str = "rgba(255,255,255,0.92)",
    line_color: str = "#d6dae2",
    line_width: float = 1.2,
) -> dict[str, object]:
    return {
        "type": "rect",
        "xref": "paper",
        "yref": "paper",
        "x0": x0,
        "y0": y0,
        "x1": x1,
        "y1": y1,
        "fillcolor": fillcolor,
        "line": {"color": line_color, "width": line_width},
        "layer": "above",
    }


def add_stack_column_shapes(
    shapes: list[dict[str, object]],
    *,
    bits: str,
    x0: float,
    x1: float,
    y_top: float,
    cell_height: float,
    highlight_top: bool = False,
) -> None:
    for index, bit in enumerate(bits):
        top = y_top - (index * cell_height)
        bottom = top - cell_height
        fill = "#fde68a" if highlight_top and index == 0 else ("#dbeafe" if bit == "0" else "#bbf7d0")
        shapes.append(paper_rect(x0=x0, x1=x1, y0=bottom, y1=top, fillcolor=fill, line_color="#94a3b8", line_width=1.0))


def visible_tape_window(
    state: PrecisionStoryState,
    *,
    left_context: int = 4,
    right_context: int = 5,
) -> tuple[str, int, bool, bool]:
    tape = state.left_stack[::-1] + state.right_stack
    head_index = len(state.left_stack)
    start = max(0, head_index - left_context)
    end = min(len(tape), head_index + right_context + 1)
    return tape[start:end], head_index - start, start > 0, end < len(tape)


def add_tape_strip_shapes(
    shapes: list[dict[str, object]],
    *,
    bits: str,
    head_index: int,
    x0: float,
    x1: float,
    y_top: float,
    cell_height: float,
) -> None:
    cell_width = (x1 - x0) / max(1, len(bits))
    for index, bit in enumerate(bits):
        left = x0 + (index * cell_width)
        right = left + cell_width
        is_head = index == head_index
        fill = "#fde68a" if is_head else ("#dbeafe" if bit == "0" else "#bbf7d0")
        line_color = "#b45309" if is_head else "#94a3b8"
        shapes.append(paper_rect(x0=left, x1=right, y0=y_top - cell_height, y1=y_top, fillcolor=fill, line_color=line_color, line_width=1.0))


def build_tape_strip_text(bits: str, head_index: int) -> str:
    chars: list[str] = []
    for index, bit in enumerate(bits):
        if index == head_index:
            chars.append(f"[{bit}]")
        else:
            chars.append(bit)
    return "&nbsp;".join(chars)


def zoom_step_indexes(payload: PrecisionStoryPayload, focus_step: int, *, radius: int) -> tuple[int, ...]:
    lower = max(0, focus_step - radius)
    upper = min(payload.states[-1].step_index, focus_step + radius)
    return tuple(range(lower, upper + 1))


def build_precision_legend_text(payload: PrecisionStoryPayload) -> str:
    lines = ["<b>Flip a striped binary tape</b>"]
    for state in payload.states[::2]:
        line = f"{state.step_index:>2}. {state.operation_label:<7}  {state.tape_snapshot}".replace(" ", "&nbsp;")
        lines.append("<span style='font-family:IBM Plex Mono, Aptos Mono, Cascadia Mono, Consolas, monospace'>" f"{line}" "</span>")
    if payload.states[-1].step_index % 2 != 0:
        final_state = payload.states[-1]
        line = f"{final_state.step_index:>2}. {final_state.operation_label:<7}  {final_state.tape_snapshot}".replace(" ", "&nbsp;")
        lines.append("<span style='font-family:IBM Plex Mono, Aptos Mono, Cascadia Mono, Consolas, monospace'>" f"{line}" "</span>")
    return "<br>".join(lines)


def build_vertex_label_groups(payload: PrecisionStoryPayload) -> tuple[PrecisionVertexLabel, ...]:
    label_step_indexes = select_precision_label_step_indexes(payload)
    grouped: dict[tuple[int, int, str], tuple[PrecisionStoryState, list[int]]] = {}
    for state in payload.states:
        if state.step_index not in label_step_indexes:
            continue
        tape_window = visible_tape_window_markup(state)
        key = (round(state.x_left * 1_000_000), round(state.x_right * 1_000_000), tape_window)
        if key not in grouped:
            grouped[key] = (state, [])
        grouped[key][1].append(state.step_index)
    labels: list[PrecisionVertexLabel] = []
    for state, step_indexes in grouped.values():
        text = (
            "<span style='font-family:IBM Plex Mono, Aptos Mono, Cascadia Mono, Consolas, monospace'>"
            f"{visible_tape_window_markup(state)}"
            "</span>"
        )
        labels.append(PrecisionVertexLabel(anchor_state=state, step_indexes=tuple(step_indexes), text=text))
    return tuple(labels)


def select_precision_label_step_indexes(payload: PrecisionStoryPayload) -> set[int]:
    operations = precision_story_operations()
    label_step_indexes = {0, payload.states[-1].step_index}
    for step_index, operation in enumerate(operations, start=1):
        if operation.action == "write":
            label_step_indexes.add(step_index)
    return label_step_indexes


def precision_label_offsets(labels: tuple[PrecisionVertexLabel, ...]) -> dict[int, tuple[int, int, str]]:
    y_slots = (0, -22, 22, -44, 44, -66, 66, -88, 88)
    side_counts = {"west": 0, "east": 0}
    offsets: dict[int, tuple[int, int, str]] = {}
    for label in labels:
        state = label.anchor_state
        if state.x_left <= 0.42:
            side = "west"
        elif state.x_left >= 0.72:
            side = "east"
        else:
            side = "west" if state.step_index % 2 == 0 else "east"
        slot_index = side_counts[side]
        side_counts[side] += 1
        y_offset = y_slots[slot_index % len(y_slots)]
        if side == "west":
            offsets[state.step_index] = (-124, y_offset, "right")
        else:
            offsets[state.step_index] = (124, y_offset, "left")
    return offsets


def visible_tape_window_markup(state: PrecisionStoryState) -> str:
    bits, head_index, has_left_more, has_right_more = visible_tape_window(state)
    tokens: list[str] = []
    if has_left_more:
        tokens.append("...")
    for index, bit in enumerate(bits):
        if index == head_index:
            tokens.append(f"<b>[{bit}]</b>")
        else:
            tokens.append(bit)
    if has_right_more:
        tokens.append("...")
    return "".join(tokens)


def build_precision_story_figure(payload: PrecisionStoryPayload) -> go.Figure:
    main_domain_x = (0.09, 0.97)
    main_domain_y = (0.12, 0.90)
    main_image = render_cantor_dust_image(depth=payload.dust_depth, size=1400, x_range=(0.0, 1.0), y_range=(0.0, 1.0))
    vertex_labels = build_vertex_label_groups(payload)
    label_offsets = precision_label_offsets(vertex_labels)

    figure = go.Figure()
    figure.update_layout(
        width=1600,
        height=1200,
        margin={"t": 92, "l": 38, "r": 32, "b": 40},
        title={"text": "Patterned Tape Walk Through Cantor Dust", "y": 0.985},
        showlegend=False,
        **FIGURE_STYLE,
    )
    figure.update_layout(font={"family": "IBM Plex Sans, Aptos, Segoe UI, Helvetica, Arial, sans-serif", "color": "#1f2937", "size": 14})
    figure.update_layout(
        xaxis={
            "domain": list(main_domain_x),
            "range": [0.0, 1.0],
            "title": {"text": "q(L) · left-stack coordinate", "font": {"color": "#334155"}},
            "showgrid": False,
            "zeroline": False,
            "scaleanchor": "y",
            "constrain": "domain",
            "tickfont": {"color": "#475569"},
        },
        yaxis={
            "domain": list(main_domain_y),
            "range": [0.0, 1.0],
            "title": {"text": "q(R) · right-stack coordinate", "font": {"color": "#334155"}},
            "showgrid": False,
            "zeroline": False,
            "constrain": "domain",
            "tickfont": {"color": "#475569"},
        },
    )
    figure.add_layout_image(source=main_image, xref="x", yref="y", x=0.0, y=1.0, sizex=1.0, sizey=1.0, sizing="stretch", opacity=1.0, layer="below")

    add_precision_path_trace(figure, payload=payload, axis_suffix="", show_text=False, line_width=1.7, marker_size=6.0, text_color="#0f172a")

    start_state = payload.states[0]
    end_state = payload.states[-1]
    figure.add_trace(go.Scatter(x=[start_state.x_left], y=[start_state.x_right], mode="markers", marker={"size": 8.2, "symbol": "diamond", "color": "#0f172a", "line": {"color": "#ffffff", "width": 1.0}}, hovertemplate="start state<extra></extra>", showlegend=False))
    figure.add_trace(go.Scatter(x=[end_state.x_left], y=[end_state.x_right], mode="markers", marker={"size": 9.2, "symbol": "star", "color": "#be123c", "line": {"color": "#ffffff", "width": 1.0}}, hovertemplate="final state<extra></extra>", showlegend=False))

    for label in vertex_labels:
        first_step = label.step_indexes[0]
        ax, ay, xanchor = label_offsets[first_step]
        border_color = "#94a3b8"
        figure.add_annotation(
            x=label.anchor_state.x_left,
            y=label.anchor_state.x_right,
            xref="x",
            yref="y",
            text=label.text,
            showarrow=True,
            arrowhead=0,
            arrowwidth=0.8,
            arrowcolor="rgba(100,116,139,0.42)",
            ax=ax,
            ay=ay,
            xanchor=xanchor,
            font={"size": 11, "color": "#0f172a"},
            bgcolor="rgba(255,255,255,0.88)",
            bordercolor=border_color,
            borderwidth=1,
            borderpad=4,
        )

    figure.add_annotation(
        x=0.50,
        y=0.955,
        xref="paper",
        yref="paper",
        text="The head starts at the far left, sweeps right, edits, then doubles back; labels show local 10-bit tape windows.",
        showarrow=False,
        xanchor="center",
        yanchor="top",
        align="center",
        font={"size": 13, "color": "#334155"},
        bgcolor="rgba(255,255,255,0.80)",
        bordercolor="#d6dae2",
        borderwidth=1,
    )
    figure.add_annotation(
        x=0.97,
        y=0.05,
        xref="paper",
        yref="paper",
        text="Finite picture, infinite claim: the depth-6 dust is only a proxy for the indefinitely nested precision the construction relies on.",
        showarrow=False,
        xanchor="right",
        yanchor="bottom",
        align="right",
        font={"size": 12, "color": "#334155"},
        bgcolor="rgba(255,255,255,0.82)",
        bordercolor="#d6dae2",
        borderwidth=1,
    )
    return figure


def render_precision_assets(*, output_dir: Path, write_html: bool) -> dict[str, object]:
    payload = build_precision_story_payload()
    figure = build_precision_story_figure(payload)
    files = write_figure(figure, output_dir=output_dir, stem=PRECISION_IMAGE_STEM, write_html=write_html)
    return {
        "files": files,
        "encoding": payload.encoding,
        "dust_depth": payload.dust_depth,
        "initial_left_stack": payload.initial_left_stack,
        "initial_right_stack": payload.initial_right_stack,
        "step_labels": list(payload.step_labels),
        "zoom_depths": [zoom.depth for zoom in payload.zooms],
    }


@app.command()
def generate(
    output_dir: Path = typer.Option(DEFAULT_OUTPUT_DIR, help="Directory where article-facing assets should be written."),
    html: bool = typer.Option(True, "--html/--no-html", help="Whether to emit a Plotly HTML companion alongside the PNG."),
    clean: bool = typer.Option(True, "--clean/--no-clean", help="Whether to clear the output directory before generating fresh artifacts."),
) -> None:
    if clean:
        clean_output_dir(output_dir)
    render_precision_assets(output_dir=output_dir, write_html=html)


def main() -> None:
    app()


if __name__ == "__main__":
    main()
