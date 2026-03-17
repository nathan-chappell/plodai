from dataclasses import dataclass
import json
from pathlib import Path
import random
from textwrap import fill
from typing import Callable, NotRequired, TypeAlias, TypedDict, cast

import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
import torch
from torch import nn
import typer


app = typer.Typer(
    help="Train a tiny stacked RNN on toy languages and render article-ready plots."
)
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
ROOT = Path(__file__).resolve().parent
ARTICLE_SLUG = "15-03-2026-the-theoretical-justification-of-neural-networks"
ARTICLE_DIR = ROOT.parent / ARTICLE_SLUG
DEFAULT_OUTPUT_DIR = ARTICLE_DIR / "images" / "rnn-fractal-demo"
DEFAULT_VARIANT_DIR = ROOT.parents[1] / "tmp" / "rnn-fractal-demo"
BODY_FONT = "Manrope"
DISPLAY_FONT = "Liberation Serif"

TraceSequence: TypeAlias = tuple[str, str]
ModelStateDict: TypeAlias = dict[str, torch.Tensor]


class ModelForwardResult(TypedDict):
    logits: torch.Tensor
    final_hidden: torch.Tensor
    layer_traces: NotRequired[list[torch.Tensor]]


class TrainingHistoryRow(TypedDict):
    epoch: float
    train_loss: float
    train_acc: float
    train_short_loss: float | None
    train_short_acc: float | None
    train_long_loss: float | None
    train_long_acc: float | None
    short_test_loss: float
    short_test_acc: float
    long_test_loss: float
    long_test_acc: float


class ResponseHistoryRow(TypedDict):
    epoch: int
    probabilities: list[float]


class RunSummary(TypedDict):
    device: str
    language: str
    train_samples: int
    test_samples: int
    length_mean: float
    initial_length_mean: float
    short_threshold: int
    max_complexity: int
    short_test_count: int
    long_test_count: int
    note: str
    trace_input_complexities: list[str]
    epochs: int
    batch_size: int
    learning_rate: float
    embedding_dim: int
    hidden_sizes: list[int]
    seed: int
    final_metrics: TrainingHistoryRow
    output_files: list[str]
    trace_cloud_files: list[str]


class RunMetadata(TypedDict):
    runs: list[RunSummary]


TRACE_DEFAULT_INPUTS: tuple[str, ...] = ("(()()(()))(()(()))()",)
SHORT_COMPLEXITY_MAX = 49
LONG_COMPLEXITY_MIN = 50


def seed_everything(seed: int = 7) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


@dataclass(frozen=True)
class LanguageSpec:
    name: str
    alphabet: str
    is_valid: Callable[[str], bool]
    random_valid: Callable[[random.Random, int], str]
    random_invalid: Callable[[random.Random, int], str]
def is_balanced_parentheses(text: str) -> bool:
    balance = 0
    for ch in text:
        if ch not in "()":
            return False
        balance += 1 if ch == "(" else -1
        if balance < 0:
            return False
    return balance == 0 and bool(text)


def sample_balanced_parentheses(rng: random.Random, max_pairs: int) -> str:
    opens = closes = rng.randint(1, max_pairs)
    balance = 0
    out: list[str] = []
    while opens or closes:
        choices = []
        if opens:
            choices.append("(")
        if closes and balance:
            choices.append(")")
        ch = rng.choice(choices)
        out.append(ch)
        if ch == "(":
            opens -= 1
            balance += 1
        else:
            closes -= 1
            balance -= 1
    return "".join(out)


def sample_not_balanced_parentheses(rng: random.Random, max_pairs: int) -> str:
    while True:
        valid = sample_balanced_parentheses(rng, max_pairs)
        strategy = rng.randrange(5)
        if strategy == 0:
            opens = [idx for idx, ch in enumerate(valid) if ch == "("]
            closes = [idx for idx, ch in enumerate(valid) if ch == ")"]
            if opens and closes:
                left = rng.choice(opens)
                right = rng.choice(closes)
                chars = list(valid)
                chars[left], chars[right] = chars[right], chars[left]
                text = "".join(chars)
            else:
                text = ")" + valid[:-1]
        elif strategy == 1:
            flip = rng.randrange(len(valid))
            replacement = ")" if valid[flip] == "(" else "("
            text = valid[:flip] + replacement + valid[flip + 1 :]
        elif strategy == 2 and len(valid) > 3:
            first = rng.randrange(len(valid))
            second = rng.randrange(len(valid))
            while second == first:
                second = rng.randrange(len(valid))
            chars = list(valid)
            chars[first] = ")" if chars[first] == "(" else "("
            chars[second] = ")" if chars[second] == "(" else "("
            text = "".join(chars)
        elif strategy == 3:
            cut = rng.randrange(len(valid))
            text = valid[:cut] + valid[cut + 1 :]
        else:
            text = valid[1:] + valid[:1]
        if not is_balanced_parentheses(text):
            return text


LANGUAGES: dict[str, LanguageSpec] = {
    "balanced_parentheses": LanguageSpec(
        "balanced_parentheses",
        "()",
        is_balanced_parentheses,
        sample_balanced_parentheses,
        sample_not_balanced_parentheses,
    ),
}


def build_vocab(alphabet: str) -> dict[str, int]:
    vocab = {ch: i for i, ch in enumerate(sorted(set(alphabet)))}
    vocab["<EOS>"] = len(vocab)
    return vocab


def encode_batch(
    sequences: list[str], vocab: dict[str, int]
) -> tuple[torch.Tensor, torch.Tensor]:
    eos = vocab["<EOS>"]
    lengths = torch.tensor([len(seq) + 1 for seq in sequences], dtype=torch.long)
    max_len = int(lengths.max().item())
    batch = torch.full((len(sequences), max_len), eos, dtype=torch.long)
    for row, seq in enumerate(sequences):
        batch[row, : len(seq) + 1] = torch.tensor(
            [vocab[ch] for ch in seq] + [eos], dtype=torch.long
        )
    return batch.to(DEVICE), lengths.to(DEVICE)


