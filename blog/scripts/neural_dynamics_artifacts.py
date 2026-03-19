from __future__ import annotations

from dataclasses import asdict, dataclass
from contextlib import contextmanager
from pathlib import Path
import json
import math
import random
import shutil
from statistics import NormalDist
import time
from typing import Callable, Iterator, Literal

import plotly.graph_objects as go
from plotly.subplots import make_subplots
import torch
from torch import nn
from torch.nn import functional as F
import typer


app = typer.Typer(
    help="Generate article-ready neural network figures for the theoretical-justification post."
)
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
ARTICLE_SLUG = "15-03-2026-the-theoretical-justification-of-neural-networks"

try:
    from blog.scripts.artifact_common import DEFAULT_OUTPUT_DIR, FIGURE_STYLE, clean_output_dir, ensure_dir, write_figure
    from blog.scripts.mlp_story_artifacts import (
        MLPTrainingRun,
        MLP_DEFAULT_SHAPE,
        build_mlp_dataset,
        build_mlp_story_figure,
        format_mlp_shape,
        mlp_story_epochs,
        parse_mlp_shape,
        render_mlp_assets,
        run_mlp_training,
    )
    from blog.scripts.precision_story_artifacts import (
        PRECISION_DUST_DEPTH,
        PRECISION_IMAGE_STEM,
        PRECISION_INITIAL_LEFT_STACK,
        PRECISION_INITIAL_RIGHT_STACK,
        PRECISION_STORY_MODE,
        PRECISION_ZOOM_DEPTHS,
        build_precision_story_figure,
        build_precision_story_payload,
        cantor_stack_pop,
        cantor_stack_push,
        decode_binary_cantor_stack,
        encode_binary_cantor_stack,
        render_precision_assets,
    )
except ModuleNotFoundError:
    from artifact_common import DEFAULT_OUTPUT_DIR, FIGURE_STYLE, clean_output_dir, ensure_dir, write_figure
    from mlp_story_artifacts import (
        MLPTrainingRun,
        MLP_DEFAULT_SHAPE,
        build_mlp_dataset,
        build_mlp_story_figure,
        format_mlp_shape,
        mlp_story_epochs,
        parse_mlp_shape,
        render_mlp_assets,
        run_mlp_training,
    )
    from precision_story_artifacts import (
        PRECISION_DUST_DEPTH,
        PRECISION_IMAGE_STEM,
        PRECISION_INITIAL_LEFT_STACK,
        PRECISION_INITIAL_RIGHT_STACK,
        PRECISION_STORY_MODE,
        PRECISION_ZOOM_DEPTHS,
        build_precision_story_figure,
        build_precision_story_payload,
        cantor_stack_pop,
        cantor_stack_push,
        decode_binary_cantor_stack,
        encode_binary_cantor_stack,
        render_precision_assets,
    )

PAD_INDEX = 2
STORY_PROBE_LENGTH = 10
ACCURACY_EVAL_LENGTHS: tuple[int, ...] = (10, 20, 30, 50)
DEFAULT_PHASE_EPOCHS = 60
DEFAULT_TRAIN_SAMPLES = 192
DEFAULT_TEST_SAMPLES = 32
DEFAULT_RNN_LR_START = 0.0015
DEFAULT_RNN_LR_END = 0.00015
TRAIN_LENGTHS: tuple[int, ...] = (10, 20, 30)

INVALID_KIND_RANDOM = "random_invalid"
PHASE_KIND_RANDOM = "random"
PHASE_KIND_OFF_BY_ONE = "off_by_one"
PHASE_KIND_VALID_PREFIX = "valid_prefix"
PHASE_KIND_BALANCED_INVALID = "balanced_invalid"
PHASE_KIND_PRETRAIN = "phase_random"
PHASE_KIND_SHOCK = "phase_off_by_one"
PHASE_KIND_REINFORCE = "phase_valid_prefix_balanced"

EVAL_COLORS = {
    10: "#c2410c",
    20: "#1d4ed8",
    30: "#15803d",
    50: "#0f766e",
}
PROBE_CLASS_COLORS = {
    "valid": "#2a9d55",
    INVALID_KIND_RANDOM: "#64748b",
    PHASE_KIND_OFF_BY_ONE: "#ea580c",
    PHASE_KIND_VALID_PREFIX: "#0f766e",
    PHASE_KIND_BALANCED_INVALID: "#7c3aed",
}
PROBE_STATUS_STYLES = {
    "valid / correct": {"color": "#2a9d55", "dash": "dot"},
    "invalid / correct": {"color": "#ca8a04", "dash": "dot"},
    "invalid / wrong": {"color": "#dc2626", "dash": "dot"},
    "valid / wrong": {"color": "#dc2626", "dash": "dot"},
}
STORY_STATUS_COLORS = {
    "valid / correct": "#2a9d55",
    "invalid / correct": "#ca8a04",
    "valid / wrong": "#dc2626",
    "invalid / wrong": "#dc2626",
}
TRACE_SIGMA_RANGE = 4.0
STORY_SIGMA_ZOOM = 0.9
NORMAL_DIST = NormalDist()
RUN_START_TIME = time.perf_counter()
LAST_LOG_TIME = RUN_START_TIME


@app.callback()
def main_callback() -> None:
    """Typer command group for article artifact generation."""


@dataclass(frozen=True)
class SequenceExample:
    text: str
    label: int
    kind: str
    family: str = ""


@dataclass(frozen=True)
class ProbeSpec:
    label: str
    text: str
    probe_kind: str
    length: int
    short_label: str
    highlight: bool = False


@dataclass
class MetricRow:
    epoch: int
    phase: str
    train_loss: float
    train_acc: float
    eval_10_acc: float
    eval_20_acc: float
    eval_30_acc: float
    eval_50_acc: float
    off_by_one_acc: float
    valid_prefix_acc: float
    balanced_invalid_acc: float


@dataclass
class TraceCell:
    phase_label: str
    epoch: int
    probe_label: str
    text: str
    probe_kind: str
    is_valid: bool
    predicted_valid: bool
    correct: bool
    probability: float
    raw_points: list[list[float]]
    projected_points: list[list[float]]
    failure_texts: list[str]
    failure_probabilities: list[float]
    failure_projected_points: list[list[float]]


@dataclass
class TraceGridPayload:
    phase_epochs: list[int]
    phase_labels: list[str]
    probe_labels: list[str]
    probe_texts: list[str]
    probe_role_labels: list[str]
    cells: list[TraceCell]
    projection_mode: str
    axis_labels: tuple[str, ...]
    explained_variance: tuple[float, ...]
    acceptance_center: list[float]
    acceptance_region: list[list[float]]


@dataclass(frozen=True)
class TraceStorySelection:
    focus_probe: ProbeSpec
    companion_probes: tuple[ProbeSpec, ...]
    role_labels: tuple[str, ...]

    @property
    def selected_probes(self) -> tuple[ProbeSpec, ...]:
        return (self.focus_probe,) + self.companion_probes


@dataclass(frozen=True)
class ProbeTrajectory:
    probe: ProbeSpec
    actual_valid: bool
    epochs: tuple[int, ...]
    probabilities: tuple[float, ...]
    correctness: tuple[bool, ...]
    turn_pattern: tuple[bool, ...]
    flip_epochs: tuple[int, ...]


@dataclass(frozen=True)
class TrainingPhaseSpec:
    phase_kind: str
    label: str
    epoch_multiplier: int
    batch_size: int
    family_mix: tuple[tuple[str, float], ...]


@dataclass
class RNNExperimentResult:
    model_key: str
    model_title: str
    phase_spans: list[dict[str, object]]
    metrics: list[MetricRow]
    response_history: list[list[float]]
    story_response_history: list[list[float]]
    story_probes: tuple[ProbeSpec, ...]
    evaluation_sets: dict[str | int, list[SequenceExample]]
    representative_examples: list[SequenceExample]
    trace_payload: TraceGridPayload | None
    files: list[str]
    model_mode: str
    language: str
    accept_anchor: list[float]
    accept_radius: float
    state_dimension: int
    checkpoint_labels: list[str]
    checkpoint_epochs: list[int]
    architecture: dict[str, object]
    phase_epoch_schedule: list[int]
    phase_batch_schedule: list[int]
    phase_family_mix: list[dict[str, float]]
    checkpoint_states: dict[int, dict[str, torch.Tensor]]


