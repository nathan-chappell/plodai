from dataclasses import dataclass
import json
from pathlib import Path
import random
from typing import Callable

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
DISPLAY_FONT = "Fraunces"


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


def is_odd_parity(text: str) -> bool:
    return set(text).issubset({"0", "1"}) and text.count("1") % 2 == 1


def sample_odd_parity(rng: random.Random, max_len: int) -> str:
    length = rng.randint(1, max_len)
    bits = [rng.choice("01") for _ in range(length)]
    if bits.count("1") % 2 == 0:
        flip = rng.randrange(length)
        bits[flip] = "1" if bits[flip] == "0" else "0"
    return "".join(bits)


def sample_not_odd_parity(rng: random.Random, max_len: int) -> str:
    while True:
        text = "".join(rng.choice("01") for _ in range(rng.randint(1, max_len)))
        if not is_odd_parity(text):
            return text


def is_anbn(text: str) -> bool:
    if not text or set(text) - {"a", "b"}:
        return False
    idx = 0
    while idx < len(text) and text[idx] == "a":
        idx += 1
    a_count = idx
    b_count = len(text) - idx
    return a_count > 0 and text[idx:] == "b" * b_count and a_count == b_count


def sample_anbn(rng: random.Random, max_pairs: int) -> str:
    n = rng.randint(1, max_pairs)
    return "a" * n + "b" * n


def sample_not_anbn(rng: random.Random, max_pairs: int) -> str:
    while True:
        if rng.random() < 0.6:
            a_count = rng.randint(1, max_pairs + 1)
            b_count = rng.randint(1, max_pairs + 1)
            if a_count == b_count:
                b_count += 1
            text = "a" * a_count + "b" * b_count
        else:
            left = rng.randint(1, max_pairs)
            middle = rng.randint(1, max_pairs)
            right = rng.randint(1, max_pairs)
            text = "a" * left + "b" * middle + "a" * right
        if not is_anbn(text):
            return text


def is_dyck1(text: str) -> bool:
    balance = 0
    for ch in text:
        if ch not in "()":
            return False
        balance += 1 if ch == "(" else -1
        if balance < 0:
            return False
    return balance == 0 and bool(text)


def sample_dyck1(rng: random.Random, max_pairs: int) -> str:
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


def sample_not_dyck1(rng: random.Random, max_pairs: int) -> str:
    while True:
        valid = sample_dyck1(rng, max_pairs)
        strategy = rng.randrange(4)
        if strategy == 0:
            text = ")" + valid
        elif strategy == 1:
            text = valid + "("
        elif strategy == 2:
            cut = rng.randrange(len(valid))
            text = valid[:cut] + valid[cut + 1 :]
        else:
            flip = rng.randrange(len(valid))
            replacement = ")" if valid[flip] == "(" else "("
            text = valid[:flip] + replacement + valid[flip + 1 :]
        if not is_dyck1(text):
            return text


LANGUAGES: dict[str, LanguageSpec] = {
    "odd_parity": LanguageSpec(
        "odd_parity", "01", is_odd_parity, sample_odd_parity, sample_not_odd_parity
    ),
    "anbn": LanguageSpec("anbn", "ab", is_anbn, sample_anbn, sample_not_anbn),
    "dyck1": LanguageSpec("dyck1", "()", is_dyck1, sample_dyck1, sample_not_dyck1),
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
) -> tuple[list[str], torch.Tensor]:
    rng = random.Random(seed)
    sequences: list[str] = []
    labels: list[float] = []
    min_complexity = max(1, min_complexity)
    while len(sequences) < n_samples:
        if rng.random() < 0.5:
            candidate = spec.random_valid(rng, max_complexity)
            label = 1.0
        else:
            candidate = spec.random_invalid(rng, max_complexity)
            label = 0.0
        complexity = sequence_complexity(spec, candidate)
        if min_complexity <= complexity <= max_complexity:
            sequences.append(candidate)
            labels.append(label)
    return sequences, torch.tensor(labels, dtype=torch.float32, device=DEVICE)