def sample_dataset(
    spec: LanguageSpec,
    *,
    n_samples: int,
    min_complexity: int,
    max_complexity: int,
    seed: int,
    complexity_sampler: Callable[[random.Random], int] | None = None,
) -> tuple[list[str], torch.Tensor]:
    rng = random.Random(seed)
    sequences: list[str] = []
    labels: list[float] = []
    min_complexity = max(1, min_complexity)
    target_counts = {1.0: n_samples // 2, 0.0: n_samples - (n_samples // 2)}
    for label in (1.0, 0.0):
        generated = 0
        while generated < target_counts[label]:
            target_complexity = (
                max(min_complexity, min(max_complexity, complexity_sampler(rng)))
                if complexity_sampler is not None
                else None
            )
            if label == 1.0:
                candidate = (
                    sample_exact_valid_sequence(
                        spec,
                        complexity=target_complexity,
                        seed=rng.randrange(1_000_000_000),
                    )
                    if target_complexity is not None
                    else spec.random_valid(rng, max_complexity)
                )
            else:
                candidate = (
                    sample_exact_invalid_sequence(
                        spec,
                        complexity=target_complexity,
                        seed=rng.randrange(1_000_000_000),
                    )
                    if target_complexity is not None
                    else spec.random_invalid(rng, max_complexity)
                )
            complexity = sequence_complexity(spec, candidate)
            if min_complexity <= complexity <= max_complexity:
                sequences.append(candidate)
                labels.append(label)
                generated += 1
    paired = list(zip(sequences, labels, strict=False))
    rng.shuffle(paired)
    sequences = [sequence for sequence, _ in paired]
    labels = [label for _, label in paired]
    return sequences, torch.tensor(labels, dtype=torch.float32, device=DEVICE)


def sequence_complexity(spec: LanguageSpec, sequence: str) -> int:
    if spec.name == "balanced_parentheses":
        return len(sequence) // 2
    return len(sequence)


class StackedElmanRNN(nn.Module):
    def __init__(
        self,
        vocab_size: int,
        embedding_dim: int = 8,
        hidden_sizes: tuple[int, ...] = (8, 4),
    ) -> None:
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embedding_dim)
        self.cells = nn.ModuleList()
        in_dim = embedding_dim
        for hidden_dim in hidden_sizes:
            self.cells.append(nn.RNNCell(in_dim, hidden_dim))
            in_dim = hidden_dim
        self.classifier = nn.Linear(hidden_sizes[-1], 1)
        self.hidden_sizes = hidden_sizes

    def forward(
        self,
        tokens: torch.Tensor,
        lengths: torch.Tensor,
        *,
        capture_states: bool = False,
    ) -> ModelForwardResult:
        batch_size, steps = tokens.shape
        embedded = self.embedding(tokens)
        states = [embedded.new_zeros((batch_size, size)) for size in self.hidden_sizes]
        traces: list[list[torch.Tensor]] = [[] for _ in self.hidden_sizes]
        outputs: list[torch.Tensor] = []
        for step in range(steps):
            current = embedded[:, step, :]
            for layer_idx, cell in enumerate(self.cells):
                states[layer_idx] = cell(current, states[layer_idx])
                current = states[layer_idx]
                if capture_states:
                    traces[layer_idx].append(states[layer_idx].detach().cpu())
            outputs.append(current)
        stacked = torch.stack(outputs, dim=1)
        final_hidden = stacked[
            torch.arange(batch_size, device=tokens.device), lengths - 1
        ]
        logits = self.classifier(final_hidden).squeeze(-1)
        result: ModelForwardResult = {
            "logits": logits,
            "final_hidden": final_hidden,
        }
        if capture_states:
            result["layer_traces"] = [torch.stack(layer, dim=1) for layer in traces]
        return result


def accuracy_from_logits(logits: torch.Tensor, labels: torch.Tensor) -> float:
    preds = (logits.sigmoid() >= 0.5).float()
    return float((preds == labels).float().mean().item())


def evaluate_model(
    model: StackedElmanRNN,
    sequences: list[str],
    labels: torch.Tensor,
    vocab: dict[str, int],
) -> tuple[float, float]:
    criterion = nn.BCEWithLogitsLoss()
    model.eval()
    with torch.no_grad():
        tokens, lengths = encode_batch(sequences, vocab)
        logits = model(tokens, lengths)["logits"]
        loss = float(criterion(logits, labels).item())
        acc = accuracy_from_logits(logits, labels)
    return loss, acc


def evaluate_sequence_probabilities(
    model: StackedElmanRNN,
    sequences: list[str],
    vocab: dict[str, int],
) -> list[float]:
    model.eval()
    with torch.no_grad():
        tokens, lengths = encode_batch(sequences, vocab)
        logits = model(tokens, lengths)["logits"]
        return logits.sigmoid().detach().cpu().tolist()


def subset_dataset_by_complexity(
    spec: LanguageSpec,
    sequences: list[str],
    labels: torch.Tensor,
    *,
    min_complexity: int,
    max_complexity: int,
) -> tuple[list[str], torch.Tensor]:
    selected_ids = [
        idx
        for idx, sequence in enumerate(sequences)
        if min_complexity <= sequence_complexity(spec, sequence) <= max_complexity
    ]
    subset_sequences = [sequences[idx] for idx in selected_ids]
    subset_labels = labels[selected_ids]
    return subset_sequences, subset_labels


