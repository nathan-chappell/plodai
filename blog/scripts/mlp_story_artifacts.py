from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
from matplotlib import pyplot as plt
from matplotlib.figure import Figure

from blog.scripts.artifact_common import (
    DEFAULT_OUTPUT_DIR,
    STATIC_ACCENT_INK,
    STATIC_FIGURE_BG,
    STATIC_MAIN_INK,
    STATIC_PANEL_BG,
    STATIC_SECONDARY_INK,
    STATIC_TEXT_INK,
    clean_output_dir,
    apply_static_rcparams,
    font_kwargs,
    style_static_axis,
    write_matplotlib_figure,
)

import torch
from torch import nn
import typer


app = typer.Typer(
    help="Generate the MLP story figure for the theoretical-justification post."
)
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
MLP_DEFAULT_SHAPE = (32, 32)
TARGET_COLOR = "#c69a7b"
LOSS_COLOR = "#79a0c6"


@dataclass(frozen=True)
class MLPTrainingRun:
    hidden_layers: tuple[int, ...]
    loss_history: list[float]
    predictions_by_epoch: dict[int, torch.Tensor]
    xs: torch.Tensor
    ys: torch.Tensor

    @property
    def final_loss(self) -> float:
        return self.loss_history[-1]


def parse_mlp_shape(shape: str) -> tuple[int, ...]:
    hidden_layers = tuple(
        int(part.strip()) for part in shape.split(",") if part.strip()
    )
    if not hidden_layers or any(size <= 0 for size in hidden_layers):
        raise ValueError("mlp_shape must contain one or more positive integers.")
    return hidden_layers


def format_mlp_shape(hidden_layers: tuple[int, ...]) -> str:
    return "1→" + "→".join(str(size) for size in hidden_layers) + "→1"


def detect_mlp_reorganization_epoch(
    loss_history: list[float],
    *,
    late_start: int = 150,
    late_margin: int = 40,
    local_radius: int = 8,
    lookahead: int = 60,
    minimum_prominence: float = 5e-4,
) -> tuple[int, float]:
    total_epochs = len(loss_history)
    if total_epochs <= 1:
        return 0, 0.0
    start_epoch = min(total_epochs, max(1, late_start))
    end_epoch = max(start_epoch, total_epochs - late_margin)
    candidate_epochs = list(range(start_epoch, end_epoch + 1))
    if not candidate_epochs:
        return total_epochs, 0.0

    local_candidates: list[tuple[float, int]] = []
    fallback_candidates: list[tuple[float, int]] = []
    for epoch in candidate_epochs:
        index = epoch - 1
        value = loss_history[index]
        future_slice = loss_history[index + 1 : min(total_epochs, index + 1 + lookahead)]
        if not future_slice:
            continue
        score = value - min(future_slice)
        fallback_candidates.append((score, epoch))
        left = max(0, index - local_radius)
        right = min(total_epochs, index + local_radius + 1)
        neighborhood = loss_history[left:right]
        if value >= max(neighborhood) - 1e-12:
            local_candidates.append((score, epoch))

    if not fallback_candidates:
        return total_epochs, 0.0

    strong_locals = [
        candidate for candidate in local_candidates if candidate[0] >= minimum_prominence
    ]
    chosen_score, chosen_epoch = max(
        strong_locals or local_candidates or fallback_candidates,
        key=lambda item: (item[0], item[1]),
    )
    return chosen_epoch, float(chosen_score)


def mlp_story_epochs(total_epochs: int, *, reorganization_epoch: int | None = None) -> list[int]:
    if total_epochs <= 0:
        return [0]
    preferred = [0, min(total_epochs, 30), min(total_epochs, 200)]
    if reorganization_epoch is not None:
        preferred.append(min(total_epochs, max(0, reorganization_epoch)))
    preferred.append(total_epochs)
    selected: list[int] = []
    for epoch in preferred:
        if epoch not in selected:
            selected.append(epoch)
    return selected


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
        self.network = nn.Sequential(*layers)

    def forward(self, xs: torch.Tensor) -> torch.Tensor:
        return self.network(xs)


