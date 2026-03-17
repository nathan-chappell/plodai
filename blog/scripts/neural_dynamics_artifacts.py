from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
import json
import math
import random
import shutil
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
TRAIN_COHORTS: tuple[int, ...] = (20, 50, 100)
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
DEFAULT_BLOCK_EPOCHS = 10
DEFAULT_BATCH_SIZE = 16
VERY_LONG_LENGTHS: tuple[int, ...] = (200, 260)
VERY_LONG_LENGTH_MIN = VERY_LONG_LENGTHS[0]
DEFAULT_MAX_LENGTH = VERY_LONG_LENGTHS[-1]
FIGURE_STYLE = {
    "paper_bgcolor": "#f7f8fb",
    "plot_bgcolor": "#ffffff",
    "font": {"family": "Aptos, Segoe UI, Helvetica, Arial, sans-serif", "color": "#1f2937", "size": 14},
}
COLOR_TRAIN = "#5c4d7d"
COLOR_BALANCED = "#1d3557"
FAMILY_PALETTES = {
    "cohort-20": ("#7f1d1d", "#b91c1c", "#ef4444"),
    "cohort-50": ("#1d4ed8", "#2563eb", "#60a5fa"),
    "cohort-100": ("#166534", "#16a34a", "#86efac"),
    "very-long": ("#7c5c2d", "#a16207", "#d6a856"),
}
TRACE_COLORS = ("#7f1d1d", "#1d4ed8", "#166534", "#7c5c2d", "#9333ea", "#db2777")
TRACE_SYMBOLS = {
    "valid": "circle",
    PHASE_KIND_OFF_BY_ONE: "diamond",
    PHASE_KIND_BALANCED: "square",
    "transition": "x",
}


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
class CohortBlock:
    name: str
    label: str
    cohort_length: int
    phase_kind: str
    active_lengths: tuple[int, ...]
    epochs: int
    train_samples: int
    learning_rate: float


@dataclass(frozen=True)
class EvaluationFamily:
    key: str
    label: str
    lengths: tuple[int, ...]
    color: str


@dataclass(frozen=True)
class ProbeSpec:
    label: str
    text: str
    family: str
    probe_kind: str
    color: str


@dataclass
class MetricRow:
    epoch: int
    phase: str
    train_loss: float
    train_acc: float
    overall_eval_acc: float
    cohort_20_acc: float
    cohort_50_acc: float
    cohort_100_acc: float
    very_long_acc: float
    balanced_invalid_acc: float
    probe_change: float = 0.0
    aha_score: float = 0.0


@dataclass
class RNNExperimentResult:
    model_key: str
    model_title: str
    num_layers: int
    phase_spans: list[dict[str, object]]
    peak_aha_epoch: int
    selected_epochs: list[int]
    metrics: list[MetricRow]
    response_history: list[list[float]]
    representative_train_examples: list[SequenceExample]
    evaluation_sets: dict[str, list[SequenceExample]]
    balanced_invalid_examples: list[SequenceExample]
    trace_payloads: dict[int, list[dict[str, object]]]
    files: list[str]


EVALUATION_FAMILIES: tuple[EvaluationFamily, ...] = (
    EvaluationFamily("cohort-20", "20 / 25 / 30", (20, 25, 30), FAMILY_PALETTES["cohort-20"][1]),
    EvaluationFamily("cohort-50", "50 / 60 / 75", (50, 60, 75), FAMILY_PALETTES["cohort-50"][1]),
    EvaluationFamily("cohort-100", "100 / 120 / 150", (100, 120, 150), FAMILY_PALETTES["cohort-100"][1]),
    EvaluationFamily("very-long", "200 / 260", VERY_LONG_LENGTHS, FAMILY_PALETTES["very-long"][1]),
)


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


def phase_invalid_kinds(phase_kind: str) -> tuple[str, ...]:
    if phase_kind == PHASE_KIND_RANDOM:
        return (INVALID_KIND_RANDOM,)
    if phase_kind == PHASE_KIND_OFF_BY_ONE:
        return (INVALID_KIND_RANDOM, INVALID_KIND_CORRUPTION)
    if phase_kind == PHASE_KIND_BALANCED:
        return (INVALID_KIND_RANDOM, INVALID_KIND_CORRUPTION, INVALID_KIND_BALANCED)
    raise ValueError(f"Unknown phase kind: {phase_kind}")


