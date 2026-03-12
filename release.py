import json
import re
import shutil
import subprocess
from pathlib import Path

import typer


app = typer.Typer(help="Build and publish Report Foundry artifacts.")
ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
STATIC_DIR = BACKEND / "app" / "static"
PACKAGE_JSON = FRONTEND / "package.json"
PACKAGE_LOCK_JSON = FRONTEND / "package-lock.json"
BACKEND_MAIN = BACKEND / "app" / "main.py"
DEFAULT_IMAGE = "nathanschappell/report-foundry"


@app.command()
def set_version(version: str = typer.Argument(..., help="Application version.")) -> None:
    update_package_version(PACKAGE_JSON, version)
    if PACKAGE_LOCK_JSON.exists():
        update_package_lock_version(PACKAGE_LOCK_JSON, version)
    update_backend_version(BACKEND_MAIN, version)
    typer.echo(f"Updated app version to {version}")


@app.command()
def sync_static() -> None:
    copy_frontend_dist()
    typer.echo("Frontend assets copied into backend/app/static")


@app.command()
def build(
    version: str = typer.Argument(..., help="Application version and docker tag."),
    image: str = typer.Option(DEFAULT_IMAGE, "--image", help="Docker image repository."),
) -> None:
    set_version(version)
    run(["npm", "run", "build"], cwd=FRONTEND)
    copy_frontend_dist()
    run(["docker", "build", "-t", f"{image}:{version}", "."], cwd=ROOT)
    typer.echo(f"Built docker image {image}:{version}")


@app.command()
def publish(
    version: str = typer.Argument(..., help="Application version and docker tag."),
    image: str = typer.Option(DEFAULT_IMAGE, "--image", help="Docker image repository."),
    latest: bool = typer.Option(False, "--latest", help="Also tag and push :latest."),
) -> None:
    build(version=version, image=image)
    run(["docker", "push", f"{image}:{version}"], cwd=ROOT)
    if latest:
        run(["docker", "tag", f"{image}:{version}", f"{image}:latest"], cwd=ROOT)
        run(["docker", "push", f"{image}:latest"], cwd=ROOT)
    typer.echo(f"Published docker image {image}:{version}")


@app.command()
def show_version() -> None:
    typer.echo(read_package_version(PACKAGE_JSON))


def copy_frontend_dist() -> None:
    dist_dir = FRONTEND / "dist"
    if not dist_dir.exists():
        raise typer.BadParameter("dist does not exist. Run the frontend build first.")

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


def read_package_version(path: Path) -> str:
    data = json.loads(path.read_text())
    version = data.get("version")
    if not isinstance(version, str) or not version:
        raise typer.BadParameter("package.json is missing a version string.")
    return version


def update_package_version(path: Path, version: str) -> None:
    data = json.loads(path.read_text())
    data["version"] = version
    path.write_text(json.dumps(data, indent=2) + "\n")


def update_package_lock_version(path: Path, version: str) -> None:
    data = json.loads(path.read_text())
    data["version"] = version
    if isinstance(data.get("packages"), dict):
        root_package = data["packages"].get("")
        if isinstance(root_package, dict):
            root_package["version"] = version
    path.write_text(json.dumps(data, indent=2) + "\n")


def update_backend_version(path: Path, version: str) -> None:
    content = path.read_text()
    updated = re.sub(r'version="[^"]+"', f'version="{version}"', content, count=1)
    if updated == content:
        raise typer.BadParameter("Could not find FastAPI version assignment to update.")
    path.write_text(updated)


def run(command: list[str], cwd: Path) -> None:
    typer.echo(f"Running: {' '.join(command)}")
    completed = subprocess.run(command, cwd=cwd, check=False)
    if completed.returncode != 0:
        raise typer.Exit(completed.returncode)


if __name__ == "__main__":
    app()