def train_model(
    model: StackedElmanRNN,
    spec: LanguageSpec,
    train_sequences: list[str],
    train_labels: torch.Tensor,
    short_test_sequences: list[str],
    short_test_labels: torch.Tensor,
    long_test_sequences: list[str],
    long_test_labels: torch.Tensor,
    vocab: dict[str, int],
    *,
    epochs: int,
    batch_size: int,
    lr: float,
    checkpoint_epochs: tuple[int, ...] = (),
    train_dataset_factory: Callable[[int], tuple[list[str], torch.Tensor]]
    | None = None,
    train_short_max_complexity: int | None = None,
    train_long_min_complexity: int | None = None,
    train_long_max_complexity: int | None = None,
    response_probe_sequences: list[str] | None = None,
) -> tuple[
    list[TrainingHistoryRow],
    dict[int, ModelStateDict],
    list[ResponseHistoryRow],
]:
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    criterion = nn.BCEWithLogitsLoss()
    history: list[TrainingHistoryRow] = []
    checkpoints: dict[int, ModelStateDict] = {}
    response_history: list[ResponseHistoryRow] = []
    for epoch in range(1, epochs + 1):
        if train_dataset_factory is not None:
            epoch_train_sequences, epoch_train_labels = train_dataset_factory(epoch)
        else:
            epoch_train_sequences, epoch_train_labels = train_sequences, train_labels
        indices = list(range(len(epoch_train_sequences)))
        random.shuffle(indices)
        model.train()
        for start in range(0, len(indices), batch_size):
            batch_ids = indices[start : start + batch_size]
            seqs = [epoch_train_sequences[i] for i in batch_ids]
            labels = epoch_train_labels[batch_ids]
            tokens, lengths = encode_batch(seqs, vocab)
            optimizer.zero_grad()
            logits = model(tokens, lengths)["logits"]
            loss = criterion(logits, labels)
            loss.backward()
            optimizer.step()
        train_loss, train_acc = evaluate_model(
            model, epoch_train_sequences, epoch_train_labels, vocab
        )
        train_short_loss = train_short_acc = None
        train_long_loss = train_long_acc = None
        if train_short_max_complexity is not None:
            train_short_sequences, train_short_labels = subset_dataset_by_complexity(
                spec,
                epoch_train_sequences,
                epoch_train_labels,
                min_complexity=1,
                max_complexity=train_short_max_complexity,
            )
            if train_short_sequences:
                train_short_loss, train_short_acc = evaluate_model(
                    model,
                    train_short_sequences,
                    train_short_labels,
                    vocab,
                )
        if (
            train_long_min_complexity is not None
            and train_long_max_complexity is not None
        ):
            train_long_sequences, train_long_labels = subset_dataset_by_complexity(
                spec,
                epoch_train_sequences,
                epoch_train_labels,
                min_complexity=train_long_min_complexity,
                max_complexity=train_long_max_complexity,
            )
            if train_long_sequences:
                train_long_loss, train_long_acc = evaluate_model(
                    model,
                    train_long_sequences,
                    train_long_labels,
                    vocab,
                )
        short_test_loss, short_test_acc = evaluate_model(
            model, short_test_sequences, short_test_labels, vocab
        )
        long_test_loss, long_test_acc = evaluate_model(
            model, long_test_sequences, long_test_labels, vocab
        )
        history.append(
            {
                "epoch": float(epoch),
                "train_loss": train_loss,
                "train_acc": train_acc,
                "train_short_loss": train_short_loss,
                "train_short_acc": train_short_acc,
                "train_long_loss": train_long_loss,
                "train_long_acc": train_long_acc,
                "short_test_loss": short_test_loss,
                "short_test_acc": short_test_acc,
                "long_test_loss": long_test_loss,
                "long_test_acc": long_test_acc,
            }
        )
        if response_probe_sequences:
            response_history.append(
                {
                    "epoch": epoch,
                    "probabilities": evaluate_sequence_probabilities(
                        model,
                        response_probe_sequences,
                        vocab,
                    ),
                }
            )
        if epoch in checkpoint_epochs:
            checkpoints[epoch] = {
                key: value.detach().cpu().clone()
                for key, value in model.state_dict().items()
            }
    return history, checkpoints, response_history


def project_with_pca(points: torch.Tensor, dims: int = 2) -> torch.Tensor:
    centered = points - points.mean(dim=0, keepdim=True)
    _, _, v = torch.pca_lowrank(centered, q=max(dims, 2))
    return centered @ v[:, :dims]


def fit_pca_projection(
    points: torch.Tensor,
    dims: int = 2,
) -> tuple[torch.Tensor, torch.Tensor]:
    centered = points - points.mean(dim=0, keepdim=True)
    _, _, v = torch.pca_lowrank(centered, q=max(dims, 2))
    return points.mean(dim=0, keepdim=True), v[:, :dims]


def apply_pca_projection(
    points: torch.Tensor,
    mean: torch.Tensor,
    basis: torch.Tensor,
) -> torch.Tensor:
    return (points - mean) @ basis


def collect_trajectory_embeddings(
    model: StackedElmanRNN,
    sequences: list[str],
    vocab: dict[str, int],
    *,
    layer: int = -1,
) -> list[torch.Tensor]:
    model.eval()
    with torch.no_grad():
        tokens, lengths = encode_batch(sequences, vocab)
        out = model(tokens, lengths, capture_states=True)
        traces = cast(list[torch.Tensor], out["layer_traces"])[layer]
    result = []
    for idx, length in enumerate(lengths.detach().cpu().tolist()):
        result.append(traces[idx, :length, :].clone())
    return result


def symbolic_dust(
    *,
    depth: int = 8,
    digits: tuple[int, int] = (0, 2),
    base: int = 3,
) -> torch.Tensor:
    values = torch.tensor([0.0])
    for _ in range(depth):
        shifted = [(values + digit) / base for digit in digits]
        values = torch.cat(shifted).unique(sorted=True)
    xx, yy = torch.meshgrid(values, values, indexing="xy")
    return torch.stack([xx.flatten(), yy.flatten()], dim=1)


