import shutil
import subprocess
from pathlib import Path

import typer


app = typer.Typer(help="Build and release Report Foundry artifacts.")
ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
STATIC_DIR = BACKEND / "app" / "static"


@app.command()
def build(version: str = typer.Argument(..., help="Application version and docker tag.")) -> None:
    run(["npm", "run", "build"], cwd=FRONTEND)
    sync_frontend_dist()
    run(["docker", "build", "-t", f"report-foundry:{version}", "."], cwd=ROOT)
    typer.echo(f"Built docker image report-foundry:{version}")


@app.command()
def sync_static() -> None:
    sync_frontend_dist()
    typer.echo("Frontend assets copied into backend/app/static")


@app.command()
def publish(version: str = typer.Argument(..., help="Application version and docker tag.")) -> None:
    typer.echo("Publish flow is not implemented yet.")
    typer.echo(f"When ready, upload report-foundry:{version} to the chosen registry.")


def sync_frontend_dist() -> None:
    dist_dir = FRONTEND / "dist"
    if not dist_dir.exists():
        raise typer.BadParameter("frontend/dist does not exist. Run the frontend build first.")

    if STATIC_DIR.exists():
        for child in STATIC_DIR.iterdir():
            if child.name == ".gitkeep":
                continue
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
    else:
        STATIC_DIR.mkdir(parents=True, exist_ok=True)

    for child in dist_dir.iterdir():
        destination = STATIC_DIR / child.name
        if child.is_dir():
            shutil.copytree(child, destination, dirs_exist_ok=True)
        else:
            shutil.copy2(child, destination)


def run(command: list[str], cwd: Path) -> None:
    typer.echo(f"Running: {' '.join(command)}")
    completed = subprocess.run(command, cwd=cwd, check=False)
    if completed.returncode != 0:
        raise typer.Exit(completed.returncode)


if __name__ == "__main__":
    app()