def sequence_complexity(spec: LanguageSpec, sequence: str) -> int:
    if spec.name in {"anbn", "dyck1"}:
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
    ) -> dict[str, torch.Tensor | list[torch.Tensor]]:
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
        result: dict[str, torch.Tensor | list[torch.Tensor]] = {
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


def train_model(
    model: StackedElmanRNN,
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
) -> list[dict[str, float]]:
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    criterion = nn.BCEWithLogitsLoss()
    history: list[dict[str, float]] = []
    indices = list(range(len(train_sequences)))
    for epoch in range(1, epochs + 1):
        random.shuffle(indices)
        model.train()
        losses: list[float] = []
        accs: list[float] = []
        for start in range(0, len(indices), batch_size):
            batch_ids = indices[start : start + batch_size]
            seqs = [train_sequences[i] for i in batch_ids]
            labels = train_labels[batch_ids]
            tokens, lengths = encode_batch(seqs, vocab)
            optimizer.zero_grad()
            logits = model(tokens, lengths)["logits"]
            loss = criterion(logits, labels)
            loss.backward()
            optimizer.step()
            losses.append(float(loss.item()))
            accs.append(accuracy_from_logits(logits.detach(), labels))
        short_test_loss, short_test_acc = evaluate_model(
            model, short_test_sequences, short_test_labels, vocab
        )
        long_test_loss, long_test_acc = evaluate_model(
            model, long_test_sequences, long_test_labels, vocab
        )
        history.append(
            {
                "epoch": float(epoch),
                "train_loss": sum(losses) / len(losses),
                "train_acc": sum(accs) / len(accs),
                "short_test_loss": short_test_loss,
                "short_test_acc": short_test_acc,
                "long_test_loss": long_test_loss,
                "long_test_acc": long_test_acc,
            }
        )
    return history


def project_with_pca(points: torch.Tensor, dims: int = 2) -> torch.Tensor:
    centered = points - points.mean(dim=0, keepdim=True)
    _, _, v = torch.pca_lowrank(centered, q=max(dims, 2))
    return centered @ v[:, :dims]


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
        traces = out["layer_traces"][layer]
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
            "axes.facecolor": "#fbfaf8",
            "figure.facecolor": "#fbfaf8",
            "savefig.facecolor": "#fbfaf8",
            "savefig.bbox": "tight",
            "axes.edgecolor": "#332c26",
            "axes.labelcolor": "#2b2622",
            "xtick.color": "#4a4138",
            "ytick.color": "#4a4138",
            "axes.titleweight": "semibold",
            "axes.titlesize": 16,
            "axes.labelsize": 11.5,
            "grid.color": "#dfd6ca",
            "grid.alpha": 0.42,
            "grid.linestyle": "-",
            "font.size": 11,
            "font.family": "sans-serif",
            "font.sans-serif": [BODY_FONT, "DejaVu Sans", "Arial"],
        }
    )


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_history_plot(history: list[dict[str, float]], path: Path) -> None:
    epochs = [int(row["epoch"]) for row in history]
    fig, axes = plt.subplots(1, 2, figsize=(11.2, 4.3))
    axes[0].plot(
        epochs,
        [row["train_loss"] for row in history],
        label="train",
        color="#9b4d2f",
        lw=2.6,
    )
    axes[0].plot(
        epochs,
        [row["short_test_loss"] for row in history],
        label="short test",
        color="#245f73",
        lw=2.6,
    )
    axes[0].plot(
        epochs,
        [row["long_test_loss"] for row in history],
        label="long test",
        color="#8d7c5b",
        lw=2.1,
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
        lw=2.6,
    )
    axes[1].plot(
        epochs,
        [row["short_test_acc"] for row in history],
        label="short test",
        color="#245f73",
        lw=2.6,
    )
    axes[1].plot(
        epochs,
        [row["long_test_acc"] for row in history],
        label="long test",
        color="#8d7c5b",
        lw=2.1,
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
) -> None:
    fig, axes = plt.subplots(
        1, len(datasets), figsize=(4.4 * len(datasets), 3.7), sharey=True
    )
    if len(datasets) == 1:
        axes = [axes]

    palette = {0.0: "#245f73", 1.0: "#c46a2d"}
    label_names = {0.0: "invalid", 1.0: "valid"}

    for ax, (name, sequences, labels) in zip(axes, datasets):
        buckets = {0.0: {}, 1.0: {}}
        for seq, label in zip(sequences, labels.detach().cpu().tolist()):
            complexity = sequence_complexity(spec, seq)
            buckets[float(label)][complexity] = buckets[float(label)].get(complexity, 0) + 1

        xs = sorted(set(buckets[0.0]) | set(buckets[1.0]))
        for label in (0.0, 1.0):
            ys = [buckets[label].get(x, 0) for x in xs]
            ax.plot(
                xs,
                ys,
                color=palette[label],
                lw=2.2,
                marker="o",
                ms=3.0,
                label=label_names[label],
            )
        ax.set_title(name, fontfamily=DISPLAY_FONT)
        ax.set_xlabel("complexity")
        ax.grid(True)
        ax.legend(frameon=False)

    axes[0].set_ylabel("count")
    fig.suptitle(f"{spec.name}: dataset distribution", fontfamily=DISPLAY_FONT, fontsize=17)
    fig.savefig(path)
    plt.close(fig)