def sample_symbolic_dust(
    *,
    n_points: int = 1000,
    depth: int = 10,
    digits: tuple[int, int] = (0, 2),
    base: int = 3,
    seed: int = 7,
    prefix_depth: int = 0,
) -> torch.Tensor:
    rng = random.Random(seed)
    prefix_depth = max(0, min(prefix_depth, depth))

    def sample_coord() -> float:
        prefix = [rng.choice(digits) for _ in range(prefix_depth)]
        suffix = [rng.choice(digits) for _ in range(depth - prefix_depth)]
        coeffs = prefix + suffix
        return sum(digit * (base ** -(idx + 1)) for idx, digit in enumerate(coeffs))

    points = [(sample_coord(), sample_coord()) for _ in range(n_points)]
    return torch.tensor(points, dtype=torch.float32)


def sample_layered_symbolic_dust(
    *,
    depth: int = 10,
    digits: tuple[int, int] = (0, 2),
    base: int = 3,
    seed: int = 7,
    base_points: int = 64,
) -> tuple[torch.Tensor, torch.Tensor]:
    rng = random.Random(seed)
    all_points: list[torch.Tensor] = []
    all_levels: list[int] = []

    for level in range(1, depth + 1):
        level_points = symbolic_dust(depth=level, digits=digits, base=base)
        n_points = min(base_points * (2 ** (level - 1)), level_points.shape[0])
        if n_points < level_points.shape[0]:
            indices = rng.sample(range(level_points.shape[0]), k=n_points)
            level_points = level_points[indices]
        all_points.append(level_points)
        all_levels.extend([level] * level_points.shape[0])

    return (
        torch.cat(all_points, dim=0),
        torch.tensor(all_levels, dtype=torch.long),
    )


def use_pretty_style() -> None:
    plt.style.use("default")
    plt.rcParams.update(
        {
            "figure.figsize": (9.5, 5.8),
            "figure.dpi": 220,
            "axes.facecolor": "#f1f3f5",
            "figure.facecolor": "#f1f3f5",
            "savefig.facecolor": "#f1f3f5",
            "savefig.bbox": "tight",
            "axes.edgecolor": "#324152",
            "axes.labelcolor": "#223244",
            "xtick.color": "#425466",
            "ytick.color": "#425466",
            "axes.titleweight": "semibold",
            "axes.titlesize": 16,
            "axes.labelsize": 11.5,
            "grid.color": "#cbd3dd",
            "grid.alpha": 0.65,
            "grid.linestyle": "-",
            "font.size": 11,
            "font.family": "sans-serif",
            "font.sans-serif": [BODY_FONT, "DejaVu Sans", "Arial"],
        }
    )


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_history_plot(history: list[TrainingHistoryRow], path: Path) -> None:
    epochs = [int(row["epoch"]) for row in history]
    fig, axes = plt.subplots(1, 2, figsize=(11.2, 4.3))
    axes[0].plot(
        epochs,
        [row["train_loss"] for row in history],
        label="train",
        color="#9b4d2f",
        lw=1.8,
    )
    axes[0].plot(
        epochs,
        [row["short_test_loss"] for row in history],
        label="short test",
        color="#245f73",
        lw=1.8,
    )
    axes[0].plot(
        epochs,
        [row["long_test_loss"] for row in history],
        label="long test",
        color="#8d7c5b",
        lw=1.5,
        linestyle="--",
    )
    axes[0].set_title("Loss", fontfamily=DISPLAY_FONT)
    axes[0].grid(True)
    axes[0].legend(frameon=False)
    axes[1].plot(
        epochs,
        [row["train_acc"] for row in history],
        label="train",
        color="#9b4d2f",
        lw=1.8,
    )
    axes[1].plot(
        epochs,
        [row["short_test_acc"] for row in history],
        label="short test",
        color="#245f73",
        lw=1.8,
    )
    axes[1].plot(
        epochs,
        [row["long_test_acc"] for row in history],
        label="long test",
        color="#8d7c5b",
        lw=1.5,
        linestyle="--",
    )
    axes[1].set_title("Accuracy", fontfamily=DISPLAY_FONT)
    axes[1].set_ylim(0.0, 1.02)
    axes[1].grid(True)
    axes[1].legend(frameon=False)
    fig.suptitle("Training Curves", fontfamily=DISPLAY_FONT, fontsize=18)
    fig.savefig(path)
    plt.close(fig)


def save_dataset_distribution_plot(
    spec: LanguageSpec,
    datasets: list[tuple[str, list[str], torch.Tensor]],
    path: Path,
    *,
    short_threshold: int | None = None,
) -> None:
    fig, axes = plt.subplots(
        1, len(datasets), figsize=(4.4 * len(datasets), 3.7), sharey=True
    )
    if len(datasets) == 1:
        axes = [axes]

    palette = {0.0: "#245f73", 1.0: "#c46a2d"}
    label_names = {0.0: "invalid", 1.0: "valid"}

    for ax, (name, sequences, labels) in zip(axes, datasets):
        buckets = {0.0: [], 1.0: []}
        for seq, label in zip(sequences, labels.detach().cpu().tolist(), strict=False):
            buckets[float(label)].append(sequence_complexity(spec, seq))

        xs = sorted(set(buckets[0.0]) | set(buckets[1.0]))
        if not xs:
            continue
        min_x = xs[0]
        max_x = xs[-1]
        span = max_x - min_x + 1
        bin_width = max(3, int(round(span / 10)))
        bin_edges = [min_x - 0.5]
        edge = min_x - 0.5
        while edge < max_x + 0.5:
            edge += bin_width
            bin_edges.append(edge)
        for label in (0.0, 1.0):
            ax.hist(
                buckets[label],
                bins=bin_edges,
                color=palette[label],
                alpha=0.58,
                edgecolor="#f1f3f5",
                linewidth=0.8,
                label=label_names[label],
            )
        if short_threshold is not None:
            ax.axvline(
                short_threshold + 0.5,
                color="#5b6470",
                linestyle="--",
                linewidth=1.2,
                alpha=0.9,
            )
        ax.set_title(name, fontfamily=DISPLAY_FONT)
        ax.set_xlabel("complexity")
        ax.grid(True)
        ax.legend(frameon=False)

    axes[0].set_ylabel("count")
    fig.suptitle(
        f"{spec.name}: dataset distribution", fontfamily=DISPLAY_FONT, fontsize=17
    )
    fig.savefig(path)
    plt.close(fig)


