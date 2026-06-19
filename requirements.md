# S2D Online Recipe Programmer - Requirements

## 1. Objective
Build a production-grade web application using Python, FastAPI, MongoDB, HTML, CSS, JavaScript, and Bootstrap to create, edit, manage, and persist recipe JSON files (production process steps), including per-step image annotation and cloud storage.

## 2. Technology Stack
1. Backend: Python + FastAPI
2. Database: MongoDB
3. Frontend: HTML, CSS, JavaScript, Bootstrap
4. Cloud Storage: Google Cloud Storage (GCP bucket)
5. Deployment/Runtime support: existing project setup with Docker/Cloud Build where applicable

## 3. Domain Model Requirements
### 3.1 Recipe
1. A recipe represents one production program.
2. The recipe key identifier is `partname` (example: `IBE151960`).
3. A recipe contains global flags such as `enable_mes`, `enable_ftp`.
4. A recipe contains an ordered list of `steps`.

### 3.2 Step
1. Each step includes common fields: `step_no`, `remarks`.
2. Each step can operate in one of three modes:
   - Barcode
   - Acknowledgement
   - Fastening
3. Mode-specific fields are persisted only when that mode is enabled for the step.
4. Each step may have an associated image path (stored in recipe JSON) pointing to GCP image object.

## 4. Business Rules (Critical)
1. Step 1 is always Barcode mode.
2. Step 1 is always `parent_bc = true`.
3. No step other than step 1 can be `parent_bc = true`.
4. `parent_bc` and `child_bc` are mutually exclusive for a step.
5. If `parent_bc = true`, UI must not allow enabling `child_bc`.
6. If `child_bc = true`, UI must not allow enabling `parent_bc`.
7. Parent or child barcode steps can enable `whatloc`.
8. If `whatloc_enabled = true`, user must be able to enter whatloc details and persist them.
9. If a step is `parent_bc`, it must not allow `enable_barcode_mes`.
10. For Barcode mode, `remarks` must mirror `bc_title`.
11. For Acknowledgement mode, `remarks` must mirror `ack_title`.
12. For Fastening mode, explicit `remarks` input must be available.
13. Step sequence changes (move up/down, delete, duplicate) must re-index `step_no` values.
14. Image names in GCP must be renamed/reordered with step numbers after sequence changes.

## 5. UI/UX Requirements
### 5.1 Main Recipe Management Screen
1. Provide actions to:
   - Create recipe
   - Load recipe
   - Edit recipe
   - Delete recipe
   - Save recipe
2. Display recipe-level metadata and global flags.
3. Display ordered list of steps with quick action controls.

### 5.2 Step Editor UI
1. Add new step.
2. Edit existing step fields.
3. Duplicate step.
4. Move step up.
5. Move step down.
6. Delete step.
7. Save individual step (local draft state).
8. Provide mode toggles per step.
9. Dynamically show/hide fields based on selected mode.
10. Enforce all business rules at UI level before save.

### 5.3 Mode Panels
1. Barcode panel fields:
   - `enable_barcode`
   - `bc_title`
   - `bc_parent`
   - `bc_child`
   - `whatloc_enabled`
   - `check_short_workstation`
   - `check_part_number`
   - `check_ref_designator`
   - `enable_barcode_mes` (disabled/hidden for parent)
2. Acknowledgement panel fields:
   - `request_ack`
   - `ack_title`
   - `enable_ack_mes`
3. Fastening panel fields:
   - All fastening target and control fields (torque/angle/rpm/etc.)
   - `remarks` input dedicated for fastening

### 5.4 Canvas/Image Annotation UI
1. Provide per-step image canvas.
2. Tools required:
   - Draw
   - Erase
   - Clear
   - Undo
   - Redo
   - Save
3. Shape/text/PIP tools required:
   - Square
   - Circle
   - Text
   - PIP
4. Image is saved per step and linked in step JSON.
5. UI must show existing image when editing loaded recipes.

