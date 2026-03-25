# PlodAI

PlodAI is a farm-first demo app with a FastAPI backend and a Vite React frontend. The app centers on farms, one canonical farm record per farm, farm image uploads, one persistent chat per farm, entity search, and public farm-order pages.

## Stack

- Backend: FastAPI, ChatKit, the OpenAI Agents SDK, async SQLAlchemy, SQLite
- Frontend: React, Vite, styled-components, Clerk auth
- Storage: SQLite for app state and ChatKit memory, Railway object storage for farm images

## Routes

- `/plodai` for the signed-in PlodAI app
- `/farms/{farm_id}/orders/{order_id}` for public farm-order pages
- `/admin/users` for admin credit tools

## Backend API

- `GET /api/farms`
- `POST /api/farms`
- `GET /api/farms/{farm_id}`
- `PATCH /api/farms/{farm_id}`
- `GET /api/farms/{farm_id}/record`
- `PUT /api/farms/{farm_id}/record`
- `POST /api/farms/{farm_id}/images`
- `DELETE /api/farms/{farm_id}/images/{image_id}`
- `POST /api/farms/{farm_id}/entities/search`
- `GET /api/public/farms/{farm_id}/orders/{order_id}`
- `POST /api/farms/{farm_id}/chatkit`

## Local run

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-dev.txt
npm install
npm run build
python main.py
```

For frontend-only development:

```bash
npm run dev
```

## Notes

- Clerk bearer auth gates the signed-in API.
- The backend owns the PlodAI agent definition and tool set.
- Farm images are image-only; there is no document/report/chart workspace layer anymore.