def build_mlp_dataset(points: int = 512) -> tuple[torch.Tensor, torch.Tensor]:
    xs = torch.linspace(0.0, 1.0, steps=points, device=DEVICE).unsqueeze(1)
    ys = torch.sin(8 * torch.pi * xs)
    return xs, ys


def run_mlp_training(
    *,
    epochs: int,
    batch_size: int,
    seed: int,
    hidden_layers: tuple[int, ...],
) -> MLPTrainingRun:
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    model = SineMLP(hidden_layers).to(DEVICE)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.01)
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
    return MLPTrainingRun(
        hidden_layers=hidden_layers,
        loss_history=loss_history,
        predictions_by_epoch=predictions_by_epoch,
        xs=xs.detach().cpu(),
        ys=ys.detach().cpu(),
    )


def build_mlp_story_figure(
    *,
    xs: torch.Tensor,
    ys: torch.Tensor,
    predictions_by_epoch: dict[int, torch.Tensor],
    loss_history: list[float],
    hidden_layers: tuple[int, ...],
    reorganization_epoch: int,
    reorganization_score: float,
) -> tuple[Figure, list[int]]:
    apply_static_rcparams()
    selected_epochs = mlp_story_epochs(
        len(loss_history),
        reorganization_epoch=reorganization_epoch,
    )
    figure = plt.figure(figsize=(16.0, 7.9))
    figure.patch.set_facecolor(STATIC_FIGURE_BG)
    grid = figure.add_gridspec(
        2, 5, height_ratios=[1.0, 0.92], hspace=0.26, wspace=0.18
    )
    x_values = xs.squeeze(1).tolist()
    target_values = ys.squeeze(1).tolist()
    prediction_axes = [figure.add_subplot(grid[0, index]) for index in range(5)]
    for index, epoch in enumerate(selected_epochs, start=1):
        prediction_values = predictions_by_epoch[epoch].squeeze(1).tolist()
        axis = prediction_axes[index - 1]
        style_static_axis(axis)
        axis.plot(
            x_values, target_values, color=TARGET_COLOR, linewidth=2.25, label="target"
        )
        axis.plot(
            x_values, prediction_values, color=STATIC_MAIN_INK, linewidth=1.95, label="MLP"
        )
        title = f"Epoch {epoch}"
        if epoch == reorganization_epoch:
            title = f"Epoch {epoch} · reorganization spike"
        axis.set_title(
            title,
            fontsize=10.8,
            fontfamily=["Ubuntu", "DejaVu Sans", "Liberation Sans"],
            color=STATIC_TEXT_INK,
            pad=7,
        )
        axis.set_xlabel("x", **font_kwargs(size=10.0, color=STATIC_TEXT_INK))
        axis.set_ylabel("y", **font_kwargs(size=10.0, color=STATIC_TEXT_INK))
    for axis in prediction_axes[len(selected_epochs) :]:
        axis.axis("off")
    epochs = list(range(1, len(loss_history) + 1))
    loss_axis = figure.add_subplot(grid[1, :])
    style_static_axis(loss_axis)
    for epoch in selected_epochs[1:]:
        loss_axis.axvline(
            epoch,
            color="#3a4652",
            linewidth=0.8,
            zorder=1,
        )
    loss_axis.plot(epochs, loss_history, color=LOSS_COLOR, linewidth=2.05)
    spike_y = loss_history[reorganization_epoch - 1]
    loss_axis.scatter(
        [reorganization_epoch],
        [spike_y],
        s=30,
        color=TARGET_COLOR,
        edgecolors=STATIC_PANEL_BG,
        linewidths=0.8,
        zorder=4,
    )
    callout_y = min(max(loss_history), spike_y + (0.08 * max(loss_history, default=1.0)))
    loss_axis.annotate(
        "temporary loss spike\nbefore better long-run fit",
        xy=(reorganization_epoch, spike_y),
        xytext=(reorganization_epoch + 20, callout_y),
        textcoords="data",
        ha="left",
        va="bottom",
        **font_kwargs(size=8.6, color=STATIC_TEXT_INK),
        bbox={
            "boxstyle": "round,pad=0.25",
            "facecolor": STATIC_PANEL_BG,
            "edgecolor": "#3a4652",
            "linewidth": 0.8,
        },
        arrowprops={
            "arrowstyle": "-",
            "linewidth": 0.7,
            "color": STATIC_SECONDARY_INK,
            "shrinkA": 4,
            "shrinkB": 4,
        },
        zorder=5,
    )
    loss_axis.set_xlabel("epoch", **font_kwargs(size=10.0, color=STATIC_TEXT_INK))
    loss_axis.set_ylabel("MSE", **font_kwargs(size=10.0, color=STATIC_TEXT_INK))

    figure.suptitle(
        f"Approximating sin(8πx) with a {format_mlp_shape(hidden_layers)} ReLU MLP",
        x=0.05,
        y=0.975,
        ha="left",
        fontsize=13.4,
        fontfamily=["Ubuntu", "DejaVu Sans", "Liberation Sans"],
        color=STATIC_TEXT_INK,
    )
    prediction_axes[0].legend(
        loc="upper right",
        frameon=False,
        prop={"family": ["Ubuntu", "DejaVu Sans", "Liberation Sans"], "size": 8.8},
        labelcolor=STATIC_SECONDARY_INK,
    )
    figure.subplots_adjust(top=0.89, left=0.055, right=0.985, bottom=0.08)
    return figure, selected_epochs


