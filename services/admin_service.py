from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import threading
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import HTTPException

from enums.roles import UserRole
from repository.mongo_repository import AdminRepository


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AdminService:
    def __init__(self, repository: AdminRepository, session_timeout_minutes: int = 30) -> None:
        self.repo = repository
        self._session_lock = threading.Lock()
        self._sessions: Dict[str, Dict[str, Any]] = {}
        self._session_timeout_minutes = max(1, int(session_timeout_minutes or 30))

    @staticmethod
    def _normalize_code(value: str) -> str:
        cleaned = "".join(ch if ch.isalnum() or ch in ("_", "-") else "_" for ch in value.strip().lower())
        cleaned = cleaned.strip("._")
        return cleaned or "na"

    @staticmethod
    def _hash_password(password: str) -> str:
        salt = os.urandom(16)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120000)
        return base64.b64encode(salt + digest).decode("ascii")

    @staticmethod
    def _verify_password(password: str, encoded: str) -> bool:
        raw = base64.b64decode(encoded.encode("ascii"))
        salt, digest = raw[:16], raw[16:]
        test = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120000)
        return hmac.compare_digest(digest, test)

    def _issue_token(self, user_id: str, role: UserRole) -> Dict[str, Any]:
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=self._session_timeout_minutes)
        with self._session_lock:
            self._sessions[token] = {
                "user_id": user_id,
                "role": role.value,
                "expires_at_epoch": int(expires_at.timestamp()),
            }
        return {
            "token": token,
            "expires_at_epoch": int(expires_at.timestamp()),
            "expires_in_seconds": self._session_timeout_minutes * 60,
        }

    def require_user(self, token: str) -> Dict[str, Any]:
        if not token:
            raise HTTPException(status_code=401, detail="Missing admin token")
        with self._session_lock:
            session = self._sessions.get(token)
            if session and int(session.get("expires_at_epoch", 0)) <= int(datetime.now(timezone.utc).timestamp()):
                self._sessions.pop(token, None)
                session = None
        if not session:
            raise HTTPException(status_code=401, detail="Invalid or expired admin token")
        user = self.repo.get_user_by_id(session["user_id"])
        if not user:
            raise HTTPException(status_code=401, detail="User session is invalid")
        return user

    def logout(self, token: str) -> None:
        if not token:
            return
        with self._session_lock:
            self._sessions.pop(token, None)

    def _assert_role(self, user: Dict[str, Any], allowed: set[UserRole]) -> None:
        role = UserRole(user["role"])
        if role not in allowed:
            raise HTTPException(status_code=403, detail="Insufficient permissions")

    def bootstrap_super_admin(self, username: str, password: str, user_group: str = "global") -> Dict[str, Any]:
        existing = [u for u in self.repo.list_users() if u.get("role") == UserRole.SUPER_ADMIN.value]
        if existing:
            raise HTTPException(status_code=409, detail="Super admin already exists")

        user = {
            "user_id": str(uuid.uuid4()),
            "username": username.strip().lower(),
            "password_hash": self._hash_password(password),
            "user_group": user_group,
            "role": UserRole.SUPER_ADMIN.value,
            "organization_id": None,
            "branch_id": None,
            "project_id": None,
            "line_id": None,
            "station_id": None,
            "active": True,
            "created_at": _utc_now(),
        }
        created = self.repo.create_user(user)
        return self._safe_user(created)

    def login(self, username: str, password: str) -> Dict[str, Any]:
        user = self.repo.get_user_by_username(username.strip().lower())
        if not user or not user.get("active", True):
            raise HTTPException(status_code=401, detail="Invalid credentials")

        if not self._verify_password(password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid credentials")

        token_info = self._issue_token(user["user_id"], UserRole(user["role"]))
        return {
            "token": token_info["token"],
            "user": self._safe_user(user),
            "expires_at_epoch": token_info["expires_at_epoch"],
            "expires_in_seconds": token_info["expires_in_seconds"],
        }

    def _safe_user(self, user: Dict[str, Any]) -> Dict[str, Any]:
        out = dict(user)
        out.pop("password_hash", None)
        return out

    def create_user(self, actor: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
        actor_role = UserRole(actor["role"])
        target_role = UserRole(payload["role"])
        if actor_role == UserRole.SUPER_ADMIN:
            pass
        elif actor_role == UserRole.ADMIN:
            if target_role == UserRole.SUPER_ADMIN:
                raise HTTPException(status_code=403, detail="Admin cannot create super admin users")
            if payload.get("organization_id") and payload.get("organization_id") != actor.get("organization_id"):
                raise HTTPException(status_code=403, detail="Admin can only create users in own organization")
            payload["organization_id"] = actor.get("organization_id")
        else:
            raise HTTPException(status_code=403, detail="Engineer cannot create users")

        if self.repo.get_user_by_username(payload["username"].strip().lower()):
            raise HTTPException(status_code=409, detail="Username already exists")

        user = {
            "user_id": str(uuid.uuid4()),
            "username": payload["username"].strip().lower(),
            "password_hash": self._hash_password(payload["password"]),
            "user_group": payload.get("user_group", "default"),
            "role": target_role.value,
            "organization_id": payload.get("organization_id"),
            "branch_id": payload.get("branch_id"),
            "project_id": payload.get("project_id"),
            "line_id": payload.get("line_id"),
            "station_id": payload.get("station_id"),
            "active": True,
            "created_at": _utc_now(),
        }
        return self._safe_user(self.repo.create_user(user))

    def create_organization(self, actor: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
        self._assert_role(actor, {UserRole.SUPER_ADMIN})
        org = {
            "organization_id": str(uuid.uuid4()),
            "name": payload["name"].strip(),
            "code": self._normalize_code(payload["code"]),
            "created_at": _utc_now(),
            "created_by": actor["user_id"],
        }
        return self.repo.create_organization(org)

    def create_branch(self, actor: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
        self._assert_role(actor, {UserRole.SUPER_ADMIN, UserRole.ADMIN})
        self._assert_actor_scope(actor, payload["organization_id"])
        if not self.repo.get_organization(payload["organization_id"]):
            raise HTTPException(status_code=404, detail="Organization not found")
        doc = {
            "branch_id": str(uuid.uuid4()),
            "organization_id": payload["organization_id"],
            "name": payload["name"].strip(),
            "code": self._normalize_code(payload["code"]),
            "created_at": _utc_now(),
            "created_by": actor["user_id"],
        }
        return self.repo.create_branch(doc)

    def create_project(self, actor: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
        self._assert_role(actor, {UserRole.SUPER_ADMIN, UserRole.ADMIN})
        self._assert_actor_scope(actor, payload["organization_id"])
        branch = self.repo.get_branch(payload["branch_id"])
        if not branch:
            raise HTTPException(status_code=404, detail="Branch not found")
        doc = {
            "project_id": str(uuid.uuid4()),
            "organization_id": payload["organization_id"],
            "branch_id": payload["branch_id"],
            "name": payload["name"].strip(),
            "code": self._normalize_code(payload["code"]),
            "created_at": _utc_now(),
            "created_by": actor["user_id"],
        }
        return self.repo.create_project(doc)

    def create_line(self, actor: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
        self._assert_role(actor, {UserRole.SUPER_ADMIN, UserRole.ADMIN})
        self._assert_actor_scope(actor, payload["organization_id"])
        project = self.repo.get_project(payload["project_id"])
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        doc = {
            "line_id": str(uuid.uuid4()),
            "organization_id": payload["organization_id"],
            "branch_id": payload["branch_id"],
            "project_id": payload["project_id"],
            "name": payload["name"].strip(),
            "code": self._normalize_code(payload["code"]),
            "created_at": _utc_now(),
            "created_by": actor["user_id"],
        }
        return self.repo.create_line(doc)

    def create_station(self, actor: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
        self._assert_role(actor, {UserRole.SUPER_ADMIN, UserRole.ADMIN})
        self._assert_actor_scope(actor, payload["organization_id"])
        line = self.repo.get_line(payload["line_id"])
        if not line:
            raise HTTPException(status_code=404, detail="Line not found")
        doc = {
            "station_id": str(uuid.uuid4()),
            "organization_id": payload["organization_id"],
            "branch_id": payload["branch_id"],
            "project_id": payload["project_id"],
            "line_id": payload["line_id"],
            "name": payload["name"].strip(),
            "code": self._normalize_code(payload["code"]),
            "created_at": _utc_now(),
            "created_by": actor["user_id"],
        }
        return self.repo.create_station(doc)

    def create_device(self, actor: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
        self._assert_role(actor, {UserRole.SUPER_ADMIN, UserRole.ADMIN})
        self._assert_actor_scope(actor, payload["organization_id"])
        if not self.repo.get_station(payload["station_id"]):
            raise HTTPException(status_code=404, detail="Station not found")
        doc = {
            "device_id": str(uuid.uuid4()),
            "organization_id": payload["organization_id"],
            "branch_id": payload["branch_id"],
            "project_id": payload["project_id"],
            "line_id": payload["line_id"],
            "station_id": payload["station_id"],
            "name": payload["name"].strip(),
            "device_code": payload["device_code"].strip(),
            "metadata": payload.get("metadata", {}),
            "created_at": _utc_now(),
            "created_by": actor["user_id"],
        }
        return self.repo.create_device(doc)

    def upsert_recipe(self, actor: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
        self._assert_role(actor, {UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.ENGINEER})
        self._assert_actor_scope(actor, payload["organization_id"])
        doc = {
            "recipe_id": str(uuid.uuid4()),
            "name": payload["name"].strip(),
            "description": payload.get("description", "").strip(),
            "payload": payload.get("payload", {}),
            "organization_id": payload["organization_id"],
            "branch_id": payload.get("branch_id"),
            "project_id": payload.get("project_id"),
            "line_id": payload.get("line_id"),
            "station_id": payload.get("station_id"),
            "updated_at": _utc_now(),
            "updated_by": actor["user_id"],
        }
        return self.repo.create_recipe(doc)

    def _assert_actor_scope(self, actor: Dict[str, Any], organization_id: Optional[str]) -> None:
        role = UserRole(actor["role"])
        if role == UserRole.SUPER_ADMIN:
            return
        if role == UserRole.ADMIN and actor.get("organization_id") == organization_id:
            return
        if role == UserRole.ENGINEER and actor.get("organization_id") == organization_id:
            return
        raise HTTPException(status_code=403, detail="Operation outside your allowed scope")

    def tree_view(self, actor: Dict[str, Any]) -> Dict[str, Any]:
        org_filters = {}
        role = UserRole(actor["role"])
        if role != UserRole.SUPER_ADMIN:
            org_filters = {"organization_id": actor.get("organization_id")}

        organizations = self.repo.list_organizations()
        if org_filters:
            organizations = [o for o in organizations if o.get("organization_id") == org_filters["organization_id"]]

        branches = self.repo.list_branches()
        projects = self.repo.list_projects()
        lines = self.repo.list_lines()
        stations = self.repo.list_stations()
        devices = self.repo.list_devices()
        recipes = self.repo.list_recipes()
        users = self.repo.list_users()

        if org_filters:
            org_id = org_filters["organization_id"]
            branches = [b for b in branches if b.get("organization_id") == org_id]
            projects = [p for p in projects if p.get("organization_id") == org_id]
            lines = [l for l in lines if l.get("organization_id") == org_id]
            stations = [s for s in stations if s.get("organization_id") == org_id]
            devices = [d for d in devices if d.get("organization_id") == org_id]
            recipes = [r for r in recipes if r.get("organization_id") == org_id]
            users = [u for u in users if u.get("organization_id") == org_id]

        tree = []
        branch_map = {}
        project_map = {}
        line_map = {}
        station_map = {}

        for org in organizations:
            entry = dict(org)
            entry["branches"] = []
            tree.append(entry)

        org_map = {org["organization_id"]: org for org in tree}

        for branch in branches:
            entry = dict(branch)
            entry["projects"] = []
            branch_map[entry["branch_id"]] = entry
            if entry["organization_id"] in org_map:
                org_map[entry["organization_id"]]["branches"].append(entry)

        for project in projects:
            entry = dict(project)
            entry["lines"] = []
            project_map[entry["project_id"]] = entry
            if entry["branch_id"] in branch_map:
                branch_map[entry["branch_id"]]["projects"].append(entry)

        for line in lines:
            entry = dict(line)
            entry["stations"] = []
            line_map[entry["line_id"]] = entry
            if entry["project_id"] in project_map:
                project_map[entry["project_id"]]["lines"].append(entry)

        for station in stations:
            entry = dict(station)
            entry["devices"] = []
            station_map[entry["station_id"]] = entry
            if entry["line_id"] in line_map:
                line_map[entry["line_id"]]["stations"].append(entry)

        for device in devices:
            station_id = device.get("station_id")
            if station_id in station_map:
                station_map[station_id]["devices"].append(dict(device))

        return {
            "organizations": tree,
            "users": [self._safe_user(user) for user in users],
            "recipes": recipes,
            "mongo_enabled": self.repo.mongo_enabled,
        }

    def list_recipes_for_actor(self, actor: Dict[str, Any]) -> list[Dict[str, Any]]:
        role = UserRole(actor["role"])
        if role == UserRole.SUPER_ADMIN:
            return self.repo.list_recipes()

        org_id = actor.get("organization_id")
        if not org_id:
            return []
        return self.repo.list_recipes({"organization_id": org_id})

    def map_recipe_to_device(self, actor: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
        self._assert_role(actor, {UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.ENGINEER})
        device = self.repo.get_device(payload["device_id"])
        if not device:
            raise HTTPException(status_code=404, detail="Device not found")
        self._assert_actor_scope(actor, device.get("organization_id"))
        doc = {
            "map_id": str(uuid.uuid4()),
            "recipe_name": payload["recipe_name"].strip(),
            "organization_id": device["organization_id"],
            "branch_id": device.get("branch_id"),
            "project_id": device.get("project_id"),
            "line_id": device.get("line_id"),
            "station_id": device.get("station_id"),
            "device_id": payload["device_id"],
            "mapped_at": _utc_now(),
            "mapped_by": actor["user_id"],
        }
        return self.repo.create_recipe_device_map(doc)

    def update_organization(self, actor: Dict[str, Any], org_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        self._assert_role(actor, {UserRole.SUPER_ADMIN})
        if not self.repo.get_organization(org_id):
            raise HTTPException(status_code=404, detail="Organization not found")
        patch = {"name": payload["name"].strip(), "code": self._normalize_code(payload["code"]), "updated_at": _utc_now()}
        return self.repo.update_organization(org_id, patch) or {}

    def update_branch(self, actor: Dict[str, Any], branch_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        self._assert_role(actor, {UserRole.SUPER_ADMIN, UserRole.ADMIN})
        branch = self.repo.get_branch(branch_id)
        if not branch:
            raise HTTPException(status_code=404, detail="Branch not found")
        self._assert_actor_scope(actor, branch["organization_id"])
        patch = {"name": payload["name"].strip(), "code": self._normalize_code(payload["code"]), "updated_at": _utc_now()}
        return self.repo.update_branch(branch_id, patch) or {}

    def update_project(self, actor: Dict[str, Any], project_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        self._assert_role(actor, {UserRole.SUPER_ADMIN, UserRole.ADMIN})
        project = self.repo.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        self._assert_actor_scope(actor, project["organization_id"])
        patch = {"name": payload["name"].strip(), "code": self._normalize_code(payload["code"]), "updated_at": _utc_now()}
        return self.repo.update_project(project_id, patch) or {}

    def update_line(self, actor: Dict[str, Any], line_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        self._assert_role(actor, {UserRole.SUPER_ADMIN, UserRole.ADMIN})
        line = self.repo.get_line(line_id)
        if not line:
            raise HTTPException(status_code=404, detail="Line not found")
        self._assert_actor_scope(actor, line["organization_id"])
        patch = {"name": payload["name"].strip(), "code": self._normalize_code(payload["code"]), "updated_at": _utc_now()}
        return self.repo.update_line(line_id, patch) or {}

    def update_station(self, actor: Dict[str, Any], station_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        self._assert_role(actor, {UserRole.SUPER_ADMIN, UserRole.ADMIN})
        station = self.repo.get_station(station_id)
        if not station:
            raise HTTPException(status_code=404, detail="Station not found")
        self._assert_actor_scope(actor, station["organization_id"])
        patch = {"name": payload["name"].strip(), "code": self._normalize_code(payload["code"]), "updated_at": _utc_now()}
        return self.repo.update_station(station_id, patch) or {}

    def update_device(self, actor: Dict[str, Any], device_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        self._assert_role(actor, {UserRole.SUPER_ADMIN, UserRole.ADMIN})
        device = self.repo.get_device(device_id)
        if not device:
            raise HTTPException(status_code=404, detail="Device not found")
        self._assert_actor_scope(actor, device["organization_id"])
        patch = {"name": payload["name"].strip(), "device_code": payload["device_code"].strip(), "updated_at": _utc_now()}
        return self.repo.update_device(device_id, patch) or {}

    def update_user(self, actor: Dict[str, Any], user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        actor_role = UserRole(actor["role"])
        target = self.repo.get_user_by_id(user_id)
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        target_role = UserRole(target["role"])
        new_role = UserRole(payload["role"])
        if actor_role == UserRole.SUPER_ADMIN:
            pass
        elif actor_role == UserRole.ADMIN:
            if target_role == UserRole.SUPER_ADMIN:
                raise HTTPException(status_code=403, detail="Cannot edit a super admin")
            if new_role == UserRole.SUPER_ADMIN:
                raise HTTPException(status_code=403, detail="Cannot assign super admin role")
            if target.get("organization_id") and target.get("organization_id") != actor.get("organization_id"):
                raise HTTPException(status_code=403, detail="Cannot edit users outside your organization")
        else:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        patch = {
            "username": payload["username"].strip().lower(),
            "user_group": payload.get("user_group") or "default",
            "role": new_role.value,
            "active": bool(payload.get("active", True)),
            "updated_at": _utc_now(),
        }
        return self._safe_user(self.repo.update_user(user_id, patch) or {})

    def upsert_program_recipe(
        self,
        actor: Dict[str, Any],
        program: Dict[str, Any],
        name: Optional[str] = None,
        description: str = "Auto-synced from Program Editor",
    ) -> Dict[str, Any]:
        role = UserRole(actor["role"])
        if role not in {UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.ENGINEER}:
            raise HTTPException(status_code=403, detail="Role cannot manage recipes")

        storage_context = program.get("storage_context") if isinstance(program, dict) else {}
        if not isinstance(storage_context, dict):
            storage_context = {}

        recipe_name = str(name or program.get("partname") or "").strip()
        if not recipe_name:
            raise HTTPException(status_code=400, detail="Part or recipe name is required")

        organization_id = actor.get("organization_id")
        branch_id = actor.get("branch_id")
        project_id = actor.get("project_id")
        line_id = actor.get("line_id")
        station_id = actor.get("station_id")

        if role == UserRole.SUPER_ADMIN and not organization_id and storage_context.get("organization_code"):
            org_code = str(storage_context.get("organization_code") or "").strip().lower()
            for org in self.repo.list_organizations():
                if str(org.get("code") or "").strip().lower() == org_code:
                    organization_id = org.get("organization_id")
                    break

        if not organization_id:
            organization_id = "global"

        doc = {
            "recipe_id": str(uuid.uuid4()),
            "name": recipe_name,
            "description": description,
            "payload": program,
            "organization_id": organization_id,
            "branch_id": branch_id,
            "project_id": project_id,
            "line_id": line_id,
            "station_id": station_id,
            "updated_at": _utc_now(),
            "updated_by": actor["user_id"],
        }
        return self.repo.create_recipe(doc)

    def bootstrap_state(self) -> Dict[str, Any]:
        super_admin_exists = any(u.get("role") == UserRole.SUPER_ADMIN.value for u in self.repo.list_users())
        return {
            "super_admin_exists": super_admin_exists,
            "mongo_enabled": self.repo.mongo_enabled,
        }

    def build_storage_context(self, actor: Dict[str, Any], station_id: str) -> Dict[str, str]:
        station = self.repo.get_station(station_id)
        if not station:
            raise HTTPException(status_code=404, detail="Station not found")
        self._assert_actor_scope(actor, station.get("organization_id"))

        line = self.repo.get_line(station["line_id"]) or {}
        project = self.repo.get_project(station["project_id"]) or {}
        branch = self.repo.get_branch(station["branch_id"]) or {}
        organization = self.repo.get_organization(station["organization_id"]) or {}

        return {
            "organization_code": organization.get("code", "org"),
            "branch_code": branch.get("code", "branch"),
            "project_code": project.get("code", "project"),
            "line_code": line.get("code", "line"),
            "station_code": station.get("code", "station"),
        }
