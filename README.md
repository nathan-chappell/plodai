# PlodAI

PlodAI is an AI-assisted farm operations workspace for image review, structured record-keeping, and simple order publishing. Users can create farms, upload orchard or field images, maintain a canonical farm record, chat with an assistant about visible conditions and operational next steps, and publish public-facing order pages from the saved data.

This repository is intended as both a product demo and a portfolio project. Its main technical goal is to show how a frontend agent experience can be exposed to a reusable runtime using FastAPI, ChatKit, the OpenAI Agents SDK, the Conversations API, and strict typed backend contracts.

> Live app: `https://YOUR-DEPLOYED-URL`
>
> Access note: signing up creates a Clerk account, but it does not automatically unlock the app. After signing up, email `YOUR_EMAIL_HERE` so I can activate the account and grant initial usage credit.

PlodAI is built around one core product idea: the assistant should not only answer questions, it should help maintain a durable and reusable farm record. Each farm has a persistent chat, uploaded images become part of the working context, and the assistant is expected to turn durable facts and image evidence into structured application state rather than leaving everything as loose conversation.

The current domain direction is orchard and small-farm operations. The documentation is written in English for a public portfolio audience, but the product was shaped with local use cases in mind and could be adapted for local farmers, including around Nemetin in eastern Croatia.

## AI runtime and architecture

The AI layer is explicit, typed, and integrated into the product model rather than bolted on as a standalone chatbot.

- `@openai/chatkit` and `@openai/chatkit-react` power the browser chat experience, attachments, starter prompts, and thread interaction.
- The FastAPI backend exposes a ChatKit entrypoint at `/api/farms/{farm_id}/chatkit`.
- Each request builds a request-scoped ChatKit server and memory store so the runtime can attach to the same async SQLAlchemy session used by the rest of the request.
- The OpenAI Agents SDK constructs the `PlodAI` agent and wires in tools, instructions, and model settings.
- The OpenAI Conversations API is used to keep server-side conversation state aligned with local thread state and to recover incomplete tool calls more safely.
- The agent is grounded in strict typed backend structures, especially `FarmRecordPayload`, `FarmArea`, `FarmCrop`, `FarmWorkItem`, `FarmOrder`, and the related response models.
- The frontend owns the user-facing workspace and ChatKit interaction, while the backend owns auth, persistence, credit checks, and agent runtime plumbing.

### Model routing

The runtime routes user-facing model choices to the GPT-5.4 family:

- `lightweight` -> `gpt-5.4-nano`
- `balanced` -> `gpt-5.4-mini`
- `powerful` -> `gpt-5.4`

### Image attachments

Farm images are stored in an S3-compatible Railway bucket rather than directly in the database.

- The app creates presigned upload URLs for chat attachments and uploads the file bytes to object storage.
- After upload, the backend verifies the uploaded object, creates a `FarmImage` record, and stores canonical attachment metadata for the chat thread.
- Image previews in the UI are served through presigned download URLs.
- When the model needs image context, the backend loads the image bytes from the bucket and sends them to OpenAI as high-detail image inputs.
- This keeps large binary files out of the main relational data model while still making them available to both the UI and the agent runtime.

### Agentic capabilities

The assistant uses a small toolset deliberately rather than relying on free-form chat alone.

- It can read the latest saved farm record before making structured updates.
- It can save a complete updated farm record back into the canonical data model.
- It can rename the active thread when the conversation becomes specific enough to deserve a stable title.
- It can use OpenAI hosted web search when fresh public information would materially improve an answer, such as extension guidance, treatment options, or current references.

In practice, this means the assistant can inspect uploaded images, retrieve the current farm record, reason about what should be added or corrected, write those changes back into typed structures, and then continue the conversation with the updated state available to the rest of the application.

## Stack

