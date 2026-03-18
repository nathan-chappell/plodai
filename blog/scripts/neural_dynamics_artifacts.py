from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
import json
import math
import random
import shutil
from typing import Literal

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

TRAIN_LENGTH = 20
EVAL_LENGTHS: tuple[int, ...] = (10, 20, 30)
TRACE_LENGTH = 40
DEFAULT_PHASE_EPOCHS = 5
DEFAULT_TRAIN_SAMPLES = 512
DEFAULT_TEST_SAMPLES = 128
DEFAULT_BATCH_SIZE = 8
DEFAULT_RNN_LR_START = 0.08
DEFAULT_RNN_LR_END = 0.02

PHASE_KIND_RANDOM = "random"
PHASE_KIND_OFF_BY_ONE = "off_by_one"
PHASE_KIND_BALANCED = "balanced_invalid"
PHASE_KIND_ORDER: tuple[str, ...] = (
    PHASE_KIND_RANDOM,
    PHASE_KIND_OFF_BY_ONE,
    PHASE_KIND_BALANCED,
)

INVALID_KIND_RANDOM = "random_invalid"
INVALID_KIND_CORRUPTION = "corruption_invalid"
INVALID_KIND_BALANCED = "balanced_invalid"
INVALID_KIND_ORDER: tuple[str, ...] = (
    INVALID_KIND_RANDOM,
    INVALID_KIND_CORRUPTION,
    INVALID_KIND_BALANCED,
)

FIGURE_STYLE = {
    "paper_bgcolor": "#f7f8fb",
    "plot_bgcolor": "#ffffff",
    "font": {"family": "Aptos, Segoe UI, Helvetica, Arial, sans-serif", "color": "#1f2937", "size": 14},
}
PHASE_COLORS = {
    PHASE_KIND_RANDOM: "#f3e8d3",
    PHASE_KIND_OFF_BY_ONE: "#efe4f8",
    PHASE_KIND_BALANCED: "#e6f3ea",
}
INVALID_COLORS = {
    INVALID_KIND_RANDOM: "#18a9c5",
    INVALID_KIND_CORRUPTION: "#f06292",
    INVALID_KIND_BALANCED: "#9ad65d",
}
EVAL_COLORS = {
    10: "#c2410c",
    20: "#1d4ed8",
    30: "#15803d",
}
PROBE_CLASS_COLORS = {
    "valid": "#2a9d55",
    PHASE_KIND_RANDOM: "#64748b",
    PHASE_KIND_OFF_BY_ONE: "#d97706",
    PHASE_KIND_BALANCED: "#dc2626",
}
PROBE_STATUS_STYLES = {
    "valid / correct": {"color": "#2a9d55", "dash": "solid"},
    "invalid / correct": {"color": "#2d6cdf", "dash": "dot"},
    "invalid / wrong": {"color": "#e23b3b", "dash": "dash"},
    "valid / wrong": {"color": "#d98a00", "dash": "solid"},
}
TRACE_COLORS = ("#7f1d1d", "#1d4ed8", "#166534", "#9333ea", "#db2777")


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
class TrainingPhase:
    name: str
    label: str
    invalid_kinds: tuple[str, ...]
    invalid_weights: tuple[float, ...]
    epochs: int
    train_samples: int
    lr_start: float
    lr_end: float


@dataclass(frozen=True)
class ProbeSpec:
    label: str
    text: str
    probe_kind: str
    length: int
    short_label: str
    highlight: bool = True


@dataclass
class MetricRow:
    epoch: int
    phase: str
    train_loss: float
    train_acc: float
    eval_10_acc: float
    eval_20_acc: float
    eval_30_acc: float


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
    points: list[list[float]]


@dataclass
class TraceGridPayload:
    phase_epochs: list[int]
    phase_labels: list[str]
    probe_labels: list[str]
    probe_texts: list[str]
    cells: list[TraceCell]


@dataclass
class RNNExperimentResult:
    model_key: str
    model_title: str
    phase_spans: list[dict[str, object]]
    metrics: list[MetricRow]
    response_history: list[list[float]]
    evaluation_sets: dict[int, list[SequenceExample]]
    representative_examples: list[SequenceExample]
    trace_payload: TraceGridPayload | None
    files: list[str]


