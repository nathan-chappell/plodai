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
- Release automation: `release.py`

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

The repo includes VS Code launch configs for backend debugging and tasks for the frontend build/dev loop.

## Docker and release

- `Dockerfile` expects prebuilt frontend assets in `dist/` and copies them into the runtime image.
- The runtime image copies `backend/` plus the prebuilt frontend output and runs `gunicorn`.
- `release.py` is the Typer-based release entrypoint at the repo root.
- `release.py set-version <version>` keeps the frontend package version and backend FastAPI version aligned.
- `release.py build <version>` updates versions, builds the frontend, syncs static assets, and builds the Docker image.
- `release.py publish <version>` also pushes the image to Docker Hub.

Examples:

```bash
python release.py build 0.4.0
python release.py publish 0.4.0 --image nathanschappell/report-foundry
```

## Railway notes

- Railway volumes are a good match for this demo if you want SQLite plus editable seed files.
- Railway supports deploying public container images, including Docker Hub images, so a pushed image can be part of the deployment flow.
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

The biggest missing pieces are real query execution over CSVs, fuller local file processing for client-side tools, and deeper verification of the exact installed ChatKit request handler API after dependency install.
