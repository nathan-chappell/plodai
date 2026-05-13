# plodai

plodai is an agriculture assistant and information-gathering application for field evidence, structured issue reports, official-source guidance, and practical follow-up planning. Users can create advisory cases, upload orchard or field images, report production problems, ask agricultural questions, and preserve the resulting context as reusable advisory data.

The current workflow is built around field advisory cases. A user can start with photos or a rough problem description, then the assistant helps inspect the available evidence, asks for or searches for missing context when useful, and saves durable facts into a structured record. The goal is to turn one-off agricultural troubleshooting into information that can be reviewed, updated, and reused.

The app currently focuses on orchard and small-farm operations in Croatia, with English and Croatian chat output. It is designed to support agriculture information gathering without pretending to replace local advisors, inspectors, veterinarians, official registries, or label-specific compliance checks.

## What The App Does

- Collects field reports, questions, measurements, materials, and crop or livestock subjects into advisory cases.
- Accepts uploaded evidence images and sends relevant visual context back to the assistant when analysis needs it.
- Saves assistant-discovered or user-provided facts through typed tools instead of leaving everything in chat history.
- Uses hosted web search when current public references materially improve an answer.
- Prioritizes official or institutionally reliable Croatian agricultural sources for guidance, subsidy, regulatory, pesticide, fertilizer, veterinary, and food-safety context.
- Keeps authenticated access, credit checks, account state, advisory records, uploaded evidence, and ChatKit memory connected in one application flow.

## Architecture

- Frontend stack: React 19, Vite, TypeScript, styled-components, Clerk, `@openai/chatkit`, and `@openai/chatkit-react`.
- Backend stack: FastAPI, OpenAI Agents SDK, OpenAI ChatKit server integration, async SQLAlchemy, Alembic, and Pydantic.
- Persistence: advisory cases, structured records, evidence images, account/credit state, and ChatKit memory live in the application database; uploaded images and chat attachments live in S3-compatible object storage.
- Runtime shape: ChatKit receives authenticated requests, the backend builds a request-scoped agent context, the Agents SDK runs the PlodAI assistant with typed tools, and frontend-visible progress streams back through ChatKit events.
- Product shape: the frontend owns the advisory workspace and local context, while the backend stays focused on auth, persistence, ChatKit/Agents SDK wiring, and bookkeeping.
- Model mapping: `lightweight` -> `gpt-5.4-nano`, `balanced` -> `gpt-5.4-mini`, `powerful` -> `gpt-5.4`.

## Demo Flow

The included screenshots show a walnut-orchard advisory case:

1. A user starts with a mostly empty advisory case and attaches walnut-orchard photos.
2. The assistant inspects the images and calls backend tools to fetch the current saved record.
3. The assistant converts image and chat observations into structured application data.
4. The user receives a practical assessment with saved reports, follow-up actions, and linked public references.

<p align="center">
  <img src="screenshots/just-attached-walnut-images.png" alt="PlodAI with walnut orchard images attached in the chat composer before analysis begins." width="88%" />
</p>

<p align="center">
  <img src="screenshots/thinking-and-showing-tool-call.png" alt="PlodAI reviewing walnut orchard images and showing a get_advisory_record tool call in progress." width="88%" />
</p>

<p align="center">
  <img src="screenshots/farm-record-created.png" alt="A saved Walnut Orchard advisory record with subject, quantity estimate, reports, and follow-up context." width="88%" />
</p>

<p align="center">
  <img src="screenshots/finished-with-assessment.png" alt="A finished walnut assessment with structured reports and linked public references in the chat response." width="88%" />
</p>

Sample development images are available in [`walnut_test_images/`](./walnut_test_images).

## Local Setup

### Prerequisites

- Python `3.14` or newer
- Node.js and npm
- An OpenAI API key
- A Clerk application
- An S3-compatible bucket for images and chat attachments

### Environment

Create a `.env` file in the repository root. These names match the current code, including the lowercase backend settings fields.

```bash
OPENAI_API_KEY=your-openai-key
CLERK_SECRET_KEY=your-clerk-secret-key
CLERK_JWT_KEY=your-clerk-jwt-key
VITE_CLERK_PUBLISHABLE_KEY=your-clerk-publishable-key

VITE_API_BASE_URL=/api
PUBLIC_BASE_URL=http://localhost:8000
CORS_ORIGINS=["http://localhost:8000","http://127.0.0.1:8000","http://localhost:5173","http://127.0.0.1:5173"]

database_url=sqlite:///./plodai.db
database_schema_mode=migrations
database_app_schema=plodai
database_shared_schema=public

# Use your own storage values in a real deployment or fork.
storage_bucket_endpoint=https://your-bucket-endpoint
storage_bucket_name=your-bucket-name
storage_bucket_access_key_id=your-access-key
storage_bucket_secret_access_key=your-secret
storage_bucket_region=auto
storage_bucket_url_style=path

# Optional ChatKit frontend defaults
VITE_CHATKIT_DEFAULT_MODEL=balanced
VITE_CHATKIT_LIGHTWEIGHT_MODEL_LABEL=Lightweight
VITE_CHATKIT_BALANCED_MODEL_LABEL=Balanced
VITE_CHATKIT_POWERFUL_MODEL_LABEL=Powerful
```

For deployed PostgreSQL, keep `database_schema_mode=migrations` and set `database_app_schema=plodai`. Startup creates the app schema and runs Alembic with its version table in the app schema.

For Railway public networking, leave `HOST` unset or set it to `0.0.0.0`, and let Railway provide `PORT`. A conflicting host/port can make the deployment look healthy while Railway's edge proxy returns 502.

### Install And Run

Run both toolchains from the repository root.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
npm install
npm run build
python main.py
```

Then open `http://localhost:8000`.

### Frontend Development Mode

To run the backend and Vite frontend separately:

```bash
source .venv/bin/activate
DEV_RELOAD=true python main.py
```

```bash
npm run dev
```

For that workflow, keep `VITE_API_BASE_URL` pointed at the backend API and make sure `CORS_ORIGINS` includes the Vite origin.

## Test Commands

```bash
pytest
npm test
```

## Current Boundaries

- The advisory workspace is the active product surface and still owns many app-domain names in code.
- The vendored shared admin package still uses its historical package name because renaming it requires a coordinated submodule and import migration.
- The backend should stay mostly plumbing: expose the assistant to ChatKit, attach request-scoped persistence, stream progress, and enforce auth/credit gates.
