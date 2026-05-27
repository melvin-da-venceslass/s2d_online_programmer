Program Editor + Super Admin Console

This project now includes two major capabilities:
- Program Editor for recipe step authoring, preview, JSON/ZIP import-export, and PDF/WI generation.
- Super Admin Console for organization hierarchy, user-role management, device mapping, and recipe management.

Core Hierarchy Model:
- Organization -> Branch -> Project -> Line -> Station

Role Model:
- super_admin: Full global access, can create organizations and all levels.
- admin: Scoped to one organization, can manage branch/project/line/station/users/devices/recipes inside that org.
- engineer: Recipe create/edit access within assigned scope.

Storage Path Upgrade

Programs and images support hierarchical paths derived from active station mapping:
- orgs/<org>/<branch>/<project>/<line>/<station>/programs/<part>.json
- orgs/<org>/<branch>/<project>/<line>/<station>/programs/<part>/imgs/<step>.png

When no storage context is selected, legacy root storage remains supported.

MongoDB Upgrade

All admin domain records are persisted in MongoDB when configured:
- organizations
- branches
- projects
- lines
- stations
- users
- devices
- recipes

If MongoDB is not reachable, the admin repository automatically falls back to in-memory mode.

Environment Variables

General:
- APP_NAME
- HOST
- PORT
- DEBUG

Cloud Storage:
- GCS_BUCKET_NAME
- GCS_PREFIX
- GCS_KEY_FILE
- GCS_UPLOAD_EXPIRY_SECONDS
- GCS_DIRECT_UPLOAD_THRESHOLD_BYTES

MongoDB and Admin Bootstrap:
- MONGODB_URI
- MONGODB_DB_NAME
- ADMIN_SESSION_TIMEOUT_MINUTES
- DEFAULT_SUPER_ADMIN_USERNAME
- DEFAULT_SUPER_ADMIN_PASSWORD

Default super admin login (if env vars are not set):
- username: mviis
- password: mviis

Local Run

1. Install dependencies:
   pip install -r requirements.txt

2. Start app:
   python main.py

3. Open:
- Program Editor: /
- Admin Console: /admin

Admin Console Flow

1. If no super admin exists, bootstrap one in /admin.
2. Login as super admin.
3. Create hierarchy: Organization -> Branch -> Project -> Line -> Station.
4. Create users with role and scope.
5. Map devices to stations.
6. Create or update recipes.
7. Use "Use Storage Path" on a station row to activate storage context for Program Editor saves.

Layered Application Structure

- main.py
- program_editor.py
- services/
- repository/
- schemas/
- entities/
- enums/
- models/
- templates/
- static/

Cloud Run Deployment

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

Cloud Storage setup:
1. Create a bucket:
   gsutil mb -l us-central1 gs://YOUR_BUCKET_NAME
2. Add service account key JSON at project root as bucket_key.json (or set GCS_KEY_FILE).
3. Grant Storage Object Admin role.
4. Deploy with bucket substitution:
   gcloud builds submit --config cloudbuild.yaml --substitutions _GCS_BUCKET=YOUR_BUCKET_NAME
