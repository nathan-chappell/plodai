# Report Foundry

Report Foundry is a demo app for showing agentic CSV analysis with a FastAPI backend and a Vite TypeScript React frontend. The core story is that a user can upload an arbitrary number of CSV files, ask an analyst agent to investigate them, and receive a report composed of charts plus markdown narrative sections.

## Why this shape

- Backend: FastAPI on Python 3.14 keeps the agent orchestration surface simple and deployable on Railway.
- Frontend: React plus Vite keeps iteration fast and gives us an easy place to host ChatKit client effects, chart rendering, and result caching.
- Persistence: SQLite on a Railway volume is the best fit for this demo stage. It now backs users, report runs, and ChatKit conversation memory.
- Auth: tokens are signed with `itsdangerous`, users live in SQLite, and the app can bootstrap an admin from env while also syncing a server-editable `backend/data/users.json` file.
- Database access: the backend now uses async SQLAlchemy sessions end to end.

## Architecture

The intended flow is:

1. The frontend accepts CSV uploads.
2. The frontend creates safe dataset summaries locally: file name, row count, columns, and a tiny sample for familiarization.
3. The backend agent uses tools that operate on safe abstractions, not raw tables.
4. Query results intended for charts are rendered on the frontend.
5. The rendered chart can be cached by query id and sent back as image input so the model can reason over the visual output.
6. The UI assembles the final report from chart artifacts and markdown sections.

## Auth model

- `POST /api/auth/login` accepts email and password.
- `GET /api/auth/me` resolves the current bearer token.
- `backend/data/users.json` is a deliberate operational escape hatch for server-side edits.
- `BOOTSTRAP_ADMIN_*` env vars create or refresh a built-in admin account on startup.
- Tokens are simple signed payloads with expiry, not full JWT infrastructure.

## OpenAI scaffolding

The scaffold now includes dependency placeholders for:

- `openai-agents`
- `openai-chatkit`
- `@openai/chatkit`
- `@openai/chatkit-react`

Backend agent scaffolding lives under `backend/app/agents/`.
ChatKit persistence now uses SQLAlchemy models in `backend/app/models/chatkit.py`, a request-scoped async store in `backend/app/chatkit/memory_store.py`, and a request-scoped server adapter in `backend/app/chatkit/server.py`.
The FastAPI ChatKit entrypoint lives at `POST /chatkit`, where request-scoped dependencies and thread metadata are folded into the generic agent context.

## Build and run

### Backend dev

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
```

### Frontend dev

```bash
cd frontend
npm install
npm run dev
```

### Production-style local run

1. Build the frontend.
2. Copy `frontend/dist` into `backend/app/static`.
3. Run gunicorn from the backend.

The repo includes VS Code tasks for each of these steps in `.vscode/tasks.json`.

## Docker and release

- `Dockerfile` builds the frontend first, then copies the built assets into the backend image.
- The production container runs `gunicorn` with `uvicorn.workers.UvicornWorker`.
- `backend/scripts/release.py` is a Typer-based release entrypoint.
- The intended image tag is the app version you pass to `release.py build`, for example `report-foundry:0.4.0`.

Example:

```bash
cd backend
.venv\Scripts\activate
python scripts/release.py build 0.4.0
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
- client-side CSV preview parsing to keep raw data out of the backend request
- Docker, VS Code tasks, and a Typer release script scaffold

The biggest missing pieces are real query execution over CSVs, actual Agents SDK runs, chart rendering image capture, and verification of the exact installed ChatKit request handler API after dependency install.