def sample_exact_length_examples(
    *,
    total_examples: int,
    length: int,
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
    invalid_allocations = allocate_counts(invalid_count, len(invalid_kinds))
    for kind, kind_count in zip(invalid_kinds, invalid_allocations, strict=True):
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


def sample_block_examples(
    *,
    total_examples: int,
    active_lengths: tuple[int, ...],
    phase_kind: str,
    seed: int,
) -> list[SequenceExample]:
    length_allocations = allocate_counts(total_examples, len(active_lengths))
    all_examples: list[SequenceExample] = []
    invalid_kinds = phase_invalid_kinds(phase_kind)
    for index, (length, length_count) in enumerate(zip(active_lengths, length_allocations, strict=True)):
        all_examples.extend(
            sample_exact_length_examples(
                total_examples=length_count,
                length=length,
                invalid_kinds=invalid_kinds,
                seed=seed + index * 137,
                family=f"train-{length}",
            )
        )
    random.Random(seed + 999).shuffle(all_examples)
    return all_examples


def build_training_blocks(
    *,
    block_epochs: int,
    train_samples: int,
) -> list[CohortBlock]:
    blocks: list[CohortBlock] = []
    learning_rates = {
        PHASE_KIND_RANDOM: 0.03,
        PHASE_KIND_OFF_BY_ONE: 0.025,
        PHASE_KIND_BALANCED: 0.02,
    }
    for cohort_index, cohort_length in enumerate(TRAIN_COHORTS):
        active_lengths = TRAIN_COHORTS[: cohort_index + 1]
        for phase_kind in PHASE_KIND_ORDER:
            blocks.append(
                CohortBlock(
                    name=f"cohort-{cohort_length}-{phase_kind}",
                    label=f"{cohort_length}/{phase_kind.replace('_', '-')}",
                    cohort_length=cohort_length,
                    phase_kind=phase_kind,
                    active_lengths=active_lengths,
                    epochs=block_epochs,
                    train_samples=train_samples,
                    learning_rate=learning_rates[phase_kind],
                )
            )
    return blocks


def build_evaluation_sets(
    *,
    test_samples: int,
    seed: int,
) -> tuple[dict[str, list[SequenceExample]], list[SequenceExample]]:
    evaluation_sets: dict[str, list[SequenceExample]] = {}
    final_invalid_kinds = phase_invalid_kinds(PHASE_KIND_BALANCED)
    for family_index, family in enumerate(EVALUATION_FAMILIES):
        examples: list[SequenceExample] = []
        for length_index, (length, count) in enumerate(
            zip(family.lengths, allocate_counts(test_samples, len(family.lengths)), strict=True)
        ):
            examples.extend(
                sample_exact_length_examples(
                    total_examples=count,
                    length=length,
                    invalid_kinds=final_invalid_kinds,
                    seed=seed + family_index * 1_000 + length_index * 97,
                    family=family.key,
                )
            )
        evaluation_sets[family.key] = examples

    balanced_lengths = tuple(
        length
        for family in EVALUATION_FAMILIES
        for length in family.lengths
        if length % 2 == 0
    )
    balanced_examples: list[SequenceExample] = []
    for index, (length, count) in enumerate(
        zip(balanced_lengths, allocate_counts(test_samples, len(balanced_lengths)), strict=True)
    ):
        rng = random.Random(seed + 50_000 + index * 193)
        for _ in range(count):
            balanced_examples.append(
                SequenceExample(
                    text=sample_invalid_sequence(rng, length, kind=INVALID_KIND_BALANCED).text,
                    label=0,
                    kind=INVALID_KIND_BALANCED,
                    family="balanced-invalid",
                )
            )
    return evaluation_sets, balanced_examples


def deterministic_valid(length: int, seed: int) -> str:
    return sample_valid_sequence_of_length(random.Random(seed), length)


def deterministic_invalid(length: int, kind: str, seed: int) -> str:
    return sample_invalid_sequence(random.Random(seed), length, kind=kind).text


def build_response_probes() -> tuple[ProbeSpec, ...]:
    return (
        ProbeSpec("20 valid", deterministic_valid(20, 1_020), "cohort-20", "valid", FAMILY_PALETTES["cohort-20"][0]),
        ProbeSpec("30 off-by-one", deterministic_invalid(30, INVALID_KIND_CORRUPTION, 1_030), "cohort-20", PHASE_KIND_OFF_BY_ONE, FAMILY_PALETTES["cohort-20"][1]),
        ProbeSpec("20 balanced-invalid", deterministic_invalid(20, INVALID_KIND_BALANCED, 1_040), "cohort-20", PHASE_KIND_BALANCED, FAMILY_PALETTES["cohort-20"][2]),
        ProbeSpec("40 transition", ")" + deterministic_valid(38, 1_050) + ")", "cohort-20", "transition", FAMILY_PALETTES["cohort-20"][2]),
        ProbeSpec("50 valid", deterministic_valid(50, 2_050), "cohort-50", "valid", FAMILY_PALETTES["cohort-50"][0]),
        ProbeSpec("60 off-by-one", deterministic_invalid(60, INVALID_KIND_CORRUPTION, 2_060), "cohort-50", PHASE_KIND_OFF_BY_ONE, FAMILY_PALETTES["cohort-50"][1]),
        ProbeSpec("50 balanced-invalid", deterministic_invalid(50, INVALID_KIND_BALANCED, 2_070), "cohort-50", PHASE_KIND_BALANCED, FAMILY_PALETTES["cohort-50"][2]),
        ProbeSpec("100 valid", deterministic_valid(100, 3_100), "cohort-100", "valid", FAMILY_PALETTES["cohort-100"][0]),
        ProbeSpec("120 off-by-one", deterministic_invalid(120, INVALID_KIND_CORRUPTION, 3_120), "cohort-100", PHASE_KIND_OFF_BY_ONE, FAMILY_PALETTES["cohort-100"][1]),
        ProbeSpec("100 balanced-invalid", deterministic_invalid(100, INVALID_KIND_BALANCED, 3_140), "cohort-100", PHASE_KIND_BALANCED, FAMILY_PALETTES["cohort-100"][2]),
        ProbeSpec("200 valid", deterministic_valid(200, 4_200), "very-long", "valid", FAMILY_PALETTES["very-long"][0]),
        ProbeSpec("200 balanced-invalid", deterministic_invalid(200, INVALID_KIND_BALANCED, 4_240), "very-long", PHASE_KIND_BALANCED, FAMILY_PALETTES["very-long"][2]),
    )


def build_trace_probes() -> tuple[ProbeSpec, ...]:
    valid_40 = deterministic_valid(40, 9_001)
    valid_18_a = deterministic_valid(18, 9_018)
    valid_18_b = deterministic_valid(18, 9_028)
    valid_10 = deterministic_valid(10, 9_010)
    return (
        ProbeSpec("A valid tail", valid_40, "cohort-50", "valid", TRACE_COLORS[0]),
        ProbeSpec("B immediate invalid", ")" + deterministic_valid(38, 9_101) + "(", "cohort-50", "transition", TRACE_COLORS[1]),
        ProbeSpec("C valid+valid+bad", valid_18_a + valid_18_b + "())(", "cohort-50", "transition", TRACE_COLORS[2]),
        ProbeSpec("D balanced-invalid", deterministic_invalid(40, INVALID_KIND_BALANCED, 9_301), "cohort-50", PHASE_KIND_BALANCED, TRACE_COLORS[3]),
        ProbeSpec("E oscillating prefix", valid_10 + ")" + valid_10 + "(" + deterministic_valid(18, 9_401), "cohort-50", "transition", TRACE_COLORS[4]),
        ProbeSpec("F off-by-one long", deterministic_invalid(40, INVALID_KIND_CORRUPTION, 9_501), "cohort-50", PHASE_KIND_OFF_BY_ONE, TRACE_COLORS[5]),
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


def set_optimizer_lr(optimizer: torch.optim.Optimizer, lr: float) -> None:
    for group in optimizer.param_groups:
        group["lr"] = lr


def build_metric_row(
    *,
    epoch: int,
    phase: str,
    train_examples: list[SequenceExample],
    evaluation_sets: dict[str, list[SequenceExample]],
    balanced_invalid_examples: list[SequenceExample],
    model: TinyTraceRNN,
    criterion: nn.Module,
) -> MetricRow:
    train_loss, train_acc = evaluate_rnn(model, train_examples, criterion)
    overall_examples = [
        example
        for family_examples in evaluation_sets.values()
        for example in family_examples
    ]
    overall_eval_acc = evaluate_rnn(model, overall_examples, criterion)[1]
    cohort_20_acc = evaluate_rnn(model, evaluation_sets["cohort-20"], criterion)[1]
    cohort_50_acc = evaluate_rnn(model, evaluation_sets["cohort-50"], criterion)[1]
    cohort_100_acc = evaluate_rnn(model, evaluation_sets["cohort-100"], criterion)[1]
    very_long_acc = evaluate_rnn(model, evaluation_sets["very-long"], criterion)[1]
    balanced_invalid_acc = evaluate_rnn(model, balanced_invalid_examples, criterion)[1]
    return MetricRow(
        epoch=epoch,
        phase=phase,
        train_loss=train_loss,
        train_acc=train_acc,
        overall_eval_acc=overall_eval_acc,
        cohort_20_acc=cohort_20_acc,
        cohort_50_acc=cohort_50_acc,
        cohort_100_acc=cohort_100_acc,
        very_long_acc=very_long_acc,
        balanced_invalid_acc=balanced_invalid_acc,
    )


def clone_model_state(model: nn.Module) -> dict[str, torch.Tensor]:
    return {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}


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
            for current, previous in zip(current_responses, previous_responses, strict=True)
        )
        balanced_jump = max(0.0, metric.balanced_invalid_acc - previous_metric.balanced_invalid_acc)
        long_jump = max(0.0, metric.very_long_acc - previous_metric.very_long_acc)
        cohort_jump = max(0.0, metric.cohort_100_acc - previous_metric.cohort_100_acc)
        metric.aha_score = metric.probe_change + balanced_jump + 0.5 * (long_jump + cohort_jump)


def select_trace_epochs(
    metrics: list[MetricRow],
    *,
    phase_boundary_epochs: tuple[int, ...] = (),
    top_k: int = 3,
) -> list[int]:
    final_epoch = metrics[-1].epoch
    candidates = [
        metric.epoch
        for metric in sorted(metrics[1:-1], key=lambda metric: metric.aha_score, reverse=True)[:top_k]
    ]
    ordered = [0, *phase_boundary_epochs, *candidates, final_epoch]
    selected: list[int] = []
    for epoch in ordered:
        if epoch not in selected:
            selected.append(epoch)
    return sorted(selected)


def peak_aha_epoch(metrics: list[MetricRow]) -> int:
    if len(metrics) <= 2:
        return metrics[-1].epoch
    return max(metrics[1:-1], key=lambda metric: metric.aha_score).epoch


def collect_trace_payloads(
    *,
    model_builder: Callable[[], TinyTraceRNN],
    checkpoints: dict[int, dict[str, torch.Tensor]],
    selected_epochs: list[int],
    trace_probes: tuple[ProbeSpec, ...],
) -> dict[int, list[dict[str, object]]]:
    payloads: dict[int, list[dict[str, object]]] = {}
    sequences = [probe.text for probe in trace_probes]
    for epoch in selected_epochs:
        model = model_builder().to(DEVICE)
        load_model_state(model, checkpoints[epoch])
        tokens, lengths = encode_sequences(sequences)
        logits, traces = model(tokens, lengths, capture_traces=True)
        predictions = (logits.sigmoid() >= 0.5).detach().cpu().tolist()
        assert traces is not None
        epoch_payloads: list[dict[str, object]] = []
        for probe_index, probe in enumerate(trace_probes):
            layer_payloads: list[dict[str, object]] = []
            for layer_index, layer_trace in enumerate(traces):
                steps = len(probe.text)
                points = layer_trace[probe_index, :steps, :].tolist()
                layer_payloads.append({"layer": layer_index + 1, "points": points})
            epoch_payloads.append(
                {
                    "label": probe.label,
                    "text": probe.text,
                    "family": probe.family,
                    "probe_kind": probe.probe_kind,
                    "color": probe.color,
                    "is_valid": is_balanced_parentheses(probe.text),
                    "predicted_valid": bool(predictions[probe_index]),
                    "correct": bool(predictions[probe_index]) == is_balanced_parentheses(probe.text),
                    "layers": layer_payloads,
                }
            )
        payloads[epoch] = epoch_payloads
    return payloads


def build_rnn_result_snapshot(
    *,
    model_key: str,
    model_title: str,
    num_layers: int,
    phase_spans: list[dict[str, object]],
    metrics: list[MetricRow],
    response_history: list[list[float]],
    representative_train_examples: list[SequenceExample],
    evaluation_sets: dict[str, list[SequenceExample]],
    balanced_invalid_examples: list[SequenceExample],
    trace_payloads: dict[int, list[dict[str, object]]] | None = None,
) -> RNNExperimentResult:
    score_aha_moments(metrics, response_history)
    peak_epoch = peak_aha_epoch(metrics)
    selected_epochs = select_trace_epochs(
        metrics,
        phase_boundary_epochs=tuple(int(span["end_epoch"]) for span in phase_spans[:-1]),
    )
    return RNNExperimentResult(
        model_key=model_key,
        model_title=model_title,
        num_layers=num_layers,
        phase_spans=phase_spans,
        peak_aha_epoch=peak_epoch,
        selected_epochs=selected_epochs,
        metrics=metrics,
        response_history=response_history,
        representative_train_examples=representative_train_examples,
        evaluation_sets=evaluation_sets,
        balanced_invalid_examples=balanced_invalid_examples,
        trace_payloads=trace_payloads or {},
        files=[],
    )


def build_model_title(num_layers: int) -> str:
    return "4-unit RNN (1 layer)" if num_layers == 1 else "4-unit RNN (2 layers)"


def run_rnn_experiment(
    *,
    num_layers: int,
    seed: int,
    block_epochs: int,
    train_samples: int,
    test_samples: int,
) -> RNNExperimentResult:
    seed_everything(seed)
    model_builder = lambda: TinyTraceRNN(num_layers=num_layers)
    model = model_builder().to(DEVICE)
    model_title = build_model_title(num_layers)
    optimizer = torch.optim.SGD(model.parameters(), lr=0.03, momentum=0.9)
    criterion = nn.BCEWithLogitsLoss()
    blocks = build_training_blocks(block_epochs=block_epochs, train_samples=train_samples)
    evaluation_sets, balanced_invalid_examples = build_evaluation_sets(
        test_samples=test_samples,
        seed=seed + 7_000,
    )
    response_sequences = [probe.text for probe in RESPONSE_PROBES]
    metrics: list[MetricRow] = []
    response_history: list[list[float]] = []
    checkpoints: dict[int, dict[str, torch.Tensor]] = {}
    representative_train_examples: list[SequenceExample] = []
    rng = random.Random(seed)
    initial_examples = sample_block_examples(
        total_examples=train_samples,
        active_lengths=(TRAIN_COHORTS[0],),
        phase_kind=PHASE_KIND_RANDOM,
        seed=seed + 111,
    )
    metrics.append(
        build_metric_row(
            epoch=0,
            phase="initial",
            train_examples=initial_examples,
            evaluation_sets=evaluation_sets,
            balanced_invalid_examples=balanced_invalid_examples,
            model=model,
            criterion=criterion,
        )
    )
    response_history.append(evaluate_probabilities(model, response_sequences))
    checkpoints[0] = clone_model_state(model)

    phase_spans: list[dict[str, object]] = []
    global_epoch = 0
    for block_index, block in enumerate(blocks):
        log_progress(
            f"{model_title}: starting {block.label} for {block.epochs} epochs "
            f"(lengths={list(block.active_lengths)}, batch={DEFAULT_BATCH_SIZE}, "
            f"samples={block.train_samples}, lr={block.learning_rate:.3f})"
        )
        set_optimizer_lr(optimizer, block.learning_rate)
        start_epoch = global_epoch + 1
        for local_epoch in range(1, block.epochs + 1):
            global_epoch += 1
            phase_examples = sample_block_examples(
                total_examples=block.train_samples,
                active_lengths=block.active_lengths,
                phase_kind=block.phase_kind,
                seed=seed + block_index * 10_000 + local_epoch * 307,
            )
            train_rnn_epoch(
                model,
                phase_examples,
                optimizer,
                criterion,
                batch_size=DEFAULT_BATCH_SIZE,
                rng=rng,
            )
            representative_train_examples = phase_examples
            metrics.append(
                build_metric_row(
                    epoch=global_epoch,
                    phase=block.name,
                    train_examples=phase_examples,
                    evaluation_sets=evaluation_sets,
                    balanced_invalid_examples=balanced_invalid_examples,
                    model=model,
                    criterion=criterion,
                )
            )
            response_history.append(evaluate_probabilities(model, response_sequences))
            checkpoints[global_epoch] = clone_model_state(model)
        phase_spans.append(
            {
                "name": block.name,
                "label": block.label,
                "start_epoch": start_epoch,
                "end_epoch": global_epoch,
                "batch_size": DEFAULT_BATCH_SIZE,
                "train_samples": block.train_samples,
                "learning_rate": block.learning_rate,
                "cohort_length": block.cohort_length,
                "phase_kind": block.phase_kind,
                "active_lengths": list(block.active_lengths),
            }
        )
        log_progress(f"{model_title}: finished {block.label} at epoch {global_epoch}")
    final_snapshot = build_rnn_result_snapshot(
        model_key="rnn-1layer" if num_layers == 1 else "rnn-2layer",
        model_title=model_title,
        num_layers=num_layers,
        phase_spans=phase_spans,
        metrics=metrics,
        response_history=response_history,
        representative_train_examples=representative_train_examples,
        evaluation_sets=evaluation_sets,
        balanced_invalid_examples=balanced_invalid_examples,
    )
    trace_payloads = collect_trace_payloads(
        model_builder=model_builder,
        checkpoints=checkpoints,
        selected_epochs=final_snapshot.selected_epochs,
        trace_probes=TRACE_PROBES,
    )
    return build_rnn_result_snapshot(
        model_key=final_snapshot.model_key,
        model_title=final_snapshot.model_title,
        num_layers=final_snapshot.num_layers,
        phase_spans=final_snapshot.phase_spans,
        metrics=final_snapshot.metrics,
        response_history=final_snapshot.response_history,
        representative_train_examples=final_snapshot.representative_train_examples,
        evaluation_sets=final_snapshot.evaluation_sets,
        balanced_invalid_examples=final_snapshot.balanced_invalid_examples,
        trace_payloads=trace_payloads,
    )


def mlp_snapshot_epochs(total_epochs: int) -> list[int]:
    if total_epochs <= 0:
        return [0]
    fractions = (0.0, 0.03, 0.08, 0.18, 0.4, 1.0)
    selected: list[int] = []
    for fraction in fractions:
        epoch = int(round(total_epochs * fraction))
        if epoch not in selected:
            selected.append(epoch)
    if selected[-1] != total_epochs:
        selected.append(total_epochs)
    return selected


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
    optimizer = torch.optim.SGD(model.parameters(), lr=lr_start, momentum=0.9)
    criterion = nn.MSELoss()
    xs, ys = build_mlp_dataset()
    snapshot_epochs = mlp_snapshot_epochs(epochs)
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
    hidden_layers: tuple[int, ...],
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
                line={"color": "#c26b2d", "width": 3},
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
                line={"color": "#1f5f7a", "width": 2.5},
                showlegend=index == 0,
            ),
            row=row,
            col=col,
        )
        figure.update_xaxes(title_text="x", row=row, col=col)
        figure.update_yaxes(title_text="y", row=row, col=col)
    figure.update_layout(
        title=f"Approximating sin(8πx) with a {format_mlp_shape(hidden_layers)} ReLU MLP",
        legend={"orientation": "h", "y": 1.04, "x": 0.0},
        margin={"t": 80, "r": 30, "b": 60, "l": 60},
        **FIGURE_STYLE,
    )
    for row in range(1, rows + 1):
        for col in range(1, cols + 1):
            figure.update_xaxes(showgrid=True, gridcolor="#e5e7eb", zeroline=False, row=row, col=col)
            figure.update_yaxes(showgrid=True, gridcolor="#e5e7eb", zeroline=False, row=row, col=col)
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
    figure.update_xaxes(showgrid=True, gridcolor="#e5e7eb", zeroline=False)
    figure.update_yaxes(showgrid=True, gridcolor="#e5e7eb", zeroline=False)
    return figure


