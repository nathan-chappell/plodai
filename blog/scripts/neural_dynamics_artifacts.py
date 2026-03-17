from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
import itertools
import json
import math
import random
from statistics import mean
from typing import Callable, Literal

import plotly.graph_objects as go
from plotly.subplots import make_subplots
import torch
from torch import nn
import typer


app = typer.Typer(
    help="Generate article-ready neural network figures for the theoretical-justification post."
)
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
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
PAD_INDEX = 2
SHORT_LENGTH_MAX = 80
DEFAULT_MAX_LENGTH = 240
PHASE_ONE_MAX_LENGTH = 10
INVALID_KIND_RANDOM = "random_invalid"
INVALID_KIND_CORRUPTION = "corruption_invalid"
INVALID_KIND_VALID_THEN_INVALID = "valid_then_invalid"
INVALID_KIND_INVALID_THEN_VALID = "invalid_then_valid"
INVALID_KIND_ORDER: tuple[str, ...] = (
    INVALID_KIND_RANDOM,
    INVALID_KIND_CORRUPTION,
    INVALID_KIND_VALID_THEN_INVALID,
    INVALID_KIND_INVALID_THEN_VALID,
)
TRACE_PROBES: tuple[tuple[str, str], ...] = (
    ("shallow valid", "()()()()"),
    ("nested valid", "(((())))"),
    ("near miss invalid", "(((()))"),
    ("concat invalid", ")(()())()"),
)
RESPONSE_PROBES: tuple[str, ...] = (
    "()",
    "(())",
    "()()",
    "(()())",
    "(((())))",
    "(()(()))",
    "()()()()",
    "(((())))((()))",
    "(()(()()))(())",
    "((()())(()()))",
    "(",
    ")",
    "(()",
    "())",
    "())(",
    "(()))(",
    "()())()",
    "())(()",
    "(((())))((",
    "(()())())(()",
)
FIGURE_STYLE = {
    "paper_bgcolor": "#fcfbf8",
    "plot_bgcolor": "#f4efe6",
    "font": {"family": "Georgia, serif", "color": "#24313d", "size": 14},
}
COLOR_VALID = "#c26b2d"
COLOR_INVALID = "#2f6c8f"
COLOR_SHORT = "#1f5f7a"
COLOR_LONG = "#bc6c25"
COLOR_TRAIN = "#5c4d7d"
TRACE_COLORS = ("#c26b2d", "#38618c", "#7b4f9d", "#809848")


@app.callback()
def main_callback() -> None:
    """Typer command group for article artifact generation."""


@dataclass(frozen=True)
class SequenceExample:
    text: str
    label: int
    kind: str


@dataclass
class MetricRow:
    epoch: int
    phase: str
    train_loss: float
    train_acc: float
    short_test_loss: float
    short_test_acc: float
    long_test_loss: float
    long_test_acc: float
    probe_change: float = 0.0
    aha_score: float = 0.0


@dataclass
class RNNExperimentResult:
    model_key: str
    model_title: str
    num_layers: int
    warmup_end_epoch: int
    phase_spans: list[dict[str, object]]
    peak_aha_epoch: int
    selected_epochs: list[int]
    metrics: list[MetricRow]
    response_history: list[list[float]]
    representative_train_examples: list[SequenceExample]
    short_test_examples: list[SequenceExample]
    long_test_examples: list[SequenceExample]
    trace_payloads: dict[int, list[dict[str, object]]]
    files: list[str]


@dataclass(frozen=True)
class CurriculumPhase:
    name: str
    label: str
    short_ratio: float
    short_length_max: int
    max_length: int
    batch_size: int
    lr_start: float
    lr_end: float
    epochs: int