def save_trace_cloud_variants(
    model: StackedElmanRNN,
    spec: LanguageSpec,
    vocab: dict[str, int],
    output_dir: Path,
    *,
    complexity: int,
    seed: int,
    variants: int = 10,
    samples_per_variant: int = 180,
    layer: int = -1,
    progress: Callable[[int, int, str], None] | None = None,
) -> list[str]:
    filenames: list[str] = []
    cmap = LinearSegmentedColormap.from_list(
        "dust", ["#245f73", "#d9a441", "#bf5634"]
    )
    for variant in range(variants):
        if progress is not None:
            progress(variant + 1, variants, spec.name)
        rng = random.Random(seed + 500 + variant)
        sequences = [spec.random_valid(rng, complexity) for _ in range(samples_per_variant)]
        trajectories = collect_trajectory_embeddings(model, sequences, vocab, layer=layer)
        flat = torch.cat(trajectories, dim=0)
        projected = project_with_pca(flat, dims=2)
        splits = []
        start = 0
        for traj in trajectories:
            stop = start + traj.shape[0]
            splits.append(projected[start:stop])
            start = stop

        fig, ax = plt.subplots(figsize=(6.2, 5.1))
        for idx, path_points in enumerate(splits):
            color = cmap(idx / max(1, len(splits) - 1))
            ax.scatter(
                path_points[:, 0],
                path_points[:, 1],
                s=6.5,
                color=color,
                alpha=0.18,
                linewidths=0,
            )
        ax.set_title(
            f"{spec.name}: state-space trace cloud {variant + 1}",
            fontfamily=DISPLAY_FONT,
        )
        ax.set_xlabel("PC1")
        ax.set_ylabel("PC2")
        ax.grid(True)
        filename = f"{spec.name}-trace-cloud-{variant + 1:02d}.png"
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
            size = max(1.2, 12.0 / (level ** 0.55))
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
        raise typer.BadParameter("hidden-sizes must look like '6,4' with positive integers")
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


def validate_complexity_ranges(
    *,
    min_complexity: int,
    max_complexity: int,
    short_test_min_complexity: int,
    short_test_complexity: int,
    long_test_min_complexity: int,
    long_test_complexity: int,
) -> None:
    if min_complexity > max_complexity:
        raise typer.BadParameter("min-complexity must be <= max-complexity")
    if short_test_min_complexity > short_test_complexity:
        raise typer.BadParameter(
            "short-test-min-complexity must be <= short-test-complexity"
        )
    if long_test_min_complexity > long_test_complexity:
        raise typer.BadParameter(
            "long-test-min-complexity must be <= long-test-complexity"
        )
    if long_test_min_complexity <= max_complexity:
        raise typer.BadParameter(
            "long-test-min-complexity must be greater than max-complexity so long-test strings stay out of training"
        )


