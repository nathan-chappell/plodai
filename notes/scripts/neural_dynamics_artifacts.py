from __future__ import annotations

import json
import math
import random
import time
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Iterator, Literal

import torch
import typer
from torch import nn
from torch.nn import functional as F

from notes.scripts.artifact_common import (
    DEFAULT_OUTPUT_DIR,
    clean_output_dir,
    ensure_dir,
)
from notes.scripts.mlp_story_artifacts import (
    MLP_DEFAULT_SHAPE,
    MLPTrainingRun,
    render_mlp_assets,
)
from notes.scripts.precision_story_artifacts import (
    PRECISION_COUNT_BITS,
    PRECISION_DUST_DEPTH,
    PRECISION_INITIAL_LEFT_STACK,
    PRECISION_INITIAL_RIGHT_STACK,
    PRECISION_MILESTONE_COUNTS,
    PRECISION_STORY_MODE,
    PRECISION_ZOOM_DEPTHS,
    build_precision_story_figure,
    build_precision_story_payload,
    render_precision_assets,
)

app = typer.Typer(
    help="Generate article-ready neural network figures for the theoretical-justification post."
)
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
ARTICLE_SLUG = "15-03-2026-the-theoretical-justification-of-neural-networks"

PAD_INDEX = 2
STORY_PROBE_LENGTH = 10
ACCURACY_EVAL_LENGTHS: tuple[int, ...] = (10, 20, 30, 50)
DEFAULT_PHASE_EPOCHS = 40
DEFAULT_TRAIN_SAMPLES = 128
DEFAULT_TEST_SAMPLES = 32
DEFAULT_MLP_STORY_SEED = 7
DEFAULT_RNN_STORY_SEED = 1337
DEFAULT_RNN_LR_START = 0.0015
DEFAULT_RNN_LR_END = 0.0002

INVALID_KIND_RANDOM = "random_invalid"
PHASE_KIND_RANDOM = "random"
PHASE_KIND_OFF_BY_ONE = "off_by_one"
PHASE_KIND_VALID_PREFIX = "valid_prefix"
PHASE_KIND_BALANCED_INVALID = "balanced_invalid"
PHASE_KIND_PRETRAIN = "phase_short_random"
PHASE_KIND_SHOCK = "phase_counterexample_shock"

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


@dataclass(frozen=True)
class TrainingPhaseSpec:
    phase_kind: str
    label: str
    epoch_multiplier: int
    batch_size: int
    length_mix: tuple[tuple[int, float], ...]
    family_mix: tuple[tuple[str, float], ...]


@dataclass
class RNNExperimentResult:
    seed: int
    model_key: str
    model_title: str
    phase_spans: list[dict[str, object]]
    metrics: list[MetricRow]
    response_history: list[list[float]]
    story_response_history: list[list[float]]
    story_probes: tuple[ProbeSpec, ...]
    evaluation_sets: dict[str | int, list[SequenceExample]]
    representative_examples: list[SequenceExample]
    trace_payload: object | None
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
    training_texts: tuple[str, ...]


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
        raise ValueError(
            "Valid balanced-parentheses strings require an even length >= 2."
        )
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
    raise ValueError(
        f"Failed to construct an off-by-one invalid sequence for length {length}."
    )


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
    raise ValueError(
        f"Failed to construct a balanced-invalid sequence for length {length}."
    )


def sample_valid_prefix_invalid_sequence(rng: random.Random, length: int) -> str:
    if length <= 0:
        raise ValueError("Valid-prefix invalid strings require a positive length.")
    target_balance = 1 if length % 2 else 2
    prefix_length = length - target_balance
    prefix = (
        sample_valid_sequence_of_length(rng, prefix_length) if prefix_length > 0 else ""
    )
    candidate = prefix + "(" * target_balance
    if not is_valid_prefix_invalid(candidate):
        raise ValueError(
            f"Failed to build valid-prefix invalid sequence for length {length}."
        )
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
        examples.append(
            SequenceExample(text=text, label=label, kind=kind, family=family)
        )
    return examples


def encode_sequences(sequences: list[str]) -> tuple[torch.Tensor, torch.Tensor]:
    lengths = torch.tensor(
        [len(sequence) for sequence in sequences], dtype=torch.long, device=DEVICE
    )
    max_length = int(lengths.max().item()) if sequences else 0
    tokens = torch.full(
        (len(sequences), max_length), PAD_INDEX, dtype=torch.long, device=DEVICE
    )
    for row, sequence in enumerate(sequences):
        for col, char in enumerate(sequence):
            tokens[row, col] = 0 if char == "(" else 1
    return tokens, lengths