def seed_everything(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def is_balanced_parentheses(text: str) -> bool:
    balance = 0
    if not text:
        return False
    for char in text:
        if char not in "()":
            return False
        balance += 1 if char == "(" else -1
        if balance < 0:
            return False
    return balance == 0


def iter_parentheses_strings(max_length: int) -> list[str]:
    sequences: list[str] = []
    for length in range(1, max_length + 1):
        for chars in itertools.product("()", repeat=length):
            sequences.append("".join(chars))
    return sequences


def build_warmup_examples(max_length: int = PHASE_ONE_MAX_LENGTH) -> list[SequenceExample]:
    examples: list[SequenceExample] = []
    for text in iter_parentheses_strings(max_length):
        is_valid = is_balanced_parentheses(text)
        examples.append(
            SequenceExample(
                text=text,
                label=1 if is_valid else 0,
                kind="valid" if is_valid else "exhaustive_invalid",
            )
        )
    return examples


def sample_valid_sequence_of_length(rng: random.Random, length: int) -> str:
    if length < 2 or length % 2 != 0:
        raise ValueError("Valid balanced-parentheses strings require an even length >= 2.")
    opens_remaining = length // 2
    closes_remaining = length // 2
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


def sample_random_invalid_sequence(rng: random.Random, length: int) -> str:
    while True:
        text = "".join(rng.choice("()") for _ in range(length))
        if not is_balanced_parentheses(text):
            return text


def sample_corruption_invalid_sequence(rng: random.Random, length: int) -> str:
    if length < 2 or length % 2 != 0:
        return sample_random_invalid_sequence(rng, length)
    while True:
        base = list(sample_valid_sequence_of_length(rng, length))
        edits = 1 if length < 4 else rng.choice((1, 2))
        positions = rng.sample(range(length), k=edits)
        for position in positions:
            base[position] = ")" if base[position] == "(" else "("
        text = "".join(base)
        if not is_balanced_parentheses(text):
            return text


def valid_concat_lengths(total_length: int) -> list[int]:
    return [
        length
        for length in range(2, total_length)
        if length % 2 == 0 and total_length - length >= 1
    ]


def sample_concat_invalid_sequence(
    rng: random.Random,
    total_length: int,
    *,
    valid_first: bool,
) -> str:
    possible_valid_lengths = valid_concat_lengths(total_length)
    if not possible_valid_lengths:
        return sample_random_invalid_sequence(rng, total_length)
    valid_length = rng.choice(possible_valid_lengths)
    invalid_length = total_length - valid_length
    valid_text = sample_valid_sequence_of_length(rng, valid_length)
    invalid_text = sample_random_invalid_sequence(rng, invalid_length)
    return valid_text + invalid_text if valid_first else invalid_text + valid_text


def sample_invalid_sequence(
    rng: random.Random,
    length: int,
    *,
    kind: str | None = None,
) -> SequenceExample:
    candidate_kinds = (
        (kind,)
        if kind is not None
        else tuple(rng.sample(list(INVALID_KIND_ORDER), k=len(INVALID_KIND_ORDER)))
    )
    for candidate in candidate_kinds:
        if candidate == INVALID_KIND_RANDOM:
            text = sample_random_invalid_sequence(rng, length)
        elif candidate == INVALID_KIND_CORRUPTION:
            text = sample_corruption_invalid_sequence(rng, length)
        elif candidate == INVALID_KIND_VALID_THEN_INVALID:
            text = sample_concat_invalid_sequence(rng, length, valid_first=True)
        elif candidate == INVALID_KIND_INVALID_THEN_VALID:
            text = sample_concat_invalid_sequence(rng, length, valid_first=False)
        else:
            continue
        if not is_balanced_parentheses(text):
            return SequenceExample(text=text, label=0, kind=candidate)
    return SequenceExample(
        text=sample_random_invalid_sequence(rng, length),
        label=0,
        kind=INVALID_KIND_RANDOM,
    )


def sample_truncated_exponential_length(
    rng: random.Random,
    *,
    mean_length: float,
    min_length: int,
    max_length: int,
    even_only: bool = False,
) -> int:
    if mean_length <= 0:
        raise ValueError("mean_length must be positive")
    while True:
        length = max(1, int(round(rng.expovariate(1.0 / mean_length))))
        if min_length <= length <= max_length and (not even_only or length % 2 == 0):
            return length


def sample_bucket_examples(
    *,
    total_examples: int,
    mean_length: float,
    min_length: int,
    max_length: int,
    seed: int,
) -> list[SequenceExample]:
    rng = random.Random(seed)
    examples: list[SequenceExample] = []
    valid_count = total_examples // 2
    invalid_count = total_examples - valid_count
    for _ in range(valid_count):
        length = sample_truncated_exponential_length(
            rng,
            mean_length=mean_length,
            min_length=min_length,
            max_length=max_length,
            even_only=True,
        )
        examples.append(
            SequenceExample(
                text=sample_valid_sequence_of_length(rng, length),
                label=1,
                kind="valid",
            )
        )
    for _ in range(invalid_count):
        length = sample_truncated_exponential_length(
            rng,
            mean_length=mean_length,
            min_length=min_length,
            max_length=max_length,
        )
        examples.append(sample_invalid_sequence(rng, length))
    rng.shuffle(examples)
    return examples


def sample_phase2_examples(
    *,
    total_examples: int,
    mean_length: float,
    short_ratio: float,
    short_length_max: int,
    max_length: int,
    seed: int,
) -> list[SequenceExample]:
    if not 0 <= short_ratio <= 1:
        raise ValueError("short_ratio must be between 0 and 1 inclusive.")
    short_examples = int(round(total_examples * short_ratio))
    long_examples = total_examples - short_examples
    short_bucket = (
        sample_bucket_examples(
            total_examples=short_examples,
            mean_length=mean_length,
            min_length=1,
            max_length=short_length_max,
            seed=seed,
        )
        if short_examples > 0
        else []
    )
    long_bucket = (
        sample_bucket_examples(
            total_examples=long_examples,
            mean_length=mean_length,
            min_length=short_length_max + 1,
            max_length=max_length,
            seed=seed + 17,
        )
        if long_examples > 0 and short_length_max < max_length
        else []
    )
    combined = short_bucket + long_bucket
    random.Random(seed + 31).shuffle(combined)
    return combined


def examples_to_tensors(
    examples: list[SequenceExample],
) -> tuple[list[str], torch.Tensor]:
    texts = [example.text for example in examples]
    labels = torch.tensor(
        [float(example.label) for example in examples],
        dtype=torch.float32,
        device=DEVICE,
    )
    return texts, labels


def encode_sequences(sequences: list[str]) -> tuple[torch.Tensor, torch.Tensor]:
    lengths = torch.tensor([len(sequence) for sequence in sequences], dtype=torch.long)
    max_length = int(lengths.max().item()) if len(sequences) else 0
    tokens = torch.full((len(sequences), max_length), PAD_INDEX, dtype=torch.long)
    for row, sequence in enumerate(sequences):
        encoded = [0 if char == "(" else 1 for char in sequence]
        tokens[row, : len(encoded)] = torch.tensor(encoded, dtype=torch.long)
    return tokens.to(DEVICE), lengths.to(DEVICE)


class TinyTraceRNN(nn.Module):
    def __init__(
        self,
        *,
        hidden_size: int = 4,
        num_layers: int = 1,
        embedding_dim: int = 4,
    ) -> None:
        super().__init__()
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.embedding = nn.Embedding(3, embedding_dim, padding_idx=PAD_INDEX)
        self.cells = nn.ModuleList(
            [
                nn.RNNCell(
                    input_size=embedding_dim if layer_index == 0 else hidden_size,
                    hidden_size=hidden_size,
                    nonlinearity="tanh",
                )
                for layer_index in range(num_layers)
            ]
        )
        self.classifier = nn.Linear(hidden_size, 1)

    def forward(
        self,
        tokens: torch.Tensor,
        lengths: torch.Tensor,
        *,
        capture_traces: bool = False,
    ) -> tuple[torch.Tensor, list[torch.Tensor] | None]:
        batch_size, steps = tokens.shape
        embedded = self.embedding(tokens)
        states = [
            embedded.new_zeros((batch_size, self.hidden_size))
            for _ in range(self.num_layers)
        ]
        traces: list[list[torch.Tensor]] = [[] for _ in range(self.num_layers)]

        for step_index in range(steps):
            active_mask = (step_index < lengths).unsqueeze(1)
            current = embedded[:, step_index, :]
            for layer_index, cell in enumerate(self.cells):
                next_state = cell(current, states[layer_index])
                states[layer_index] = torch.where(active_mask, next_state, states[layer_index])
                current = states[layer_index]
                if capture_traces:
                    traces[layer_index].append(states[layer_index].detach().cpu())

        logits = self.classifier(states[-1]).squeeze(-1)
        if not capture_traces:
            return logits, None
        return logits, [torch.stack(layer_trace, dim=1) for layer_trace in traces]


class SineMLP(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(1, 32),
            nn.ReLU(),
            nn.Linear(32, 32),
            nn.ReLU(),
            nn.Linear(32, 1),
        )

    def forward(self, values: torch.Tensor) -> torch.Tensor:
        return self.net(2 * values - 1)


def accuracy_from_logits(logits: torch.Tensor, labels: torch.Tensor) -> float:
    predictions = (logits.sigmoid() >= 0.5).float()
    return float((predictions == labels).float().mean().item())


def evaluate_rnn(
    model: TinyTraceRNN,
    examples: list[SequenceExample],
    criterion: nn.Module,
) -> tuple[float, float]:
    model.eval()
    texts, labels = examples_to_tensors(examples)
    with torch.no_grad():
        tokens, lengths = encode_sequences(texts)
        logits, _ = model(tokens, lengths)
        loss = float(criterion(logits, labels).item())
        acc = accuracy_from_logits(logits, labels)
    return loss, acc


def evaluate_probabilities(model: TinyTraceRNN, sequences: list[str]) -> list[float]:
    model.eval()
    with torch.no_grad():
        tokens, lengths = encode_sequences(sequences)
        logits, _ = model(tokens, lengths)
        return logits.sigmoid().detach().cpu().tolist()


def train_rnn_epoch(
    model: TinyTraceRNN,
    examples: list[SequenceExample],
    optimizer: torch.optim.Optimizer,
    criterion: nn.Module,
    *,
    batch_size: int,
    rng: random.Random,
) -> None:
    model.train()
    indices = list(range(len(examples)))
    rng.shuffle(indices)
    for start in range(0, len(indices), batch_size):
        batch_indices = indices[start : start + batch_size]
        batch = [examples[index] for index in batch_indices]
        texts, labels = examples_to_tensors(batch)
        tokens, lengths = encode_sequences(texts)
        optimizer.zero_grad()
        logits, _ = model(tokens, lengths)
        loss = criterion(logits, labels)
        loss.backward()
        optimizer.step()


def set_optimizer_lr(optimizer: torch.optim.Optimizer, lr: float) -> None:
    for group in optimizer.param_groups:
        group["lr"] = lr


def interpolate_lr(epoch_index: int, total_epochs: int, *, start: float, end: float) -> float:
    if total_epochs <= 1:
        return end
    progress = epoch_index / (total_epochs - 1)
    return start + (end - start) * progress


def build_metric_row(
    *,
    epoch: int,
    phase: str,
    train_examples: list[SequenceExample],
    short_test_examples: list[SequenceExample],
    long_test_examples: list[SequenceExample],
    model: TinyTraceRNN,
    criterion: nn.Module,
) -> MetricRow:
    train_loss, train_acc = evaluate_rnn(model, train_examples, criterion)
    short_test_loss, short_test_acc = evaluate_rnn(model, short_test_examples, criterion)
    long_test_loss, long_test_acc = evaluate_rnn(model, long_test_examples, criterion)
    return MetricRow(
        epoch=epoch,
        phase=phase,
        train_loss=train_loss,
        train_acc=train_acc,
        short_test_loss=short_test_loss,
        short_test_acc=short_test_acc,
        long_test_loss=long_test_loss,
        long_test_acc=long_test_acc,
    )


def clone_model_state(model: nn.Module) -> dict[str, torch.Tensor]:
    return {
        key: value.detach().cpu().clone()
        for key, value in model.state_dict().items()
    }


def load_model_state(model: nn.Module, state: dict[str, torch.Tensor]) -> None:
    model.load_state_dict(state)


def score_aha_moments(
    metrics: list[MetricRow],
    response_history: list[list[float]],
) -> None:
    for index, metric in enumerate(metrics):
        if index == 0:
            continue
        previous_metric = metrics[index - 1]
        previous_responses = response_history[index - 1]
        current_responses = response_history[index]
        metric.probe_change = mean(
            abs(current - previous)
            for current, previous in zip(current_responses, previous_responses, strict=False)
        )
        long_acc_jump = max(0.0, metric.long_test_acc - previous_metric.long_test_acc)
        metric.aha_score = long_acc_jump + metric.probe_change


def select_trace_epochs(
    metrics: list[MetricRow],
    *,
    warmup_end_epoch: int,
    phase_boundary_epochs: tuple[int, ...] = (),
    top_k: int = 3,
) -> list[int]:
    final_epoch = metrics[-1].epoch
    candidates = [
        metric.epoch
        for metric in sorted(
            metrics[1:-1],
            key=lambda metric: metric.aha_score,
            reverse=True,
        )[:top_k]
    ]
    ordered = [0, warmup_end_epoch, *phase_boundary_epochs, *candidates, final_epoch]
    selected: list[int] = []
    for epoch in ordered:
        if epoch not in selected:
            selected.append(epoch)
    return sorted(selected)


def peak_aha_epoch(metrics: list[MetricRow]) -> int:
    if len(metrics) <= 2:
        return metrics[-1].epoch
    return max(metrics[1:-1], key=lambda metric: metric.aha_score).epoch


def allocate_phase_epochs(total_epochs: int, weights: tuple[float, ...]) -> list[int]:
    if total_epochs < 0:
        raise ValueError("total_epochs must be non-negative")
    if not weights or any(weight <= 0 for weight in weights):
        raise ValueError("weights must be a non-empty tuple of positive values")
    scaled = [total_epochs * weight / sum(weights) for weight in weights]
    epochs = [math.floor(value) for value in scaled]
    remainder = total_epochs - sum(epochs)
    order = sorted(
        range(len(weights)),
        key=lambda index: scaled[index] - epochs[index],
        reverse=True,
    )
    for index in order[:remainder]:
        epochs[index] += 1
    return epochs


def build_curriculum_phases(
    *,
    total_epochs: int,
    max_length: int,
) -> list[CurriculumPhase]:
    phase_epochs = allocate_phase_epochs(total_epochs, (0.18, 0.24, 0.28, 0.30))
    rollout_max = max(SHORT_LENGTH_MAX + 8, min(max_length, 120))
    return [
        CurriculumPhase(
            name="rollout-short",
            label="rollout short strings",
            short_ratio=1.0,
            short_length_max=min(18, SHORT_LENGTH_MAX),
            max_length=min(max_length, 18),
            batch_size=32,
            lr_start=0.02,
            lr_end=0.008,
            epochs=phase_epochs[0],
        ),
        CurriculumPhase(
            name="rollout-medium",
            label="rollout medium strings",
            short_ratio=0.85,
            short_length_max=min(36, SHORT_LENGTH_MAX),
            max_length=min(max_length, 60),
            batch_size=48,
            lr_start=0.024,
            lr_end=0.008,
            epochs=phase_epochs[1],
        ),
        CurriculumPhase(
            name="shock-long",
            label="shock longer strings",
            short_ratio=0.65,
            short_length_max=SHORT_LENGTH_MAX,
            max_length=rollout_max,
            batch_size=96,
            lr_start=0.03,
            lr_end=0.006,
            epochs=phase_epochs[2],
        ),
        CurriculumPhase(
            name="shock-full",
            label="shock full distribution",
            short_ratio=0.5,
            short_length_max=SHORT_LENGTH_MAX,
            max_length=max_length,
            batch_size=160,
            lr_start=0.024,
            lr_end=0.003,
            epochs=phase_epochs[3],
        ),
    ]


def collect_trace_payloads(
    *,
    model_builder: Callable[[], TinyTraceRNN],
    checkpoints: dict[int, dict[str, torch.Tensor]],
    selected_epochs: list[int],
    trace_probes: tuple[tuple[str, str], ...],
) -> dict[int, list[dict[str, object]]]:
    payloads: dict[int, list[dict[str, object]]] = {}
    for epoch in selected_epochs:
        model = model_builder().to(DEVICE)
        load_model_state(model, checkpoints[epoch])
        sequences = [text for _, text in trace_probes]
        tokens, lengths = encode_sequences(sequences)
        logits, traces = model(tokens, lengths, capture_traces=True)
        predictions = (logits.sigmoid() >= 0.5).detach().cpu().tolist()
        assert traces is not None
        epoch_payloads: list[dict[str, object]] = []
        for probe_index, (label, text) in enumerate(trace_probes):
            layer_payloads: list[dict[str, object]] = []
            for layer_index, layer_trace in enumerate(traces):
                steps = len(text)
                layer_points = layer_trace[probe_index, :steps, :].tolist()
                layer_payloads.append(
                    {
                        "layer": layer_index + 1,
                        "points": layer_points,
                    }
                )
            epoch_payloads.append(
                {
                    "label": label,
                    "text": text,
                    "is_valid": is_balanced_parentheses(text),
                    "predicted_valid": bool(predictions[probe_index]),
                    "correct": bool(predictions[probe_index]) == is_balanced_parentheses(text),
                    "layers": layer_payloads,
                }
            )
        payloads[epoch] = epoch_payloads
    return payloads


def log_spaced_epochs(total_epochs: int, *, count: int) -> list[int]:
    if total_epochs <= 1:
        return [0, total_epochs]
    values = [0]
    for value in torch.logspace(0, math.log10(total_epochs), steps=max(2, count - 1)):
        values.append(int(round(float(value.item()))))
    values.append(total_epochs)
    unique: list[int] = []
    for value in values:
        if value not in unique:
            unique.append(value)
    return sorted(unique)


def write_figure(
    figure: go.Figure,
    *,
    output_dir: Path,
    stem: str,
    write_html: bool,
) -> list[str]:
    ensure_dir(output_dir)
    png_path = output_dir / f"{stem}.png"
    figure.write_image(png_path, width=1400, height=900, scale=2)
    written = [png_path.name]
    if write_html:
        html_path = output_dir / f"{stem}.html"
        figure.write_html(html_path, include_plotlyjs="cdn", full_html=True)
        written.append(html_path.name)
    return written


def build_mlp_dataset(points: int = 512) -> tuple[torch.Tensor, torch.Tensor]:
    xs = torch.linspace(0.0, 1.0, steps=points, device=DEVICE).unsqueeze(1)
    ys = torch.sin(8 * math.pi * xs)
    return xs, ys


def train_mlp(
    *,
    epochs: int,
    batch_size: int,
    lr_start: float,
    lr_end: float,
    seed: int,
) -> tuple[list[float], dict[int, torch.Tensor], torch.Tensor, torch.Tensor]:
    seed_everything(seed)
    model = SineMLP().to(DEVICE)
    optimizer = torch.optim.SGD(model.parameters(), lr=lr_start, momentum=0.9)
    criterion = nn.MSELoss()
    xs, ys = build_mlp_dataset()
    snapshot_epochs = log_spaced_epochs(epochs, count=6)
    snapshots: dict[int, torch.Tensor] = {}
    history: list[float] = []

    model.eval()
    with torch.no_grad():
        snapshots[0] = model(xs).detach().cpu()

    for epoch in range(1, epochs + 1):
        progress = epoch / epochs
        lr = lr_start
        if progress >= 0.8:
            lr *= 0.09
        elif progress >= 0.5:
            lr *= 0.3
        set_optimizer_lr(optimizer, max(lr, lr_end))
        permutation = torch.randperm(xs.shape[0], device=DEVICE)
        model.train()
        for start in range(0, xs.shape[0], batch_size):
            batch_ids = permutation[start : start + batch_size]
            optimizer.zero_grad()
            predictions = model(xs[batch_ids])
            loss = criterion(predictions, ys[batch_ids])
            loss.backward()
            optimizer.step()
        model.eval()
        with torch.no_grad():
            epoch_predictions = model(xs)
            epoch_loss = float(criterion(epoch_predictions, ys).item())
            history.append(epoch_loss)
            if epoch in snapshot_epochs:
                snapshots[epoch] = epoch_predictions.detach().cpu()
    return history, snapshots, xs.detach().cpu(), ys.detach().cpu()


def build_mlp_snapshot_figure(
    *,
    xs: torch.Tensor,
    ys: torch.Tensor,
    snapshots: dict[int, torch.Tensor],
) -> go.Figure:
    epochs = sorted(snapshots)
    rows = 2
    cols = math.ceil(len(epochs) / rows)
    figure = make_subplots(
        rows=rows,
        cols=cols,
        subplot_titles=[f"Epoch {epoch}" for epoch in epochs],
    )
    x_values = xs.squeeze(1).tolist()
    target_values = ys.squeeze(1).tolist()
    for index, epoch in enumerate(epochs):
        row = index // cols + 1
        col = index % cols + 1
        prediction_values = snapshots[epoch].squeeze(1).tolist()
        figure.add_trace(
            go.Scatter(
                x=x_values,
                y=target_values,
                mode="lines",
                name="target" if index == 0 else None,
                line={"color": COLOR_VALID, "width": 3},
                showlegend=index == 0,
            ),
            row=row,
            col=col,
        )
        figure.add_trace(
            go.Scatter(
                x=x_values,
                y=prediction_values,
                mode="lines",
                name="MLP" if index == 0 else None,
                line={"color": COLOR_SHORT, "width": 2.5},
                showlegend=index == 0,
            ),
            row=row,
            col=col,
        )
        figure.update_xaxes(title_text="x", row=row, col=col)
        figure.update_yaxes(title_text="y", row=row, col=col)
    figure.update_layout(
        title="Approximating sin(8πx) with a 1→32→32→1 ReLU MLP",
        legend={"orientation": "h", "y": 1.06, "x": 0.0},
        margin={"t": 90, "r": 30, "b": 60, "l": 60},
        **FIGURE_STYLE,
    )
    return figure


def build_mlp_loss_figure(loss_history: list[float]) -> go.Figure:
    epochs = list(range(1, len(loss_history) + 1))
    figure = go.Figure()
    figure.add_trace(
        go.Scatter(
            x=epochs,
            y=loss_history,
            mode="lines",
            line={"color": COLOR_TRAIN, "width": 3},
            name="MSE loss",
        )
    )
    figure.update_layout(
        title="MLP training loss",
        xaxis_title="epoch",
        yaxis_title="MSE",
        margin={"t": 90, "r": 30, "b": 60, "l": 60},
        **FIGURE_STYLE,
    )
    return figure


def build_rnn_metrics_figure(results: list[RNNExperimentResult]) -> go.Figure:
    figure = make_subplots(
        rows=len(results),
        cols=1,
        shared_xaxes=True,
        subplot_titles=[result.model_title for result in results],
    )
    phase_fill_colors = ("#ead7b8", "#d8e7ef", "#e8dfef", "#dfe9d7", "#f1dfd8")
    phase_border_colors = ("#7a5c2e", "#486c80", "#6a4c93", "#617a3c", "#99624e")
    for row_index, result in enumerate(results, start=1):
        epochs = [metric.epoch for metric in result.metrics]
        final_epoch = epochs[-1]
        for span_index, span in enumerate(result.phase_spans):
            start_epoch = int(span["start_epoch"])
            end_epoch = int(span["end_epoch"])
            fill_color = phase_fill_colors[span_index % len(phase_fill_colors)]
            border_color = phase_border_colors[span_index % len(phase_border_colors)]
            figure.add_vrect(
                x0=start_epoch,
                x1=end_epoch,
                fillcolor=fill_color,
                opacity=0.28 if span_index % 2 else 0.4,
                line_width=0,
                row=row_index,
                col=1,
            )
            if span_index > 0:
                figure.add_vline(
                    x=start_epoch,
                    line_width=3,
                    line_dash="dash",
                    line_color=border_color,
                    row=row_index,
                    col=1,
                )
            span_midpoint = start_epoch + max(0.5, (end_epoch - start_epoch) / 2)
            short_ratio = float(span.get("short_ratio", 1.0))
            batch_size = int(span.get("batch_size", 0))
            short_length_max = int(span.get("short_length_max", SHORT_LENGTH_MAX))
            max_length = int(span.get("max_length", SHORT_LENGTH_MAX))
            figure.add_annotation(
                x=span_midpoint,
                y=0.14,
                xref=f"x{row_index}" if row_index > 1 else "x",
                yref=f"y{row_index}" if row_index > 1 else "y",
                text=(
                    f"{span['label']} ({start_epoch}-{end_epoch})"
                    f"<br>batch={batch_size}, short={short_ratio:.0%}, len<= {short_length_max}, max={max_length}"
                ),
                showarrow=False,
                font={"size": 12, "color": border_color},
                bgcolor=f"rgba(252,251,248,{0.9 if span_index % 2 == 0 else 0.82})",
                bordercolor=border_color,
                borderwidth=1,
            )
        figure.add_vline(
            x=result.peak_aha_epoch,
            line_width=2,
            line_dash="dot",
            line_color="#a23e48",
            row=row_index,
            col=1,
        )
        figure.add_trace(
            go.Scatter(
                x=epochs,
                y=[metric.train_acc for metric in result.metrics],
                mode="lines",
                line={"color": COLOR_TRAIN, "width": 2.5},
                name="train",
                showlegend=row_index == 1,
            ),
            row=row_index,
            col=1,
        )
        figure.add_trace(
            go.Scatter(
                x=epochs,
                y=[metric.short_test_acc for metric in result.metrics],
                mode="lines",
                line={"color": COLOR_SHORT, "width": 2.5},
                name="short test",
                showlegend=row_index == 1,
            ),
            row=row_index,
            col=1,
        )
        figure.add_trace(
            go.Scatter(
                x=epochs,
                y=[metric.long_test_acc for metric in result.metrics],
                mode="lines",
                line={"color": COLOR_LONG, "width": 2.5},
                name="long test",
                showlegend=row_index == 1,
            ),
            row=row_index,
            col=1,
        )
        figure.update_yaxes(title_text="accuracy", range=[0.0, 1.02], row=row_index, col=1)
        figure.add_annotation(
            x=result.peak_aha_epoch,
            y=0.98,
            xref=f"x{row_index}" if row_index > 1 else "x",
            yref=f"y{row_index}" if row_index > 1 else "y",
            text=f"aha @ {result.peak_aha_epoch}",
            showarrow=True,
            arrowhead=2,
            arrowsize=1,
            arrowwidth=1.5,
            ay=-24,
            font={"size": 12, "color": "#a23e48"},
            bgcolor="rgba(252,251,248,0.9)",
            bordercolor="#a23e48",
            borderwidth=1,
        )
    figure.update_xaxes(title_text="epoch", row=len(results), col=1)
    figure.update_layout(
        title={
            "text": "Balanced-parentheses accuracy through curriculum phase changes",
            "x": 0.5,
        },
        legend={"orientation": "h", "y": 1.12, "x": 0.02},
        margin={"t": 110, "r": 40, "b": 60, "l": 60},
        **FIGURE_STYLE,
    )
    return figure


def lengths_for_examples(examples: list[SequenceExample]) -> list[int]:
    return [len(example.text) for example in examples]


def invalid_mode_counts(examples: list[SequenceExample]) -> dict[str, int]:
    counts = {kind: 0 for kind in INVALID_KIND_ORDER}
    for example in examples:
        if example.label == 0 and example.kind in counts:
            counts[example.kind] += 1
    return counts


def build_dataset_diversity_figure(
    *,
    train_examples: list[SequenceExample],
    short_test_examples: list[SequenceExample],
    long_test_examples: list[SequenceExample],
) -> go.Figure:
    figure = make_subplots(
        rows=1,
        cols=2,
        subplot_titles=("Length distribution", "Invalid example composition"),
    )
    figure.add_trace(
        go.Histogram(
            x=lengths_for_examples(train_examples),
            name="train",
            opacity=0.65,
            marker_color=COLOR_TRAIN,
            nbinsx=24,
        ),
        row=1,
        col=1,
    )
    figure.add_trace(
        go.Histogram(
            x=lengths_for_examples(short_test_examples),
            name="short test",
            opacity=0.55,
            marker_color=COLOR_SHORT,
            nbinsx=24,
        ),
        row=1,
        col=1,
    )
    figure.add_trace(
        go.Histogram(
            x=lengths_for_examples(long_test_examples),
            name="long test",
            opacity=0.55,
            marker_color=COLOR_LONG,
            nbinsx=24,
        ),
        row=1,
        col=1,
    )
    figure.add_vline(
        x=SHORT_LENGTH_MAX,
        line_width=2,
        line_dash="dash",
        line_color="#425466",
        row=1,
        col=1,
    )
    labels = ["train", "short test", "long test"]
    buckets = [train_examples, short_test_examples, long_test_examples]
    for kind in INVALID_KIND_ORDER:
        figure.add_trace(
            go.Bar(
                x=labels,
                y=[invalid_mode_counts(bucket)[kind] for bucket in buckets],
                name=kind.replace("_", " "),
            ),
            row=1,
            col=2,
        )
    figure.update_layout(
        barmode="stack",
        title="Dataset diversity across the balanced-parentheses curriculum",
        **FIGURE_STYLE,
    )
    figure.update_xaxes(title_text="character length", row=1, col=1)
    figure.update_yaxes(title_text="count", row=1, col=1)
    figure.update_yaxes(title_text="count", row=1, col=2)
    return figure


def build_bifurcation_figure(results: list[RNNExperimentResult]) -> go.Figure:
    figure = make_subplots(
        rows=len(results),
        cols=1,
        shared_xaxes=True,
        subplot_titles=[result.model_title for result in results],
    )
    probe_labels = [
        f"{text} ({'valid' if is_balanced_parentheses(text) else 'invalid'})"
        for text in RESPONSE_PROBES
    ]
    shown_valid = False
    shown_invalid = False
    phase_fill_colors = ("#ead7b8", "#d8e7ef", "#e8dfef", "#dfe9d7", "#f1dfd8")
    phase_border_colors = ("#7a5c2e", "#486c80", "#6a4c93", "#617a3c", "#99624e")
    for row_index, result in enumerate(results, start=1):
        epochs = [metric.epoch for metric in result.metrics]
        for span_index, span in enumerate(result.phase_spans):
            start_epoch = int(span["start_epoch"])
            end_epoch = int(span["end_epoch"])
            fill_color = phase_fill_colors[span_index % len(phase_fill_colors)]
            border_color = phase_border_colors[span_index % len(phase_border_colors)]
            figure.add_vrect(
                x0=start_epoch,
                x1=end_epoch,
                fillcolor=fill_color,
                opacity=0.28 if span_index % 2 else 0.4,
                line_width=0,
                row=row_index,
                col=1,
            )
            if span_index > 0:
                figure.add_vline(
                    x=start_epoch,
                    line_width=3,
                    line_dash="dash",
                    line_color=border_color,
                    row=row_index,
                    col=1,
                )
            span_midpoint = start_epoch + max(0.5, (end_epoch - start_epoch) / 2)
            short_ratio = float(span.get("short_ratio", 1.0))
            batch_size = int(span.get("batch_size", 0))
            figure.add_annotation(
                x=span_midpoint,
                y=0.12,
                xref=f"x{row_index}" if row_index > 1 else "x",
                yref=f"y{row_index}" if row_index > 1 else "y",
                text=(
                    f"{span['label']} ({start_epoch}-{end_epoch})"
                    f"<br>batch={batch_size}, short={short_ratio:.0%}"
                ),
                showarrow=False,
                font={"size": 12, "color": border_color},
                bgcolor=f"rgba(252,251,248,{0.9 if span_index % 2 == 0 else 0.82})",
                bordercolor=border_color,
                borderwidth=1,
            )
        figure.add_vline(
            x=result.peak_aha_epoch,
            line_width=2,
            line_dash="dot",
            line_color="#a23e48",
            row=row_index,
            col=1,
        )
        for probe_index, probe_label in enumerate(probe_labels):
            values = [response[probe_index] for response in result.response_history]
            is_valid = is_balanced_parentheses(RESPONSE_PROBES[probe_index])
            showlegend = False
            if is_valid and not shown_valid:
                showlegend = True
                shown_valid = True
            elif not is_valid and not shown_invalid:
                showlegend = True
                shown_invalid = True
            figure.add_trace(
                go.Scatter(
                    x=epochs,
                    y=values,
                    mode="lines",
                    line={
                        "color": COLOR_VALID if is_valid else COLOR_INVALID,
                        "width": 1.6,
                    },
                    opacity=0.72,
                    name="valid probes" if is_valid else "invalid probes",
                    showlegend=showlegend,
                    customdata=[[probe_label]] * len(epochs),
                    hovertemplate="epoch=%{x}<br>p(valid)=%{y:.3f}<br>%{customdata[0]}<extra></extra>",
                ),
                row=row_index,
                col=1,
            )
        figure.update_yaxes(title_text="p(valid)", range=[0.0, 1.0], row=row_index, col=1)
        figure.add_annotation(
            x=result.peak_aha_epoch,
            y=0.99,
            xref=f"x{row_index}" if row_index > 1 else "x",
            yref=f"y{row_index}" if row_index > 1 else "y",
            text=f"aha @ {result.peak_aha_epoch}",
            showarrow=True,
            arrowhead=2,
            arrowsize=1,
            arrowwidth=1.5,
            ay=-24,
            font={"size": 12, "color": "#a23e48"},
            bgcolor="rgba(252,251,248,0.9)",
            bordercolor="#a23e48",
            borderwidth=1,
        )
    figure.update_xaxes(title_text="epoch", row=len(results), col=1)
    figure.update_layout(
        title={"text": "Response bifurcation across curriculum phase changes", "x": 0.5},
        legend={"orientation": "h", "y": 1.12, "x": 0.02},
        margin={"t": 110, "r": 40, "b": 60, "l": 60},
        **FIGURE_STYLE,
    )
    return figure


def build_trace_figure(
    *,
    model_title: str,
    epoch: int,
    payloads: list[dict[str, object]],
    num_layers: int,
) -> go.Figure:
    figure = make_subplots(
        rows=num_layers,
        cols=2,
        subplot_titles=[
            f"Layer {layer_index + 1}: (h1, h2)"
            if pair_index == 0
            else f"Layer {layer_index + 1}: (h3, h4)"
            for layer_index in range(num_layers)
            for pair_index in range(2)
        ],
    )
    for probe_index, payload in enumerate(payloads):
        label = str(payload["label"])
        text = str(payload["text"])
        correctness = "correct" if bool(payload["correct"]) else "wrong"
        legend_label = f"{label}: {text} ({correctness})"
        for layer_payload in payload["layers"]:  # type: ignore[index]
            layer_number = int(layer_payload["layer"])
            points = layer_payload["points"]  # type: ignore[index]
            xs_left = [point[0] for point in points]
            ys_left = [point[1] for point in points]
            xs_right = [point[2] for point in points]
            ys_right = [point[3] for point in points]
            for col_index, (xs, ys) in enumerate(((xs_left, ys_left), (xs_right, ys_right)), start=1):
                figure.add_trace(
                    go.Scatter(
                        x=xs,
                        y=ys,
                        mode="lines+markers",
                        name=legend_label,
                        showlegend=(layer_number == 1 and col_index == 1),
                        line={"color": TRACE_COLORS[probe_index], "width": 2.3},
                        marker={"size": 6},
                        hovertemplate=f"{legend_label}<br>step=%{{pointNumber}}<br>x=%{{x:.3f}}<br>y=%{{y:.3f}}<extra></extra>",
                    ),
                    row=layer_number,
                    col=col_index,
                )
                figure.add_trace(
                    go.Scatter(
                        x=[xs[0], xs[-1]],
                        y=[ys[0], ys[-1]],
                        mode="markers",
                        showlegend=False,
                        marker={
                            "size": 11,
                            "symbol": ["circle", "x"],
                            "color": [TRACE_COLORS[probe_index], TRACE_COLORS[probe_index]],
                        },
                        hoverinfo="skip",
                    ),
                    row=layer_number,
                    col=col_index,
                )
    figure.update_layout(
        title=f"{model_title} hidden-state traces at epoch {epoch}",
        legend={"orientation": "v", "x": 1.02, "y": 1.0},
        margin={"t": 95, "r": 210, "b": 60, "l": 60},
        **FIGURE_STYLE,
    )
    return figure

def build_model_title(num_layers: int) -> str:
    return "4-unit RNN (1 layer)" if num_layers == 1 else "4-unit RNN (2 layers)"


def run_rnn_experiment(
    *,
    num_layers: int,
    seed: int,
    warmup_max_epochs: int,
    phase2_epochs: int,
    train_samples: int,
    test_samples: int,
    mean_length: float,
    max_length: int,
) -> RNNExperimentResult:
    seed_everything(seed)
    model_builder = lambda: TinyTraceRNN(num_layers=num_layers)
    model = model_builder().to(DEVICE)
    optimizer = torch.optim.SGD(model.parameters(), lr=0.01, momentum=0.9)
    criterion = nn.BCEWithLogitsLoss()
    warmup_examples = build_warmup_examples()
    short_test_examples = sample_bucket_examples(
        total_examples=test_samples,
        mean_length=mean_length,
        min_length=1,
        max_length=SHORT_LENGTH_MAX,
        seed=seed + 101,
    )
    long_test_examples = sample_bucket_examples(
        total_examples=test_samples,
        mean_length=mean_length,
        min_length=SHORT_LENGTH_MAX + 1,
        max_length=max_length,
        seed=seed + 211,
    )
    response_probe_sequences = list(RESPONSE_PROBES)
    metrics: list[MetricRow] = []
    response_history: list[list[float]] = []
    checkpoints: dict[int, dict[str, torch.Tensor]] = {}
    representative_train_examples: list[SequenceExample] = []
    rng = random.Random(seed)

    checkpoints[0] = clone_model_state(model)
    metrics.append(
        build_metric_row(
            epoch=0,
            phase="initial",
            train_examples=warmup_examples,
            short_test_examples=short_test_examples,
            long_test_examples=long_test_examples,
            model=model,
            criterion=criterion,
        )
    )
    response_history.append(evaluate_probabilities(model, response_probe_sequences))

    warmup_end_epoch = 0
    phase_spans: list[dict[str, object]] = []
    best_train_acc = 0.0
    epochs_without_improvement = 0
    perfect_epochs = 0
    global_epoch = 0

    for warmup_epoch in range(1, warmup_max_epochs + 1):
        global_epoch += 1
        train_rnn_epoch(
            model,
            warmup_examples,
            optimizer,
            criterion,
            batch_size=16,
            rng=rng,
        )
        row = build_metric_row(
            epoch=global_epoch,
            phase="warmup",
            train_examples=warmup_examples,
            short_test_examples=short_test_examples,
            long_test_examples=long_test_examples,
            model=model,
            criterion=criterion,
        )
        metrics.append(row)
        response_history.append(evaluate_probabilities(model, response_probe_sequences))
        checkpoints[global_epoch] = clone_model_state(model)
        if row.train_acc > best_train_acc:
            best_train_acc = row.train_acc
            epochs_without_improvement = 0
        else:
            epochs_without_improvement += 1
        if row.train_acc >= 0.999:
            perfect_epochs += 1
        else:
            perfect_epochs = 0
        if perfect_epochs >= 5 or (
            best_train_acc >= 0.90 and epochs_without_improvement >= 20
        ):
            warmup_end_epoch = global_epoch
            break
    if warmup_end_epoch == 0:
        warmup_end_epoch = global_epoch
    phase_spans.append(
        {
            "name": "warmup",
            "label": "warmup",
            "start_epoch": 0,
            "end_epoch": warmup_end_epoch,
            "batch_size": 16,
            "short_ratio": 1.0,
            "short_length_max": PHASE_ONE_MAX_LENGTH,
            "max_length": PHASE_ONE_MAX_LENGTH,
        }
    )

    curriculum_phases = build_curriculum_phases(
        total_epochs=phase2_epochs,
        max_length=max_length,
    )
    for phase_index, curriculum_phase in enumerate(curriculum_phases):
        if curriculum_phase.epochs <= 0:
            continue
        phase_start_epoch = global_epoch + 1
        for local_epoch in range(1, curriculum_phase.epochs + 1):
            global_epoch += 1
            phase_examples = sample_phase2_examples(
                total_examples=train_samples,
                mean_length=mean_length,
                short_ratio=curriculum_phase.short_ratio,
                short_length_max=curriculum_phase.short_length_max,
                max_length=curriculum_phase.max_length,
                seed=seed + (phase_index + 1) * 10_000 + local_epoch * 1009,
            )
            set_optimizer_lr(
                optimizer,
                interpolate_lr(
                    local_epoch - 1,
                    curriculum_phase.epochs,
                    start=curriculum_phase.lr_start,
                    end=curriculum_phase.lr_end,
                ),
            )
            train_rnn_epoch(
                model,
                phase_examples,
                optimizer,
                criterion,
                batch_size=curriculum_phase.batch_size,
                rng=rng,
            )
            metrics.append(
                build_metric_row(
                    epoch=global_epoch,
                    phase=curriculum_phase.name,
                    train_examples=phase_examples,
                    short_test_examples=short_test_examples,
                    long_test_examples=long_test_examples,
                    model=model,
                    criterion=criterion,
                )
            )
            response_history.append(evaluate_probabilities(model, response_probe_sequences))
            checkpoints[global_epoch] = clone_model_state(model)
            representative_train_examples = phase_examples
        phase_spans.append(
            {
                "name": curriculum_phase.name,
                "label": curriculum_phase.label,
                "start_epoch": phase_start_epoch,
                "end_epoch": global_epoch,
                "batch_size": curriculum_phase.batch_size,
                "short_ratio": curriculum_phase.short_ratio,
                "short_length_max": curriculum_phase.short_length_max,
                "max_length": curriculum_phase.max_length,
            }
        )

    if not representative_train_examples:
        representative_train_examples = sample_phase2_examples(
            total_examples=train_samples,
            mean_length=mean_length,
            short_ratio=0.5,
            short_length_max=SHORT_LENGTH_MAX,
            max_length=max_length,
            seed=seed + 503,
        )

    score_aha_moments(metrics, response_history)
    strongest_aha_epoch = peak_aha_epoch(metrics)
    selected_epochs = select_trace_epochs(
        metrics,
        warmup_end_epoch=warmup_end_epoch,
        phase_boundary_epochs=tuple(
            int(span["end_epoch"]) for span in phase_spans[1:-1]
        ),
    )
    trace_payloads = collect_trace_payloads(
        model_builder=model_builder,
        checkpoints=checkpoints,
        selected_epochs=selected_epochs,
        trace_probes=TRACE_PROBES,
    )
    return RNNExperimentResult(
        model_key="rnn-1layer" if num_layers == 1 else "rnn-2layer",
        model_title=build_model_title(num_layers),
        num_layers=num_layers,
        warmup_end_epoch=warmup_end_epoch,
        phase_spans=phase_spans,
        peak_aha_epoch=strongest_aha_epoch,
        selected_epochs=selected_epochs,
        metrics=metrics,
        response_history=response_history,
        representative_train_examples=representative_train_examples,
        short_test_examples=short_test_examples,
        long_test_examples=long_test_examples,
        trace_payloads=trace_payloads,
        files=[],
    )


def render_mlp_assets(
    *,
    output_dir: Path,
    write_html: bool,
    seed: int,
    mlp_epochs: int,
    mlp_batch_size: int,
) -> dict[str, object]:
    loss_history, snapshots, xs, ys = train_mlp(
        epochs=mlp_epochs,
        batch_size=mlp_batch_size,
        lr_start=0.08,
        lr_end=0.008,
        seed=seed,
    )
    files: list[str] = []
    files.extend(
        write_figure(
            build_mlp_snapshot_figure(xs=xs, ys=ys, snapshots=snapshots),
            output_dir=output_dir,
            stem="mlp-sine-approximation-snapshots",
            write_html=write_html,
        )
    )
    files.extend(
        write_figure(
            build_mlp_loss_figure(loss_history),
            output_dir=output_dir,
            stem="mlp-sine-loss",
            write_html=write_html,
        )
    )
    return {
        "files": files,
        "snapshot_epochs": sorted(snapshots),
        "final_loss": loss_history[-1],
    }


def render_rnn_assets(
    *,
    output_dir: Path,
    write_html: bool,
    write_trace_images: bool,
    seed: int,
    warmup_max_epochs: int,
    phase2_epochs: int,
    train_samples: int,
    test_samples: int,
    mean_length: float,
    max_length: int,
) -> dict[str, object]:
    results = [
        run_rnn_experiment(
            num_layers=1,
            seed=seed + 100,
            warmup_max_epochs=warmup_max_epochs,
            phase2_epochs=phase2_epochs,
            train_samples=train_samples,
            test_samples=test_samples,
            mean_length=mean_length,
            max_length=max_length,
        ),
        run_rnn_experiment(
            num_layers=2,
            seed=seed + 200,
            warmup_max_epochs=warmup_max_epochs,
            phase2_epochs=phase2_epochs,
            train_samples=train_samples,
            test_samples=test_samples,
            mean_length=mean_length,
            max_length=max_length,
        ),
    ]
    shared_files: list[str] = []
    shared_files.extend(
        write_figure(
            build_dataset_diversity_figure(
                train_examples=results[0].representative_train_examples,
                short_test_examples=results[0].short_test_examples,
                long_test_examples=results[0].long_test_examples,
            ),
            output_dir=output_dir,
            stem="rnn-dataset-diversity",
            write_html=write_html,
        )
    )
    shared_files.extend(
        write_figure(
            build_rnn_metrics_figure(results),
            output_dir=output_dir,
            stem="rnn-training-metrics",
            write_html=write_html,
        )
    )
    shared_files.extend(
        write_figure(
            build_bifurcation_figure(results),
            output_dir=output_dir,
            stem="rnn-response-bifurcation",
            write_html=write_html,
        )
    )
    if write_trace_images:
        for result in results:
            article_aliases = {
                "initial": 0,
                "aha": result.peak_aha_epoch,
                "final": result.metrics[-1].epoch,
            }
            for alias, epoch in article_aliases.items():
                payloads = result.trace_payloads[epoch]
                result.files.extend(
                    write_figure(
                        build_trace_figure(
                            model_title=result.model_title,
                            epoch=epoch,
                            payloads=payloads,
                            num_layers=result.num_layers,
                        ),
                        output_dir=output_dir,
                        stem=f"{result.model_key}-traces-{alias}",
                        write_html=write_html,
                    )
                )
    return {
        "files": shared_files,
        "models": [
            {
                "model_key": result.model_key,
                "model_title": result.model_title,
                "num_layers": result.num_layers,
                "warmup_end_epoch": result.warmup_end_epoch,
                "phase_spans": result.phase_spans,
                "peak_aha_epoch": result.peak_aha_epoch,
                "selected_epochs": result.selected_epochs,
                "final_metrics": asdict(result.metrics[-1]),
                "files": result.files,
            }
            for result in results
        ],
    }


@app.command()
def generate(
    target: Literal["all", "mlp", "rnn"] = typer.Option(
        "all",
        help="Which artifact set to generate.",
    ),
    output_dir: Path = typer.Option(
        DEFAULT_OUTPUT_DIR,
        help="Directory where article-facing assets should be written.",
    ),
    seed: int = typer.Option(7, help="Random seed."),
    mlp_epochs: int = typer.Option(400, help="Training epochs for the MLP."),
    mlp_batch_size: int = typer.Option(64, help="Mini-batch size for the MLP."),
    rnn_warmup_max_epochs: int = typer.Option(
        60, help="Maximum warmup epochs on exhaustive short strings."
    ),
    rnn_phase2_epochs: int = typer.Option(
        80, help="Shock/curriculum epochs for each RNN."
    ),
    rnn_train_samples: int = typer.Option(
        2048, help="Phase-2 training examples sampled each epoch."
    ),
    rnn_test_samples: int = typer.Option(
        512, help="Examples in each fixed evaluation split."
    ),
    mean_length: float = typer.Option(
        40.0, help="Mean of the truncated exponential length sampler."
    ),
    max_length: int = typer.Option(
        DEFAULT_MAX_LENGTH, help="Maximum sampled string length."
    ),
    html: bool = typer.Option(
        True,
        "--html/--no-html",
        help="Whether to emit Plotly HTML companions alongside PNGs.",
    ),
    trace_images: bool = typer.Option(
        True,
        "--trace-images/--no-trace-images",
        help="Whether to emit detailed trace figure PNGs and HTML files.",
    ),
) -> None:
    ensure_dir(output_dir)
    manifest: dict[str, object] = {
        "article": ARTICLE_SLUG,
        "seed": seed,
        "output_dir": str(output_dir),
    }
    if target in {"all", "mlp"}:
        manifest["mlp"] = render_mlp_assets(
            output_dir=output_dir,
            write_html=html,
            seed=seed,
            mlp_epochs=mlp_epochs,
            mlp_batch_size=mlp_batch_size,
        )
    if target in {"all", "rnn"}:
        manifest["rnn"] = render_rnn_assets(
            output_dir=output_dir,
            write_html=html,
            write_trace_images=trace_images,
            seed=seed,
            warmup_max_epochs=rnn_warmup_max_epochs,
            phase2_epochs=rnn_phase2_epochs,
            train_samples=rnn_train_samples,
            test_samples=rnn_test_samples,
            mean_length=mean_length,
            max_length=max_length,
        )
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    typer.echo(f"Generated assets for {target} at {output_dir}")
    typer.echo(f"Wrote manifest to {manifest_path}")


def main() -> None:
    app()


if __name__ == "__main__":
    main()
