Program Editor

Local-first program editor for creating and managing step-based recipes.

Features
- Program editing with step add/insert/clone/delete
- JSON and ZIP upload/download
- PDF and WI export
- Local file storage under programs/
- In-memory admin repository (no external database required)

Run locally
1. Install dependencies:
   pip install -r requirements.txt

2. Start app:
   python main.py

3. Open:
   http://localhost:8000/

Environment variables
- APP_NAME
- HOST
- PORT
- DEBUG
- ADMIN_SESSION_TIMEOUT_MINUTES
- DEFAULT_SUPER_ADMIN_USERNAME
- DEFAULT_SUPER_ADMIN_PASSWORD

Project entry point
- main.py imports and runs app from program_editor.py