def short_threshold_from_mean(length_mean: float) -> int:
    _ = length_mean
    return SHORT_COMPLEXITY_MAX


def max_complexity_from_mean(length_mean: float) -> int:
    short_threshold = short_threshold_from_mean(length_mean)
    return max(short_threshold + 8, int(round(length_mean * 6.0)))


def initial_length_mean_from_target(length_mean: float) -> float:
    return max(4.0, length_mean * 0.45)


def ramped_length_mean(
    epoch: int,
    *,
    epochs: int,
    initial_length_mean: float,
    target_length_mean: float,
) -> float:
    if epochs <= 1:
        return target_length_mean
    progress = (epoch - 1) / (epochs - 1)
    return initial_length_mean + (target_length_mean - initial_length_mean) * progress


def characteristic_parenthesis_strings(n_strings: int = 25) -> list[str]:
    valid_strings: list[str] = []
    invalid_strings: list[str] = []
    length = 1
    while len(valid_strings) < n_strings or len(invalid_strings) < n_strings:
        for value in range(2**length):
            bits = format(value, f"0{length}b")
            sequence = "".join("(" if bit == "0" else ")" for bit in bits)
            if is_balanced_parentheses(sequence):
                valid_strings.append(sequence)
            else:
                invalid_strings.append(sequence)
        length += 1

    output: list[str] = []
    valid_idx = 0
    invalid_idx = 0
    while len(output) < n_strings:
        for _ in range(2):
            if len(output) >= n_strings or valid_idx >= len(valid_strings):
                break
            output.append(valid_strings[valid_idx])
            valid_idx += 1
        if len(output) < n_strings and invalid_idx < len(invalid_strings):
            output.append(invalid_strings[invalid_idx])
            invalid_idx += 1
    return output


def save_response_bifurcation_plot(
    history: list[ResponseHistoryRow],
    sequences: list[str],
    spec: LanguageSpec,
    path: Path,
) -> None:
    if not history or not sequences:
        return
    epochs = [int(row["epoch"]) for row in history]
    fig, ax = plt.subplots(figsize=(8.4, 5.2))
    valid_color = "#c46a2d"
    invalid_color = "#245f73"
    labeled_valid = False
    labeled_invalid = False
    for idx, sequence in enumerate(sequences):
        ys = [float(row["probabilities"][idx]) for row in history]
        is_valid = spec.is_valid(sequence)
        color = valid_color if is_valid else invalid_color
        label = None
        if is_valid and not labeled_valid:
            label = "valid"
            labeled_valid = True
        elif not is_valid and not labeled_invalid:
            label = "invalid"
            labeled_invalid = True
        ax.plot(
            epochs,
            ys,
            color=color,
            lw=1.05,
            alpha=0.78,
            label=label,
        )
    ax.set_title("Balanced Parentheses Response Diagram", fontfamily=DISPLAY_FONT)
    ax.set_xlabel("epoch")
    ax.set_ylabel("model output")
    ax.set_ylim(-0.02, 1.02)
    ax.grid(True)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.legend(frameon=False, loc="upper left")
    fig.savefig(path)
    plt.close(fig)


def sample_exact_valid_sequence(
    spec: LanguageSpec,
    *,
    complexity: int,
    seed: int,
) -> str:
    rng = random.Random(seed)
    while True:
        candidate = spec.random_valid(rng, complexity)
        if sequence_complexity(spec, candidate) == complexity:
            return candidate


def sample_exact_invalid_sequence(
    spec: LanguageSpec,
    *,
    complexity: int,
    seed: int,
) -> str:
    rng = random.Random(seed)
    max_complexity = max(1, complexity)
    while True:
        candidate = spec.random_invalid(rng, max_complexity)
        if sequence_complexity(spec, candidate) == complexity:
            return candidate


def default_trace_epochs(epochs: int, n_snapshots: int = 10) -> tuple[int, ...]:
    checkpoints = [
        max(1, int(round(value)))
        for value in torch.linspace(1, epochs, steps=max(2, n_snapshots)).tolist()
    ]
    unique: list[int] = []
    for checkpoint in sorted(checkpoints):
        if checkpoint not in unique:
            unique.append(checkpoint)
    return tuple(unique)


def parse_trace_inputs(text: str, *, name: str) -> tuple[str, ...]:
    values = tuple(part.strip() for part in text.split(",") if part.strip())
    if not values:
        raise typer.BadParameter(
            f"{name} must be a comma-separated list of trace items"
        )
    return values


def build_truncated_exponential_sampler(
    *,
    mean: float,
    min_complexity: int,
    max_complexity: int,
) -> Callable[[random.Random], int]:
    if mean <= 0:
        raise typer.BadParameter("means must be positive")

    def sample(rng: random.Random) -> int:
        while True:
            complexity = max(1, int(round(rng.expovariate(1.0 / mean))))
            if min_complexity <= complexity <= max_complexity:
                return complexity

    return sample


def build_trace_sequences(
    spec: LanguageSpec,
    *,
    trace_inputs: tuple[str, ...],
    seed: int,
) -> list[TraceSequence]:
    chosen = trace_inputs if trace_inputs else TRACE_DEFAULT_INPUTS
    sequences: list[TraceSequence] = []
    valid_count = 0
    invalid_count = 0
    for idx, trace_input in enumerate(chosen):
        if trace_input.isdigit():
            complexity = int(trace_input)
            sequence = sample_exact_valid_sequence(
                spec,
                complexity=complexity,
                seed=seed + 800 + idx,
            )
            valid_count += 1
            sequences.append((f"valid-{valid_count} (c={complexity})", sequence))
            continue
        if spec.is_valid(trace_input):
            valid_count += 1
            label = (
                f"valid-{valid_count} (c={sequence_complexity(spec, trace_input)})"
            )
        else:
            invalid_count += 1
            label = (
                f"invalid-{invalid_count} (c={sequence_complexity(spec, trace_input)})"
            )
        sequences.append((label, trace_input))
    return sequences