## 6. Application Flow Requirements
### 6.1 Create New Recipe Flow
1. User creates recipe with part name and flags.
2. System auto-creates step 1 as Barcode + Parent barcode.
3. User adds/edits additional steps.
4. User configures mode fields per step.
5. User draws/uploads step image and saves step image.
6. User saves step data to local server state.
7. User saves full recipe.
8. Backend validates all rules.
9. Backend persists recipe to MongoDB and images to GCP.

### 6.2 Edit Existing Recipe Flow
1. User selects recipe to edit.
2. Backend loads recipe from MongoDB.
3. UI populates all step fields.
4. UI fetches and displays existing step images from GCP.
5. User modifies steps/order/modes/images.
6. Changes are stored locally in server temporary edit state.
7. On Save Recipe:
   - Validate full recipe
   - Apply step renumbering if needed
   - Rename/re-map images to match new step numbers
   - Update MongoDB document
   - Update GCP images
8. Clear local temporary server state after successful save.

### 6.3 Delete Recipe Flow
1. User confirms delete.
2. Backend removes recipe document from MongoDB.
3. Backend removes associated images from GCP path.

## 7. Frontend Requirements
1. Use Bootstrap-based responsive layout for desktop and mobile.
2. Use modular JavaScript for:
   - Recipe state management
   - Step operations
   - Mode field visibility and validation
   - Canvas tool handling
3. Prevent invalid mode combinations in real time.
4. Keep form state synchronized with server draft state.
5. Show clear validation errors and save success/failure messages.

## 8. Backend Requirements (FastAPI)
### 8.1 API Endpoints
1. Recipe CRUD endpoints:
   - Create recipe
   - Get recipe by partname
   - List/search recipes
   - Update recipe
   - Delete recipe
2. Step operations endpoint(s) as needed for step-level save/draft.
3. Image endpoints:
   - Upload/save step image
   - Retrieve step image URL/content
   - Rename/re-map images on step reorder
   - Delete step image

### 8.2 Validation and Processing
1. Validate schema for recipe and steps.
2. Enforce critical business rules.
3. Auto-sync `remarks` for Barcode (`bc_title`) and Acknowledgement (`ack_title`).
4. Handle step renumbering atomically.
5. Ensure consistency between DB step numbers and image object names.
6. Maintain transactional-like behavior across MongoDB + GCP updates (best-effort rollback/compensation on failure).

### 8.3 Local Edit State Handling
1. During edit, maintain temporary server-side working copy.
2. Only commit to MongoDB/GCP on final Save Recipe.
3. Clear temporary state after successful commit.

## 9. Database Requirements (MongoDB)
1. Store each recipe as a document keyed by `partname`.
2. Persist complete `steps` array in order.
3. Store per-step image path string in step payload.
4. Add indexes for recipe lookup by `partname`.
5. Track updated timestamp and optional audit fields.

## 10. GCP Storage Requirements
1. Bucket object path format:
   - `bucket/program_editor/<part_name>/imgs/<step_no>.png`
2. On step image save, upload to corresponding path.
3. On step reorder, rename/copy-delete objects so file names match new `step_no`.
4. On recipe delete, remove all image objects under recipe prefix.
5. Persist final object path in corresponding step JSON.

## 11. JSON Contract Requirements
1. Output JSON must preserve required schema fields.
2. Include only relevant mode fields based on enabled mode(s), or maintain explicit flags with consistent defaults.
3. Keep `step_no` sequential, unique, and ordered.
4. Keep image path aligned with step number and part name.
5. Ensure `remarks` mapping rules are applied correctly.

## 12. Error Handling and User Feedback
1. Provide clear validation errors for rule violations.
2. Provide API error responses with actionable messages.
3. Handle partial failures (DB success, GCP failure and vice versa) with recovery logic.
4. Display upload/processing progress and failure retry options for images.