def seed_everything(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


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


def log_progress(message: str) -> None:
    typer.echo(f"[artifacts] {message}")


def min_prefix_balance(text: str) -> int:
    balance = 0
    trough = 0
    for char in text:
        balance += 1 if char == "(" else -1
        trough = min(trough, balance)
    return trough


def terminal_balance(text: str) -> int:
    return text.count("(") - text.count(")")


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
        chars = list(sample_valid_sequence_of_length(rng, length))
        edits = 1 if length < 12 else 2
        for position in rng.sample(range(length), k=edits):
            chars[position] = ")" if chars[position] == "(" else "("
        candidate = "".join(chars)
        if not is_balanced_parentheses(candidate):
            return candidate


def sample_balanced_invalid_sequence(rng: random.Random, length: int) -> str:
    if length < 2 or length % 2 != 0:
        return sample_random_invalid_sequence(rng, length)
    base = sample_valid_sequence_of_length(rng, length)
    for offset in rng.sample(range(1, length), k=length - 1):
        candidate = base[offset:] + base[:offset]
        if is_balanced_invalid(candidate):
            return candidate
    while True:
        chars = ["("] * (length // 2) + [")"] * (length // 2)
        rng.shuffle(chars)
        candidate = "".join(chars)
        if is_balanced_invalid(candidate):
            return candidate


def sample_invalid_sequence(
    rng: random.Random,
    length: int,
    *,
    kind: str,
) -> SequenceExample:
    if kind == INVALID_KIND_RANDOM:
        text = sample_random_invalid_sequence(rng, length)
    elif kind == INVALID_KIND_CORRUPTION:
        text = sample_corruption_invalid_sequence(rng, length)
    elif kind == INVALID_KIND_BALANCED:
        text = sample_balanced_invalid_sequence(rng, length)
    else:
        raise ValueError(f"Unknown invalid kind: {kind}")
    return SequenceExample(text=text, label=0, kind=kind)


def parse_mlp_shape(shape: str) -> tuple[int, ...]:
    hidden_layers = tuple(int(part.strip()) for part in shape.split(",") if part.strip())
    if not hidden_layers or any(size <= 0 for size in hidden_layers):
        raise ValueError("mlp_shape must contain one or more positive integers.")
    return hidden_layers


def format_mlp_shape(hidden_layers: tuple[int, ...]) -> str:
    return "1→" + "→".join(str(size) for size in hidden_layers) + "→1"


def allocate_counts(total: int, buckets: int) -> list[int]:
    base = total // buckets
    counts = [base] * buckets
    for index in range(total - sum(counts)):
        counts[index] += 1
    return counts


def weighted_counts(total: int, weights: tuple[float, ...]) -> list[int]:
    if total <= 0:
        return [0 for _ in weights]
    total_weight = sum(weights)
    scaled = [total * weight / total_weight for weight in weights]
    counts = [int(math.floor(value)) for value in scaled]
    remainder = total - sum(counts)
    order = sorted(
        range(len(weights)),
        key=lambda index: scaled[index] - counts[index],
        reverse=True,
    )
    for index in order[:remainder]:
        counts[index] += 1
    return counts


def sample_exact_length_examples(
    *,
    total_examples: int,
    length: int,
    invalid_weights: tuple[float, ...],
    invalid_kinds: tuple[str, ...],
    seed: int,
    family: str = "",
) -> list[SequenceExample]:
    rng = random.Random(seed)
    examples: list[SequenceExample] = []
    valid_count = total_examples // 2 if length % 2 == 0 else 0
    invalid_count = total_examples - valid_count
    for _ in range(valid_count):
        examples.append(
            SequenceExample(
                text=sample_valid_sequence_of_length(rng, length),
                label=1,
                kind="valid",
                family=family,
            )
        )
    for kind, kind_count in zip(
        invalid_kinds,
        weighted_counts(invalid_count, invalid_weights),
        strict=True,
    ):
        for _ in range(kind_count):
            example = sample_invalid_sequence(rng, length, kind=kind)
            examples.append(
                SequenceExample(
                    text=example.text,
                    label=example.label,
                    kind=example.kind,
                    family=family,
                )
            )
    rng.shuffle(examples)
    return examples


def build_training_phases(
    *,
    phase_epochs: int,
    train_samples: int,
    lr_start: float,
    lr_end: float,
) -> list[TrainingPhase]:
    return [
        TrainingPhase(
            name="phase-1-random",
            label="Phase 1: random",
            invalid_kinds=(INVALID_KIND_RANDOM,),
            invalid_weights=(1.0,),
            epochs=phase_epochs,
            train_samples=train_samples,
            lr_start=lr_start,
            lr_end=lr_end,
        ),
        TrainingPhase(
            name="phase-2-off-by-one",
            label="Phase 2: add off-by-one",
            invalid_kinds=(INVALID_KIND_RANDOM, INVALID_KIND_CORRUPTION),
            invalid_weights=(1.0, 1.0),
            epochs=phase_epochs,
            train_samples=train_samples,
            lr_start=lr_start,
            lr_end=lr_end,
        ),
        TrainingPhase(
            name="phase-3-balanced-invalid",
            label="Phase 3: add balanced-invalid",
            invalid_kinds=(INVALID_KIND_RANDOM, INVALID_KIND_CORRUPTION, INVALID_KIND_BALANCED),
            invalid_weights=(1.0, 1.0, 1.0),
            epochs=phase_epochs,
            train_samples=train_samples,
            lr_start=lr_start,
            lr_end=lr_end,
        ),
    ]


def build_evaluation_sets(
    *,
    test_samples: int,
    seed: int,
) -> dict[int, list[SequenceExample]]:
    return {
        length: sample_exact_length_examples(
            total_examples=test_samples,
            length=length,
            invalid_weights=(1.0, 1.0, 1.0),
            invalid_kinds=(INVALID_KIND_RANDOM, INVALID_KIND_CORRUPTION, INVALID_KIND_BALANCED),
            seed=seed + length * 97,
            family=f"eval-{length}",
        )
        for length in EVAL_LENGTHS
    }


def deterministic_valid(length: int, seed: int) -> str:
    return sample_valid_sequence_of_length(random.Random(seed), length)


def deterministic_invalid(length: int, kind: str, seed: int) -> str:
    return sample_invalid_sequence(random.Random(seed), length, kind=kind).text


def build_response_probes() -> tuple[ProbeSpec, ...]:
    probes: list[ProbeSpec] = []
    for length, base_seed in zip(EVAL_LENGTHS, (1_000, 2_000, 3_000), strict=True):
        probes.extend(
            [
                ProbeSpec(
                    f"{length} valid A",
                    deterministic_valid(length, base_seed + 1),
                    "valid",
                    length,
                    f"{length}V1",
                    True,
                ),
                ProbeSpec(
                    f"{length} valid B",
                    deterministic_valid(length, base_seed + 11),
                    "valid",
                    length,
                    f"{length}V2",
                    False,
                ),
                ProbeSpec(
                    f"{length} random invalid A",
                    deterministic_invalid(length, INVALID_KIND_RANDOM, base_seed + 2),
                    PHASE_KIND_RANDOM,
                    length,
                    f"{length}R1",
                    True,
                ),
                ProbeSpec(
                    f"{length} random invalid B",
                    deterministic_invalid(length, INVALID_KIND_RANDOM, base_seed + 12),
                    PHASE_KIND_RANDOM,
                    length,
                    f"{length}R2",
                    False,
                ),
                ProbeSpec(
                    f"{length} off-by-one A",
                    deterministic_invalid(length, INVALID_KIND_CORRUPTION, base_seed + 3),
                    PHASE_KIND_OFF_BY_ONE,
                    length,
                    f"{length}O1",
                    True,
                ),
                ProbeSpec(
                    f"{length} off-by-one B",
                    deterministic_invalid(length, INVALID_KIND_CORRUPTION, base_seed + 13),
                    PHASE_KIND_OFF_BY_ONE,
                    length,
                    f"{length}O2",
                    False,
                ),
                ProbeSpec(
                    f"{length} balanced-invalid A",
                    deterministic_invalid(length, INVALID_KIND_BALANCED, base_seed + 4),
                    PHASE_KIND_BALANCED,
                    length,
                    f"{length}B1",
                    True,
                ),
                ProbeSpec(
                    f"{length} balanced-invalid B",
                    deterministic_invalid(length, INVALID_KIND_BALANCED, base_seed + 14),
                    PHASE_KIND_BALANCED,
                    length,
                    f"{length}B2",
                    False,
                ),
            ]
        )
    return tuple(probes)


def build_trace_probes() -> tuple[ProbeSpec, ...]:
    valid_40 = deterministic_valid(TRACE_LENGTH, 9_001)
    valid_18_a = deterministic_valid(18, 9_018)
    valid_18_b = deterministic_valid(18, 9_028)
    valid_10 = deterministic_valid(10, 9_010)
    return (
        ProbeSpec("A valid reference", valid_40, "valid", TRACE_LENGTH, "A"),
        ProbeSpec("B immediate invalid", ")" + deterministic_valid(38, 9_101) + "(", "transition", TRACE_LENGTH, "B"),
        ProbeSpec("C valid then bad ending", valid_18_a + valid_18_b + "())(", "transition", TRACE_LENGTH, "C"),
        ProbeSpec(
            "D balanced-invalid",
            deterministic_invalid(TRACE_LENGTH, INVALID_KIND_BALANCED, 9_301),
            PHASE_KIND_BALANCED,
            TRACE_LENGTH,
            "D",
        ),
        ProbeSpec(
            "E oscillating prefix",
            valid_10 + ")" + valid_10 + "(" + deterministic_valid(18, 9_401),
            "transition",
            TRACE_LENGTH,
            "E",
        ),
    )


RESPONSE_PROBES = build_response_probes()
TRACE_PROBES = build_trace_probes()


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
    def __init__(self, hidden_layers: tuple[int, ...]) -> None:
        super().__init__()
        layers: list[nn.Module] = []
        input_size = 1
        for hidden_size in hidden_layers:
            layers.append(nn.Linear(input_size, hidden_size))
            layers.append(nn.ReLU())
            input_size = hidden_size
        layers.append(nn.Linear(input_size, 1))
        self.net = nn.Sequential(*layers)

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
    if not examples:
        return 0.0, 0.0
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


def set_optimizer_lr(optimizer: torch.optim.Optimizer, lr: float) -> None:
    for group in optimizer.param_groups:
        group["lr"] = lr


def phase_epoch_lr(phase: TrainingPhase, local_epoch: int) -> float:
    if phase.epochs <= 1:
        return phase.lr_end
    fraction = (local_epoch - 1) / (phase.epochs - 1)
    return phase.lr_start + fraction * (phase.lr_end - phase.lr_start)


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
        batch = [examples[index] for index in indices[start : start + batch_size]]
        texts, labels = examples_to_tensors(batch)
        tokens, lengths = encode_sequences(texts)
        optimizer.zero_grad()
        logits, _ = model(tokens, lengths)
        loss = criterion(logits, labels)
        loss.backward()
        optimizer.step()


def build_metric_row(
    *,
    epoch: int,
    phase: str,
    train_examples: list[SequenceExample],
    evaluation_sets: dict[int, list[SequenceExample]],
    model: TinyTraceRNN,
    criterion: nn.Module,
) -> MetricRow:
    train_loss, train_acc = evaluate_rnn(model, train_examples, criterion)
    eval_10_acc = evaluate_rnn(model, evaluation_sets[10], criterion)[1]
    eval_20_acc = evaluate_rnn(model, evaluation_sets[20], criterion)[1]
    eval_30_acc = evaluate_rnn(model, evaluation_sets[30], criterion)[1]
    return MetricRow(
        epoch=epoch,
        phase=phase,
        train_loss=train_loss,
        train_acc=train_acc,
        eval_10_acc=eval_10_acc,
        eval_20_acc=eval_20_acc,
        eval_30_acc=eval_30_acc,
    )


def clone_model_state(model: nn.Module) -> dict[str, torch.Tensor]:
    return {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}


def load_model_state(model: nn.Module, state: dict[str, torch.Tensor]) -> None:
    model.load_state_dict(state)


def probe_status_label(actual_valid: bool, predicted_valid: bool) -> str:
    if actual_valid and predicted_valid:
        return "valid / correct"
    if actual_valid and not predicted_valid:
        return "valid / wrong"
    if not actual_valid and predicted_valid:
        return "invalid / wrong"
    return "invalid / correct"


def probe_line_dash(probe_kind: str) -> str:
    if probe_kind == "valid":
        return "solid"
    if probe_kind == PHASE_KIND_RANDOM:
        return "dot"
    if probe_kind == PHASE_KIND_OFF_BY_ONE:
        return "dash"
    if probe_kind == PHASE_KIND_BALANCED:
        return "longdash"
    return "solid"


def probe_end_symbol(status: str) -> str:
    return "circle" if "correct" in status else "x"


def probe_end_label_position(index: int) -> str:
    positions = ("middle right", "top right", "bottom right", "top left", "bottom left")
    return positions[index % len(positions)]


def probe_length_dash(length: int) -> str:
    if length == 10:
        return "solid"
    if length == 20:
        return "dash"
    if length == 30:
        return "dot"
    return "solid"


def probe_class_color(probe_kind: str) -> str:
    return PROBE_CLASS_COLORS.get(probe_kind, "#6b7280")


def build_model_title(hidden_size: int, num_layers: int) -> str:
    layer_text = "layer" if num_layers == 1 else "layers"
    return f"{hidden_size}-unit RNN ({num_layers} {layer_text})"


def run_rnn_experiment(
    *,
    seed: int,
    phase_epochs: int,
    train_samples: int,
    test_samples: int,
    lr_start: float,
    lr_end: float,
) -> tuple[RNNExperimentResult, dict[int, dict[str, torch.Tensor]]]:
    seed_everything(seed)
    phases = build_training_phases(
        phase_epochs=phase_epochs,
        train_samples=train_samples,
        lr_start=lr_start,
        lr_end=lr_end,
    )
    model = TinyTraceRNN(hidden_size=4, num_layers=1).to(DEVICE)
    optimizer = torch.optim.SGD(model.parameters(), lr=lr_start, momentum=0.9)
    criterion = nn.BCEWithLogitsLoss()
    evaluation_sets = build_evaluation_sets(test_samples=test_samples, seed=seed + 7_000)
    response_sequences = [probe.text for probe in RESPONSE_PROBES]
    rng = random.Random(seed + 99)

    metrics: list[MetricRow] = []
    response_history: list[list[float]] = []
    checkpoints: dict[int, dict[str, torch.Tensor]] = {}
    phase_spans: list[dict[str, object]] = []
    representative_examples: list[SequenceExample] = []

    initial_examples = sample_exact_length_examples(
        total_examples=train_samples,
        length=TRAIN_LENGTH,
        invalid_weights=phases[0].invalid_weights,
        invalid_kinds=phases[0].invalid_kinds,
        seed=seed + 111,
        family="train-initial",
    )
    metrics.append(
        build_metric_row(
            epoch=0,
            phase="initial",
            train_examples=initial_examples,
            evaluation_sets=evaluation_sets,
            model=model,
            criterion=criterion,
        )
    )
    response_history.append(evaluate_probabilities(model, response_sequences))

    global_epoch = 0
    for phase_index, phase in enumerate(phases):
        log_progress(
            f"{build_model_title(4, 1)}: starting {phase.label} "
            f"(epochs={phase.epochs}, samples={phase.train_samples}, batch={DEFAULT_BATCH_SIZE}, "
            f"lr={phase.lr_start:.3f}->{phase.lr_end:.3f})"
        )
        start_epoch = global_epoch + 1
        for local_epoch in range(1, phase.epochs + 1):
            global_epoch += 1
            lr = phase_epoch_lr(phase, local_epoch)
            set_optimizer_lr(optimizer, lr)
            phase_examples = sample_exact_length_examples(
                total_examples=phase.train_samples,
                length=TRAIN_LENGTH,
                invalid_weights=phase.invalid_weights,
                invalid_kinds=phase.invalid_kinds,
                seed=seed + phase_index * 10_000 + local_epoch * 307,
                family=phase.name,
            )
            train_rnn_epoch(
                model,
                phase_examples,
                optimizer,
                criterion,
                batch_size=DEFAULT_BATCH_SIZE,
                rng=rng,
            )
            representative_examples = phase_examples
            metrics.append(
                build_metric_row(
                    epoch=global_epoch,
                    phase=phase.name,
                    train_examples=phase_examples,
                    evaluation_sets=evaluation_sets,
                    model=model,
                    criterion=criterion,
                )
            )
            response_history.append(evaluate_probabilities(model, response_sequences))
        checkpoints[global_epoch] = clone_model_state(model)
        phase_spans.append(
            {
                "name": phase.name,
                "label": phase.label,
                "start_epoch": start_epoch,
                "end_epoch": global_epoch,
                "epochs": phase.epochs,
                "train_samples": phase.train_samples,
                "invalid_kinds": list(phase.invalid_kinds),
                "invalid_weights": list(phase.invalid_weights),
                "lr_start": phase.lr_start,
                "lr_end": phase.lr_end,
                "batch_size": DEFAULT_BATCH_SIZE,
            }
        )
        log_progress(f"{build_model_title(4, 1)}: finished {phase.label} at epoch {global_epoch}")

    result = RNNExperimentResult(
        model_key="rnn-1layer-4unit",
        model_title=build_model_title(4, 1),
        phase_spans=phase_spans,
        metrics=metrics,
        response_history=response_history,
        evaluation_sets=evaluation_sets,
        representative_examples=representative_examples,
        trace_payload=None,
        files=[],
    )
    return result, checkpoints


def build_trace_grid_payload(
    *,
    model_builder: callable,
    checkpoints: dict[int, dict[str, torch.Tensor]],
    phase_spans: list[dict[str, object]],
    trace_probes: tuple[ProbeSpec, ...],
) -> TraceGridPayload:
    phase_epochs = [int(span["end_epoch"]) for span in phase_spans]
    phase_labels = [str(span["label"]) for span in phase_spans]
    sequences = [probe.text for probe in trace_probes]
    cells: list[TraceCell] = []

    for phase_index, epoch in enumerate(phase_epochs):
        model = model_builder().to(DEVICE)
        load_model_state(model, checkpoints[epoch])
        tokens, lengths = encode_sequences(sequences)
        logits, traces = model(tokens, lengths, capture_traces=True)
        predictions = (logits.sigmoid() >= 0.5).detach().cpu().tolist()
        assert traces is not None
        layer_trace = traces[0]
        for probe_index, probe in enumerate(trace_probes):
            steps = len(probe.text)
            states = layer_trace[probe_index, :steps, :]
            actual_valid = is_balanced_parentheses(probe.text)
            cells.append(
                TraceCell(
                    phase_label=phase_labels[phase_index],
                    epoch=epoch,
                    probe_label=probe.label,
                    text=probe.text,
                    probe_kind=probe.probe_kind,
                    is_valid=actual_valid,
                    predicted_valid=bool(predictions[probe_index]),
                    correct=actual_valid == bool(predictions[probe_index]),
                    points=states.tolist(),
                )
            )
    return TraceGridPayload(
        phase_epochs=phase_epochs,
        phase_labels=phase_labels,
        probe_labels=[probe.label for probe in trace_probes],
        probe_texts=[probe.text for probe in trace_probes],
        cells=cells,
    )


def mlp_story_epochs(total_epochs: int) -> list[int]:
    if total_epochs <= 0:
        return [0]
    preferred = [0, min(total_epochs, 30), min(total_epochs, 200), total_epochs]
    selected: list[int] = []
    for epoch in preferred:
        if epoch not in selected:
            selected.append(epoch)
    while len(selected) < 4:
        fallback_epoch = max(1, int(round(total_epochs * (0.25 + 0.25 * (len(selected) - 1)))))
        if fallback_epoch not in selected and fallback_epoch < total_epochs:
            selected.insert(-1, fallback_epoch)
        else:
            break
    return selected


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
    hidden_layers: tuple[int, ...],
) -> tuple[list[float], dict[int, torch.Tensor], torch.Tensor, torch.Tensor]:
    seed_everything(seed)
    model = SineMLP(hidden_layers).to(DEVICE)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr_start)
    criterion = nn.MSELoss()
    xs, ys = build_mlp_dataset()
    predictions_by_epoch: dict[int, torch.Tensor] = {}
    loss_history: list[float] = []

    model.eval()
    with torch.no_grad():
        predictions_by_epoch[0] = model(xs).detach().cpu()

    for epoch in range(1, epochs + 1):
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
            full_predictions = model(xs)
            predictions_by_epoch[epoch] = full_predictions.detach().cpu()
            loss_history.append(float(criterion(full_predictions, ys).item()))
    return loss_history, predictions_by_epoch, xs.detach().cpu(), ys.detach().cpu()


