# Report Foundry

Report Foundry is a demo app for showing agentic CSV analysis with a FastAPI backend and a Vite TypeScript React frontend. The repo root now acts as the frontend/tooling root, while the Python app code lives under `backend/`.

## Why this shape

- Backend: FastAPI on Python 3.14 keeps the agent orchestration surface simple and deployable on Railway.
- Frontend: React plus Vite lives at the repo root, which tends to play more nicely with editors and workspace tooling.
- Persistence: SQLite on a Railway volume is the best fit for this demo stage. It now backs users, report runs, and ChatKit conversation memory.
- Auth: tokens are signed with `itsdangerous`, users live in SQLite, and the app can bootstrap an admin from env while also syncing a server-editable `backend/data/users.json` file.
- Database access: the backend now uses async SQLAlchemy sessions end to end.

## Layout

- Frontend/tooling root: `package.json`, `vite.config.ts`, `tsconfig.json`, `src/`
- Python app: `backend/app/`
- Python runtime config: `requirements.txt`, `requirements-dev.txt`
- Release automation: `backend/scripts/release.py`

## Build and run

### Backend dev

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r ..\requirements.txt
pip install -r ..\requirements-dev.txt
uvicorn app.main:app --reload
```

### Frontend dev

```bash
npm install
npm run dev
```

### Production-style local run

1. Build the frontend at the repo root.
2. Copy `dist/` into `backend/app/static`.
3. Run gunicorn from `backend/`.

The repo includes VS Code tasks for each of these steps in `.vscode/tasks.json`.

## Docker and release

- `Dockerfile` builds the frontend first at the repo root.
- It then copies `backend/` plus the built `dist/` output into the runtime image.
- The production container runs `gunicorn` with `uvicorn.workers.UvicornWorker`.
- `backend/scripts/release.py` is a Typer-based release entrypoint.
- The intended image tag is the app version you pass to `release.py build`, for example `report-foundry:0.4.0`.

Example:

```bash
cd backend
.venv\Scripts\activate
python scripts\release.py build 0.4.0
```

## Railway notes

- Railway volumes are a good match for this demo if you want SQLite plus editable seed files.
- The current user bootstrap design is intentionally simple and operationally friendly.
- Async SQLAlchemy keeps the app ready for streaming ChatKit request handling.
- Thread metadata is a good place for small pieces of report state that should travel with the conversation.
- Railway HTTPS may be enough on its own, which is likely easier than managing Let’s Encrypt inside the container.

## Current status

This scaffold provides:

- a FastAPI API with async SQLAlchemy and SQLite-backed users
- signed auth tokens with a typed `admin | user` role model
- DB-backed ChatKit memory models and a request-scoped server adapter
- a `/chatkit` entrypoint that builds per-request agent context
- a React UI with styled-components, ChatKit scaffolding, Chart.js, and client analysis tooling
- Docker, VS Code tasks, and a Typer release script scaffold

The biggest missing pieces are real query execution over CSVs, actual Agents SDK runs, chart rendering image capture, and verification of the exact installed ChatKit request handler API after dependency install.