def compact_phase_label(span: dict[str, object]) -> str:
    return f"{span['label']}<br>epochs {span['start_epoch']}-{span['end_epoch']}"


def phase_colors() -> tuple[tuple[str, ...], tuple[str, ...]]:
    return (
        ("#ead7b8", "#d8e7ef", "#e8dfef", "#dfe9d7", "#f1dfd8", "#e9d4c7"),
        ("#7a5c2e", "#486c80", "#6a4c93", "#617a3c", "#99624e", "#735751"),
    )


def add_phase_backgrounds(
    figure: go.Figure,
    *,
    result: RNNExperimentResult,
    row: int,
    col: int,
    annotate: bool,
    xref: str,
    yref: str,
    label_y: float,
) -> None:
    fill_colors, border_colors = phase_colors()
    for span_index, span in enumerate(result.phase_spans):
        start_epoch = int(span["start_epoch"])
        end_epoch = int(span["end_epoch"])
        border_color = border_colors[span_index % len(border_colors)]
        figure.add_vrect(
            x0=start_epoch,
            x1=end_epoch,
            fillcolor=fill_colors[span_index % len(fill_colors)],
            opacity=0.24 if span_index % 2 else 0.34,
            line_width=0,
            row=row,
            col=col,
        )
        if span_index > 0:
            figure.add_vline(
                x=start_epoch,
                line_width=2,
                line_dash="dash",
                line_color=border_color,
                row=row,
                col=col,
            )
        if annotate:
            figure.add_annotation(
                x=start_epoch + max(0.5, (end_epoch - start_epoch) / 2),
                y=label_y,
                xref=xref,
                yref=yref,
                text=compact_phase_label(span),
                showarrow=False,
                font={"size": 10, "color": border_color},
                bgcolor="rgba(255,255,255,0.92)",
                bordercolor=border_color,
                borderwidth=1,
            )