def slugify_trace_label(label: str) -> str:
    return (
        label.lower()
        .replace(" ", "-")
        .replace("(", "")
        .replace(")", "")
        .replace("=", "")
    )


def save_trace_checkpoint_clouds(
    build_model: Callable[[], StackedElmanRNN],
    checkpoint_states: dict[int, ModelStateDict],
    spec: LanguageSpec,
    vocab: dict[str, int],
    output_dir: Path,
    *,
    trace_sequences: list[TraceSequence],
    layer: int = -1,
) -> list[str]:
    filenames: list[str] = []
    trace_maps = [
        LinearSegmentedColormap.from_list("trace_a", ["#0f766e", "#2dd4bf"]),
        LinearSegmentedColormap.from_list("trace_b", ["#9a3412", "#fb7185"]),
        LinearSegmentedColormap.from_list("trace_c", ["#4338ca", "#a855f7"]),
    ]
    checkpoint_trajectories: dict[int, list[torch.Tensor]] = {}
    all_points: list[torch.Tensor] = []
    for epoch in sorted(checkpoint_states):
        model = build_model().to(DEVICE)
        model.load_state_dict(checkpoint_states[epoch])
        trajectories = collect_trajectory_embeddings(
            model,
            [sequence for _, sequence in trace_sequences],
            vocab,
            layer=layer,
        )
        checkpoint_trajectories[epoch] = trajectories
        all_points.append(torch.cat(trajectories, dim=0))

    projection_mean, projection_basis = fit_pca_projection(torch.cat(all_points, dim=0))

    for epoch in sorted(checkpoint_states):
        trajectories = checkpoint_trajectories[epoch]
        flat = torch.cat(trajectories, dim=0)
        projected = apply_pca_projection(flat, projection_mean, projection_basis)
        splits = []
        start = 0
        for traj in trajectories:
            stop = start + traj.shape[0]
            splits.append(projected[start:stop])
            start = stop

        for idx, ((label, sequence), path_points) in enumerate(
            zip(trace_sequences, splits, strict=False)
        ):
            keep = min(72, path_points.shape[0])
            indices = (
                torch.linspace(0, path_points.shape[0] - 1, steps=keep).round().long()
            )
            simplified = path_points[indices]
            progress = torch.linspace(0.0, 1.0, simplified.shape[0])
            point_sizes = torch.linspace(16.0, 60.0, simplified.shape[0])
            cmap = trace_maps[idx % len(trace_maps)]
            fig, ax = plt.subplots(figsize=(6.2, 5.8))
            fig.subplots_adjust(bottom=0.22)
            ax.plot(
                simplified[:, 0],
                simplified[:, 1],
                color=cmap(0.18),
                lw=1.8,
                alpha=0.38,
            )
            ax.scatter(
                simplified[:, 0],
                simplified[:, 1],
                s=point_sizes.tolist(),
                c=progress,
                cmap=cmap,
                alpha=0.88,
                linewidths=0,
                label=label,
            )
            for point_id, point_idx in enumerate(indices.tolist()):
                step = point_idx + 1
                if (
                    step % 5 != 0
                    or point_id == 0
                    or point_id == simplified.shape[0] - 1
                ):
                    continue
                ax.text(
                    float(simplified[point_id, 0]),
                    float(simplified[point_id, 1]),
                    str(step),
                    fontsize=7.2,
                    color="#1f2933",
                    ha="center",
                    va="center",
                    bbox={
                        "boxstyle": "round,pad=0.18",
                        "facecolor": "#f8fafc",
                        "edgecolor": "none",
                        "alpha": 0.78,
                    },
                )
            ax.scatter(
                simplified[0:1, 0],
                simplified[0:1, 1],
                s=54,
                color=cmap(0.02),
                marker="o",
                linewidths=0,
            )
            ax.scatter(
                simplified[-1:, 0],
                simplified[-1:, 1],
                s=66,
                color=cmap(0.98),
                marker="X",
                linewidths=0,
            )
            ax.text(
                float(simplified[0, 0]),
                float(simplified[0, 1]),
                "start",
                fontsize=8,
                color="#0f172a",
                ha="left",
                va="bottom",
            )
            ax.text(
                float(simplified[-1, 0]),
                float(simplified[-1, 1]),
                "end",
                fontsize=8,
                color="#0f172a",
                ha="left",
                va="bottom",
            )
            ax.set_title(
                f"{spec.name}: {label} at epoch {epoch}",
                fontfamily=DISPLAY_FONT,
            )
            ax.set_xlabel("PC1")
            ax.set_ylabel("PC2")
            ax.grid(True)
            ax.spines["top"].set_visible(False)
            ax.spines["right"].set_visible(False)
            ax.legend(frameon=False, loc="best")
            fig.text(
                0.5,
                0.05,
                fill(sequence, width=34),
                ha="center",
                va="bottom",
                fontsize=7.6,
                family="monospace",
                color="#334155",
            )
            filename = (
                f"{spec.name}-trace-{slugify_trace_label(label)}-epoch-{epoch:03d}.png"
            )
            fig.savefig(output_dir / filename)
            plt.close(fig)
            filenames.append(filename)
    return filenames


