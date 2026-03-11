FROM python:3.14-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend ./backend
COPY dist ./backend/app/static
WORKDIR /app/backend
EXPOSE 8000
CMD ["python", "-m", "gunicorn", "-c", "../gunicorn.conf.py", "app.main:app"]