def build_rnn_metrics_figure(results: list[RNNExperimentResult]) -> go.Figure:
    figure = make_subplots(
        rows=len(results),
        cols=1,
        shared_xaxes=True,
        subplot_titles=[result.model_title for result in results],
    )
    for row_index, result in enumerate(results, start=1):
        epochs = [metric.epoch for metric in result.metrics]
        add_phase_backgrounds(
            figure,
            result=result,
            row=row_index,
            col=1,
            annotate=True,
            xref=f"x{row_index}" if row_index > 1 else "x",
            yref=f"y{row_index}" if row_index > 1 else "y",
            label_y=0.065,
        )
        figure.add_trace(
            go.Scatter(
                x=epochs,
                y=[metric.train_acc for metric in result.metrics],
                mode="lines",
                line={"color": COLOR_TRAIN, "width": 2.4},
                name="train",
                showlegend=row_index == 1,
            ),
            row=row_index,
            col=1,
        )
        figure.add_trace(
            go.Scatter(
                x=epochs,
                y=[metric.overall_eval_acc for metric in result.metrics],
                mode="lines",
                line={"color": "#111111", "width": 2.8},
                name="overall eval",
                showlegend=row_index == 1,
            ),
            row=row_index,
            col=1,
        )
        for key, field_name in (
            ("cohort-20", "cohort_20_acc"),
            ("cohort-50", "cohort_50_acc"),
            ("cohort-100", "cohort_100_acc"),
            ("very-long", "very_long_acc"),
        ):
            color = next(family.color for family in EVALUATION_FAMILIES if family.key == key)
            dash = "dot" if key == "very-long" else "solid"
            label = key.replace("-", " ")
            figure.add_trace(
                go.Scatter(
                    x=epochs,
                    y=[getattr(metric, field_name) for metric in result.metrics],
                    mode="lines",
                    line={"color": color, "width": 2.3, "dash": dash},
                    name=label,
                    showlegend=row_index == 1,
                ),
                row=row_index,
                col=1,
            )
        figure.add_trace(
            go.Scatter(
                x=epochs,
                y=[metric.balanced_invalid_acc for metric in result.metrics],
                mode="lines",
                line={"color": COLOR_BALANCED, "width": 2.3, "dash": "dash"},
                name="balanced-invalid eval",
                showlegend=row_index == 1,
            ),
            row=row_index,
            col=1,
        )
        figure.update_yaxes(title_text="accuracy", range=[0.0, 1.02], row=row_index, col=1)
        figure.update_xaxes(showgrid=True, gridcolor="#e5e7eb", zeroline=False, row=row_index, col=1)
        figure.update_yaxes(showgrid=True, gridcolor="#e5e7eb", zeroline=False, row=row_index, col=1)
    figure.update_xaxes(title_text="epoch", row=len(results), col=1)
    figure.update_layout(
        title={"text": "How accuracy changes as we add longer and harder cohorts", "x": 0.5},
        legend={"orientation": "h", "y": -0.1, "x": 0.0, "font": {"size": 11}},
        margin={"t": 95, "r": 40, "b": 95, "l": 60},
        width=1600,
        height=450 * len(results),
        **FIGURE_STYLE,
    )
    return figure