def wrap_sequence(text: str, chunk: int = 20) -> str:
    return "<br>".join(text[index : index + chunk] for index in range(0, len(text), chunk))


def write_figure(
    figure: go.Figure,
    *,
    output_dir: Path,
    stem: str,
    write_html: bool,
) -> list[str]:
    ensure_dir(output_dir)
    png_path = output_dir / f"{stem}.png"
    log_progress(f"writing {png_path.name}")
    width = figure.layout.width or 1400
    height = figure.layout.height or 900
    figure.write_image(png_path, width=width, height=height, scale=2)
    written = [png_path.name]
    if write_html:
        html_path = output_dir / f"{stem}.html"
        log_progress(f"writing {html_path.name}")
        figure.write_html(html_path, include_plotlyjs="cdn", full_html=True)
        written.append(html_path.name)
    return written


def build_mlp_story_figure(
    *,
    xs: torch.Tensor,
    ys: torch.Tensor,
    predictions_by_epoch: dict[int, torch.Tensor],
    loss_history: list[float],
    hidden_layers: tuple[int, ...],
) -> tuple[go.Figure, list[int]]:
    selected_epochs = mlp_story_epochs(len(loss_history))
    figure = make_subplots(
        rows=2,
        cols=4,
        specs=[
            [{}, {}, {}, {}],
            [{"colspan": 4}, None, None, None],
        ],
        subplot_titles=[f"Epoch {epoch}" for epoch in selected_epochs] + [""],
        vertical_spacing=0.16,
    )
    x_values = xs.squeeze(1).tolist()
    target_values = ys.squeeze(1).tolist()
    for index, epoch in enumerate(selected_epochs, start=1):
        prediction_values = predictions_by_epoch[epoch].squeeze(1).tolist()
        figure.add_trace(
            go.Scatter(
                x=x_values,
                y=target_values,
                mode="lines",
                name="target" if index == 1 else None,
                line={"color": "#c26b2d", "width": 3},
                showlegend=index == 1,
            ),
            row=1,
            col=index,
        )
        figure.add_trace(
            go.Scatter(
                x=x_values,
                y=prediction_values,
                mode="lines",
                name="MLP" if index == 1 else None,
                line={"color": "#1f5f7a", "width": 2.5},
                showlegend=index == 1,
            ),
            row=1,
            col=index,
        )
        figure.update_xaxes(title_text="x", row=1, col=index)
        figure.update_yaxes(title_text="y", row=1, col=index)
    epochs = list(range(1, len(loss_history) + 1))
    figure.add_trace(
        go.Scatter(
            x=epochs,
            y=loss_history,
            mode="lines",
            name="loss",
            line={"color": "#62558c", "width": 3},
            showlegend=False,
        ),
        row=2,
        col=1,
    )
    marker_epochs = [epoch for epoch in selected_epochs if epoch > 0]
    marker_values = [loss_history[epoch - 1] for epoch in marker_epochs]
    figure.add_trace(
        go.Scatter(
            x=marker_epochs,
            y=marker_values,
            mode="markers+text",
            text=[str(epoch) for epoch in marker_epochs],
            textposition="top center",
            marker={"color": "#b45309", "size": 11, "line": {"color": "#ffffff", "width": 1.5}},
            name="selected epoch",
            showlegend=False,
        ),
        row=2,
        col=1,
    )
    figure.update_xaxes(title_text="epoch", row=2, col=1)
    figure.update_yaxes(title_text="MSE", row=2, col=1)
    figure.update_layout(
        title=f"Approximating sin(8πx) with a {format_mlp_shape(hidden_layers)} ReLU MLP",
        width=1600,
        height=900,
        margin={"t": 85, "l": 60, "r": 40, "b": 50},
        legend={"orientation": "h", "yanchor": "bottom", "y": 1.02, "x": 0.0},
        **FIGURE_STYLE,
    )
    return figure, selected_epochs


