from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

try:
    from blog.scripts.artifact_common import DEFAULT_OUTPUT_DIR, FIGURE_STYLE, clean_output_dir, write_figure
except ModuleNotFoundError:
    from artifact_common import DEFAULT_OUTPUT_DIR, FIGURE_STYLE, clean_output_dir, write_figure

import torch
from torch import nn
from plotly.subplots import make_subplots
import plotly.graph_objects as go
import typer


app = typer.Typer(help="Generate the MLP story figure for the theoretical-justification post.")
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
MLP_DEFAULT_SHAPE = (32, 32)


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
    hidden_layers = tuple(int(part.strip()) for part in shape.split(",") if part.strip())
    if not hidden_layers or any(size <= 0 for size in hidden_layers):
        raise ValueError("mlp_shape must contain one or more positive integers.")
    return hidden_layers


def format_mlp_shape(hidden_layers: tuple[int, ...]) -> str:
    return "1→" + "→".join(str(size) for size in hidden_layers) + "→1"


def mlp_story_epochs(total_epochs: int) -> list[int]:
    if total_epochs <= 0:
        return [0]
    preferred = [0, min(total_epochs, 30), min(total_epochs, 200), total_epochs]
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
) -> tuple[go.Figure, list[int]]:
    selected_epochs = mlp_story_epochs(len(loss_history))
    figure = make_subplots(
        rows=2,
        cols=4,
        specs=[[{}, {}, {}, {}], [{"colspan": 4}, None, None, None]],
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
        go.Scatter(x=epochs, y=loss_history, mode="lines", line={"color": "#62558c", "width": 3}, showlegend=False),
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


def render_mlp_assets(
    *,
    output_dir: Path,
    write_html: bool,
    seed: int,
    mlp_epochs: int,
    mlp_batch_size: int,
    mlp_shape: str,
) -> dict[str, object]:
    hidden_layers = parse_mlp_shape(mlp_shape)
    run = run_mlp_training(seed=seed, epochs=mlp_epochs, batch_size=mlp_batch_size, hidden_layers=hidden_layers)
    figure, selected_epochs = build_mlp_story_figure(
        xs=run.xs,
        ys=run.ys,
        predictions_by_epoch=run.predictions_by_epoch,
        loss_history=run.loss_history,
        hidden_layers=run.hidden_layers,
    )
    files = write_figure(figure, output_dir=output_dir, stem="mlp-sine-story", write_html=write_html)
    return {"files": files, "published_shape": list(run.hidden_layers), "selected_epochs": selected_epochs, "final_loss": run.final_loss}


@app.command()
def generate(
    output_dir: Path = typer.Option(DEFAULT_OUTPUT_DIR, help="Directory where article-facing assets should be written."),
    seed: int = typer.Option(7, help="Random seed."),
    mlp_epochs: int = typer.Option(400, help="Training epochs for the MLP."),
    mlp_batch_size: int = typer.Option(64, help="Mini-batch size for the MLP."),
    mlp_shape: str = typer.Option(",".join(str(size) for size in MLP_DEFAULT_SHAPE), help="Comma-separated hidden-layer widths for the MLP."),
    html: bool = typer.Option(True, "--html/--no-html", help="Whether to emit a Plotly HTML companion alongside the PNG."),
    clean: bool = typer.Option(True, "--clean/--no-clean", help="Whether to clear the output directory before generating fresh artifacts."),
) -> None:
    if clean:
        clean_output_dir(output_dir)
    render_mlp_assets(
        output_dir=output_dir,
        write_html=html,
        seed=seed,
        mlp_epochs=mlp_epochs,
        mlp_batch_size=mlp_batch_size,
        mlp_shape=mlp_shape,
    )


def main() -> None:
    app()


if __name__ == "__main__":
    main()