def length_counts(examples: list[SequenceExample]) -> dict[int, int]:
    counts: dict[int, int] = {}
    for example in examples:
        counts[len(example.text)] = counts.get(len(example.text), 0) + 1
    return counts


def invalid_mode_counts(examples: list[SequenceExample]) -> dict[str, int]:
    counts = {kind: 0 for kind in INVALID_KIND_ORDER}
    for example in examples:
        if example.label == 0 and example.kind in counts:
            counts[example.kind] += 1
    return counts


def build_dataset_diversity_figure(
    *,
    train_examples: list[SequenceExample],
    evaluation_sets: dict[str, list[SequenceExample]],
    balanced_invalid_examples: list[SequenceExample],
) -> go.Figure:
    figure = make_subplots(
        rows=1,
        cols=2,
        subplot_titles=("Cohort length support", "Invalid example composition"),
    )
    length_labels = sorted(
        {
            *length_counts(train_examples).keys(),
            *[length for family in EVALUATION_FAMILIES for length in family.lengths],
        }
    )
    label_text = [str(length) for length in length_labels]
    train_counts = length_counts(train_examples)
    figure.add_trace(
        go.Bar(
            x=label_text,
            y=[train_counts.get(length, 0) for length in length_labels],
            name="train block",
            marker_color=COLOR_TRAIN,
        ),
        row=1,
        col=1,
    )
    for family in EVALUATION_FAMILIES:
        counts = length_counts(evaluation_sets[family.key])
        figure.add_trace(
            go.Bar(
                x=label_text,
                y=[counts.get(length, 0) for length in length_labels],
                name=f"{family.key} eval",
                marker_color=family.color,
                opacity=0.72,
            ),
            row=1,
            col=1,
        )
    buckets = {
        "train block": train_examples,
        "balanced eval": balanced_invalid_examples,
        "very-long eval": evaluation_sets["very-long"],
    }
    for kind in INVALID_KIND_ORDER:
        figure.add_trace(
            go.Bar(
                x=list(buckets.keys()),
                y=[invalid_mode_counts(bucket)[kind] for bucket in buckets.values()],
                name={
                    INVALID_KIND_RANDOM: "random",
                    INVALID_KIND_CORRUPTION: "off-by-one",
                    INVALID_KIND_BALANCED: "balanced-invalid",
                }[kind],
            ),
            row=1,
            col=2,
        )
    figure.update_layout(
        barmode="group",
        title="What lengths and negative examples each split actually contains",
        legend={"orientation": "h", "y": -0.12, "x": 0.0, "font": {"size": 11}},
        margin={"t": 90, "r": 40, "b": 100, "l": 60},
        width=1600,
        height=820,
        **FIGURE_STYLE,
    )
    figure.update_xaxes(title_text="exact length", row=1, col=1)
    figure.update_yaxes(title_text="count", row=1, col=1)
    figure.update_yaxes(title_text="count", row=1, col=2)
    figure.update_xaxes(title_text="split", row=1, col=2)
    figure.update_xaxes(showgrid=False, row=1, col=1)
    figure.update_xaxes(showgrid=False, row=1, col=2)
    figure.update_yaxes(showgrid=True, gridcolor="#e5e7eb", zeroline=False, row=1, col=1)
    figure.update_yaxes(showgrid=True, gridcolor="#e5e7eb", zeroline=False, row=1, col=2)
    return figure


def build_bifurcation_figure(results: list[RNNExperimentResult]) -> go.Figure:
    figure = make_subplots(
        rows=len(results),
        cols=1,
        shared_xaxes=True,
        subplot_titles=[f"{result.model_title}: all probes" for result in results],
    )
    shown_legends: set[str] = set()
    for row_index, result in enumerate(results, start=1):
        epochs = [metric.epoch for metric in result.metrics]
        add_phase_backgrounds(
            figure,
            result=result,
            row=row_index,
            col=1,
            annotate=False,
            xref=f"x{row_index}" if row_index > 1 else "x",
            yref=f"y{row_index}" if row_index > 1 else "y",
            label_y=0.0,
        )
        final_probabilities = result.response_history[-1]
        for probe_index, probe in enumerate(RESPONSE_PROBES):
            values = [response[probe_index] for response in result.response_history]
            final_prediction = final_probabilities[probe_index] >= 0.5
            actual_valid = is_balanced_parentheses(probe.text)
            final_correct = final_prediction == actual_valid
            legend_name = (
                ("valid" if actual_valid else "invalid")
                + " / "
                + ("correct" if final_correct else "wrong")
            )
            dash = {
                "valid": "solid",
                PHASE_KIND_OFF_BY_ONE: "dash",
                PHASE_KIND_BALANCED: "dot",
                "transition": "dashdot",
            }[probe.probe_kind]
            showlegend = legend_name not in shown_legends
            shown_legends.add(legend_name)
            figure.add_trace(
                go.Scatter(
                    x=epochs,
                    y=values,
                    mode="lines",
                    line={
                        "color": {
                            "valid / correct": "#15803d",
                            "valid / wrong": "#ca8a04",
                            "invalid / correct": "#2563eb",
                            "invalid / wrong": "#dc2626",
                        }[legend_name],
                        "width": 2.2,
                        "dash": dash,
                    },
                    opacity=0.84,
                    name=legend_name,
                    showlegend=showlegend,
                    customdata=[[probe.label, probe.text, probe.probe_kind, legend_name]] * len(epochs),
                    hovertemplate=(
                        "epoch=%{x}<br>p(valid)=%{y:.3f}"
                        "<br>%{customdata[0]} | %{customdata[2]}"
                        "<br>%{customdata[3]}"
                        "<br>%{customdata[1]}<extra></extra>"
                    ),
                ),
                row=row_index,
                col=1,
            )
        figure.update_yaxes(title_text="p(valid)", range=[0.0, 1.0], row=row_index, col=1)
        figure.update_xaxes(showgrid=True, gridcolor="#e5e7eb", zeroline=False, row=row_index, col=1)
        figure.update_yaxes(showgrid=True, gridcolor="#e5e7eb", zeroline=False, row=row_index, col=1)
    figure.update_xaxes(title_text="epoch", row=len(results), col=1)
    figure.update_layout(
        title={"text": "How the model's judgments split apart during cohort rollout", "x": 0.5},
        legend={"orientation": "h", "y": -0.1, "x": 0.0, "font": {"size": 11}},
        margin={"t": 95, "r": 40, "b": 95, "l": 60},
        width=1300,
        height=440 * len(results),
        **FIGURE_STYLE,
    )
    return figure