def build_dataset_figure(
    phases: list[TrainingPhase],
    evaluation_sets: dict[int, list[SequenceExample]],
) -> go.Figure:
    figure = make_subplots(
        rows=1,
        cols=2,
        subplot_titles=(
            "How the invalid training mix changes by phase",
            "Fixed evaluation lengths",
        ),
    )
    phase_labels = [phase.label.replace("Phase ", "P") for phase in phases]
    for kind, name in (
        (INVALID_KIND_RANDOM, "random invalid"),
        (INVALID_KIND_CORRUPTION, "off-by-one"),
        (INVALID_KIND_BALANCED, "balanced-invalid"),
    ):
        values = []
        for phase in phases:
            mapping = dict(zip(phase.invalid_kinds, phase.invalid_weights, strict=True))
            values.append(mapping.get(kind, 0.0))
        figure.add_trace(
            go.Bar(
                x=phase_labels,
                y=values,
                name=name,
                marker_color=INVALID_COLORS[kind],
            ),
            row=1,
            col=1,
        )
    figure.add_trace(
        go.Bar(
            x=[str(length) for length in EVAL_LENGTHS],
            y=[len(evaluation_sets[length]) for length in EVAL_LENGTHS],
            marker_color=[EVAL_COLORS[length] for length in EVAL_LENGTHS],
            showlegend=False,
        ),
        row=1,
        col=2,
    )
    figure.update_yaxes(title_text="relative share", row=1, col=1)
    figure.update_yaxes(title_text="examples", row=1, col=2)
    figure.update_xaxes(title_text="phase", row=1, col=1)
    figure.update_xaxes(title_text="sequence length", row=1, col=2)
    figure.update_layout(
        title="What changes across phases and what stays fixed",
        barmode="stack",
        width=1450,
        height=650,
        margin={"t": 80, "l": 60, "r": 30, "b": 50},
        legend={"orientation": "h", "yanchor": "bottom", "y": 1.02, "x": 0.0},
        **FIGURE_STYLE,
    )
    return figure


