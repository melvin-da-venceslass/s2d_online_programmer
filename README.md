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