def build_rnn_story_figure(result: RNNExperimentResult) -> go.Figure:
    figure = make_subplots(
        rows=2,
        cols=1,
        specs=[
            [{"type": "xy"}],
            [{"type": "xy"}],
        ],
        subplot_titles=(
            f"{result.model_title}: training accuracy",
            f"{result.model_title}: all probes",
        ),
        vertical_spacing=0.1,
    )
    epochs = [metric.epoch for metric in result.metrics]
    add_phase_backgrounds(
        figure,
        result=result,
        row=1,
        col=1,
        annotate=True,
        xref="x",
        yref="y",
        label_y=0.065,
    )
    figure.add_trace(
        go.Scatter(x=epochs, y=[metric.train_acc for metric in result.metrics], mode="lines", line={"color": COLOR_TRAIN, "width": 2.4}, name="train"),
        row=1,
        col=1,
    )
    figure.add_trace(
        go.Scatter(
            x=epochs,
            y=[metric.overall_eval_acc for metric in result.metrics],
            mode="lines",
            line={"color": "#111111", "width": 2.8},
            name="overall eval",
        ),
        row=1,
        col=1,
    )
    for key, field_name in (
        ("cohort-20", "cohort_20_acc"),
        ("cohort-50", "cohort_50_acc"),
        ("cohort-100", "cohort_100_acc"),
        ("very-long", "very_long_acc"),
    ):
        color = next(family.color for family in EVALUATION_FAMILIES if family.key == key)
        dash = "dot" if key == "very-long" else "solid"
        figure.add_trace(
            go.Scatter(
                x=epochs,
                y=[getattr(metric, field_name) for metric in result.metrics],
                mode="lines",
                line={"color": color, "width": 2.3, "dash": dash},
                name=key.replace("-", " "),
            ),
            row=1,
            col=1,
        )
    figure.add_trace(
        go.Scatter(
            x=epochs,
            y=[metric.balanced_invalid_acc for metric in result.metrics],
            mode="lines",
            line={"color": COLOR_BALANCED, "width": 2.3, "dash": "dash"},
            name="balanced-invalid eval",
        ),
        row=1,
        col=1,
    )
    figure.update_yaxes(title_text="accuracy", range=[0.0, 1.02], row=1, col=1)
    figure.update_xaxes(title_text="epoch", showgrid=True, gridcolor="#e5e7eb", zeroline=False, row=1, col=1)
    figure.update_yaxes(showgrid=True, gridcolor="#e5e7eb", zeroline=False, row=1, col=1)

    shown_legends: set[str] = set()
    add_phase_backgrounds(
        figure,
        result=result,
        row=2,
        col=1,
        annotate=False,
        xref="x2",
        yref="y2",
        label_y=0.0,
    )
    final_probabilities = result.response_history[-1]
    for probe_index, probe in enumerate(RESPONSE_PROBES):
        values = [response[probe_index] for response in result.response_history]
        final_prediction = final_probabilities[probe_index] >= 0.5
        actual_valid = is_balanced_parentheses(probe.text)
        final_correct = final_prediction == actual_valid
        status_label = (
            ("valid" if actual_valid else "invalid")
            + " / "
            + ("correct" if final_correct else "wrong")
        )
        legend_name = status_label
        dash = {
            "valid": "solid",
            PHASE_KIND_OFF_BY_ONE: "dash",
            PHASE_KIND_BALANCED: "dot",
            "transition": "dashdot",
        }[probe.probe_kind]
        showlegend = legend_name not in shown_legends
        shown_legends.add(legend_name)
        figure.add_trace(
            go.Scatter(
                x=epochs,
                y=values,
                mode="lines",
                line={
                    "color": {
                        "valid / correct": "#15803d",
                        "valid / wrong": "#ca8a04",
                        "invalid / correct": "#2563eb",
                        "invalid / wrong": "#dc2626",
                    }[status_label],
                    "width": 2.2,
                    "dash": dash,
                },
                opacity=0.84,
                name=legend_name,
                showlegend=showlegend,
                customdata=[[probe.label, probe.text, probe.probe_kind, status_label]] * len(epochs),
                hovertemplate=(
                    "epoch=%{x}<br>p(valid)=%{y:.3f}"
                    "<br>%{customdata[0]} | %{customdata[2]}"
                    "<br>%{customdata[3]}"
                    "<br>%{customdata[1]}<extra></extra>"
                ),
            ),
            row=2,
            col=1,
        )
    figure.update_xaxes(title_text="epoch", showgrid=True, gridcolor="#e5e7eb", zeroline=False, row=2, col=1)
    figure.update_yaxes(title_text="p(valid)", range=[0.0, 1.0], showgrid=True, gridcolor="#e5e7eb", zeroline=False, row=2, col=1)

    figure.update_layout(
        title={"text": f"{result.model_title}: training phases and response splitting", "x": 0.5},
        legend={"orientation": "h", "y": -0.06, "x": 0.0, "font": {"size": 11}},
        margin={"t": 95, "r": 40, "b": 100, "l": 60},
        width=1300,
        height=980,
        **FIGURE_STYLE,
    )
    return figure


def rgba(hex_color: str, alpha: float) -> str:
    hex_color = hex_color.lstrip("#")
    red = int(hex_color[0:2], 16)
    green = int(hex_color[2:4], 16)
    blue = int(hex_color[4:6], 16)
    return f"rgba({red},{green},{blue},{alpha:.3f})"


def tail_slice(points: list[list[float]]) -> tuple[list[list[float]], int]:
    keep = max(10, int(math.ceil(len(points) * 0.35)))
    start = max(0, len(points) - keep)
    return points[start:], start


def trace_grid_epochs(result: RNNExperimentResult) -> list[int]:
    balanced_phase_epochs = [
        int(span["end_epoch"])
        for span in result.phase_spans
        if str(span["phase_kind"]) == PHASE_KIND_BALANCED
    ]
    ordered = [0, *balanced_phase_epochs]
    selected: list[int] = []
    for epoch in ordered:
        if epoch not in selected:
            selected.append(epoch)
        if len(selected) == 4:
            break
    if result.metrics[-1].epoch not in selected:
        selected[-1] = result.metrics[-1].epoch
    return selected


