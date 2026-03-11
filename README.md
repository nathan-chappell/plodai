# Report Foundry

Report Foundry is a demo app for showing agentic CSV analysis with a FastAPI backend and a Vite TypeScript React frontend. The core story is that a user can upload an arbitrary number of CSV files, ask an analyst agent to investigate them, and receive a report composed of charts plus markdown narrative sections.

## Why this shape

- Backend: FastAPI on Python 3.14 keeps the agent orchestration surface simple and deployable on Railway.
- Frontend: React plus Vite keeps iteration fast and gives us an easy place to host ChatKit client effects, chart rendering, and result caching.
- Persistence: SQLite on a Railway volume is the best fit for this demo stage. It is enough for report metadata, users, tool logs, and a lightweight admin story. If the app graduates beyond a short-lived demo, the SQLAlchemy seam makes a later Postgres move straightforward.
- Auth: tokens are signed with `itsdangerous`, users live in SQLite, and the app can bootstrap an admin from env while also syncing a server-editable `backend/data/users.json` file.

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
- `@openai/chatkit-react`

Backend agent scaffolding lives under `backend/app/agents/` and the ChatKit pause point lives in `backend/app/chatkit/server.py`.

This is the intended next implementation sequence:

1. Replace the stub Agents SDK tool functions with real dataset inventory and aggregate query execution.
2. Add CSV storage plus a query layer, likely DuckDB for analysis over uploaded files.
3. Wire ChatKit client tools and client effects for chart rendering and report assembly.
4. Stop before ChatKit conversation persistence until the storage design is decided.

## Local development

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Set these environment variables before running:

- `OPENAI_API_KEY`
- `DATABASE_URL`
- `AUTH_SECRET_KEY`
- `AUTH_SALT`
- `USER_SEED_FILE`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`
- `BOOTSTRAP_ADMIN_NAME`
- `VITE_API_BASE_URL`

## Railway notes

- Railway volumes are a good match for this demo if you want SQLite plus editable seed files.
- The current user bootstrap design is intentionally simple and operationally friendly.
- If you later split auth or reporting persistence out, the SQLAlchemy seam keeps that migration manageable.

## Current status

This scaffold provides:

- a FastAPI API with SQLite-backed users and signed auth tokens
- a React UI with styled-components and CSS variables
- client-side CSV preview parsing to keep raw data out of the backend request
- an Agents SDK tool scaffold and a ChatKit integration pause point
- a report surface for tool logs, markdown sections, and chart placeholders

The biggest missing pieces are real query execution over CSVs, actual Agents SDK runs, chart rendering, and the ChatKit conversation persistence layer.