@app.command()
def train(
    language: str = typer.Option(
        "dyck1,anbn", help=f"Comma-separated languages or 'all'. Options: {', '.join(sorted(LANGUAGES))}"
    ),
    output_dir: Path = typer.Option(
        DEFAULT_OUTPUT_DIR, help="Directory for generated images."
    ),
    train_samples: int = typer.Option(1800, help="Number of training samples."),
    short_test_samples: int = typer.Option(700, help="Number of short-string test samples."),
    long_test_samples: int = typer.Option(700, help="Number of long-string test samples."),
    min_complexity: int = typer.Option(1, help="Minimum training complexity."),
    max_complexity: int = typer.Option(12, help="Maximum training complexity."),
    short_test_min_complexity: int = typer.Option(1, help="Minimum short-string test complexity."),
    short_test_complexity: int = typer.Option(12, help="Maximum short-string test complexity."),
    long_test_min_complexity: int = typer.Option(13, help="Minimum long-string test complexity."),
    long_test_complexity: int = typer.Option(60, help="Maximum long-string test complexity."),
    epochs: int = typer.Option(100, help="Training epochs."),
    batch_size: int = typer.Option(64, help="Batch size."),
    lr: float = typer.Option(3e-3, help="Learning rate."),
    embedding_dim: int = typer.Option(3, help="Embedding width for each symbol."),
    hidden_sizes: str = typer.Option("3,2", help="Comma-separated hidden sizes, e.g. '6,4'."),
    seed: int = typer.Option(7, help="Random seed."),
    trace_variants: int = typer.Option(10, help="How many trace-cloud variants to render."),
    trace_output_dir: Path = typer.Option(DEFAULT_VARIANT_DIR, help="Directory for trace-cloud variants."),
) -> None:
    seed_everything(seed)
    use_pretty_style()
    validate_complexity_ranges(
        min_complexity=min_complexity,
        max_complexity=max_complexity,
        short_test_min_complexity=short_test_min_complexity,
        short_test_complexity=short_test_complexity,
        long_test_min_complexity=long_test_min_complexity,
        long_test_complexity=long_test_complexity,
    )
    parsed_hidden_sizes = parse_hidden_sizes(hidden_sizes)
    output_dir = ensure_dir(output_dir)
    trace_output_dir = ensure_dir(trace_output_dir)
    languages = parse_languages(language)
    summaries = []
    for idx, language_name in enumerate(languages):
        spec = LANGUAGES[language_name]
        vocab = build_vocab(spec.alphabet)
        train_sequences, train_labels = sample_dataset(
            spec,
            n_samples=train_samples,
            min_complexity=min_complexity,
            max_complexity=max_complexity,
            seed=seed + idx * 101,
        )
        short_test_sequences, short_test_labels = sample_dataset(
            spec,
            n_samples=short_test_samples,
            min_complexity=short_test_min_complexity,
            max_complexity=short_test_complexity,
            seed=seed + idx * 101 + 11,
        )
        long_test_sequences, long_test_labels = sample_dataset(
            spec,
            n_samples=long_test_samples,
            min_complexity=long_test_min_complexity,
            max_complexity=long_test_complexity,
            seed=seed + idx * 101 + 23,
        )

        model = StackedElmanRNN(
            vocab_size=len(vocab),
            embedding_dim=embedding_dim,
            hidden_sizes=parsed_hidden_sizes,
        ).to(DEVICE)
        history = train_model(
            model,
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
        )
        trace_files = save_trace_cloud_variants(
            model,
            spec,
            vocab,
            trace_output_dir,
            complexity=max(short_test_complexity, max_complexity),
            seed=seed + idx * 101,
            variants=trace_variants,
            progress=lambda current, total, lang: typer.echo(
                f"[{lang}] trace cloud {current}/{total}"
            ),
        )
        summary = {
            "device": DEVICE,
            "language": language_name,
            "train_samples": train_samples,
            "short_test_samples": short_test_samples,
            "long_test_samples": long_test_samples,
            "min_complexity": min_complexity,
            "max_complexity": max_complexity,
            "short_test_min_complexity": short_test_min_complexity,
            "note": "Training uses only strings up to max_complexity; long-test evaluates longer strings only.",
            "short_test_complexity": short_test_complexity,
            "long_test_min_complexity": long_test_min_complexity,
            "long_test_complexity": long_test_complexity,
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
            ],
            "trace_cloud_files": trace_files,
        }
        (output_dir / f"{language_name}-run-metadata.json").write_text(json.dumps(summary, indent=2))
        summaries.append(summary)
        typer.echo(f"Saved {language_name} outputs to {output_dir}")
        typer.echo(json.dumps(summary["final_metrics"], indent=2))

    metadata_path(output_dir).write_text(json.dumps({"runs": summaries}, indent=2))


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
    prefix_depth: int = typer.Option(0, help="Force a shared prefix depth before sampling the remainder."),
    layered: bool = typer.Option(True, help="Render dust as layered symbolic accumulation."),
    base_points: int = typer.Option(64, help="Base count for the first layer in layered mode."),
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
    filename = (
        f"dust-depth{depth}-base{base}-digits{digit_pair[0]}{digit_pair[1]}"
        + (
            f"-layered-basepts{base_points}.png"
            if layered
            else f"-points{points}-prefix{prefix_depth}.png"
        )
    )
    save_dust_plot(point_cloud, output_dir / filename, title=title, levels=levels)
    typer.echo(f"Saved {filename} to {output_dir}")


def main() -> None:
    app()


if __name__ == "__main__":
    main()
