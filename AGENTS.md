# report-foundry

## Current product
This repo is primarily a demo of frontend capabilities being exposed to agents in a conventional, reusable way. The main idea is that a useful TypeScript or frontend capability can be packaged cleanly, made available to one agent quickly, and then reused by other agents with minimal ceremony.

## Current architecture
- Keep the frontend and shared tooling at the repo root.
- Keep Python application code under `backend/`.
- Even with separate frontend and backend subdirectories, treat the repository root as the working root for both toolchains, e.g. run `npm install` and `python -m venv .venv` from the repo root.
- Treat the frontend capability-module structure as a core architectural feature of the project.
- Define frontend capabilities in a conventional shape so they are easy to wire into agent specs, demo scenarios, and frontend-to-agent exposure.
- Keep the backend straightforward: expose the frontend-provided capabilities to the agent runtime, handle the necessary plumbing, and do a small amount of bookkeeping.
- Use FastAPI, ChatKit, the OpenAI Agents SDK, and the Conversations API for the interactive runtime.
- Use Pydantic models and typed Python structures deliberately at the backend boundary.
- Use async SQLAlchemy for persistence and keep ChatKit memory in the same database.
- Build the ChatKit server and memory store per request so they can attach to the request-scoped async session.
- The Python baseline for this repo is `python3.14` or newer.

## Backend posture
- Keep the backend light. This is intentionally a portfolio project with minimal infrastructure.
- The most important backend responsibility is correctly wiring the Agents SDK, ChatKit, and Conversations API together - it provides the agentic engine, the frontend declares the agents and provides callbacks for tool calls.
- Changes in this area must be made in consultation with the actual code, including checking the installed SDK code in the local venv when behavior is unclear.

## Current auth and access model
- Auth currently uses Clerk bearer tokens, not local demo auth.
- The ChatKit API is gated by the authenticated user and current credit checks.

## Product guardrails
- We use the technique of client-side chart rendering plus sending the rendered images back to the model as a form of vision-based context compression and to avoid making the webserver do rendering work. This requires careful hookup.
- Treat the client-declared tool catalog as the source of truth for what local context is available.

## Coding preferences
- Favor strong typings and explicit data shapes when practical.
- Use dataclasses carefully and prefer `kw_only=True` where appropriate rather than relying on positional construction.
- Use Pydantic intentionally at schema boundaries.
- No tool-call schema or structured-output schema should permit additional properties.
- Avoid plain `dict` shapes in tool-call or structured-output contracts. Prefer `TypedDict` or explicit Pydantic models.
- `Field(..., discriminator=...)` is brittle in this stack. Prefer plain unions with an implicit discriminator when possible and let Pydantic resolve them structurally.
- Watch for code duplication and repeated UI or tool-building patterns.
- It is fine to pause and refactor before things get too messy.
- Do not derail active feature delivery with opportunistic refactors while new functionality is still being established.

## Logging discipline
- Keep backend logs event-based, multiline, and summary-first so request flow and tool round trips are easy to scan at `INFO`.
- Log tool calls and returned tool outputs with stable identifiers and compact counts/summaries, not raw payloads, rows, extracted text, base64 blobs, or auth material.
- Keep frontend logging dev-only, privacy-conscious, and object-based so the browser console can inspect useful metadata without clutter.
- Logging should stay cheap on hot paths and should not serialize large payloads just for observability.

## Commit message style
- Prefer one big commit message with an umbrella conventional commit title.
- In the body, include multiple conventional-commit-style sections when the work spans multiple themes.
- Include emojis in the title and section headers when writing commit messages for this repo.
- Offer commit message suggestions from time to time after a meaningful stretch of work, but usually not after every small change.

## Maintenance note
- Keep this file short, current, and high-level.
- Remove or rewrite stale guidance instead of letting old roadmap notes accumulate here.
