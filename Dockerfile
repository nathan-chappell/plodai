FROM node:25-slim AS frontend-build
WORKDIR /app

ARG PUBLIC_CLERK_PUBLISHABLE=pk_test_build_placeholder
ARG PUBLIC_API_BASE=/api
ARG PUBLIC_CHATKIT_MODEL=gpt-5.4-mini
ARG PUBLIC_CHATKIT_DOMAIN=domain_pk_build_placeholder

COPY package.json package-lock.json ./
COPY frontend ./frontend
COPY vendor ./vendor
RUN npm ci
RUN VITE_CLERK_PUBLISHABLE_KEY=${PUBLIC_CLERK_PUBLISHABLE} \
    VITE_API_BASE_URL=${PUBLIC_API_BASE} \
    VITE_CHATKIT_DEFAULT_MODEL=${PUBLIC_CHATKIT_MODEL} \
    VITE_CHATKIT_DOMAIN_KEY=${PUBLIC_CHATKIT_DOMAIN} \
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
