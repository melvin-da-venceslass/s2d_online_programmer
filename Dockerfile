FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_NAME="Program Editor" \
    HOST=0.0.0.0 \
    PORT=8000 \
    DEBUG=false \
    GCS_BUCKET_NAME=app_release_bucket \
    GCS_PREFIX=program-editor \
    GCS_KEY_FILE=/app/key.json \
    GCS_UPLOAD_EXPIRY_SECONDS=900 \
    GCS_DIRECT_UPLOAD_THRESHOLD_BYTES=20971520 \
    MONGODB_URI=mongodb+srv://mviis_admin:d5uNysSB0uiYT3pK@mviis.bbuf8.mongodb.net/myFirstDatabase?retryWrites=true \
    MONGODB_DB_NAME=program_editor \
    DEFAULT_SUPER_ADMIN_USERNAME=mviis \
    DEFAULT_SUPER_ADMIN_PASSWORD=mviis

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080

CMD ["sh", "-c", "uvicorn program_editor:app --host 0.0.0.0 --port ${PORT:-8080}"]
