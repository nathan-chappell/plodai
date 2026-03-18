# report-foundry

## Demo scope
Build a short-lived but impressive agentic analytics demo for a targeted stakeholder. The application should accept many CSV files, let an analyst agent explore them through safe tools, and produce a report composed of charts and markdown narrative sections.

## Product thesis
The agent should feel investigative instead of chatbot-like. It should list files, inspect schemas, request bounded aggregate queries, ask the client to render charts, and progressively assemble a report artifact.

## Guardrails
- Do not expose raw datasets to the model except tiny familiarization slices.
- Prefer aggregate and grouped outputs for all analysis.
- Render charts on the client and pass chart images back for visual reasoning when useful.
- Keep auth simple and explainable for a demo setting.

## Workspace shape
- Keep the frontend/tooling root at the repo root for editor friendliness.
- Keep Python application code under `backend/`.
- Keep shared build and release files easy to discover from the repo root.

## Auth direction
- Use `itsdangerous` for signed bearer tokens.
- Keep a real SQLite `users` table with hashed passwords.
- Allow a Railway-volume-backed `backend/data/users.json` seed file for operational edits.
- Bootstrap an admin from env on startup.

## Persistence direction
- Use async SQLAlchemy for the app database.
- Keep ChatKit conversation memory in the same database through mapped dataclass models.
- Build the ChatKit server/store per request so it can attach to the request-scoped async session.

## Commit message style
- Prefer one big commit message with an umbrella conventional commit title.
- In the body, include multiple conventional-commit-style sections when the work spans multiple themes.
- Include emojis in the title and section headers when writing commit messages for this repo.

## Near-term next steps
- Add real Agents SDK orchestration and replace stub tool definitions.
- Add CSV storage plus a query layer, likely DuckDB for analysis over uploaded files.
- Add ChatKit client tools and client effects for chart rendering and report assembly.
- Finish the concrete ChatKit SDK endpoint wiring once the local venv contains the installed package.