def add_phase_bands(figure: go.Figure, phase_spans: list[dict[str, object]], row: int) -> None:
    for span in phase_spans:
        start_epoch = int(span["start_epoch"])
        end_epoch = int(span["end_epoch"])
        phase_kind = str(span["name"]).split("-")[-1]
        if phase_kind == "one":
            phase_kind = PHASE_KIND_OFF_BY_ONE
        if phase_kind == "invalid":
            phase_kind = PHASE_KIND_BALANCED
        figure.add_vrect(
            x0=start_epoch - 0.5,
            x1=end_epoch + 0.5,
            fillcolor=PHASE_COLORS.get(phase_kind, "#eef2ff"),
            opacity=0.28,
            line_width=0,
            row=row,
            col=1,
        )
        figure.add_vline(
            x=end_epoch + 0.5,
            line={"color": "#8b5e3c", "dash": "dash", "width": 2},
            row=row,
            col=1,
        )
        figure.add_annotation(
            x=(start_epoch + end_epoch) / 2,
            y=0.02 if row == 1 else 0.95,
            xref=f"x{'' if row == 1 else 2}",
            yref=f"y{'' if row == 1 else 2} domain",
            text=str(span["label"]).replace("Phase ", "P"),
            showarrow=False,
            font={"size": 11, "color": "#6b7280"},
            bgcolor="rgba(255,255,255,0.85)",
            bordercolor="#d1d5db",
            borderwidth=1,
        )


