FROM python:3.14-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py ./
COPY backend ./backend
COPY frontend/dist ./backend/app/static
EXPOSE 8080
CMD ["python", "main.py"]