def save_dust_plot(
    points: torch.Tensor,
    path: Path,
    *,
    title: str,
    levels: torch.Tensor | None = None,
) -> None:
    fig, ax = plt.subplots(figsize=(5.9, 5.9))
    if levels is None:
        ax.scatter(
            points[:, 0],
            points[:, 1],
            s=4.6,
            color="#245f73",
            alpha=0.72,
            linewidths=0,
        )
    else:
        max_level = int(levels.max().item())
        cmap = LinearSegmentedColormap.from_list(
            "dust_layers", ["#c79a2b", "#7a6d59", "#174c63"]
        )
        for level in range(1, max_level + 1):
            mask = levels == level
            color = cmap((level - 1) / max(1, max_level - 1))
            size = max(1.2, 12.0 / (level**0.55))
            alpha = min(0.82, 0.22 + 0.05 * level)
            ax.scatter(
                points[mask, 0],
                points[mask, 1],
                s=size,
                color=color,
                alpha=alpha,
                linewidths=0,
            )
    ax.set_title(title, fontfamily=DISPLAY_FONT)
    ax.set_aspect("equal")
    ax.grid(False)
    ax.set_xlim(-0.03, 1.03)
    ax.set_ylim(-0.03, 1.03)
    ax.set_xticks([0.0, 0.5, 1.0])
    ax.set_yticks([0.0, 0.5, 1.0])
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    fig.savefig(path)
    plt.close(fig)


def parse_digits(text: str) -> tuple[int, int]:
    parts = [int(part.strip()) for part in text.split(",")]
    if len(parts) != 2:
        raise typer.BadParameter("digits must look like '0,2'")
    return parts[0], parts[1]


def parse_hidden_sizes(text: str) -> tuple[int, ...]:
    sizes = tuple(int(part.strip()) for part in text.split(",") if part.strip())
    if not sizes or any(size <= 0 for size in sizes):
        raise typer.BadParameter(
            "hidden-sizes must look like '6,4' with positive integers"
        )
    return sizes


def metadata_path(output_dir: Path) -> Path:
    return output_dir / "run-metadata.json"


def parse_languages(text: str) -> list[str]:
    if text == "all":
        return list(LANGUAGES)
    languages = [part.strip() for part in text.split(",") if part.strip()]
    for language in languages:
        if language not in LANGUAGES:
            raise typer.BadParameter(f"unknown language '{language}'")
    return languages


