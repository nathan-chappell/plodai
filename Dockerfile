FROM node:22-bookworm-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM python:3.14-slim AS backend-runtime
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
RUN mkdir -p /app/backend/app/static
COPY --from=frontend-builder /app/frontend/dist/ /app/backend/app/static/
EXPOSE 8000
CMD ["python", "-m", "gunicorn", "-c", "gunicorn.conf.py", "app.main:app"]