## 13. Security and Operational Requirements
1. Validate and sanitize all inputs.
2. Restrict accepted image formats and size.
3. Use environment configuration for DB and GCP credentials.
4. Add logging for recipe save/update/delete and image operations.
5. Add basic role-based access hooks if admin/user roles are used.

## 14. Suggested Project Structure
1. `main.py`
2. `models/`
3. `routes/`
4. `templates/`
5. `static/`
6. `database/`
7. `utils/`
8. `entities/`
9. `enums/`
10. `requirements.txt`
11. `.env`
12. `config.py`

## 15. Acceptance Checklist
1. User can create/load/edit/delete recipes from UI.
2. Step operations (add/edit/duplicate/move/delete) work and preserve valid sequencing.
3. Mode-specific fields render conditionally and save correctly.
4. Step 1 parent barcode constraints are always enforced.
5. Whatloc fields appear and persist when enabled.
6. Canvas tools operate correctly; images save and reload per step.
7. Image object names/paths remain aligned after step reorder.
8. Recipe saves to MongoDB and images save to GCP.
9. Edit flow uses local temporary state and clears it after save.
10. JSON output matches schema and business rules.

## 16. Login Page UX/UI Requirements
### 16.1 Goals
1. Improve login usability for first-time and returning users.
2. Provide a modern, clean, and trustworthy visual design aligned with enterprise use.
3. Minimize login errors and recovery friction.

### 16.2 Functional Requirements
1. Login form must include:
   - Email or username input
   - Password input
   - Show/hide password toggle
   - Submit button
2. Provide a "Forgot Password" flow entry point.
3. Optionally support "Remember Me" session persistence.
4. Validate required fields before submit.
5. Validate email format when email-based login is used.
6. Disable submit button while authentication request is in progress.
7. Show clear inline and global error messages for invalid credentials or server issues.
8. Redirect authenticated users to the appropriate landing page based on role.

### 16.3 UX/UI Requirements
1. Use a responsive layout that works on desktop, tablet, and mobile.
2. Keep visual hierarchy clear with prominent title, concise helper text, and primary action button.
3. Ensure accessible color contrast for text, inputs, and buttons.
4. Provide visible input focus states and keyboard navigation support.
5. Use meaningful placeholders and field labels (do not rely only on placeholders).
6. Add subtle feedback states for loading, success, and failure.
7. Keep the design visually appealing, uncluttered, and user-friendly.

### 16.4 Security Requirements for Login
1. Never expose sensitive authentication details in frontend logs.
2. Use secure session/token handling.
3. Implement brute-force protection strategy (rate limiting or lockout policy).
4. Use secure password handling practices on backend.

## 17. Administration Requirements
### 17.1 Organization Management
1. Allow administrators to create organizations.
2. Allow administrators to edit organization details.
3. Allow administrators to delete organizations.
4. Provide an administrator dashboard to view and manage all organizations.
5. Enforce role-based access control (RBAC) for all organization management actions.

### 17.2 User Management
1. Allow administrators to create user accounts.
2. Allow administrators to edit user accounts.
3. Allow administrators to delete user accounts.
4. Provide an administrator dashboard to view and manage all users.
5. Enforce RBAC for all user lifecycle actions.

### 17.3 Permission Management
1. Allow administrators to define permissions by role.
2. Allow administrators to update and revoke permissions.
3. Provide a dashboard to view effective permissions by role and user.
4. Enforce RBAC around permission administration.

### 17.4 Audit Logging
1. Log all administrative actions (create, edit, delete, permission changes, security changes).
2. Include actor, action, target entity, timestamp, and outcome in audit entries.
3. Provide an administrator dashboard to view and search audit logs.
4. Ensure audit logs are tamper-resistant and access-controlled.

### 17.5 Security and Compliance
1. Implement controls to protect sensitive user and organization data.
2. Provide a dashboard for managing security settings and compliance status.
3. Maintain and update security controls to address emerging threats.
4. Support compliance reporting hooks for internal and external audits.