@app.command()
def train(
    language: str = typer.Option(
        "balanced_parentheses",
        help=f"Comma-separated languages or 'all'. Options: {', '.join(sorted(LANGUAGES))}",
    ),
    output_dir: Path = typer.Option(
        DEFAULT_OUTPUT_DIR, help="Directory for generated images."
    ),
    train_samples: int = typer.Option(
        100, help="Fresh training samples drawn per epoch."
    ),
    test_samples: int = typer.Option(1000, help="Evaluation samples."),
    length_mean: float = typer.Option(
        18.0, help="Exponential mean for sampled string complexities."
    ),
    epochs: int = typer.Option(300, help="Training epochs."),
    batch_size: int = typer.Option(8, help="Batch size."),
    lr: float = typer.Option(5e-3, help="Learning rate."),
    embedding_dim: int = typer.Option(6, help="Embedding width for each symbol."),
    hidden_sizes: str = typer.Option(
        "8,6,4", help="Comma-separated hidden sizes, e.g. '6,4'."
    ),
    trace_input_complexities: str = typer.Option(
        ",".join(TRACE_DEFAULT_INPUTS),
        help="Comma-separated trace items: exact strings are used as-is, while integers request valid strings of that complexity.",
    ),
    seed: int = typer.Option(7, help="Random seed."),
    trace_output_dir: Path = typer.Option(
        DEFAULT_VARIANT_DIR, help="Directory for trace-cloud variants."
    ),
) -> None:
    seed_everything(seed)
    use_pretty_style()
    if length_mean <= 0:
        raise typer.BadParameter("length-mean must be positive")
    parsed_hidden_sizes = parse_hidden_sizes(hidden_sizes)
    parsed_trace_inputs = (
        parse_trace_inputs(
            trace_input_complexities,
            name="trace-input-complexities",
        )
        if trace_input_complexities.strip()
        else ()
    )
    output_dir = ensure_dir(output_dir)
    trace_output_dir = ensure_dir(trace_output_dir)
    languages = parse_languages(language)
    summaries: list[RunSummary] = []
    for idx, language_name in enumerate(languages):
        spec = LANGUAGES[language_name]
        vocab = build_vocab(spec.alphabet)
        response_probe_sequences = characteristic_parenthesis_strings(40)
        initial_length_mean = initial_length_mean_from_target(length_mean)
        short_threshold = short_threshold_from_mean(length_mean)
        max_complexity = max_complexity_from_mean(length_mean)
        short_test_sampler = build_truncated_exponential_sampler(
            mean=length_mean,
            min_complexity=1,
            max_complexity=short_threshold,
        )
        long_test_sampler = build_truncated_exponential_sampler(
            mean=max(length_mean * 4.0, float(LONG_COMPLEXITY_MIN + 10)),
            min_complexity=LONG_COMPLEXITY_MIN,
            max_complexity=max_complexity,
        )
        initial_train_sampler = build_truncated_exponential_sampler(
            mean=initial_length_mean,
            min_complexity=1,
            max_complexity=max_complexity,
        )
        train_sequences, train_labels = sample_dataset(
            spec,
            n_samples=train_samples,
            min_complexity=1,
            max_complexity=max_complexity,
            seed=seed + idx * 101,
            complexity_sampler=initial_train_sampler,
        )
        short_test_sequences, short_test_labels = sample_dataset(
            spec,
            n_samples=test_samples,
            min_complexity=1,
            max_complexity=short_threshold,
            seed=seed + idx * 101 + 11,
            complexity_sampler=short_test_sampler,
        )
        long_test_sequences, long_test_labels = sample_dataset(
            spec,
            n_samples=test_samples,
            min_complexity=LONG_COMPLEXITY_MIN,
            max_complexity=max_complexity,
            seed=seed + idx * 101 + 23,
            complexity_sampler=long_test_sampler,
        )

        model = StackedElmanRNN(
            vocab_size=len(vocab),
            embedding_dim=embedding_dim,
            hidden_sizes=parsed_hidden_sizes,
        ).to(DEVICE)
        checkpoint_epochs = default_trace_epochs(epochs)

        def make_epoch_train_dataset(epoch: int) -> tuple[list[str], torch.Tensor]:
            epoch_length_mean = ramped_length_mean(
                epoch,
                epochs=epochs,
                initial_length_mean=initial_length_mean,
                target_length_mean=length_mean,
            )
            epoch_sampler = build_truncated_exponential_sampler(
                mean=epoch_length_mean,
                min_complexity=1,
                max_complexity=max_complexity,
            )
            return sample_dataset(
                spec,
                n_samples=train_samples,
                min_complexity=1,
                max_complexity=max_complexity,
                seed=seed + idx * 101 + epoch * 1009,
                complexity_sampler=epoch_sampler,
            )

        history, checkpoint_states, response_history = train_model(
            model,
            spec,
            train_sequences,
            train_labels,
            short_test_sequences,
            short_test_labels,
            long_test_sequences,
            long_test_labels,
            vocab,
            epochs=epochs,
            batch_size=batch_size,
            lr=lr,
            checkpoint_epochs=checkpoint_epochs,
            train_dataset_factory=make_epoch_train_dataset,
            train_short_max_complexity=short_threshold,
            train_long_min_complexity=short_threshold + 1,
            train_long_max_complexity=max_complexity,
            response_probe_sequences=response_probe_sequences,
        )

        save_history_plot(history, output_dir / f"{language_name}-training-curves.png")
        save_dataset_distribution_plot(
            spec,
            [
                ("train", train_sequences, train_labels),
                ("short test", short_test_sequences, short_test_labels),
                ("long test", long_test_sequences, long_test_labels),
            ],
            output_dir / f"{language_name}-dataset-distribution.png",
            short_threshold=short_threshold,
        )
        response_plot_file = f"{language_name}-response-bifurcation.png"
        save_response_bifurcation_plot(
            response_history,
            response_probe_sequences,
            spec,
            output_dir / response_plot_file,
        )
        trace_sequences = build_trace_sequences(
            spec,
            trace_inputs=parsed_trace_inputs,
            seed=seed + idx * 101,
        )
        trace_files = save_trace_checkpoint_clouds(
            lambda: StackedElmanRNN(
                vocab_size=len(vocab),
                embedding_dim=embedding_dim,
                hidden_sizes=parsed_hidden_sizes,
            ),
            checkpoint_states,
            spec,
            vocab,
            trace_output_dir,
            trace_sequences=trace_sequences,
        )
        summary: RunSummary = {
            "device": DEVICE,
            "language": language_name,
            "train_samples": train_samples,
            "test_samples": test_samples,
            "length_mean": length_mean,
            "initial_length_mean": initial_length_mean,
            "short_threshold": short_threshold,
            "max_complexity": max_complexity,
            "short_test_count": len(short_test_sequences),
            "long_test_count": len(long_test_sequences),
            "note": "Short and long evaluation sets are sampled once up front with a fixed split at complexity 50, while the training mean ramps upward over time.",
            "trace_input_complexities": list(parsed_trace_inputs),
            "epochs": epochs,
            "batch_size": batch_size,
            "learning_rate": lr,
            "embedding_dim": embedding_dim,
            "hidden_sizes": list(parsed_hidden_sizes),
            "seed": seed + idx * 101,
            "final_metrics": history[-1],
            "output_files": [
                f"{language_name}-training-curves.png",
                f"{language_name}-dataset-distribution.png",
            ]
            + [response_plot_file],
            "trace_cloud_files": trace_files,
        }
        (output_dir / f"{language_name}-run-metadata.json").write_text(
            json.dumps(summary, indent=2)
        )
        summaries.append(summary)
        typer.echo(f"Saved {language_name} outputs to {output_dir}")
        typer.echo(json.dumps(summary["final_metrics"], indent=2))

    metadata: RunMetadata = {"runs": summaries}
    metadata_path(output_dir).write_text(json.dumps(metadata, indent=2))


@app.command()
def dust(
    output_dir: Path = typer.Option(
        DEFAULT_OUTPUT_DIR, help="Directory for generated images."
    ),
    depth: int = typer.Option(10, help="Exact symbolic depth."),
    points: int = typer.Option(1000, help="Number of sampled points."),
    base: int = typer.Option(3, help="Geometric base."),
    digits: str = typer.Option("0,2", help="Two digits, e.g. '0,2' or '0,1'."),
    seed: int = typer.Option(7, help="Random seed."),
    prefix_depth: int = typer.Option(
        0, help="Force a shared prefix depth before sampling the remainder."
    ),
    layered: bool = typer.Option(
        True, help="Render dust as layered symbolic accumulation."
    ),
    base_points: int = typer.Option(
        64, help="Base count for the first layer in layered mode."
    ),
    title: str = typer.Option("Symbolic Dust", help="Plot title."),
) -> None:
    use_pretty_style()
    output_dir = ensure_dir(output_dir)
    digit_pair = parse_digits(digits)
    if layered:
        point_cloud, levels = sample_layered_symbolic_dust(
            depth=depth,
            digits=digit_pair,
            base=base,
            seed=seed,
            base_points=base_points,
        )
    else:
        point_cloud = sample_symbolic_dust(
            n_points=points,
            depth=depth,
            digits=digit_pair,
            base=base,
            seed=seed,
            prefix_depth=prefix_depth,
        )
        levels = None
    filename = f"dust-depth{depth}-base{base}-digits{digit_pair[0]}{digit_pair[1]}" + (
        f"-layered-basepts{base_points}.png"
        if layered
        else f"-points{points}-prefix{prefix_depth}.png"
    )
    save_dust_plot(point_cloud, output_dir / filename, title=title, levels=levels)
    typer.echo(f"Saved {filename} to {output_dir}")


def main() -> None:
    app()


if __name__ == "__main__":
    main()
