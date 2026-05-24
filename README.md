Program Editor - Cloud Run Deployment

This repository is ready for Google Cloud Run deployment.

Files used for deployment:
- Dockerfile: Builds the FastAPI app container.
- cloudbuild.yaml: Builds, pushes, and deploys with Cloud Build.
- .gcloudignore: Excludes local-only files during source upload.

One-time setup in your Google Cloud project:
1. Enable APIs:
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

2. Set project:
   gcloud config set project YOUR_PROJECT_ID

Deploy manually from local clone:
1. Build and deploy from source:
   gcloud run deploy program-editor --source . --region us-central1 --allow-unauthenticated

Deploy from Git repository using Cloud Build trigger:
1. In Cloud Build, create a trigger connected to this repository.
2. Set trigger config file path to:
   cloudbuild.yaml
3. Optional substitutions:
   _SERVICE_NAME=program-editor
   _REGION=us-central1
   _AR_REPO=cloud-run
4. Run the trigger.

Notes:
- Cloud Run provides an ephemeral filesystem.
- Data written to the local programs directory may not persist across instance restarts.
- For persistent storage, move program JSON/images to Cloud Storage or a database.

Cloud Storage setup for large uploads and persistence:
1. Create a bucket (or reuse one):
   gsutil mb -l us-central1 gs://YOUR_BUCKET_NAME
2. Create a service account key JSON and place it at project root as:
   bucket_key.json
3. Grant the service account access to the bucket (at minimum: Storage Object Admin).
4. Deploy with Cloud Build substitution for bucket name:
   gcloud builds submit --config cloudbuild.yaml --substitutions _GCS_BUCKET=YOUR_BUCKET_NAME

How uploads work after enabling bucket settings:
- Small JSON/ZIP uploads continue using regular multipart upload.
- Large JSON/ZIP uploads use a signed URL and upload directly from browser to GCS.
- The app then imports the uploaded object from GCS and persists program JSON + images back into the bucket.

CORS setup for browser uploads:
1. Create a file named `bucket-cors.json` in the project root with the CORS rules below.
2. Apply it to the bucket:
    gcloud storage buckets update gs://YOUR_BUCKET_NAME --cors-file=bucket-cors.json

Recommended `bucket-cors.json`:
[
   {
      "origin": ["http://localhost:8000", "http://127.0.0.1:8000"],
      "method": ["GET", "PUT", "POST", "HEAD", "OPTIONS"],
      "responseHeader": ["Content-Type", "x-goog-resumable", "Authorization"],
      "maxAgeSeconds": 3600
   }
]

If you deploy the frontend under a different domain, add that origin to the list as well.
