FROM python:3.14-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
COPY package.json ./
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py ./
COPY backend ./backend
COPY dist ./dist
EXPOSE 8000
CMD ["python", "main.py"]