def clone_model_parameters(model: nn.Module) -> dict[str, torch.Tensor]:
    return {
        name: tensor.detach().cpu().clone()
        for name, tensor in model.state_dict().items()
    }


def load_model_parameters(
    model: nn.Module, parameters: dict[str, torch.Tensor]
) -> None:
    model.load_state_dict(
        {
            name: tensor.detach().clone().to(device=DEVICE)
            for name, tensor in parameters.items()
        }
    )


def acceptance_distance(states: torch.Tensor) -> torch.Tensor:
    anchor = RNN_ACCEPT_ANCHOR.to(device=states.device, dtype=states.dtype)
    return torch.linalg.vector_norm(states - anchor.unsqueeze(0), dim=1)


def acceptance_probability(states: torch.Tensor) -> torch.Tensor:
    margin = RNN_ACCEPT_RADIUS - acceptance_distance(states)
    return torch.sigmoid(10.0 * margin)


def evaluate_examples(
    model: PhasedTorchRNN, examples: list[SequenceExample]
) -> tuple[float, float]:
    final_states, _ = model(
        [example.text for example in examples], capture_traces=False
    )
    probabilities = acceptance_probability(final_states)
    labels = torch.tensor(
        [float(example.label) for example in examples],
        dtype=torch.float64,
        device=DEVICE,
    )
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
    _, balanced_invalid_acc = evaluate_examples(
        model, family_sets[PHASE_KIND_BALANCED_INVALID]
    )
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


def build_story_response_row(
    model: PhasedTorchRNN, story_texts: list[str]
) -> list[float]:
    final_states, _ = model(story_texts, capture_traces=False)
    return acceptance_probability(final_states).tolist()


# RNN article reset: two-phase shock story, boundary-focused bifurcation plot, acceptance-ball geometry.

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
RNN_ACCEPT_ANCHOR = torch.zeros(RNN_HIDDEN_SIZE, dtype=torch.float64)
RNN_ACCEPT_ANCHOR[0] = 1.0
RNN_PHASE_SPECS: tuple[TrainingPhaseSpec, ...] = (
    TrainingPhaseSpec(
        phase_kind=PHASE_KIND_PRETRAIN,
        label="Phase 1: short strings + some random length-20",
        epoch_multiplier=1,
        batch_size=8,
        length_mix=((2, 1.0), (4, 1.0), (6, 1.0), (8, 1.0), (20, 0.5)),
        family_mix=((PHASE_KIND_RANDOM, 1.0),),
    ),
    TrainingPhaseSpec(
        phase_kind=PHASE_KIND_SHOCK,
        label="Phase 2: introduce counterexamples",
        epoch_multiplier=1,
        batch_size=16,
        length_mix=((10, 1.0), (20, 1.0), (30, 1.0)),
        family_mix=(
            (PHASE_KIND_RANDOM, 0.25),
            (PHASE_KIND_OFF_BY_ONE, 0.25),
            (PHASE_KIND_VALID_PREFIX, 0.25),
            (PHASE_KIND_BALANCED_INVALID, 0.25),
        ),
    ),
)
RNN_PHASE_LR_PEAK_FACTORS: tuple[float, ...] = (1.0, 0.62)
RNN_PHASE_LR_FLOOR_FACTORS: tuple[float, ...] = (0.58, 0.0)
STORY_PROBABILITY_RANGE = (0.2, 0.8)


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
        self.h0 = nn.Parameter(
            torch.zeros((RNN_NUM_LAYERS, RNN_HIDDEN_SIZE), dtype=torch.float64)
        )
        self.double()
        self.to(DEVICE)

    def forward(
        self,
        sequences: list[str],
        *,
        capture_traces: bool = False,
    ) -> tuple[torch.Tensor, torch.Tensor | None]:
        if not sequences:
            empty = torch.zeros(
                (0, RNN_HIDDEN_SIZE), dtype=torch.float64, device=DEVICE
            )
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
    positive_weight = (
        1.0
        if positive_count == 0
        else max(1.0, negative_count / max(1.0, positive_count))
    )
    weights = torch.where(labels > 0.5, positive_weight, 1.0).to(probabilities)
    return F.binary_cross_entropy(probabilities, labels, weight=weights)


