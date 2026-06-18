FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_NAME="Program Editor" \
    HOST=0.0.0.0 \
    PORT=8000 \
    DEBUG=false \
    DEFAULT_SUPER_ADMIN_USERNAME=mviis \
    DEFAULT_SUPER_ADMIN_PASSWORD=mviis

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080

CMD ["sh", "-c", "uvicorn program_editor:app --host 0.0.0.0 --port ${PORT:-8080}"]