def build_rnn_story_figure(result: RNNExperimentResult) -> go.Figure:
    figure = make_subplots(
        rows=2,
        cols=1,
        shared_xaxes=True,
        vertical_spacing=0.14,
        subplot_titles=("Accuracy by epoch", "Probe responses across training"),
    )
    epochs = [metric.epoch for metric in result.metrics]
    figure.add_trace(
        go.Scatter(
            x=epochs,
            y=[metric.train_acc for metric in result.metrics],
            mode="lines",
            name="train",
            line={"color": "#111111", "width": 3},
        ),
        row=1,
        col=1,
    )
    for length in EVAL_LENGTHS:
        figure.add_trace(
            go.Scatter(
                x=epochs,
                y=[getattr(metric, f"eval_{length}_acc") for metric in result.metrics],
                mode="lines",
                name=f"eval {length}",
                line={"color": EVAL_COLORS[length], "width": 2.5},
            ),
            row=1,
            col=1,
        )

    add_phase_bands(figure, result.phase_spans, row=1)
    add_phase_bands(figure, result.phase_spans, row=2)

    for probe_index, probe in enumerate(RESPONSE_PROBES):
        values = [responses[probe_index] for responses in result.response_history]
        final_predicted = values[-1] >= 0.5
        actual_valid = is_balanced_parentheses(probe.text)
        status = probe_status_label(actual_valid, final_predicted)
        line_color = probe_class_color(probe.probe_kind)
        dash = probe_length_dash(probe.length)
        figure.add_trace(
            go.Scatter(
                x=epochs,
                y=values,
                mode="lines",
                name=probe.short_label,
                showlegend=False,
                line={"color": line_color, "width": 2.4 if probe.highlight else 1.9, "dash": dash},
                opacity=0.92 if probe.highlight else 0.78,
                hovertemplate=(
                    f"{probe.short_label} · {probe.label}<br>"
                    f"type={probe.probe_kind}<br>"
                    f"length={probe.length}<br>"
                    f"text={probe.text}<br>"
                    "epoch=%{x}<br>p(valid)=%{y:.3f}<extra></extra>"
                ),
            ),
            row=2,
            col=1,
        )
        figure.add_trace(
            go.Scatter(
                x=[epochs[-1]],
                y=[values[-1]],
                mode="markers+text" if probe.highlight else "markers",
                text=[probe.short_label] if probe.highlight else None,
                textposition=probe_end_label_position(probe_index),
                textfont={"size": 10, "color": line_color},
                name=status,
                showlegend=False,
                marker={
                    "color": line_color,
                    "size": 10 if probe.highlight else 8,
                    "symbol": probe_end_symbol(status),
                    "line": {"color": "#111111", "width": 1.3},
                },
                hovertemplate=(
                    f"{probe.short_label} final<br>"
                    f"status={status}<br>"
                    "epoch=%{x}<br>p(valid)=%{y:.3f}<extra></extra>"
                ),
            ),
            row=2,
            col=1,
        )
    figure.update_xaxes(title_text="epoch", row=2, col=1)
    figure.update_yaxes(title_text="accuracy", range=[0, 1.02], row=1, col=1)
    figure.update_yaxes(title_text="p(valid)", range=[0, 1.02], row=2, col=1)
    figure.update_layout(
        title=result.model_title + ": training phases and probe splitting",
        width=1500,
        height=950,
        margin={"t": 85, "l": 60, "r": 120, "b": 60},
        legend={"orientation": "h", "yanchor": "bottom", "y": 1.02, "x": 0.0},
        **FIGURE_STYLE,
    )
    figure.add_annotation(
        x=0.995,
        y=0.41,
        xref="paper",
        yref="paper",
        text="Probe panel: color = problem class, dash = length, label = cohort/class id, end marker = final correctness",
        showarrow=False,
        xanchor="right",
        font={"size": 11, "color": "#4b5563"},
        bgcolor="rgba(255,255,255,0.85)",
        bordercolor="#d1d5db",
        borderwidth=1,
    )
    return figure


