FROM node:25-slim AS frontend-build
WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend ./frontend
COPY vendor ./vendor
RUN npm ci
RUN VITE_CLERK_PUBLISHABLE_KEY=pk_test_build_placeholder \
    VITE_API_BASE_URL=/api \
    VITE_CHATKIT_DEFAULT_MODEL=gpt-5.4-mini \
    VITE_CHATKIT_DOMAIN_KEY=domain_pk_build_placeholder \
    npm run build

FROM python:3.14-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt ./
COPY vendor ./vendor
RUN pip install --no-cache-dir -r requirements.txt

COPY alembic.ini ./
COPY migrations ./migrations
COPY backend ./backend
COPY main.py package.json ./
COPY --from=frontend-build /app/dist ./dist

EXPOSE 8000
CMD ["python", "main.py"]
