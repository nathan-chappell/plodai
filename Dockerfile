FROM python:3.14-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend ./backend
COPY dist ./dist
COPY package.json ./
COPY main.py ./
EXPOSE 8000
CMD ["python", "main.py"]