def build_trace_figure(
    payload: TraceGridPayload,
    *,
    pair_indices: tuple[int, int],
    pair_label: str,
) -> go.Figure:
    cols = len(payload.probe_labels)
    rows = len(payload.phase_labels)
    subplot_titles = [
        f"{label}<br>{'valid' if is_balanced_parentheses(text) else 'invalid'}<br><span style='font-size:10px'>{wrap_sequence(text)}</span>"
        for label, text in zip(payload.probe_labels, payload.probe_texts, strict=True)
    ]
    figure = make_subplots(
        rows=rows,
        cols=cols,
        subplot_titles=subplot_titles,
        vertical_spacing=0.12,
        horizontal_spacing=0.04,
    )

    x_index, y_index = pair_indices
    all_x = [point[x_index] for cell in payload.cells for point in cell.points]
    all_y = [point[y_index] for cell in payload.cells for point in cell.points]
    x_pad = 0.08 * max(1e-6, max(all_x) - min(all_x))
    y_pad = 0.08 * max(1e-6, max(all_y) - min(all_y))
    x_range = [min(all_x) - x_pad, max(all_x) + x_pad]
    y_range = [min(all_y) - y_pad, max(all_y) + y_pad]

    cell_lookup = {(cell.phase_label, cell.probe_label): cell for cell in payload.cells}
    legend_seen: set[str] = set()
    for row_index, phase_label in enumerate(payload.phase_labels, start=1):
        for col_index, probe_label in enumerate(payload.probe_labels, start=1):
            cell = cell_lookup[(phase_label, probe_label)]
            status = probe_status_label(cell.is_valid, cell.predicted_valid)
            style = PROBE_STATUS_STYLES[status]
            showlegend = status not in legend_seen
            legend_seen.add(status)
            xs = [point[x_index] for point in cell.points]
            ys = [point[y_index] for point in cell.points]
            figure.add_trace(
                go.Scatter(
                    x=xs,
                    y=ys,
                    mode="lines",
                    line={"color": style["color"], "width": 2.4},
                    name=status,
                    showlegend=showlegend,
                    hovertemplate=(
                        f"{cell.probe_label}<br>"
                        f"{cell.text}<br>"
                        f"phase={cell.phase_label}<br>"
                        f"h{x_index + 1}=%{{x:.3f}}<br>h{y_index + 1}=%{{y:.3f}}<extra></extra>"
                    ),
                ),
                row=row_index,
                col=col_index,
            )
            figure.add_trace(
                go.Scatter(
                    x=[xs[0]],
                    y=[ys[0]],
                    mode="markers",
                    marker={"color": "#111111", "size": 7, "symbol": "circle"},
                    name="start" if row_index == 1 and col_index == 1 else None,
                    showlegend=row_index == 1 and col_index == 1,
                    hovertemplate="start<extra></extra>",
                ),
                row=row_index,
                col=col_index,
            )
            figure.add_trace(
                go.Scatter(
                    x=[xs[-1]],
                    y=[ys[-1]],
                    mode="markers",
                    marker={"color": "#111111", "size": 11, "symbol": "star"},
                    name="end" if row_index == 1 and col_index == 1 else None,
                    showlegend=row_index == 1 and col_index == 1,
                    hovertemplate="end<extra></extra>",
                ),
                row=row_index,
                col=col_index,
            )
            figure.update_xaxes(range=x_range, title_text=f"h{x_index + 1}", row=row_index, col=col_index)
            figure.update_yaxes(range=y_range, title_text=f"h{y_index + 1}", row=row_index, col=col_index)
        figure.add_annotation(
            x=-0.07,
            y=1 - (row_index - 0.5) / rows,
            xref="paper",
            yref="paper",
            text=phase_label,
            showarrow=False,
            textangle=-90,
            font={"size": 12, "color": "#4b5563"},
        )

    figure.update_layout(
        title=f"Hidden-state traces in direct coordinates ({pair_label})",
        width=max(1800, 360 * cols),
        height=1050,
        margin={"t": 110, "l": 85, "r": 30, "b": 50},
        legend={"orientation": "h", "yanchor": "bottom", "y": 1.02, "x": 0.0},
        **FIGURE_STYLE,
    )
    return figure