def seed_everything(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def log_progress(message: str) -> None:
    global LAST_LOG_TIME
    now = time.perf_counter()
    total = now - RUN_START_TIME
    delta = now - LAST_LOG_TIME
    LAST_LOG_TIME = now
    typer.echo(f"[artifacts +{total:7.2f}s | +{delta:6.2f}s] {message}")


@contextmanager
def log_timing(label: str) -> Iterator[None]:
    start = time.perf_counter()
    log_progress(f"{label} started")
    try:
        yield
    finally:
        log_progress(f"{label} finished in {time.perf_counter() - start:.2f}s")


def allocate_counts(total: int, buckets: int) -> list[int]:
    base = total // buckets
    counts = [base] * buckets
    for index in range(total - sum(counts)):
        counts[index] += 1
    return counts


def terminal_balance(text: str) -> int:
    return text.count("(") - text.count(")")


def min_prefix_balance(text: str) -> int:
    balance = 0
    trough = 0
    for char in text:
        balance += 1 if char == "(" else -1
        trough = min(trough, balance)
    return trough


def is_balanced_parentheses(text: str) -> bool:
    if not text:
        return False
    balance = 0
    for char in text:
        if char not in "()":
            return False
        balance += 1 if char == "(" else -1
        if balance < 0:
            return False
    return balance == 0


def is_balanced_invalid(text: str) -> bool:
    return bool(text) and terminal_balance(text) == 0 and min_prefix_balance(text) < 0


def is_valid_prefix_invalid(text: str) -> bool:
    if not text:
        return False
    balance = 0
    for char in text:
        if char not in "()":
            return False
        balance += 1 if char == "(" else -1
        if balance < 0:
            return False
    return balance > 0


def is_off_by_one_invalid(text: str) -> bool:
    return (
        bool(text)
        and not is_balanced_parentheses(text)
        and not is_balanced_invalid(text)
        and not is_valid_prefix_invalid(text)
    )


def sample_balanced_sequence(rng: random.Random, pairs: int) -> str:
    opens_remaining = pairs
    closes_remaining = pairs
    balance = 0
    chars: list[str] = []
    while opens_remaining or closes_remaining:
        choices: list[str] = []
        if opens_remaining:
            choices.append("(")
        if closes_remaining and balance:
            choices.append(")")
        char = rng.choice(choices)
        chars.append(char)
        if char == "(":
            opens_remaining -= 1
            balance += 1
        else:
            closes_remaining -= 1
            balance -= 1
    return "".join(chars)


def sample_valid_sequence_of_length(rng: random.Random, length: int) -> str:
    if length < 2 or length % 2 != 0:
        raise ValueError("Valid balanced-parentheses strings require an even length >= 2.")
    return sample_balanced_sequence(rng, length // 2)


def sample_random_invalid_sequence(rng: random.Random, length: int) -> str:
    candidate = "".join(rng.choice("()") for _ in range(length))
    if not is_balanced_parentheses(candidate):
        return candidate
    chars = list(candidate)
    position = rng.randrange(length)
    chars[position] = ")" if chars[position] == "(" else "("
    broken = "".join(chars)
    if not is_balanced_parentheses(broken):
        return broken
    return ")" + candidate[1:]


def sample_off_by_one_invalid_sequence(rng: random.Random, length: int) -> str:
    if length < 2 or length % 2 != 0:
        return sample_random_invalid_sequence(rng, length)
    base = sample_valid_sequence_of_length(rng, length)
    positions = list(range(length))
    rng.shuffle(positions)
    for position in positions:
        chars = list(base)
        chars[position] = ")" if chars[position] == "(" else "("
        candidate = "".join(chars)
        if is_off_by_one_invalid(candidate):
            return candidate
    for left_index in positions:
        for right_index in positions:
            if left_index == right_index:
                continue
            chars = list(base)
            for position in (left_index, right_index):
                chars[position] = ")" if chars[position] == "(" else "("
            candidate = "".join(chars)
            if is_off_by_one_invalid(candidate):
                return candidate
    raise ValueError(f"Failed to construct an off-by-one invalid sequence for length {length}.")


def sample_balanced_invalid_sequence(rng: random.Random, length: int) -> str:
    if length < 2 or length % 2 != 0:
        return sample_random_invalid_sequence(rng, length)
    base = sample_valid_sequence_of_length(rng, length)
    offsets = list(range(1, length))
    rng.shuffle(offsets)
    for offset in offsets:
        candidate = base[offset:] + base[:offset]
        if is_balanced_invalid(candidate):
            return candidate
    raise ValueError(f"Failed to construct a balanced-invalid sequence for length {length}.")


def sample_valid_prefix_invalid_sequence(rng: random.Random, length: int) -> str:
    if length <= 0:
        raise ValueError("Valid-prefix invalid strings require a positive length.")
    target_balance = 1 if length % 2 else 2
    prefix_length = length - target_balance
    prefix = sample_valid_sequence_of_length(rng, prefix_length) if prefix_length > 0 else ""
    candidate = prefix + "(" * target_balance
    if not is_valid_prefix_invalid(candidate):
        raise ValueError(f"Failed to build valid-prefix invalid sequence for length {length}.")
    return candidate


def sample_examples_by_builder(
    *,
    total_examples: int,
    length: int,
    builder: Callable[[random.Random, int], str],
    label: int,
    kind: str,
    family: str,
    seed: int,
    exclude_texts: set[str] | None = None,
    allow_repeats: bool = False,
) -> list[SequenceExample]:
    rng = random.Random(seed)
    excluded = exclude_texts if exclude_texts is not None else set()
    examples: list[SequenceExample] = []
    seen = set(excluded)
    attempts = 0
    max_attempts = max(2_000, total_examples * 400)
    while len(examples) < total_examples:
        attempts += 1
        if attempts > max_attempts:
            raise RuntimeError(
                f"Unable to build {total_examples} unique examples for family={family} kind={kind} length={length}."
            )
        text = builder(rng, length)
        if not allow_repeats and text in seen:
            continue
        seen.add(text)
        examples.append(SequenceExample(text=text, label=label, kind=kind, family=family))
    return examples


def encode_sequences(sequences: list[str]) -> tuple[torch.Tensor, torch.Tensor]:
    lengths = torch.tensor([len(sequence) for sequence in sequences], dtype=torch.long, device=DEVICE)
    max_length = int(lengths.max().item()) if sequences else 0
    tokens = torch.full((len(sequences), max_length), PAD_INDEX, dtype=torch.long, device=DEVICE)
    for row, sequence in enumerate(sequences):
        for col, char in enumerate(sequence):
            tokens[row, col] = 0 if char == "(" else 1
    return tokens, lengths


def clone_model_parameters(model: nn.Module) -> dict[str, torch.Tensor]:
    return {name: tensor.detach().cpu().clone() for name, tensor in model.state_dict().items()}


def load_model_parameters(model: nn.Module, parameters: dict[str, torch.Tensor]) -> None:
    model.load_state_dict({name: tensor.detach().clone().to(device=DEVICE) for name, tensor in parameters.items()})


def acceptance_distance(states: torch.Tensor) -> torch.Tensor:
    anchor = RNN_ACCEPT_ANCHOR.to(device=states.device, dtype=states.dtype)
    return torch.linalg.vector_norm(states - anchor.unsqueeze(0), dim=1)


def acceptance_probability(states: torch.Tensor) -> torch.Tensor:
    margin = RNN_ACCEPT_RADIUS - acceptance_distance(states)
    return torch.sigmoid(10.0 * margin)


def evaluate_examples(model: PhasedTorchRNN, examples: list[SequenceExample]) -> tuple[float, float]:
    final_states, _ = model([example.text for example in examples], capture_traces=False)
    probabilities = acceptance_probability(final_states)
    labels = torch.tensor([float(example.label) for example in examples], dtype=torch.float64, device=DEVICE)
    loss = float(weighted_bce(probabilities, labels).item())
    predictions = (probabilities >= 0.5).to(torch.float64)
    accuracy = float((predictions == labels).to(torch.float64).mean().item())
    return loss, accuracy


def build_metric_row(
    *,
    epoch: int,
    phase_label: str,
    model: PhasedTorchRNN,
    train_examples: list[SequenceExample],
    evaluation_sets: dict[int, list[SequenceExample]],
    family_sets: dict[str, list[SequenceExample]],
) -> MetricRow:
    train_loss, train_acc = evaluate_examples(model, train_examples)
    eval_10_loss, eval_10_acc = evaluate_examples(model, evaluation_sets[10])
    eval_20_loss, eval_20_acc = evaluate_examples(model, evaluation_sets[20])
    eval_30_loss, eval_30_acc = evaluate_examples(model, evaluation_sets[30])
    eval_50_loss, eval_50_acc = evaluate_examples(model, evaluation_sets[50])
    del eval_10_loss, eval_20_loss, eval_30_loss, eval_50_loss
    _, off_by_one_acc = evaluate_examples(model, family_sets[PHASE_KIND_OFF_BY_ONE])
    _, valid_prefix_acc = evaluate_examples(model, family_sets[PHASE_KIND_VALID_PREFIX])
    _, balanced_invalid_acc = evaluate_examples(model, family_sets[PHASE_KIND_BALANCED_INVALID])
    return MetricRow(
        epoch=epoch,
        phase=phase_label,
        train_loss=train_loss,
        train_acc=train_acc,
        eval_10_acc=eval_10_acc,
        eval_20_acc=eval_20_acc,
        eval_30_acc=eval_30_acc,
        eval_50_acc=eval_50_acc,
        off_by_one_acc=off_by_one_acc,
        valid_prefix_acc=valid_prefix_acc,
        balanced_invalid_acc=balanced_invalid_acc,
    )


def build_story_response_row(model: PhasedTorchRNN, story_texts: list[str]) -> list[float]:
    final_states, _ = model(story_texts, capture_traces=False)
    return acceptance_probability(final_states).tolist()


def fit_pca_projection(points: list[list[float]], *, num_components: int) -> tuple[torch.Tensor, torch.Tensor, tuple[float, ...]]:
    point_tensor = torch.tensor(points, dtype=torch.float32)
    mean = point_tensor.mean(dim=0)
    centered = point_tensor - mean
    _, singular_values, right_vectors = torch.linalg.svd(centered, full_matrices=False)
    components = right_vectors[:num_components, :]
    variance = singular_values.square()
    explained = variance[:num_components] / variance.sum().clamp(min=1e-12)
    return mean, components, tuple(float(value.item()) for value in explained)


def oblique_projection_matrix() -> torch.Tensor:
    return torch.tensor(
        [
            [1.0, 0.0],
            [0.0, 1.0],
            [0.28, 0.18],
        ],
        dtype=torch.float32,
    )


def project_with_oblique_pca(points: list[list[float]], *, mean: torch.Tensor, components: torch.Tensor) -> list[list[float]]:
    if not points:
        return []
    point_tensor = torch.tensor(points, dtype=torch.float32)
    centered = point_tensor - mean
    basis = components.T @ oblique_projection_matrix()
    return (centered @ basis).tolist()


def projected_ball_ellipse(*, center: torch.Tensor, basis: torch.Tensor, radius: float, steps: int = 72) -> tuple[list[float], list[list[float]]]:
    projected_center = (center.unsqueeze(0) @ basis).squeeze(0)
    _, singular_values, right_vectors = torch.linalg.svd(basis, full_matrices=False)
    ellipse_points: list[list[float]] = []
    for step in range(steps + 1):
        theta = (2.0 * math.pi * step) / steps
        unit = torch.tensor([math.cos(theta), math.sin(theta)], dtype=torch.float32)
        offset = radius * (unit * singular_values) @ right_vectors
        ellipse_points.append((projected_center + offset).tolist())
    return projected_center.tolist(), ellipse_points


def add_phase_bands(figure: go.Figure, phase_spans: list[dict[str, object]], row: int) -> None:
    for index, span in enumerate(phase_spans):
        start_epoch = float(span["start_epoch"])
        end_epoch = float(span["end_epoch"])
        figure.add_vrect(
            x0=start_epoch,
            x1=end_epoch,
            fillcolor=SEGMENT_COLORS[str(span["phase_kind"])],
            opacity=0.22,
            line_width=0,
            row=row,
            col=1,
        )
        if index > 0:
            figure.add_vline(x=start_epoch, line={"color": "#8b5e3c", "dash": "dash", "width": 2}, row=row, col=1)
        figure.add_annotation(
            x=(start_epoch + end_epoch) / 2.0,
            y=0.94 if row != 3 else 0.06,
            xref=f"x{'' if row == 1 else row}",
            yref=f"y{'' if row == 1 else row} domain",
            text=f"<b>{span['label']}</b>",
            showarrow=False,
            font={"size": 15, "color": "#374151"},
            bgcolor="rgba(255,255,255,0.9)",
            bordercolor="#d1d5db",
            borderwidth=1,
        )


def probability_to_sigma(probability: float) -> float:
    clamped = min(1.0 - 1e-6, max(1e-6, probability))
    return float(NORMAL_DIST.inv_cdf(clamped))


def boundary_zoom_sigma(value: float) -> float:
    return math.asinh(value / STORY_SIGMA_ZOOM)


def sigma_tick_text(value: int | float) -> str:
    return "0s" if value == 0 else f"{value:+.0f}s"


def probe_status_label(actual_valid: bool, predicted_valid: bool) -> str:
    if actual_valid and predicted_valid:
        return "valid / correct"
    if (not actual_valid) and (not predicted_valid):
        return "invalid / correct"
    if actual_valid and (not predicted_valid):
        return "valid / wrong"
    return "invalid / wrong"


def probe_epoch_statuses(actual_valid: bool, predicted: list[bool]) -> list[str]:
    return [probe_status_label(actual_valid, prediction) for prediction in predicted]


def story_status_segment_runs(statuses: list[str]) -> list[tuple[int, int, str]]:
    if not statuses:
        return []
    runs: list[tuple[int, int, str]] = []
    start = 0
    current = statuses[0]
    for index, status in enumerate(statuses[1:], start=1):
        if status != current:
            runs.append((start, index - 1, current))
            start = index
            current = status
    runs.append((start, len(statuses) - 1, current))
    return runs

# RNN shock reset: balanced parentheses, resampled phase shocks, acceptance-ball geometry.

RNN_HIDDEN_SIZE = 4
RNN_NUM_LAYERS = 2
RNN_ACCEPT_RADIUS = 0.85
RNN_FAMILY_LENGTH = 20
RNN_GEOMETRY_LOSS_WEIGHT = 0.08
RNN_STORY_PROBE_LENGTH = 10
RNN_STORY_PROBE_COUNT = 128
PUBLICATION_CHECKPOINTS_PER_PHASE = 5
TARGET_LANGUAGE = "balanced_parentheses"
RNN_MODEL_MODE = "phased_torch_rnn"
SEGMENT_COLORS = {
    PHASE_KIND_PRETRAIN: "#eef2ff",
    PHASE_KIND_SHOCK: "#fef3c7",
    PHASE_KIND_REINFORCE: "#ecfdf5",
}
RNN_ACCEPT_ANCHOR = torch.zeros(RNN_HIDDEN_SIZE, dtype=torch.float64)
RNN_ACCEPT_ANCHOR[0] = 1.0
RNN_PHASE_SPECS: tuple[TrainingPhaseSpec, ...] = (
    TrainingPhaseSpec(
        phase_kind=PHASE_KIND_PRETRAIN,
        label="Phase 1: random baseline",
        epoch_multiplier=1,
        batch_size=8,
        family_mix=((PHASE_KIND_RANDOM, 1.0),),
    ),
    TrainingPhaseSpec(
        phase_kind=PHASE_KIND_SHOCK,
        label="Phase 2: add off-by-one",
        epoch_multiplier=2,
        batch_size=16,
        family_mix=((PHASE_KIND_RANDOM, 0.5), (PHASE_KIND_OFF_BY_ONE, 0.5)),
    ),
    TrainingPhaseSpec(
        phase_kind=PHASE_KIND_REINFORCE,
        label="Phase 3: add valid-prefix + balanced-invalid",
        epoch_multiplier=2,
        batch_size=32,
        family_mix=(
            (PHASE_KIND_RANDOM, 0.25),
            (PHASE_KIND_OFF_BY_ONE, 0.25),
            (PHASE_KIND_VALID_PREFIX, 0.25),
            (PHASE_KIND_BALANCED_INVALID, 0.25),
        ),
    ),
)
RNN_PHASE_LR_PEAK_FACTORS: tuple[float, ...] = (1.0, 0.8, 0.55)
RNN_PHASE_LR_FLOOR_FACTORS: tuple[float, ...] = (0.6, 0.4, 0.0)


class PhasedTorchRNN(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.rnn = nn.RNN(
            input_size=2,
            hidden_size=RNN_HIDDEN_SIZE,
            nonlinearity="tanh",
            batch_first=True,
            num_layers=RNN_NUM_LAYERS,
            bias=True,
        )
        self.h0 = nn.Parameter(torch.zeros((RNN_NUM_LAYERS, RNN_HIDDEN_SIZE), dtype=torch.float64))
        self.double()
        self.to(DEVICE)

    def forward(
        self,
        sequences: list[str],
        *,
        capture_traces: bool = False,
    ) -> tuple[torch.Tensor, torch.Tensor | None]:
        if not sequences:
            empty = torch.zeros((0, RNN_HIDDEN_SIZE), dtype=torch.float64, device=DEVICE)
            return empty, None
        tokens, lengths = encode_sequences(sequences)
        inputs = F.one_hot(tokens, num_classes=3)[..., :2].to(torch.float64)
        packed_inputs = nn.utils.rnn.pack_padded_sequence(
            inputs,
            lengths.cpu(),
            batch_first=True,
            enforce_sorted=False,
        )
        hidden0 = self.h0.unsqueeze(1).repeat(1, len(sequences), 1)
        packed_outputs, hidden_n = self.rnn(packed_inputs, hidden0)
        traces = None
        if capture_traces:
            outputs, _ = nn.utils.rnn.pad_packed_sequence(
                packed_outputs,
                batch_first=True,
                total_length=inputs.shape[1],
            )
            traces = outputs[:, :, -RNN_HIDDEN_SIZE:]
        return hidden_n[-1], traces


def weighted_bce(probabilities: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:
    positive_count = float(labels.sum().item())
    negative_count = float(len(labels) - positive_count)
    positive_weight = 1.0 if positive_count == 0 else max(1.0, negative_count / max(1.0, positive_count))
    weights = torch.where(labels > 0.5, positive_weight, 1.0).to(probabilities)
    return F.binary_cross_entropy(probabilities, labels, weight=weights)


def acceptance_geometry_loss(final_states: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:
    distances = acceptance_distance(final_states)
    positive_pull = distances.square()
    negative_push = F.relu((RNN_ACCEPT_RADIUS + 0.15) - distances).square()
    return torch.where(labels > 0.5, positive_pull, negative_push).mean()


def classification_loss(final_states: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:
    probabilities = acceptance_probability(final_states)
    return weighted_bce(probabilities, labels) + (RNN_GEOMETRY_LOSS_WEIGHT * acceptance_geometry_loss(final_states, labels))


def allocate_weighted_counts(total: int, family_mix: tuple[tuple[str, float], ...]) -> list[tuple[str, int]]:
    if total <= 0:
        return [(family, 0) for family, _weight in family_mix]
    total_weight = sum(weight for _family, weight in family_mix)
    if total_weight <= 0:
        raise ValueError("family_mix must include positive weight")
    raw = [(family, (weight / total_weight) * total) for family, weight in family_mix]
    counts = [(family, int(value)) for family, value in raw]
    assigned = sum(count for _family, count in counts)
    remainders = sorted(
        ((value - int(value), index) for index, (_family, value) in enumerate(raw)),
        reverse=True,
    )
    counts_list = [count for _family, count in counts]
    for _remainder, index in remainders[: total - assigned]:
        counts_list[index] += 1
    return [(family_mix[index][0], counts_list[index]) for index in range(len(family_mix))]


def deterministic_valid(length: int, seed: int) -> str:
    return sample_valid_sequence_of_length(random.Random(seed), length)


def deterministic_invalid(length: int, kind: str, seed: int) -> str:
    builder = {
        INVALID_KIND_RANDOM: sample_random_invalid_sequence,
        PHASE_KIND_OFF_BY_ONE: sample_off_by_one_invalid_sequence,
        PHASE_KIND_VALID_PREFIX: sample_valid_prefix_invalid_sequence,
        PHASE_KIND_BALANCED_INVALID: sample_balanced_invalid_sequence,
    }[kind]
    return builder(random.Random(seed), length)


def sample_examples_for_family(
    *,
    total_examples: int,
    length: int,
    family_kind: str,
    seed: int,
    family: str,
    exclude_texts: set[str] | None = None,
    allow_repeats: bool = False,
) -> list[SequenceExample]:
    if family_kind == PHASE_KIND_RANDOM:
        valid_count, invalid_count = allocate_counts(total_examples, 2)
        excluded = exclude_texts if exclude_texts is not None else set()
        examples = sample_examples_by_builder(
            total_examples=valid_count,
            length=length,
            builder=sample_valid_sequence_of_length,
            label=1,
            kind="valid",
            family=family,
            seed=seed,
            exclude_texts=excluded,
            allow_repeats=allow_repeats,
        )
        excluded.update(example.text for example in examples)
        examples.extend(
            sample_examples_by_builder(
                total_examples=invalid_count,
                length=length,
                builder=sample_random_invalid_sequence,
                label=0,
                kind=INVALID_KIND_RANDOM,
                family=family,
                seed=seed + 1,
                exclude_texts=excluded,
                allow_repeats=allow_repeats,
            )
        )
        return examples
    builder = {
        INVALID_KIND_RANDOM: sample_random_invalid_sequence,
        PHASE_KIND_OFF_BY_ONE: sample_off_by_one_invalid_sequence,
        PHASE_KIND_VALID_PREFIX: sample_valid_prefix_invalid_sequence,
        PHASE_KIND_BALANCED_INVALID: sample_balanced_invalid_sequence,
    }[family_kind]
    return sample_examples_by_builder(
        total_examples=total_examples,
        length=length,
        builder=builder,
        label=0,
        kind=family_kind,
        family=family,
        seed=seed,
        exclude_texts=exclude_texts,
        allow_repeats=allow_repeats,
    )


def build_rnn_evaluation_sets(
    *,
    test_samples: int,
    seed: int,
) -> dict[int, list[SequenceExample]]:
    suites: dict[int, list[SequenceExample]] = {}
    invalid_families = (
        INVALID_KIND_RANDOM,
        PHASE_KIND_OFF_BY_ONE,
        PHASE_KIND_VALID_PREFIX,
        PHASE_KIND_BALANCED_INVALID,
    )
    for length in ACCURACY_EVAL_LENGTHS:
        excluded: set[str] = set()
        valid_count = test_samples // 2
        invalid_count = test_samples - valid_count
        valid = sample_examples_by_builder(
            total_examples=valid_count,
            length=length,
            builder=sample_valid_sequence_of_length,
            label=1,
            kind="valid",
            family=f"eval-{length}",
            seed=seed + length * 11,
            exclude_texts=excluded,
        )
        excluded.update(example.text for example in valid)
        invalid_examples: list[SequenceExample] = []
        for family_index, (family_kind, family_count) in enumerate(
            allocate_weighted_counts(invalid_count, tuple((family_kind, 1.0) for family_kind in invalid_families)),
            start=1,
        ):
            bucket = sample_examples_for_family(
                total_examples=family_count,
                length=length,
                family_kind=family_kind,
                seed=seed + length * 17 + family_index,
                family=f"eval-{length}",
                exclude_texts=excluded,
                allow_repeats=False,
            )
            excluded.update(example.text for example in bucket)
            invalid_examples.extend(bucket)
        suites[length] = valid + invalid_examples
    return suites


def build_rnn_family_sets(
    *,
    test_samples: int,
    seed: int,
) -> dict[str, list[SequenceExample]]:
    return {
        PHASE_KIND_OFF_BY_ONE: sample_examples_by_builder(
            total_examples=test_samples,
            length=RNN_FAMILY_LENGTH,
            builder=sample_off_by_one_invalid_sequence,
            label=0,
            kind=PHASE_KIND_OFF_BY_ONE,
            family="off-by-one",
            seed=seed + 101,
        ),
        PHASE_KIND_VALID_PREFIX: sample_examples_by_builder(
            total_examples=test_samples,
            length=RNN_FAMILY_LENGTH,
            builder=sample_valid_prefix_invalid_sequence,
            label=0,
            kind=PHASE_KIND_VALID_PREFIX,
            family="valid-prefix",
            seed=seed + 102,
        ),
        PHASE_KIND_BALANCED_INVALID: sample_examples_by_builder(
            total_examples=test_samples,
            length=RNN_FAMILY_LENGTH,
            builder=sample_balanced_invalid_sequence,
            label=0,
            kind=PHASE_KIND_BALANCED_INVALID,
            family="balanced-invalid",
            seed=seed + 103,
        ),
    }


def build_story_probes() -> tuple[ProbeSpec, ...]:
    per_family = RNN_STORY_PROBE_COUNT // 4
    probes: list[ProbeSpec] = []
    all_strings = [format(value, f"0{RNN_STORY_PROBE_LENGTH}b").replace("0", "(").replace("1", ")") for value in range(2**RNN_STORY_PROBE_LENGTH)]
    family_buckets: list[tuple[str, str, list[str]]] = [
        ("V", "valid", [text for text in all_strings if is_balanced_parentheses(text)]),
        ("O", PHASE_KIND_OFF_BY_ONE, [text for text in all_strings if is_off_by_one_invalid(text)]),
        ("P", PHASE_KIND_VALID_PREFIX, [text for text in all_strings if is_valid_prefix_invalid(text)]),
        ("B", PHASE_KIND_BALANCED_INVALID, [text for text in all_strings if is_balanced_invalid(text)]),
    ]
    for prefix, kind, bucket in family_buckets:
        if len(bucket) < per_family:
            raise RuntimeError(
                f"Story probe pool for {kind} only has {len(bucket)} unique strings at length {RNN_STORY_PROBE_LENGTH}."
            )
        for index, text in enumerate(bucket[:per_family], start=1):
            probes.append(
                ProbeSpec(
                    label=f"{prefix}{index}",
                    text=text,
                    probe_kind=kind,
                    length=len(text),
                    short_label=f"{prefix}{index}",
                )
            )
    return tuple(probes)


STORY_PROBES = build_story_probes()


def phase_epoch_schedule(base_phase_epochs: int) -> list[int]:
    if base_phase_epochs <= 0:
        raise ValueError("phase_epochs must be positive")
    return [base_phase_epochs * phase_spec.epoch_multiplier for phase_spec in RNN_PHASE_SPECS]


def phase_learning_rate(
    *,
    phase_index: int,
    epoch_in_phase: int,
    epochs_in_phase: int,
    lr_start: float,
    lr_end: float,
) -> float:
    peak_lr = max(lr_end, lr_start * RNN_PHASE_LR_PEAK_FACTORS[phase_index])
    floor_lr = lr_end if phase_index == len(RNN_PHASE_SPECS) - 1 else max(lr_end, lr_start * RNN_PHASE_LR_FLOOR_FACTORS[phase_index])
    if epochs_in_phase <= 1:
        return floor_lr
    progress = (epoch_in_phase - 1) / (epochs_in_phase - 1)
    cosine = 0.5 * (1.0 + math.cos(math.pi * progress))
    return floor_lr + ((peak_lr - floor_lr) * cosine)


def phase_batch_schedule() -> list[int]:
    return [phase_spec.batch_size for phase_spec in RNN_PHASE_SPECS]


def phase_family_mix_manifest() -> list[dict[str, float]]:
    return [{family: weight for family, weight in phase_spec.family_mix} for phase_spec in RNN_PHASE_SPECS]


def phase_epoch_boundaries(base_phase_epochs: int) -> list[int]:
    boundaries = [0]
    total = 0
    for span in phase_epoch_schedule(base_phase_epochs):
        total += span
        boundaries.append(total)
    return boundaries


def select_story_plot_probes(result: RNNExperimentResult) -> tuple[ProbeSpec, ...]:
    return result.story_probes


def build_publication_checkpoint_epochs(phase_epochs: int) -> list[int]:
    checkpoints = [0]
    elapsed = 0
    for span in phase_epoch_schedule(phase_epochs):
        phase_points = [
            int(round(index * span / (PUBLICATION_CHECKPOINTS_PER_PHASE - 1)))
            for index in range(PUBLICATION_CHECKPOINTS_PER_PHASE)
        ]
        for offset in phase_points[1:]:
            checkpoints.append(elapsed + offset)
        elapsed += span
    deduped: list[int] = []
    for epoch in checkpoints:
        if not deduped or deduped[-1] != epoch:
            deduped.append(epoch)
    return deduped


def checkpoint_label(epoch: int, phase_epochs: int) -> str:
    phase_1_end, phase_2_end, phase_3_end = phase_epoch_boundaries(phase_epochs)[1:]
    if epoch == 0:
        return "Random init"
    if epoch == phase_1_end:
        return "After phase 1"
    if epoch == phase_2_end:
        return "After phase 2"
    if epoch == phase_3_end:
        return "After phase 3"
    if epoch < phase_1_end:
        return f"P1 {epoch / phase_1_end:.2f}"
    if epoch < phase_2_end:
        return f"P2 {(epoch - phase_1_end) / (phase_2_end - phase_1_end):.2f}"
    return f"P3 {(epoch - phase_2_end) / (phase_3_end - phase_2_end):.2f}"


def phase_label_for_epoch(epoch: int, phase_epochs: int) -> str:
    phase_1_end, phase_2_end, _phase_3_end = phase_epoch_boundaries(phase_epochs)[1:]
    if epoch == 0:
        return "Random init"
    if epoch <= phase_1_end:
        return RNN_PHASE_SPECS[0].label
    if epoch <= phase_2_end:
        return RNN_PHASE_SPECS[1].label
    return RNN_PHASE_SPECS[2].label


def phase_spans_for_schedule(phase_epochs: int) -> list[dict[str, object]]:
    boundaries = phase_epoch_boundaries(phase_epochs)
    spans: list[dict[str, object]] = []
    for index, phase_spec in enumerate(RNN_PHASE_SPECS):
        spans.append(
            {
                "label": phase_spec.label,
                "phase_kind": phase_spec.phase_kind,
                "start_epoch": boundaries[index],
                "end_epoch": boundaries[index + 1],
                "epochs": boundaries[index + 1] - boundaries[index],
            }
        )
    return spans


def build_phase_epoch_examples(
    *,
    phase_spec: TrainingPhaseSpec,
    epoch_index: int,
    total_examples: int,
    seed: int,
) -> list[SequenceExample]:
    length_allocations = allocate_counts(total_examples, len(TRAIN_LENGTHS))
    examples: list[SequenceExample] = []
    for length_index, (length, length_count) in enumerate(zip(TRAIN_LENGTHS, length_allocations, strict=True)):
        excluded: set[str] = set()
        family_counts = allocate_weighted_counts(length_count, phase_spec.family_mix)
        for family_index, (family_kind, family_count) in enumerate(family_counts):
            bucket = sample_examples_for_family(
                total_examples=family_count,
                length=length,
                family_kind=family_kind,
                seed=seed
                + ((epoch_index + 1) * 10_000)
                + (length_index * 1_000)
                + (family_index * 97),
                family=f"{phase_spec.phase_kind}-{length}",
                exclude_texts=excluded,
                allow_repeats=True,
            )
            excluded.update(example.text for example in bucket)
            examples.extend(bucket)
    random.Random(seed + epoch_index * 31 + len(examples)).shuffle(examples)
    return examples


def run_training_epoch(
    model: PhasedTorchRNN,
    *,
    examples: list[SequenceExample],
    optimizer: torch.optim.Optimizer,
    batch_size: int,
) -> tuple[float, float]:
    model.train()
    rng = random.Random(len(examples) + batch_size)
    batch_order = list(range(len(examples)))
    rng.shuffle(batch_order)
    total_loss = 0.0
    total_correct = 0
    total_examples = 0
    for start in range(0, len(batch_order), batch_size):
        batch_ids = batch_order[start : start + batch_size]
        batch_examples = [examples[index] for index in batch_ids]
        optimizer.zero_grad()
        final_states, _ = model([example.text for example in batch_examples], capture_traces=False)
        labels = torch.tensor(
            [float(example.label) for example in batch_examples],
            dtype=torch.float64,
            device=DEVICE,
        )
        probabilities = acceptance_probability(final_states)
        loss = classification_loss(final_states, labels)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=2.0)
        optimizer.step()
        predictions = (probabilities >= 0.5).to(torch.float64)
        total_loss += float(loss.item()) * len(batch_examples)
        total_correct += int((predictions == labels).sum().item())
        total_examples += len(batch_examples)
    return total_loss / max(1, total_examples), total_correct / max(1, total_examples)


def run_rnn_experiment(
    *,
    seed: int,
    phase_epochs: int,
    train_samples: int,
    test_samples: int,
    lr_start: float,
    lr_end: float,
) -> RNNExperimentResult:
    seed_everything(seed)
    with log_timing(f"building phased tanh RNN evaluation sets (train_samples={train_samples}, test_samples={test_samples})"):
        evaluation_sets = build_rnn_evaluation_sets(test_samples=test_samples, seed=seed)
        family_sets = build_rnn_family_sets(test_samples=test_samples, seed=seed + 999)
    story_texts = [probe.text for probe in STORY_PROBES]
    checkpoint_epochs = build_publication_checkpoint_epochs(phase_epochs)
    checkpoint_epoch_set = set(checkpoint_epochs)
    phase_schedule = phase_epoch_schedule(phase_epochs)
    phase_batch_sizes = phase_batch_schedule()
    phase_family_mix = phase_family_mix_manifest()
    phase_spans = phase_spans_for_schedule(phase_epochs)
    model = PhasedTorchRNN()
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr_start, weight_decay=1e-4)
    metrics: list[MetricRow] = []
    story_response_history: list[list[float]] = []
    checkpoint_states: dict[int, dict[str, torch.Tensor]] = {}

    def record_checkpoint(epoch: int, train_examples: list[SequenceExample]) -> None:
        metrics.append(
            build_metric_row(
                epoch=epoch,
                phase_label=phase_label_for_epoch(epoch, phase_epochs),
                model=model,
                train_examples=train_examples,
                evaluation_sets=evaluation_sets,
                family_sets=family_sets,
            )
        )
        story_response_history.append(build_story_response_row(model, story_texts))
        checkpoint_states[epoch] = clone_model_parameters(model)

    initial_examples = build_phase_epoch_examples(
        phase_spec=RNN_PHASE_SPECS[0],
        epoch_index=0,
        total_examples=train_samples,
        seed=seed + 2026,
    )
    record_checkpoint(0, initial_examples)
    elapsed = 0
    for phase_index, phase_spec in enumerate(RNN_PHASE_SPECS, start=1):
        epochs_in_phase = phase_schedule[phase_index - 1]
        for offset in range(1, epochs_in_phase + 1):
            epoch = elapsed + offset
            current_lr = phase_learning_rate(
                phase_index=phase_index - 1,
                epoch_in_phase=offset,
                epochs_in_phase=epochs_in_phase,
                lr_start=lr_start,
                lr_end=lr_end,
            )
            for param_group in optimizer.param_groups:
                param_group["lr"] = current_lr
            train_examples = build_phase_epoch_examples(
                phase_spec=phase_spec,
                epoch_index=offset,
                total_examples=train_samples,
                seed=seed + (phase_index * 100_000),
            )
            train_loss, train_acc = run_training_epoch(
                model,
                examples=train_examples,
                optimizer=optimizer,
                batch_size=phase_spec.batch_size,
            )
            if epoch in checkpoint_epoch_set:
                record_checkpoint(epoch, train_examples)
            if offset == 1 or offset == epochs_in_phase or offset % max(1, epochs_in_phase // 4) == 0:
                log_progress(
                    f"{phase_spec.label} epoch {offset}/{epochs_in_phase} loss={train_loss:.3f} acc={train_acc:.3f} batch={phase_spec.batch_size} lr={current_lr:.5f}"
                )
        elapsed += epochs_in_phase

    return RNNExperimentResult(
        model_key="phased-torch-rnn",
        model_title="Phased torch.RNN for balanced parentheses",
        phase_spans=phase_spans,
        metrics=metrics,
        response_history=story_response_history,
        story_response_history=story_response_history,
        story_probes=STORY_PROBES,
        evaluation_sets={**evaluation_sets, **family_sets},
        representative_examples=[],
        trace_payload=None,
        files=[],
        model_mode=RNN_MODEL_MODE,
        language=TARGET_LANGUAGE,
        accept_anchor=RNN_ACCEPT_ANCHOR.tolist(),
        accept_radius=RNN_ACCEPT_RADIUS,
        state_dimension=RNN_HIDDEN_SIZE,
        checkpoint_labels=[checkpoint_label(epoch, phase_epochs) for epoch in checkpoint_epochs],
        checkpoint_epochs=checkpoint_epochs,
        architecture={"module": "torch.RNN", "nonlinearity": "tanh", "hidden_size": RNN_HIDDEN_SIZE, "num_layers": RNN_NUM_LAYERS},
        phase_epoch_schedule=phase_schedule,
        phase_batch_schedule=phase_batch_sizes,
        phase_family_mix=phase_family_mix,
        checkpoint_states=checkpoint_states,
    )


def probe_kind_label(kind: str) -> str:
    return {
        "valid": "balanced valid",
        INVALID_KIND_RANDOM: "random invalid",
        PHASE_KIND_OFF_BY_ONE: "off-by-one",
        PHASE_KIND_VALID_PREFIX: "valid-prefix",
        PHASE_KIND_BALANCED_INVALID: "balanced-invalid",
    }.get(kind, kind)


def select_trace_story_probes(result: RNNExperimentResult) -> TraceStorySelection:
    valid = ProbeSpec(
        label="valid_control",
        text=deterministic_valid(10, 70_001),
        probe_kind="valid",
        length=10,
        short_label="T1",
    )
    off_by_one = ProbeSpec(
        label="off_by_one_shock",
        text=deterministic_invalid(10, PHASE_KIND_OFF_BY_ONE, 70_101),
        probe_kind=PHASE_KIND_OFF_BY_ONE,
        length=10,
        short_label="T2",
    )
    repair = ProbeSpec(
        label="repair_shock",
        text=deterministic_invalid(10, PHASE_KIND_VALID_PREFIX, 70_201),
        probe_kind=PHASE_KIND_VALID_PREFIX,
        length=10,
        short_label="T3",
    )
    return TraceStorySelection(
        focus_probe=valid,
        companion_probes=(off_by_one, repair),
        role_labels=("Valid control", "Off-by-one shock", "Valid-prefix repair"),
    )


def build_trace_grid_payload(
    *,
    result: RNNExperimentResult,
    trace_selection: TraceStorySelection,
) -> TraceGridPayload:
    trace_probes = trace_selection.selected_probes
    phase_epochs = [0, int(result.phase_spans[0]["end_epoch"]), int(result.phase_spans[1]["end_epoch"]), int(result.phase_spans[2]["end_epoch"])]
    phase_labels = ["Random init", "After phase 1", "After phase 2", "After phase 3"]
    cells: list[TraceCell] = []
    all_points: list[list[float]] = []
    for phase_epoch, phase_label in zip(phase_epochs, phase_labels, strict=True):
        phase_model = PhasedTorchRNN()
        load_model_parameters(phase_model, result.checkpoint_states[phase_epoch])
        phase_model.eval()
        for probe in trace_probes:
            final_state, traces = phase_model([probe.text], capture_traces=True)
            assert traces is not None
            raw_points = traces[0, : len(probe.text), :].tolist()
            probability = float(acceptance_probability(final_state).item())
            actual_valid = is_balanced_parentheses(probe.text)
            predicted_valid = probability >= 0.5
            cells.append(
                TraceCell(
                    phase_label=phase_label,
                    epoch=phase_epoch,
                    probe_label=probe.label,
                    text=probe.text,
                    probe_kind=probe.probe_kind,
                    is_valid=actual_valid,
                    predicted_valid=predicted_valid,
                    correct=actual_valid == predicted_valid,
                    probability=probability,
                    raw_points=raw_points,
                    projected_points=[],
                    failure_texts=[],
                    failure_probabilities=[],
                    failure_projected_points=[],
                )
            )
            all_points.extend(raw_points)
    mean, components, explained_variance = fit_pca_projection(all_points, num_components=3)
    oblique_basis = components.T @ oblique_projection_matrix()
    acceptance_center, acceptance_region = projected_ball_ellipse(
        center=RNN_ACCEPT_ANCHOR.to(dtype=torch.float32) - mean,
        basis=oblique_basis,
        radius=RNN_ACCEPT_RADIUS,
    )
    projected_cells = [
        TraceCell(
            phase_label=cell.phase_label,
            epoch=cell.epoch,
            probe_label=cell.probe_label,
            text=cell.text,
            probe_kind=cell.probe_kind,
            is_valid=cell.is_valid,
            predicted_valid=cell.predicted_valid,
            correct=cell.correct,
            probability=cell.probability,
            raw_points=cell.raw_points,
            projected_points=project_with_oblique_pca(cell.raw_points, mean=mean, components=components),
            failure_texts=[],
            failure_probabilities=[],
            failure_projected_points=[],
        )
        for cell in cells
    ]
    return TraceGridPayload(
        phase_epochs=phase_epochs,
        phase_labels=phase_labels,
        probe_labels=[probe.label for probe in trace_probes],
        probe_texts=[probe.text for probe in trace_probes],
        probe_role_labels=list(trace_selection.role_labels),
        cells=projected_cells,
        projection_mode="oblique_pca_2d",
        axis_labels=("PC1 + 0.28*PC3", "PC2 + 0.18*PC3"),
        explained_variance=explained_variance,
        acceptance_center=acceptance_center,
        acceptance_region=acceptance_region,
    )


def build_rnn_story_figure(result: RNNExperimentResult) -> go.Figure:
    figure = make_subplots(
        rows=3,
        cols=1,
        shared_xaxes=True,
        vertical_spacing=0.08,
        row_heights=[0.26, 0.22, 0.52],
        subplot_titles=(
            "Held-out accuracy across the three-phase story",
            "Failure-mode accuracy under the same checkpoints",
            "Family-balanced probe field at length 10",
        ),
    )
    epochs = [metric.epoch for metric in result.metrics]
    for length in ACCURACY_EVAL_LENGTHS:
        figure.add_trace(
            go.Scatter(
                x=epochs,
                y=[getattr(metric, f"eval_{length}_acc") for metric in result.metrics],
                mode="lines+markers",
                name=f"eval {length}",
                line={"color": EVAL_COLORS[length], "width": 1.7},
                marker={"size": 4},
            ),
            row=1,
            col=1,
        )
    for metric_key, label, color in (
        ("off_by_one_acc", "off-by-one", PROBE_CLASS_COLORS[PHASE_KIND_OFF_BY_ONE]),
        ("valid_prefix_acc", "valid-prefix", PROBE_CLASS_COLORS[PHASE_KIND_VALID_PREFIX]),
        ("balanced_invalid_acc", "balanced-invalid", PROBE_CLASS_COLORS[PHASE_KIND_BALANCED_INVALID]),
    ):
        figure.add_trace(
            go.Scatter(
                x=epochs,
                y=[getattr(metric, metric_key) for metric in result.metrics],
                mode="lines+markers",
                name=label,
                line={"color": color, "width": 1.9, "dash": "dash"},
                marker={"size": 4},
            ),
            row=2,
            col=1,
        )
    add_phase_bands(figure, result.phase_spans, row=1)
    add_phase_bands(figure, result.phase_spans, row=2)
    add_phase_bands(figure, result.phase_spans, row=3)
    probe_index = {probe.short_label: index for index, probe in enumerate(result.story_probes)}
    for probe in result.story_probes:
        probabilities = [row[probe_index[probe.short_label]] for row in result.story_response_history]
        sigma_values = [probability_to_sigma(value) for value in probabilities]
        plotted_values = [boundary_zoom_sigma(value) for value in sigma_values]
        actual_valid = is_balanced_parentheses(probe.text)
        predicted = [value >= 0.5 for value in probabilities]
        statuses = probe_epoch_statuses(actual_valid, predicted)
        family_dash = {
            "valid": "solid",
            PHASE_KIND_OFF_BY_ONE: "dash",
            PHASE_KIND_VALID_PREFIX: "dot",
            PHASE_KIND_BALANCED_INVALID: "dashdot",
        }.get(probe.probe_kind, "solid")
        for start_index, end_index, status in story_status_segment_runs(statuses):
            segment_slice = slice(start_index, end_index + 1)
            figure.add_trace(
                go.Scatter(
                    x=epochs[segment_slice],
                    y=plotted_values[segment_slice],
                    mode="lines+markers",
                    line={"color": STORY_STATUS_COLORS[status], "width": 1.65, "dash": family_dash},
                    marker={"size": 4.2},
                    showlegend=False,
                    customdata=[
                        [probabilities[index], statuses[index], probe_kind_label(probe.probe_kind), sigma_values[index]]
                        for index in range(start_index, end_index + 1)
                    ],
                    hovertemplate=(
                        f"{probe.short_label} · {probe.text}<br>"
                        "family=%{customdata[2]}<br>"
                        "checkpoint=%{x}<br>"
                        "status now=%{customdata[1]}<br>"
                        "sigma(valid)=%{customdata[3]:.2f}s<br>"
                        "p(valid)=%{customdata[0]:.3f}<extra></extra>"
                    ),
                ),
                row=3,
                col=1,
            )
    for sigma in (-2, -1, 0, 1, 2):
        figure.add_hline(
            y=boundary_zoom_sigma(float(sigma)),
            line={"color": "#475569" if sigma == 0 else "#cbd5e1", "width": 2.0 if sigma == 0 else 1.0, "dash": "solid" if sigma == 0 else "dot"},
            row=3,
            col=1,
        )
    accuracy_values = []
    for metric in result.metrics:
        accuracy_values.extend(
            [
                metric.eval_10_acc,
                metric.eval_20_acc,
                metric.eval_30_acc,
                metric.eval_50_acc,
                metric.off_by_one_acc,
                metric.valid_prefix_acc,
                metric.balanced_invalid_acc,
            ]
        )
    lower_bound = max(0.0, min(accuracy_values) - 0.04)
    upper_bound = min(1.0, max(accuracy_values) + 0.02)
    figure.update_xaxes(title_text="checkpoint epoch", row=3, col=1)
    figure.update_yaxes(title_text="accuracy", range=[lower_bound, upper_bound], row=1, col=1)
    figure.update_yaxes(title_text="family acc", range=[lower_bound, upper_bound], row=2, col=1)
    sigma_ticks = [-4, -2, -1, 0, 1, 2, 4]
    figure.update_yaxes(
        title_text="sigma(valid) · boundary zoom",
        range=[boundary_zoom_sigma(-4.2), boundary_zoom_sigma(4.2)],
        tickvals=[boundary_zoom_sigma(float(value)) for value in sigma_ticks],
        ticktext=[sigma_tick_text(value) for value in sigma_ticks],
        row=3,
        col=1,
    )
    figure.update_layout(
        title="Random-init 2x4 torch.RNN with resampled counterexample shocks",
        width=1600,
        height=1180,
        margin={"t": 110, "l": 64, "r": 52, "b": 60},
        legend={"orientation": "h", "yanchor": "bottom", "y": 1.03, "x": 0.0},
        **FIGURE_STYLE,
    )
    figure.add_annotation(
        x=0.995,
        y=1.08,
        xref="paper",
        yref="paper",
        text=(
            "Story field: 128 fixed length-10 probes, balanced across valid, off-by-one, valid-prefix, and balanced-invalid"
            "<br>Colors still show current classification status; line dashes distinguish probe families"
            "<br>The training phases resample fresh pools each epoch instead of replaying one static dataset"
        ),
        showarrow=False,
        xanchor="right",
        yanchor="bottom",
        font={"size": 11, "color": "#4b5563"},
    )
    return figure


def build_trace_figure(payload: TraceGridPayload) -> go.Figure:
    rows = len(payload.phase_labels)
    cols = len(payload.probe_labels)
    figure = make_subplots(
        rows=rows,
        cols=cols,
        subplot_titles=[
            f"{role}: {text}"
            for role, text in zip(payload.probe_role_labels, payload.probe_texts, strict=True)
        ],
        vertical_spacing=0.07,
        horizontal_spacing=0.05,
    )
    all_x = [point[0] for cell in payload.cells for point in cell.projected_points] + [point[0] for point in payload.acceptance_region]
    all_y = [point[1] for cell in payload.cells for point in cell.projected_points] + [point[1] for point in payload.acceptance_region]
    x_pad = 0.08 * max(1e-6, max(all_x) - min(all_x))
    y_pad = 0.08 * max(1e-6, max(all_y) - min(all_y))
    x_range = [min(all_x) - x_pad * 0.45, max(all_x) + x_pad * 0.45]
    y_range = [min(all_y) - y_pad * 0.45, max(all_y) + y_pad * 0.45]
    cell_lookup = {(cell.phase_label, cell.probe_label): cell for cell in payload.cells}
    for row_index, phase_label in enumerate(payload.phase_labels, start=1):
        for col_index, probe_label in enumerate(payload.probe_labels, start=1):
            cell = cell_lookup[(phase_label, probe_label)]
            status = probe_status_label(cell.is_valid, cell.predicted_valid)
            style = PROBE_STATUS_STYLES[status]
            figure.add_trace(
                go.Scatter(
                    x=[point[0] for point in payload.acceptance_region],
                    y=[point[1] for point in payload.acceptance_region],
                    mode="lines",
                    fill="toself",
                    line={"color": "rgba(22,101,52,0.70)", "width": 1.6},
                    fillcolor="rgba(74,222,128,0.18)",
                    showlegend=False,
                    hovertemplate="projected acceptance region<extra></extra>",
                ),
                row=row_index,
                col=col_index,
            )
            figure.add_trace(
                go.Scatter(
                    x=[point[0] for point in cell.projected_points],
                    y=[point[1] for point in cell.projected_points],
                    mode="lines+markers",
                    customdata=list(range(1, len(cell.projected_points) + 1)),
                    line={"color": style["color"], "width": 3.3, "dash": style["dash"]},
                    marker={"color": style["color"], "size": 6.8, "opacity": 0.98, "line": {"color": "rgba(248,250,252,0.70)", "width": 0.4}},
                    showlegend=False,
                    hovertemplate=(
                        f"text={cell.text}<br>phase={cell.phase_label}<br>step=%{{customdata}}"
                        f"<br>status now={status}<br>end p(valid)={cell.probability:.3f}<extra></extra>"
                    ),
                ),
                row=row_index,
                col=col_index,
            )
            figure.add_trace(
                go.Scatter(
                    x=[cell.projected_points[0][0]],
                    y=[cell.projected_points[0][1]],
                    mode="markers",
                    marker={"color": "#111111", "size": 9, "symbol": "diamond", "line": {"color": "#f8fafc", "width": 1.0}},
                    showlegend=False,
                    hovertemplate="start<extra></extra>",
                ),
                row=row_index,
                col=col_index,
            )
            figure.add_trace(
                go.Scatter(
                    x=[cell.projected_points[-1][0]],
                    y=[cell.projected_points[-1][1]],
                    mode="markers",
                    marker={"color": style["color"], "size": 11, "symbol": "circle" if cell.correct else "x", "line": {"color": "#111111", "width": 1.6}},
                    showlegend=False,
                    hovertemplate=f"end<br>{status}<br>p(valid)={cell.probability:.3f}<extra></extra>",
                ),
                row=row_index,
                col=col_index,
            )
            figure.add_hline(y=0.0, line={"color": "rgba(100,116,139,0.22)", "width": 1}, row=row_index, col=col_index)
            figure.add_vline(x=0.0, line={"color": "rgba(100,116,139,0.22)", "width": 1}, row=row_index, col=col_index)
            figure.update_xaxes(range=x_range, showticklabels=False, title_text="", row=row_index, col=col_index)
            figure.update_yaxes(range=y_range, showticklabels=False, title_text="", row=row_index, col=col_index)
        figure.add_annotation(
            x=-0.03,
            y=1 - (row_index - 0.5) / rows,
            xref="paper",
            yref="paper",
            text=phase_label,
            showarrow=False,
            textangle=-90,
            font={"size": 12, "color": "#4b5563"},
        )
    figure.update_layout(
        title={"text": "Hidden-state traces across random init and phased counterexample shocks", "y": 0.99},
        width=max(1450, 360 * cols),
        height=max(1260, 270 * rows + 180),
        margin={"t": 150, "l": 80, "r": 80, "b": 70},
        showlegend=False,
        **FIGURE_STYLE,
    )
    figure.add_annotation(
        x=0.995,
        y=1.08,
        xref="paper",
        yref="paper",
        text=(
            f"Oblique PCA map: PC1 {payload.explained_variance[0] * 100:.0f}% var, PC2 {payload.explained_variance[1] * 100:.0f}% var, PC3 {payload.explained_variance[2] * 100:.0f}% var"
            "<br>Rows are random init, after phase 1, after phase 2, and after phase 3"
            "<br>The translucent green ellipse is the projected acceptance ball around the fixed acceptance anchor"
        ),
        showarrow=False,
        xanchor="right",
        yanchor="bottom",
        font={"size": 11, "color": "#4b5563"},
        bgcolor="rgba(255,255,255,0.88)",
        bordercolor="#d1d5db",
        borderwidth=1,
    )
    return figure


def render_rnn_assets(
    *,
    output_dir: Path,
    write_html: bool,
    write_trace_images: bool,
    seed: int,
    phase_epochs: int,
    train_samples: int,
    test_samples: int,
    lr_start: float,
    lr_end: float,
) -> dict[str, object]:
    with log_timing("building phased tanh torch.RNN metrics and response history"):
        result = run_rnn_experiment(seed=seed, phase_epochs=phase_epochs, train_samples=train_samples, test_samples=test_samples, lr_start=lr_start, lr_end=lr_end)
    with log_timing("selecting canonical trace examples and projecting hidden states"):
        trace_selection = select_trace_story_probes(result)
        trace_payload = build_trace_grid_payload(result=result, trace_selection=trace_selection)
    result.trace_payload = trace_payload
    files: list[str] = []
    with log_timing("assembling phased tanh torch.RNN story figure"):
        story_figure = build_rnn_story_figure(result)
    files.extend(write_figure(story_figure, output_dir=output_dir, stem="rnn-training-story", write_html=write_html))
    if write_trace_images:
        with log_timing("assembling phased tanh torch.RNN trace figure"):
            trace_figure = build_trace_figure(trace_payload)
        files.extend(write_figure(trace_figure, output_dir=output_dir, stem="rnn-transition-traces", write_html=write_html))
    result.files = files
    final_metrics = result.metrics[-1]
    log_progress(f"{result.model_title}: final eval10={final_metrics.eval_10_acc:.3f}, eval20={final_metrics.eval_20_acc:.3f}, eval30={final_metrics.eval_30_acc:.3f}, eval50={final_metrics.eval_50_acc:.3f}")
    return {
        "files": files,
        "model_mode": result.model_mode,
        "language": result.language,
        "accept_anchor": result.accept_anchor,
        "accept_radius": result.accept_radius,
        "state_dimension": result.state_dimension,
        "architecture": result.architecture,
        "optimizer": "adamw",
        "learning_rate_start": lr_start,
        "learning_rate_end": lr_end,
        "learning_rate_schedule": "phase_restart_cosine_decay",
        "dynamics": "phased_resampled_counterexample_shocks",
        "checkpoint_labels": result.checkpoint_labels,
        "checkpoint_epochs": result.checkpoint_epochs,
        "phase_schedule": [span["label"] for span in result.phase_spans],
        "phase_epoch_schedule": result.phase_epoch_schedule,
        "phase_batch_schedule": result.phase_batch_schedule,
        "phase_family_mix": result.phase_family_mix,
        "eval_lengths": list(ACCURACY_EVAL_LENGTHS),
        "story_probe_mode": "family_balanced_probe_field",
        "story_probe_count": len(result.story_probes),
        "story_plot_probe_count": len(result.story_probes),
        "story_plot_sampling": "deterministic_family_balanced_slice",
        "story_probe_families": {
            "valid": [probe.text for probe in result.story_probes if probe.probe_kind == "valid"],
            "off_by_one": [probe.text for probe in result.story_probes if probe.probe_kind == PHASE_KIND_OFF_BY_ONE],
            "valid_prefix": [probe.text for probe in result.story_probes if probe.probe_kind == PHASE_KIND_VALID_PREFIX],
            "balanced_invalid": [probe.text for probe in result.story_probes if probe.probe_kind == PHASE_KIND_BALANCED_INVALID],
        },
        "acceptance_region_shape": "projected_ball_ellipse",
        "trace_phase_epochs": trace_payload.phase_epochs,
        "trace_phase_labels": trace_payload.phase_labels,
        "trace_projection_mode": trace_payload.projection_mode,
        "trace_axis_labels": list(trace_payload.axis_labels),
        "trace_explained_variance": list(trace_payload.explained_variance),
        "trace_example_labels": list(trace_selection.role_labels),
        "trace_strings": [asdict(probe) for probe in trace_selection.selected_probes],
        "focus_trace": asdict(trace_selection.focus_probe),
        "final_metrics": asdict(final_metrics),
    }


def generate_artifacts(
    *,
    target: Literal["all", "mlp", "precision", "rnn"],
    output_dir: Path,
    seed: int,
    mlp_epochs: int,
    mlp_batch_size: int,
    mlp_shape: str,
    rnn_phase_epochs: int,
    rnn_train_samples: int,
    rnn_test_samples: int,
    html: bool,
    trace_images: bool,
    clean: bool,
    render_mlp: Callable[..., dict[str, object]] = render_mlp_assets,
    render_precision: Callable[..., dict[str, object]] = render_precision_assets,
    render_rnn: Callable[..., dict[str, object]] = render_rnn_assets,
) -> dict[str, object]:
    if clean:
        log_progress(f"cleaning output directory {output_dir}")
        clean_output_dir(output_dir)
    ensure_dir(output_dir)
    log_progress(f"starting generation for target={target} in {output_dir}")
    manifest: dict[str, object] = {"article": ARTICLE_SLUG, "seed": seed, "output_dir": str(output_dir)}
    if target in {"all", "mlp"}:
        manifest["mlp"] = render_mlp(
            output_dir=output_dir,
            write_html=html,
            seed=seed,
            mlp_epochs=mlp_epochs,
            mlp_batch_size=mlp_batch_size,
            mlp_shape=mlp_shape,
        )
    if target in {"all", "precision"}:
        manifest["precision"] = render_precision(output_dir=output_dir, write_html=html)
    if target in {"all", "rnn"}:
        manifest["rnn"] = render_rnn(
            output_dir=output_dir,
            write_html=html,
            write_trace_images=trace_images,
            seed=seed,
            phase_epochs=rnn_phase_epochs,
            train_samples=rnn_train_samples,
            test_samples=rnn_test_samples,
            lr_start=DEFAULT_RNN_LR_START,
            lr_end=DEFAULT_RNN_LR_END,
        )
    manifest_path = output_dir / "manifest.json"
    log_progress(f"writing {manifest_path.name}")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


@app.command()
def generate(
    target: Literal["all", "mlp", "precision", "rnn"] = typer.Option("all", help="Which artifact set to generate."),
    output_dir: Path = typer.Option(DEFAULT_OUTPUT_DIR, help="Directory where article-facing assets should be written."),
    seed: int = typer.Option(7, help="Random seed."),
    mlp_epochs: int = typer.Option(400, help="Training epochs for the MLP."),
    mlp_batch_size: int = typer.Option(64, help="Mini-batch size for the MLP."),
    mlp_shape: str = typer.Option(",".join(str(size) for size in MLP_DEFAULT_SHAPE), help="Comma-separated hidden-layer widths for the MLP."),
    rnn_phase_epochs: int = typer.Option(DEFAULT_PHASE_EPOCHS, help="Base epoch count for the phased torch.RNN schedule (used as 1x, 2x, 2x)."),
    rnn_train_samples: int = typer.Option(DEFAULT_TRAIN_SAMPLES, help="Resampled training examples per epoch across lengths 10, 20, and 30."),
    rnn_test_samples: int = typer.Option(DEFAULT_TEST_SAMPLES, help="Examples in each fixed RNN evaluation set."),
    html: bool = typer.Option(True, "--html/--no-html", help="Whether to emit Plotly HTML companions alongside PNGs."),
    trace_images: bool = typer.Option(True, "--trace-images/--no-trace-images", help="Whether to emit the transition-trace figure PNG and HTML files."),
    clean: bool = typer.Option(True, "--clean/--no-clean", help="Whether to clear the output directory before generating fresh artifacts."),
) -> None:
    generate_artifacts(
        target=target,
        output_dir=output_dir,
        seed=seed,
        mlp_epochs=mlp_epochs,
        mlp_batch_size=mlp_batch_size,
        mlp_shape=mlp_shape,
        rnn_phase_epochs=rnn_phase_epochs,
        rnn_train_samples=rnn_train_samples,
        rnn_test_samples=rnn_test_samples,
        html=html,
        trace_images=trace_images,
        clean=clean,
    )
    manifest_path = output_dir / "manifest.json"
    typer.echo(f"Generated assets for {target} at {output_dir}")
    typer.echo(f"Wrote manifest to {manifest_path}")


def main() -> None:
    app()


if __name__ == "__main__":
    main()
