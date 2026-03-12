FROM python:3.14-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
COPY gunicorn.conf.py ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend ./backend
COPY frontend/dist ./backend/app/static
EXPOSE 8000
CMD ["gunicorn", "-c", "gunicorn.conf.py", "backend.app.main:app"]