def render_mlp_assets(
    *,
    output_dir: Path,
    seed: int,
    mlp_epochs: int,
    mlp_batch_size: int,
    mlp_shape: str,
) -> dict[str, object]:
    hidden_layers = parse_mlp_shape(mlp_shape)
    run = run_mlp_training(
        seed=seed,
        epochs=mlp_epochs,
        batch_size=mlp_batch_size,
        hidden_layers=hidden_layers,
    )
    reorganization_epoch, reorganization_score = detect_mlp_reorganization_epoch(
        run.loss_history
    )
    figure, selected_epochs = build_mlp_story_figure(
        xs=run.xs,
        ys=run.ys,
        predictions_by_epoch=run.predictions_by_epoch,
        loss_history=run.loss_history,
        hidden_layers=run.hidden_layers,
        reorganization_epoch=reorganization_epoch,
        reorganization_score=reorganization_score,
    )
    files = write_matplotlib_figure(
        figure, output_dir=output_dir, stem="mlp-sine-story"
    )
    plt.close(figure)
    return {
        "files": files,
        "published_shape": list(run.hidden_layers),
        "selected_epochs": selected_epochs,
        "reorganization_epoch": reorganization_epoch,
        "reorganization_score": reorganization_score,
        "final_loss": run.final_loss,
    }


@app.command()
def generate(
    output_dir: Path = typer.Option(
        DEFAULT_OUTPUT_DIR,
        help="Directory where article-facing assets should be written.",
    ),
    seed: int = typer.Option(7, help="Random seed."),
    mlp_epochs: int = typer.Option(400, help="Training epochs for the MLP."),
    mlp_batch_size: int = typer.Option(64, help="Mini-batch size for the MLP."),
    mlp_shape: str = typer.Option(
        ",".join(str(size) for size in MLP_DEFAULT_SHAPE),
        help="Comma-separated hidden-layer widths for the MLP.",
    ),
    clean: bool = typer.Option(
        True,
        "--clean/--no-clean",
        help="Whether to clear the output directory before generating fresh artifacts.",
    ),
) -> None:
    if clean:
        clean_output_dir(output_dir)
    render_mlp_assets(
        output_dir=output_dir,
        seed=seed,
        mlp_epochs=mlp_epochs,
        mlp_batch_size=mlp_batch_size,
        mlp_shape=mlp_shape,
    )


def main() -> None:
    app()


if __name__ == "__main__":
    main()
