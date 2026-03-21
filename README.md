# AI Portfolio

AI Portfolio is a demo app for showcasing reusable frontend agents with a FastAPI backend and a Vite TypeScript React frontend. The original Report Foundry CSV workflow now lives inside the app as the current dataset-first analysis flow. The Python app code lives under `backend/`, while the frontend source lives under `frontend/`.

## Why this shape

- Backend: FastAPI on Python 3.14 keeps the agent orchestration surface simple and deployable on Railway.
- Frontend: React plus Vite lives in `frontend/`, and Vite emits production assets to the repo-root `dist/` directory.
- Persistence: SQLite on a Railway volume is the best fit for this demo stage. It backs users, report runs, and ChatKit conversation memory.
- Auth: tokens are signed with `itsdangerous`, users live in SQLite, and the app can bootstrap an admin from env while also syncing a server-editable `backend/data/users.json` file.
- Database access: the backend uses async SQLAlchemy sessions end to end.

## Layout

- Frontend/tooling root: `package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/src/`
- Built frontend assets: `dist/`
- Python app: `backend/app/`
- Python runtime config: `requirements.txt`, `requirements-dev.txt`
- Release automation: `release.py`
- Runtime entrypoint: `main.py`

## Build and run

### Backend dev

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r ..\requirements.txt
pip install -r ..\requirements-dev.txt
python ..\main.py
```

### Frontend dev

```bash
npm install
npm run dev
```

### Production-style local run

1. Build the frontend with `npm run build`.
2. Run `python main.py` or use the default `Backend: Uvicorn` VS Code launch, which builds the frontend first and then serves the repo-root `dist/` directory.

The repo includes VS Code launch configs for both API-only development and production-style Uvicorn serving with freshly built frontend assets. Generated frontend assets are treated as disposable build output and are ignored by git.

## Docker and release

- `Dockerfile` expects prebuilt frontend assets in the repo-root `dist/` directory and copies them into the runtime image.
- The runtime image copies `backend/`, `dist/`, and the root `main.py` entrypoint.
- The root `main.py` prints version/runtime details first, then starts Uvicorn directly on `0.0.0.0:8000`.
- `release.py` is the release helper at the repo root.
- `release.py bump` prompts for `p/m/M` and updates the frontend package version plus the backend FastAPI version.
- `release.py release` updates the version and prints the manual release checklist, including the `npm run build` and Git commands to run.

Examples:

```bash
python release.py bump
python release.py release
```

## Railway notes

- Railway can deploy a prebuilt Docker Hub image directly.
- Railway provides the public HTTPS endpoint, so the container should serve plain HTTP only.
- This app is currently hardcoded to listen on `0.0.0.0:8000` to match the current Railway setup.
- Railway volumes are a good match for this demo if you want SQLite plus editable seed files.
- Async SQLAlchemy keeps the app ready for streaming ChatKit request handling.

## Current status

This scaffold provides:

- a FastAPI API with async SQLAlchemy and SQLite-backed users
- signed auth tokens with a typed `admin | user` role model
- DB-backed ChatKit memory models and a request-scoped server adapter
- a `/chatkit` entrypoint that builds per-request agent context
- a React UI with styled-components, ChatKit scaffolding, Chart.js, and client analysis tooling
- Docker, VS Code tasks, and a release script scaffold

The biggest missing pieces are fuller dataset-tool verification, smoother end-to-end integration coverage, and deeper testing of the client-tool round trips.

## Demo runs

The recommended demo workflow is now the in-app agent demos. Sign in normally, open any agent's `Demo` tab, and use the built-in `Run demo` action to exercise the curated scenario directly in ChatKit.

