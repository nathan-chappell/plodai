import json
import re
from pathlib import Path

import typer


app = typer.Typer(help="Version bump and release checklist helper for Report Foundry.")
PACKAGE_JSON = Path() / "package.json"
PACKAGE_LOCK_JSON = Path() / "package-lock.json"
BACKEND_MAIN = Path() / "backend" / "app" / "main.py"


@app.command()
def show_version() -> None:
    typer.echo(read_package_version(PACKAGE_JSON))


@app.command()
def set_version(
    version: str = typer.Argument(..., help="Application version."),
) -> None:
    update_all_versions(version)
    typer.echo(f"Updated app version to {version}")


@app.command()
def bump(
    bump_kind: str | None = typer.Argument(
        None,
        help="Semver bump kind: p for patch, m for minor, M for major. Leave empty to be prompted.",
    ),
) -> None:
    resolved_bump_kind = resolve_bump_kind(bump_kind)
    current_version = read_package_version(PACKAGE_JSON)
    next_version = bump_semver(current_version, resolved_bump_kind)
    update_all_versions(next_version)
    typer.echo(f"Bumped version from {current_version} to {next_version}")


@app.command()
def commit_message(
    version: str = typer.Argument(..., help="Application version."),
) -> None:
    typer.echo(release_commit_message(version=version))


@app.command()
def release(
    version: str | None = typer.Argument(
        None,
        help="Application version. Leave empty to choose a p/m/M semver bump.",
    ),
    remote: str = typer.Option("origin", "--remote", help="Git remote to push to."),
) -> None:
    resolved_version = resolve_release_version(version)
    update_all_versions(resolved_version)
    typer.echo(f"Prepared release version {resolved_version}")
    typer.echo("")
    typer.echo(release_instructions(version=resolved_version, remote=remote))


def update_all_versions(version: str) -> None:
    update_package_version(PACKAGE_JSON, version)
    if PACKAGE_LOCK_JSON.exists():
        update_package_lock_version(PACKAGE_LOCK_JSON, version)
    update_backend_version(BACKEND_MAIN, version)


def resolve_release_version(version: str | None) -> str:
    if version:
        return version
    current_version = read_package_version(PACKAGE_JSON)
    bump_kind = resolve_bump_kind(None)
    return bump_semver(current_version, bump_kind)


def resolve_bump_kind(bump_kind: str | None) -> str:
    if bump_kind is None:
        bump_kind = typer.prompt(
            "Version bump [p/m/M]",
            default="p",
            show_default=True,
        ).strip()
    if bump_kind not in {"p", "m", "M"}:
        raise typer.BadParameter("Version bump must be one of: p, m, M")
    return bump_kind


def bump_semver(version: str, bump_kind: str) -> str:
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", version)
    if match is None:
        raise typer.BadParameter(f"Version '{version}' is not valid semver.")
    major, minor, patch = (int(part) for part in match.groups())
    if bump_kind == "M":
        return f"{major + 1}.0.0"
    if bump_kind == "m":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def release_commit_message(*, version: str) -> str:
    return f"chore(release): {version}"


def release_instructions(*, version: str, remote: str) -> str:
    message = release_commit_message(version=version)
    return "\n".join(
        [
            message,
            "",
            "Run these commands manually:",
            "",
            "npm run build",
            "git add -A",
            f'git commit -m "{message}"',
            f"git tag v{version}",
            f"git push {remote}",
            f"git push {remote} v{version}",
            "",
            "Then run your Docker build/push flow from WSL.",
        ]
    )


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


if __name__ == "__main__":
    app()