def build_trace_figure(
    *,
    model_title: str,
    epoch: int,
    payloads: list[dict[str, object]],
    num_layers: int,
) -> go.Figure:
    row_count = num_layers * 2
    figure = make_subplots(
        rows=row_count,
        cols=2,
        subplot_titles=[
            f"{validity} | Layer {layer_index + 1}: (h1, h2)"
            if pair_index == 0
            else f"{validity} | Layer {layer_index + 1}: (h3, h4)"
            for validity in ("valid tails", "invalid tails")
            for layer_index in range(num_layers)
            for pair_index in range(2)
        ],
    )
    for payload in payloads:
        text = str(payload["text"])
        label = str(payload["label"])
        probe_kind = str(payload["probe_kind"])
        color = str(payload["color"])
        is_valid = bool(payload["is_valid"])
        correctness = "correct" if bool(payload["correct"]) else "wrong"
        row_offset = 0 if is_valid else num_layers
        symbol = TRACE_SYMBOLS[probe_kind]
        legend_label = f"{label} [{probe_kind}, {correctness}]"
        for layer_payload in payload["layers"]:  # type: ignore[index]
            layer_number = int(layer_payload["layer"])
            points = layer_payload["points"]  # type: ignore[index]
            tail_points, tail_start = tail_slice(points)
            full_left_x = [point[0] for point in points]
            full_left_y = [point[1] for point in points]
            full_right_x = [point[2] for point in points]
            full_right_y = [point[3] for point in points]
            tail_left_x = [point[0] for point in tail_points]
            tail_left_y = [point[1] for point in tail_points]
            tail_right_x = [point[2] for point in tail_points]
            tail_right_y = [point[3] for point in tail_points]
            row_number = row_offset + layer_number
            for col_index, (full_x, full_y, tail_x, tail_y) in enumerate(
                (
                    (full_left_x, full_left_y, tail_left_x, tail_left_y),
                    (full_right_x, full_right_y, tail_right_x, tail_right_y),
                ),
                start=1,
            ):
                figure.add_trace(
                    go.Scatter(
                        x=full_x,
                        y=full_y,
                        mode="lines",
                        line={"color": rgba(color, 0.22), "width": 1.0},
                        showlegend=False,
                        hoverinfo="skip",
                    ),
                    row=row_number,
                    col=col_index,
                )
                milestone_labels = [
                    f"{tail_start + 1}",
                    f"{(tail_start + len(tail_points)) // 2}",
                    f"{len(points)}",
                ]
                text_values = [""] * len(tail_x)
                if tail_x:
                    text_values[0] = milestone_labels[0]
                    text_values[len(tail_x) // 2] = milestone_labels[1]
                    text_values[-1] = milestone_labels[2]
                figure.add_trace(
                    go.Scatter(
                        x=tail_x,
                        y=tail_y,
                        mode="markers+text",
                        marker={
                            "size": 8,
                            "color": color,
                            "symbol": symbol,
                            "line": {"color": "#fdfcf8", "width": 0.8},
                        },
                        text=text_values,
                        textposition="top center",
                        textfont={"size": 9},
                        name=legend_label,
                        showlegend=(row_number in (1, num_layers + 1) and col_index == 1),
                        hovertemplate=(
                            f"{legend_label}<br>{text}<br>tail-step=%{{text}}"
                            "<br>x=%{x:.3f}<br>y=%{y:.3f}<extra></extra>"
                        ),
                    ),
                    row=row_number,
                    col=col_index,
                )
                if tail_x:
                    figure.add_trace(
                        go.Scatter(
                            x=[tail_x[-1]],
                            y=[tail_y[-1]],
                            mode="markers",
                            marker={
                                "size": 15,
                                "symbol": "star",
                                "color": color,
                                "line": {"color": "#111827", "width": 1.2},
                            },
                            showlegend=False,
                            hoverinfo="skip",
                        ),
                        row=row_number,
                        col=col_index,
                    )
    for row_index in range(1, row_count + 1):
        figure.update_xaxes(title_text="state x", row=row_index, col=1)
        figure.update_xaxes(title_text="state x", row=row_index, col=2)
        figure.update_yaxes(title_text="state y", row=row_index, col=1)
        figure.update_yaxes(title_text="state y", row=row_index, col=2)
    figure.update_layout(
        title=f"{model_title} hidden-state tail scatter at epoch {epoch}",
        legend={"orientation": "v", "x": 1.01, "y": 1.0, "font": {"size": 11}},
        margin={"t": 95, "r": 320, "b": 60, "l": 60},
        width=1650,
        height=410 * row_count,
        **FIGURE_STYLE,
    )
    for row_index in range(1, row_count + 1):
        figure.update_xaxes(showgrid=True, gridcolor="#e5e7eb", zeroline=False, row=row_index, col=1)
        figure.update_xaxes(showgrid=True, gridcolor="#e5e7eb", zeroline=False, row=row_index, col=2)
        figure.update_yaxes(showgrid=True, gridcolor="#e5e7eb", zeroline=False, row=row_index, col=1)
        figure.update_yaxes(showgrid=True, gridcolor="#e5e7eb", zeroline=False, row=row_index, col=2)
    return figure


def build_trace_epoch_grid_figure(
    *,
    model_title: str,
    num_layers: int,
    epochs: list[int],
    payloads_by_epoch: dict[int, list[dict[str, object]]],
    pair_index: int,
) -> go.Figure:
    row_count = num_layers * 2
    col_count = len(epochs)
    pair_label = "(h1, h2)" if pair_index == 0 else "(h3, h4)"
    figure = make_subplots(
        rows=row_count,
        cols=col_count,
        subplot_titles=[
            f"{'valid' if row_group == 0 else 'invalid'} | Layer {layer_index + 1} | epoch {epoch}"
            for row_group in range(2)
            for layer_index in range(num_layers)
            for epoch in epochs
        ],
        horizontal_spacing=0.04,
        vertical_spacing=0.1,
    )
    for col_number, epoch in enumerate(epochs, start=1):
        payloads = payloads_by_epoch[epoch]
        for payload in payloads:
            text = str(payload["text"])
            label = str(payload["label"])
            probe_kind = str(payload["probe_kind"])
            color = str(payload["color"])
            is_valid = bool(payload["is_valid"])
            correctness = "correct" if bool(payload["correct"]) else "wrong"
            row_offset = 0 if is_valid else num_layers
            symbol = TRACE_SYMBOLS[probe_kind]
            legend_label = f"{label} [{probe_kind}, {correctness}]"
            for layer_payload in payload["layers"]:  # type: ignore[index]
                layer_number = int(layer_payload["layer"])
                points = layer_payload["points"]  # type: ignore[index]
                tail_points, tail_start = tail_slice(points)
                xs = [point[pair_index * 2] for point in tail_points]
                ys = [point[pair_index * 2 + 1] for point in tail_points]
                full_xs = [point[pair_index * 2] for point in points]
                full_ys = [point[pair_index * 2 + 1] for point in points]
                row_number = row_offset + layer_number
                figure.add_trace(
                    go.Scatter(
                        x=full_xs,
                        y=full_ys,
                        mode="lines",
                        line={"color": rgba(color, 0.18), "width": 1.0},
                        showlegend=False,
                        hoverinfo="skip",
                    ),
                    row=row_number,
                    col=col_number,
                )
                text_values = [""] * len(xs)
                if xs:
                    text_values[0] = str(tail_start + 1)
                    text_values[-1] = str(len(points))
                figure.add_trace(
                    go.Scatter(
                        x=xs,
                        y=ys,
                        mode="markers+text",
                        marker={
                            "size": 7,
                            "color": color,
                            "symbol": symbol,
                            "line": {"color": "#fdfcf8", "width": 0.8},
                        },
                        text=text_values,
                        textposition="top center",
                        textfont={"size": 8},
                        name=legend_label,
                        showlegend=col_number == 1 and row_number in (1, num_layers + 1),
                        hovertemplate=(
                            f"{legend_label}<br>{text}<br>tail-step=%{{text}}"
                            "<br>x=%{x:.3f}<br>y=%{y:.3f}<extra></extra>"
                        ),
                    ),
                    row=row_number,
                    col=col_number,
                )
                if xs:
                    figure.add_trace(
                        go.Scatter(
                            x=[xs[-1]],
                            y=[ys[-1]],
                            mode="markers",
                            marker={
                                "size": 13,
                                "symbol": "star",
                                "color": color,
                                "line": {"color": "#111827", "width": 1.0},
                            },
                            showlegend=False,
                            hoverinfo="skip",
                        ),
                        row=row_number,
                        col=col_number,
                    )
    for row_index in range(1, row_count + 1):
        for col_index in range(1, col_count + 1):
            figure.update_xaxes(title_text="state x", showgrid=True, gridcolor="#e5e7eb", zeroline=False, row=row_index, col=col_index)
            figure.update_yaxes(title_text="state y", showgrid=True, gridcolor="#e5e7eb", zeroline=False, row=row_index, col=col_index)
    figure.update_layout(
        title=f"{model_title} tail traces across key epochs for {pair_label}",
        legend={"orientation": "v", "x": 1.01, "y": 1.0, "font": {"size": 11}},
        margin={"t": 95, "r": 320, "b": 60, "l": 60},
        width=420 * col_count + 380,
        height=350 * row_count,
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
        f"(batch={mlp_batch_size}, lr=0.08->0.008)"
    )
    loss_history, snapshots, xs, ys = train_mlp(
        epochs=mlp_epochs,
        batch_size=mlp_batch_size,
        lr_start=0.08,
        lr_end=0.008,
        seed=seed,
        hidden_layers=mlp_shape,
    )
    files: list[str] = []
    files.extend(
        write_figure(
            build_mlp_snapshot_figure(xs=xs, ys=ys, snapshots=snapshots, hidden_layers=mlp_shape),
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
        "shape": list(mlp_shape),
        "snapshot_epochs": sorted(snapshots),
        "final_loss": loss_history[-1],
    }


def render_rnn_assets(
    *,
    output_dir: Path,
    write_html: bool,
    write_trace_images: bool,
    seed: int,
    block_epochs: int,
    train_samples: int,
    test_samples: int,
) -> dict[str, object]:
    blocks = build_training_blocks(block_epochs=block_epochs, train_samples=train_samples)
    log_progress(
        f"training RNN studies with {len(blocks)} cohort blocks, block_epochs={block_epochs}, "
        f"train_samples={train_samples}, test_samples={test_samples}, batch={DEFAULT_BATCH_SIZE}"
    )

    results = [
        run_rnn_experiment(
            num_layers=1,
            seed=seed + 100,
            block_epochs=block_epochs,
            train_samples=train_samples,
            test_samples=test_samples,
        ),
        run_rnn_experiment(
            num_layers=2,
            seed=seed + 200,
            block_epochs=block_epochs,
            train_samples=train_samples,
            test_samples=test_samples,
        ),
    ]
    for result in results:
        final_metrics = result.metrics[-1]
        log_progress(
            f"{result.model_title}: final train={final_metrics.train_acc:.3f}, "
            f"overall={final_metrics.overall_eval_acc:.3f}, "
            f"20={final_metrics.cohort_20_acc:.3f}, 50={final_metrics.cohort_50_acc:.3f}, "
            f"100={final_metrics.cohort_100_acc:.3f}, very-long={final_metrics.very_long_acc:.3f}, "
            f"balanced={final_metrics.balanced_invalid_acc:.3f}"
        )
    shared_files: list[str] = []
    shared_files.extend(
        write_figure(
            build_dataset_diversity_figure(
                train_examples=results[0].representative_train_examples,
                evaluation_sets=results[0].evaluation_sets,
                balanced_invalid_examples=results[0].balanced_invalid_examples,
            ),
            output_dir=output_dir,
            stem="rnn-dataset-diversity",
            write_html=write_html,
        )
    )
    for result in results:
        shared_files.extend(
            write_figure(
                build_rnn_story_figure(result),
                output_dir=output_dir,
                stem=f"{result.model_key}-training-story",
                write_html=write_html,
            )
        )
    if write_trace_images:
        for result in results:
            epochs = trace_grid_epochs(result)
            for pair_index, pair_alias in enumerate(("pair-a", "pair-b")):
                result.files.extend(
                    write_figure(
                        build_trace_epoch_grid_figure(
                            model_title=result.model_title,
                            num_layers=result.num_layers,
                            epochs=epochs,
                            payloads_by_epoch=result.trace_payloads,
                            pair_index=pair_index,
                        ),
                        output_dir=output_dir,
                        stem=f"{result.model_key}-traces-{pair_alias}",
                        write_html=write_html,
                    )
                )
            result.files.extend(
                write_figure(
                    build_trace_figure(
                            model_title=result.model_title,
                            epoch=result.peak_aha_epoch,
                            payloads=result.trace_payloads[result.peak_aha_epoch],
                            num_layers=result.num_layers,
                        ),
                        output_dir=output_dir,
                        stem=f"{result.model_key}-traces-aha-detail",
                        write_html=write_html,
                    )
                )
    return {
        "files": shared_files,
        "block_epochs": block_epochs,
        "batch_size": DEFAULT_BATCH_SIZE,
        "train_cohorts": list(TRAIN_COHORTS),
        "blocks": blocks and [asdict(block) for block in blocks],
        "evaluation_families": [asdict(family) for family in EVALUATION_FAMILIES],
        "probe_families": [asdict(probe) for probe in RESPONSE_PROBES],
        "trace_strings": [asdict(probe) for probe in TRACE_PROBES],
        "models": [
            {
                "model_key": result.model_key,
                "model_title": result.model_title,
                "num_layers": result.num_layers,
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
    mlp_shape: str = typer.Option(
        "32",
        help="Comma-separated hidden-layer widths for the MLP, e.g. 32 or 32,32.",
    ),
    rnn_block_epochs: int = typer.Option(
        DEFAULT_BLOCK_EPOCHS,
        help="Epochs to run for each cohort-phase block.",
    ),
    rnn_train_samples: int = typer.Option(
        512,
        help="Training examples sampled for each RNN block epoch.",
    ),
    rnn_test_samples: int = typer.Option(
        128,
        help="Examples in each fixed evaluation family.",
    ),
    html: bool = typer.Option(
        True,
        "--html/--no-html",
        help="Whether to emit Plotly HTML companions alongside PNGs.",
    ),
    trace_images: bool = typer.Option(
        True,
        "--trace-images/--no-trace-images",
        help="Whether to emit tail-trace figure PNGs and HTML files.",
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
            block_epochs=rnn_block_epochs,
            train_samples=rnn_train_samples,
            test_samples=rnn_test_samples,
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