def acceptance_geometry_loss(
    final_states: torch.Tensor, labels: torch.Tensor
) -> torch.Tensor:
    distances = acceptance_distance(final_states)
    positive_pull = distances.square()
    negative_push = F.relu((RNN_ACCEPT_RADIUS + 0.15) - distances).square()
    return torch.where(labels > 0.5, positive_pull, negative_push).mean()


def classification_loss(
    final_states: torch.Tensor, labels: torch.Tensor
) -> torch.Tensor:
    probabilities = acceptance_probability(final_states)
    return weighted_bce(probabilities, labels) + (
        RNN_GEOMETRY_LOSS_WEIGHT * acceptance_geometry_loss(final_states, labels)
    )


def allocate_weighted_counts(
    total: int, family_mix: tuple[tuple[str, float], ...]
) -> list[tuple[str, int]]:
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
    return [
        (family_mix[index][0], counts_list[index]) for index in range(len(family_mix))
    ]


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
            allocate_weighted_counts(
                invalid_count,
                tuple((family_kind, 1.0) for family_kind in invalid_families),
            ),
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
    all_strings = [
        format(value, f"0{RNN_STORY_PROBE_LENGTH}b").replace("0", "(").replace("1", ")")
        for value in range(2**RNN_STORY_PROBE_LENGTH)
    ]
    family_buckets: list[tuple[str, str, list[str]]] = [
        ("V", "valid", [text for text in all_strings if is_balanced_parentheses(text)]),
        (
            "O",
            PHASE_KIND_OFF_BY_ONE,
            [text for text in all_strings if is_off_by_one_invalid(text)],
        ),
        (
            "P",
            PHASE_KIND_VALID_PREFIX,
            [text for text in all_strings if is_valid_prefix_invalid(text)],
        ),
        (
            "B",
            PHASE_KIND_BALANCED_INVALID,
            [text for text in all_strings if is_balanced_invalid(text)],
        ),
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
    return [
        base_phase_epochs * phase_spec.epoch_multiplier
        for phase_spec in RNN_PHASE_SPECS
    ]


def phase_learning_rate(
    *,
    phase_index: int,
    epoch_in_phase: int,
    epochs_in_phase: int,
    lr_start: float,
    lr_end: float,
) -> float:
    peak_lr = max(lr_end, lr_start * RNN_PHASE_LR_PEAK_FACTORS[phase_index])
    floor_lr = (
        lr_end
        if phase_index == len(RNN_PHASE_SPECS) - 1
        else max(lr_end, lr_start * RNN_PHASE_LR_FLOOR_FACTORS[phase_index])
    )
    if epochs_in_phase <= 1:
        return floor_lr
    progress = (epoch_in_phase - 1) / (epochs_in_phase - 1)
    cosine = 0.5 * (1.0 + math.cos(math.pi * progress))
    return floor_lr + ((peak_lr - floor_lr) * cosine)


def phase_batch_schedule() -> list[int]:
    return [phase_spec.batch_size for phase_spec in RNN_PHASE_SPECS]


def phase_family_mix_manifest() -> list[dict[str, float]]:
    return [
        {family: weight for family, weight in phase_spec.family_mix}
        for phase_spec in RNN_PHASE_SPECS
    ]


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
    if epoch == 0:
        return "Random init"
    boundaries = phase_epoch_boundaries(phase_epochs)
    for phase_index, end_epoch in enumerate(boundaries[1:], start=1):
        if epoch == end_epoch:
            return f"After phase {phase_index}"
    for phase_index, (start_epoch, end_epoch) in enumerate(
        zip(boundaries[:-1], boundaries[1:], strict=True), start=1
    ):
        if start_epoch < epoch < end_epoch:
            return f"P{phase_index} {(epoch - start_epoch) / (end_epoch - start_epoch):.2f}"
    return f"epoch {epoch}"


def phase_label_for_epoch(epoch: int, phase_epochs: int) -> str:
    if epoch == 0:
        return "Random init"
    boundaries = phase_epoch_boundaries(phase_epochs)[1:]
    for phase_spec, end_epoch in zip(RNN_PHASE_SPECS, boundaries, strict=True):
        if epoch <= end_epoch:
            return phase_spec.label
    return RNN_PHASE_SPECS[-1].label


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
    length_allocations = allocate_weighted_counts(total_examples, phase_spec.length_mix)
    examples: list[SequenceExample] = []
    for length_index, (length, length_count) in enumerate(length_allocations):
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
        final_states, _ = model(
            [example.text for example in batch_examples], capture_traces=False
        )
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
    with log_timing(
        f"building phased tanh RNN evaluation sets (train_samples={train_samples}, test_samples={test_samples})"
    ):
        evaluation_sets = build_rnn_evaluation_sets(
            test_samples=test_samples, seed=seed
        )
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
    training_texts_seen: set[str] = set()

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
    training_texts_seen.update(example.text for example in initial_examples)
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
            training_texts_seen.update(example.text for example in train_examples)
            train_loss, train_acc = run_training_epoch(
                model,
                examples=train_examples,
                optimizer=optimizer,
                batch_size=phase_spec.batch_size,
            )
            if epoch in checkpoint_epoch_set:
                record_checkpoint(epoch, train_examples)
            if (
                offset == 1
                or offset == epochs_in_phase
                or offset % max(1, epochs_in_phase // 4) == 0
            ):
                log_progress(
                    f"{phase_spec.label} epoch {offset}/{epochs_in_phase} loss={train_loss:.3f} acc={train_acc:.3f} batch={phase_spec.batch_size} lr={current_lr:.5f}"
                )
        elapsed += epochs_in_phase

    return RNNExperimentResult(
        seed=seed,
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
        checkpoint_labels=[
            checkpoint_label(epoch, phase_epochs) for epoch in checkpoint_epochs
        ],
        checkpoint_epochs=checkpoint_epochs,
        architecture={
            "module": "torch.RNN",
            "nonlinearity": "tanh",
            "hidden_size": RNN_HIDDEN_SIZE,
            "num_layers": RNN_NUM_LAYERS,
        },
        phase_epoch_schedule=phase_schedule,
        phase_batch_schedule=phase_batch_sizes,
        phase_family_mix=phase_family_mix,
        checkpoint_states=checkpoint_states,
        training_texts=tuple(sorted(training_texts_seen)),
    )


def render_rnn_assets(
    *,
    output_dir: Path,
    seed: int,
    phase_epochs: int,
    train_samples: int,
    test_samples: int,
    lr_start: float,
    lr_end: float,
) -> dict[str, object]:
    try:
        from notes.scripts.rnn_transition_report import render_rnn_transition_report
    except ModuleNotFoundError:
        from rnn_transition_report import render_rnn_transition_report

    with log_timing("building phased tanh torch.RNN metrics and response history"):
        result = run_rnn_experiment(
            seed=seed,
            phase_epochs=phase_epochs,
            train_samples=train_samples,
            test_samples=test_samples,
            lr_start=lr_start,
            lr_end=lr_end,
        )
    with log_timing(
        "extracting transition metrics and rendering matplotlib publication report"
    ):
        report_manifest = render_rnn_transition_report(
            result,
            output_dir=output_dir,
            is_valid_fn=is_balanced_parentheses,
        )
    files = list(report_manifest["files"])
    result.trace_payload = None
    result.files = files
    final_metrics = result.metrics[-1]
    log_progress(
        f"{result.model_title}: final eval10={final_metrics.eval_10_acc:.3f}, eval20={final_metrics.eval_20_acc:.3f}, eval30={final_metrics.eval_30_acc:.3f}, eval50={final_metrics.eval_50_acc:.3f}"
    )
    return {
        "seed": result.seed,
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
        "metrics_probe_mode": "family_balanced_probe_pool",
        "metrics_probe_count": len(result.story_probes),
        "metrics_probe_families": {
            "valid": [
                probe.text
                for probe in result.story_probes
                if probe.probe_kind == "valid"
            ],
            "off_by_one": [
                probe.text
                for probe in result.story_probes
                if probe.probe_kind == PHASE_KIND_OFF_BY_ONE
            ],
            "valid_prefix": [
                probe.text
                for probe in result.story_probes
                if probe.probe_kind == PHASE_KIND_VALID_PREFIX
            ],
            "balanced_invalid": [
                probe.text
                for probe in result.story_probes
                if probe.probe_kind == PHASE_KIND_BALANCED_INVALID
            ],
        },
        "final_metrics": asdict(final_metrics),
        **report_manifest,
    }


def generate_artifacts(
    *,
    target: Literal["all", "mlp", "precision", "rnn"],
    output_dir: Path,
    seed: int | None,
    mlp_seed: int | None,
    rnn_seed: int | None,
    mlp_epochs: int,
    mlp_batch_size: int,
    mlp_shape: str,
    rnn_phase_epochs: int,
    rnn_train_samples: int,
    rnn_test_samples: int,
    clean: bool,
    render_mlp: Callable[..., dict[str, object]] | None = None,
    render_precision: Callable[..., dict[str, object]] | None = None,
    render_rnn: Callable[..., dict[str, object]] | None = None,
) -> dict[str, object]:
    render_mlp = render_mlp or render_mlp_assets
    render_precision = render_precision or render_precision_assets
    render_rnn = render_rnn or render_rnn_assets
    resolved_mlp_seed = (
        mlp_seed
        if mlp_seed is not None
        else seed if seed is not None else DEFAULT_MLP_STORY_SEED
    )
    resolved_rnn_seed = (
        rnn_seed
        if rnn_seed is not None
        else seed if seed is not None else DEFAULT_RNN_STORY_SEED
    )
    if clean:
        log_progress(f"cleaning output directory {output_dir}")
        clean_output_dir(output_dir)
    ensure_dir(output_dir)
    log_progress(f"starting generation for target={target} in {output_dir}")
    manifest: dict[str, object] = {
        "article": ARTICLE_SLUG,
        "output_dir": str(output_dir),
        "seed": {
            "shared": seed,
            "mlp": resolved_mlp_seed,
            "rnn": resolved_rnn_seed,
        },
    }
    if target in {"all", "mlp"}:
        manifest["mlp"] = render_mlp(
            output_dir=output_dir,
            seed=resolved_mlp_seed,
            mlp_epochs=mlp_epochs,
            mlp_batch_size=mlp_batch_size,
            mlp_shape=mlp_shape,
        )
    if target in {"all", "precision"}:
        manifest["precision"] = render_precision(output_dir=output_dir)
    if target in {"all", "rnn"}:
        manifest["rnn"] = render_rnn(
            output_dir=output_dir,
            seed=resolved_rnn_seed,
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
    target: Literal["all", "mlp", "precision", "rnn"] = typer.Option(
        "all", help="Which artifact set to generate."
    ),
    output_dir: Path = typer.Option(
        DEFAULT_OUTPUT_DIR,
        help="Directory where article-facing assets should be written.",
    ),
    seed: int | None = typer.Option(
        None,
        help="Shared fallback seed. If omitted, the MLP and RNN use their own publication seeds.",
    ),
    mlp_seed: int | None = typer.Option(
        None,
        help=f"Seed for the MLP story. Defaults to {DEFAULT_MLP_STORY_SEED} unless --seed is supplied.",
    ),
    rnn_seed: int | None = typer.Option(
        None,
        help=f"Seed for the RNN story. Defaults to {DEFAULT_RNN_STORY_SEED} unless --seed is supplied.",
    ),
    mlp_epochs: int = typer.Option(400, help="Training epochs for the MLP."),
    mlp_batch_size: int = typer.Option(64, help="Mini-batch size for the MLP."),
    mlp_shape: str = typer.Option(
        ",".join(str(size) for size in MLP_DEFAULT_SHAPE),
        help="Comma-separated hidden-layer widths for the MLP.",
    ),
    rnn_phase_epochs: int = typer.Option(
        DEFAULT_PHASE_EPOCHS,
        help="Base epoch count for the phased torch.RNN schedule (used as 1x, 2x, 2x).",
    ),
    rnn_train_samples: int = typer.Option(
        DEFAULT_TRAIN_SAMPLES,
        help="Resampled training examples per epoch across lengths 10, 20, and 30.",
    ),
    rnn_test_samples: int = typer.Option(
        DEFAULT_TEST_SAMPLES, help="Examples in each fixed RNN evaluation set."
    ),
    clean: bool = typer.Option(
        True,
        "--clean/--no-clean",
        help="Whether to clear the output directory before generating fresh artifacts.",
    ),
) -> None:
    generate_artifacts(
        target=target,
        output_dir=output_dir,
        seed=seed,
        mlp_seed=mlp_seed,
        rnn_seed=rnn_seed,
        mlp_epochs=mlp_epochs,
        mlp_batch_size=mlp_batch_size,
        mlp_shape=mlp_shape,
        rnn_phase_epochs=rnn_phase_epochs,
        rnn_train_samples=rnn_train_samples,
        rnn_test_samples=rnn_test_samples,
        clean=clean,
    )
    manifest_path = output_dir / "manifest.json"
    typer.echo(f"Generated assets for {target} at {output_dir}")
    typer.echo(f"Wrote manifest to {manifest_path}")


def main() -> None:
    app()


if __name__ == "__main__":
    main()