## 18. Application Domain and Hierarchy Requirements
### 18.1 Organization Structure
1. The application supports multiple Organizations.
2. Each Organization contains Users.
3. Each Organization contains Branches (shop floors).

### 18.2 User Entity Fields
1. Required user fields:
   - Name
   - Email
   - Role
   - Password

### 18.3 Branch (Shop Floor) Entity
1. Required branch fields:
   - Name
   - Location
   - Manager
2. Each Branch contains Projects.

### 18.4 Project Entity
1. Required project fields:
   - Name
   - Description
2. Each Project contains Lines.

### 18.5 Line Entity
1. Required line fields:
   - Name
   - Description
2. Each Line contains Stations.

### 18.6 Station Entity
1. Required station fields:
   - Name
   - Description
   - Mapped Device
   - Mapped Recipe

### 18.7 Additional Organization Assets
1. Each Organization must support management of:
   - Recipes
   - Devices
   - Maps

## 19. Recipe Mapping Requirements
### 19.1 Recipe Map
1. The system must provide recipe mapping for devices and recipes.
2. For mapped devices and recipes, store mapping context including:
   - Recipe ID
   - Organization
   - Branch
   - Project
   - Line
   - Station
   - Device

### 19.2 Partial Mapping Support
1. If full mapping (line/station/device) is not available, the system must still support recipe association with:
   - Recipe ID
   - Organization
   - Branch
   - Project
2. Mapping validation must indicate whether mapping is full or partial.

## 20. Extended Acceptance Checklist
1. Login page is responsive, accessible, and provides clear validation/feedback states.
2. Organization CRUD is available for authorized administrators only.
3. User CRUD is available for authorized administrators only.
4. Permission definitions and updates are manageable via admin dashboard.
5. Audit logs capture all critical administrative actions and are searchable.
6. Security/compliance dashboard exposes current posture and configurable controls.
7. Domain hierarchy (Organization -> Branch -> Project -> Line -> Station) is represented and manageable.
8. Recipe mappings can be saved as full mappings (with device/station context) or partial mappings.

## 21. Role Hierarchy and RBAC Permission Matrix
### 21.1 Role Scope Boundaries
1. `super-admin` can create and manage everything under the Organization scope.
2. `admin` can create and manage everything under the Branch scope.
3. `engineer` can only create and manage Projects under the Branch scope.

### 21.2 Canonical Role Permissions
```json
{
   "roles": {
      "super-admin": {
         "permissions": [
            "create_organization",
            "manage_organization",
            "create_branch",
            "manage_branch",
            "create_project",
            "manage_project",
            "manage_user",
            "manage_role",
            "manage_permission",
            "manage_devices",
            "map_devices_recipes"
         ]
      },
      "admin": {
         "permissions": [
            "create_branch",
            "manage_branch",
            "create_project",
            "manage_project",
            "manage_user",
            "manage_role",
            "manage_permission",
            "manage_devices",
            "map_devices_recipes"
         ]
      },
      "engineer": {
         "permissions": [
            "create_project",
            "manage_project",
            "map_devices_recipes"
         ]
      }
   }
}
```

### 21.3 Enforcement Requirements
1. All API endpoints and UI actions must enforce role permissions server-side.
2. UI should hide or disable actions that are not allowed for the logged-in role.
3. Permission checks must be scope-aware:
    - Organization scope checks for `super-admin` actions.
    - Branch scope checks for `admin` and `engineer` actions.
4. Unauthorized actions must return clear `403 Forbidden` responses.
5. Audit logs must record permission-denied attempts with actor, action, target, and timestamp.

### 21.4 RBAC Acceptance Criteria
1. `super-admin` can perform organization-level and all subordinate operations.
2. `admin` cannot perform organization-level operations outside assigned scope.
3. `engineer` can only create/manage projects and map devices/recipes within authorized branch scope.
4. Any action outside role scope is blocked in both UI and API.