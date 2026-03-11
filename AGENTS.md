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

## Near-term next steps
- Add Agents SDK orchestration and real tool definitions.
- Add CSV storage plus a query layer, likely DuckDB for analysis over uploaded files.
- Add ChatKit client tools/effects for chart rendering and report assembly.
- Decide whether SQLite remains enough or whether Postgres is needed for multi-user persistence.
