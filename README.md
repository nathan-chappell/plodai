# Report Foundry

Report Foundry is a demo app for showing agentic CSV analysis with a FastAPI backend and a Vite TypeScript React frontend. The core story is that a user can upload an arbitrary number of CSV files, ask an analyst agent to investigate them, and receive a report composed of charts plus markdown narrative sections.

## Why this shape

- Backend: FastAPI on Python 3.14 keeps the agent orchestration surface simple and deployable on Railway.
- Frontend: React plus Vite keeps iteration fast and gives us an easy place to host ChatKit client effects, chart rendering, and result caching.
- Persistence: SQLite is the best fit for this demo stage. It is enough for report metadata, uploaded file manifests, tool logs, and a lightweight user allowlist. If the app graduates beyond a short-lived demo, the SQLAlchemy seam makes a later Postgres move straightforward.
- Auth: a user allowlist is intentionally simple here. The backend expects an `X-Demo-User` header and checks it against `ALLOWED_USERS`.

## Architecture

The intended flow is:

1. The frontend accepts CSV uploads.
2. The frontend creates safe dataset summaries locally: file name, row count, columns, and a tiny sample for familiarization.
3. The backend agent uses tools that operate on safe abstractions, not raw tables.
4. Query results intended for charts are rendered on the frontend.
5. The rendered chart can be cached by query id and sent back as image input so the model can reason over the visual output.
6. The UI assembles the final report from chart artifacts and markdown sections.

## Tooling direction

The scaffold includes the beginnings of a tool contract, and the next real implementation step is to replace the placeholder report builder with actual Agents SDK tools such as:

- `list_accessible_datasets`
- `inspect_dataset_schema`
- `run_aggregate_query`
- `request_chart_render`
- `append_report_section`
- `close_report`

A practical guardrail is to ensure `run_aggregate_query` only returns aggregated tables, grouped metrics, top-N slices, and capped previews.

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
- `ALLOWED_USERS`
- `VITE_API_BASE_URL`
- `VITE_DEMO_USER`

## Railway notes

- Railway can host the FastAPI service and the frontend separately, or the frontend can be built to static assets and served another way.
- SQLite is fine for demos, but use Railway volumes if you want persistence across redeploys.
- If you move to Postgres later, start by migrating report runs, tool logs, uploaded file metadata, and any cached query manifests.

## Current status

This scaffold provides:

- a FastAPI API with demo auth and report persistence
- a React UI with styled-components and CSS variables
- client-side CSV preview parsing to keep raw data out of the backend request
- a report surface for tool logs, markdown sections, and chart placeholders

The biggest missing pieces are Agents SDK integration, real query execution over CSVs, chart rendering, and the ChatKit client effect loop.