def render_mlp_assets(
    *,
    output_dir: Path,
    write_html: bool,
    seed: int,
    mlp_epochs: int,
    mlp_batch_size: int,
    mlp_shape: tuple[int, ...],
) -> dict[str, object]:
    log_progress(
        f"training MLP {format_mlp_shape(mlp_shape)} for {mlp_epochs} epochs "
        f"(batch={mlp_batch_size}, Adam lr=0.01)"
    )
    loss_history, predictions_by_epoch, xs, ys = train_mlp(
        epochs=mlp_epochs,
        batch_size=mlp_batch_size,
        lr_start=0.01,
        lr_end=0.01,
        seed=seed,
        hidden_layers=mlp_shape,
    )
    figure, selected_epochs = build_mlp_story_figure(
        xs=xs,
        ys=ys,
        predictions_by_epoch=predictions_by_epoch,
        loss_history=loss_history,
        hidden_layers=mlp_shape,
    )
    files = write_figure(
        figure,
        output_dir=output_dir,
        stem="mlp-sine-story",
        write_html=write_html,
    )
    return {
        "files": files,
        "shape": list(mlp_shape),
        "selected_epochs": selected_epochs,
        "final_loss": loss_history[-1],
    }


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
    log_progress(
        "training simplified RNN "
        f"(phases=3, phase_epochs={phase_epochs}, samples={train_samples}, "
        f"test_samples={test_samples}, batch={DEFAULT_BATCH_SIZE}, lr={lr_start:.3f}->{lr_end:.3f})"
    )
    result, checkpoints = run_rnn_experiment(
        seed=seed,
        phase_epochs=phase_epochs,
        train_samples=train_samples,
        test_samples=test_samples,
        lr_start=lr_start,
        lr_end=lr_end,
    )
    trace_payload = build_trace_grid_payload(
        model_builder=lambda: TinyTraceRNN(hidden_size=4, num_layers=1),
        checkpoints=checkpoints,
        phase_spans=result.phase_spans,
        trace_probes=TRACE_PROBES,
    )
    result.trace_payload = trace_payload

    shared_files: list[str] = []
    phases = build_training_phases(
        phase_epochs=phase_epochs,
        train_samples=train_samples,
        lr_start=lr_start,
        lr_end=lr_end,
    )
    story_figure = build_rnn_story_figure(result)
    story_files = write_figure(
        story_figure,
        output_dir=output_dir,
        stem="rnn-training-story",
        write_html=write_html,
    )
    shared_files.extend(story_files)
    if write_trace_images:
        shared_files.extend(
            write_figure(
                build_trace_figure(trace_payload, pair_indices=(0, 1), pair_label="h1, h2"),
                output_dir=output_dir,
                stem="rnn-phase-traces-pair-a",
                write_html=write_html,
            )
        )
        shared_files.extend(
            write_figure(
                build_trace_figure(trace_payload, pair_indices=(2, 3), pair_label="h3, h4"),
                output_dir=output_dir,
                stem="rnn-phase-traces-pair-b",
                write_html=write_html,
            )
        )
    result.files = shared_files
    final_metrics = result.metrics[-1]
    log_progress(
        f"{result.model_title}: final train={final_metrics.train_acc:.3f}, "
        f"eval10={final_metrics.eval_10_acc:.3f}, eval20={final_metrics.eval_20_acc:.3f}, "
        f"eval30={final_metrics.eval_30_acc:.3f}"
    )
    return {
        "files": shared_files,
        "train_length": TRAIN_LENGTH,
        "eval_lengths": list(EVAL_LENGTHS),
        "batch_size": DEFAULT_BATCH_SIZE,
        "phase_epochs": phase_epochs,
        "train_samples": train_samples,
        "test_samples": test_samples,
        "phase_invalid_mix": [
            {
                "label": phase.label,
                "invalid_kinds": list(phase.invalid_kinds),
                "invalid_weights": list(phase.invalid_weights),
            }
            for phase in phases
        ],
        "phases": result.phase_spans,
        "probes": [asdict(probe) for probe in RESPONSE_PROBES],
        "trace_strings": [asdict(probe) for probe in TRACE_PROBES],
        "trace_phase_epochs": trace_payload.phase_epochs,
        "final_metrics": asdict(final_metrics),
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
    mlp_shape: str = typer.Option(
        "8",
        help="Comma-separated hidden-layer widths for the MLP, e.g. 32 or 32,32.",
    ),
    rnn_phase_epochs: int = typer.Option(
        DEFAULT_PHASE_EPOCHS,
        help="Epochs to run for each of the three RNN phases.",
    ),
    rnn_train_samples: int = typer.Option(
        DEFAULT_TRAIN_SAMPLES,
        help="Training examples sampled for each RNN epoch.",
    ),
    rnn_test_samples: int = typer.Option(
        DEFAULT_TEST_SAMPLES,
        help="Examples in each fixed RNN evaluation set.",
    ),
    html: bool = typer.Option(
        True,
        "--html/--no-html",
        help="Whether to emit Plotly HTML companions alongside PNGs.",
    ),
    trace_images: bool = typer.Option(
        True,
        "--trace-images/--no-trace-images",
        help="Whether to emit the PCA trace figure PNG and HTML files.",
    ),
    clean: bool = typer.Option(
        True,
        "--clean/--no-clean",
        help="Whether to clear the output directory before generating fresh artifacts.",
    ),
) -> None:
    if clean:
        log_progress(f"cleaning output directory {output_dir}")
        clean_output_dir(output_dir)
    ensure_dir(output_dir)
    log_progress(f"starting generation for target={target} in {output_dir}")

    parsed_mlp_shape = parse_mlp_shape(mlp_shape)
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
            mlp_shape=parsed_mlp_shape,
        )
    if target in {"all", "rnn"}:
        manifest["rnn"] = render_rnn_assets(
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
    typer.echo(f"Generated assets for {target} at {output_dir}")
    typer.echo(f"Wrote manifest to {manifest_path}")


def main() -> None:
    app()


if __name__ == "__main__":
    main()