- Frontend: React 19, Vite, TypeScript, styled-components, Clerk, ChatKit React
- Backend: FastAPI, OpenAI Agents SDK, OpenAI ChatKit server integration, async SQLAlchemy, Pydantic
- Persistence: SQLite by default for application data and ChatKit memory
- Storage: S3-compatible object storage for farm images and chat attachments
- Deployment: currently proven out on Railway

## Key routes

- `/plodai` for the signed-in farm workspace
- `/farms/{farm_id}/orders/{order_id}` for public order pages
- `/admin/users` for activation and credit administration

## Local setup

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

database_url=sqlite:///./ai_portfolio.db

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

### Install and run

Run both the Python and npm toolchains from the repository root.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-dev.txt
npm install
npm run build
python main.py
```

Then open `http://localhost:8000`.

### Frontend development mode

To run the backend and Vite frontend separately:

```bash
source .venv/bin/activate
DEV_RELOAD=true python main.py
```

```bash
npm run dev
```

For that workflow, keep `VITE_API_BASE_URL` pointed at the backend API and make sure `CORS_ORIGINS` includes the Vite origin.

## Test commands

```bash
pytest
npm test
```

## Demonstration

The screenshots below tell a simple user story: a user starts with a mostly empty farm, uploads walnut-orchard photos, lets the assistant inspect them, and ends up with a structured farm record plus a practical assessment.

### 1. The user starts with photos, not a finished dataset

In the first screenshot, the farm record on the left is still almost empty. On the right, the user has attached several walnut-orchard images in the chat composer and is about to ask PlodAI to analyze them. This is important because the workflow does not require the user to prepare a perfect spreadsheet or form in advance; they can begin with natural inputs.

<p align="center">
  <img src="screenshots/just-attached-walnut-images.png" alt="PlodAI with walnut orchard images attached in the chat composer before analysis begins." width="88%" />
</p>

### 2. The assistant inspects the images and uses tools to gather context

In the second screenshot, the assistant is already reasoning over the uploaded images. It is also using a backend tool to fetch the current farm record before deciding what to save. For a non-technical reader, this is the main "agentic" behavior: the system is not only generating text, it is deciding what information it needs, calling a tool, and continuing with more context.

<p align="center">
  <img src="screenshots/thinking-and-showing-tool-call.png" alt="PlodAI reviewing walnut orchard images and showing a get_farm_record tool call in progress." width="88%" />
</p>

### 3. The assistant turns observations into structured farm data

In the third screenshot, the left-hand panel is no longer blank. The assistant has created a usable farm record with a farm name, description, an orchard area, a walnut crop entry, a rough quantity estimate, an expected yield note, and initial work items. The key point is that image observations and chat context have been converted into typed application data that the rest of the product can reuse.

<p align="center">
  <img src="screenshots/farm-record-created.png" alt="A saved Walnut Orchard farm record with area, crop, quantity estimate, expected yield, and work items." width="88%" />
</p>

### 4. The user gets a practical assessment, not just a vague summary

In the final screenshot, the user sees a clearer operational result: saved work items on the left and a practical assessment on the right, including likely issues, suggested follow-up actions, and linked public references. This is the intended outcome of the product: move from raw photos to actionable farm information that can be reviewed, updated, and reused.

<p align="center">
  <img src="screenshots/finished-with-assessment.png" alt="A finished walnut assessment with structured work items and linked public references in the chat response." width="88%" />
</p>

The sample images used during development are available in [`walnut_test_images/`](./walnut_test_images).

## Notes for reviewers

- This is intentionally a light backend. The most interesting engineering work is the runtime wiring between ChatKit, the OpenAI Agents SDK, the Conversations API, and the farm data model.
- Auth and monetization are intentionally simple at this stage: controlled access, manual approval, and usage credit instead of a polished self-serve billing flow.
- The README is in English, while the product itself supports English and Croatian chat output.

## Documentation note

This README was drafted and refined in Codex using GPT-5.4, then reviewed against the repository implementation.
