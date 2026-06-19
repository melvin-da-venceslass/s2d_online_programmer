from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import threading
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

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
            self.log_audit(
                actor=user,
                action="permission_denied",
                target_type="role",
                target_id=user.get("user_id", ""),
                outcome="denied",
                details={"required_roles": sorted(role_item.value for role_item in allowed)},
            )
            raise HTTPException(status_code=403, detail="Insufficient permissions")

    def log_audit(
        self,
        actor: Optional[Dict[str, Any]],
        action: str,
        target_type: str,
        target_id: str = "",
        outcome: str = "success",
        details: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        entry = {
            "audit_id": str(uuid.uuid4()),
            "actor_id": (actor or {}).get("user_id", "anonymous"),
            "actor_username": (actor or {}).get("username", "anonymous"),
            "actor_role": (actor or {}).get("role", "unknown"),
            "action": action,
            "target_type": target_type,
            "target_id": target_id,
            "outcome": outcome,
            "details": details or {},
            "timestamp": _utc_now(),
        }
        return self.repo.create_audit_log(entry)

    def list_audit_logs(self, actor: Dict[str, Any], q: Optional[str] = None, limit: int = 200) -> List[Dict[str, Any]]:
        self._assert_role(actor, {UserRole.SUPER_ADMIN, UserRole.ADMIN})
        rows = self.repo.list_audit_logs(limit=limit)
        if actor.get("role") == UserRole.ADMIN.value:
            actor_org = actor.get("organization_id")
            if actor_org:
                rows = [
                    row for row in rows
                    if row.get("details", {}).get("organization_id") in {None, "", actor_org}
                    or row.get("actor_id") == actor.get("user_id")
                ]
        if q:
            needle = q.strip().lower()
            rows = [
                row for row in rows
                if needle in str(row.get("action", "")).lower()
                or needle in str(row.get("target_type", "")).lower()
                or needle in str(row.get("target_id", "")).lower()
                or needle in str(row.get("actor_username", "")).lower()
            ]
        return rows

    @staticmethod
    def _normalize_scope_list(values: Any) -> list[str]:
        if not values:
            return []
        if not isinstance(values, list):
            values = [values]
        normalized = [str(item).strip() for item in values if str(item).strip()]
        # Preserve order while removing duplicates.
        return list(dict.fromkeys(normalized))

    @staticmethod
    def _actor_scope_values(actor: Dict[str, Any], singular_key: str, plural_key: str) -> list[str]:
        values: list[str] = []
        plural_values = actor.get(plural_key)
        if isinstance(plural_values, list):
            values.extend(str(item).strip() for item in plural_values if str(item).strip())
        singular_value = actor.get(singular_key)
        if singular_value:
            values.append(str(singular_value).strip())
        return list(dict.fromkeys(values))

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

        payload_org_ids = self._normalize_scope_list(payload.get("organization_ids"))
        payload_branch_ids = self._normalize_scope_list(payload.get("branch_ids"))
        payload_project_ids = self._normalize_scope_list(payload.get("project_ids"))
        payload_line_ids = self._normalize_scope_list(payload.get("line_ids"))
        payload_station_ids = self._normalize_scope_list(payload.get("station_ids"))
        if actor_role == UserRole.SUPER_ADMIN:
            pass
        elif actor_role == UserRole.ADMIN:
            if target_role == UserRole.SUPER_ADMIN:
                raise HTTPException(status_code=403, detail="Admin cannot create super admin users")
            if payload.get("organization_id") and payload.get("organization_id") != actor.get("organization_id"):
                raise HTTPException(status_code=403, detail="Admin can only create users in own organization")
            payload["organization_id"] = actor.get("organization_id")
            if payload_org_ids and actor.get("organization_id") not in payload_org_ids:
                raise HTTPException(status_code=403, detail="Admin can only assign users to own organization")
            payload_org_ids = [str(actor.get("organization_id") or "").strip()] if actor.get("organization_id") else payload_org_ids
            actor_branch_scope = set(self._actor_scope_values(actor, "branch_id", "branch_ids"))
            if actor_branch_scope:
                payload_branch_id = str(payload.get("branch_id") or "").strip()
                if payload_branch_id and payload_branch_id not in actor_branch_scope:
                    raise HTTPException(status_code=403, detail="Admin can only assign users inside own branch scope")
                if payload_branch_ids and any(branch_id not in actor_branch_scope for branch_id in payload_branch_ids):
                    raise HTTPException(status_code=403, detail="Admin can only assign users inside own branch scope")
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
            "organization_ids": payload_org_ids,
            "branch_ids": payload_branch_ids,
            "project_ids": payload_project_ids,
            "line_ids": payload_line_ids,
            "station_ids": payload_station_ids,
            "active": True,
            "created_at": _utc_now(),
        }

        # Keep backward compatibility with singular scope fields.
        if user.get("organization_ids") and not user.get("organization_id"):
            user["organization_id"] = user["organization_ids"][0]
        if user.get("branch_ids") and not user.get("branch_id"):
            user["branch_id"] = user["branch_ids"][0]
        if user.get("project_ids") and not user.get("project_id"):
            user["project_id"] = user["project_ids"][0]
        if user.get("line_ids") and not user.get("line_id"):
            user["line_id"] = user["line_ids"][0]
        if user.get("station_ids") and not user.get("station_id"):
            user["station_id"] = user["station_ids"][0]
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
        self._assert_actor_recipe_scope(actor, payload["organization_id"], payload.get("branch_id"))
        branch = self.repo.get_branch(payload["branch_id"])
        if not branch or branch.get("organization_id") != payload["organization_id"]:
            raise HTTPException(status_code=404, detail="Branch not found")
        doc = {
            "recipe_id": str(uuid.uuid4()),
            "name": payload["name"].strip(),
            "description": payload.get("description", "").strip(),
            "payload": payload.get("payload", {}),
            "organization_id": payload["organization_id"],
            "branch_id": payload.get("branch_id"),
            "updated_at": _utc_now(),
            "updated_by": actor["user_id"],
        }
        return self.repo.create_recipe(doc)

    def _assert_actor_recipe_scope(self, actor: Dict[str, Any], organization_id: Optional[str], branch_id: Optional[str]) -> None:
        self._assert_actor_scope(actor, organization_id)
        role = UserRole(actor["role"])
        if role == UserRole.SUPER_ADMIN:
            return
        actor_branch_ids = self._actor_scope_values(actor, "branch_id", "branch_ids")
        if actor_branch_ids and branch_id and branch_id not in actor_branch_ids:
            raise HTTPException(status_code=403, detail="Operation outside your allowed branch scope")

    def _assert_actor_scope(self, actor: Dict[str, Any], organization_id: Optional[str]) -> None:
        role = UserRole(actor["role"])
        if role == UserRole.SUPER_ADMIN:
            return
        actor_org_ids = self._actor_scope_values(actor, "organization_id", "organization_ids")
        if role == UserRole.ADMIN and organization_id in actor_org_ids:
            return
        if role == UserRole.ENGINEER and organization_id in actor_org_ids:
            return
        raise HTTPException(status_code=403, detail="Operation outside your allowed scope")

    def tree_view(self, actor: Dict[str, Any]) -> Dict[str, Any]:
        role = UserRole(actor["role"])
        org_scope = set(self._actor_scope_values(actor, "organization_id", "organization_ids"))
        branch_scope = set(self._actor_scope_values(actor, "branch_id", "branch_ids"))
        project_scope = set(self._actor_scope_values(actor, "project_id", "project_ids"))
        line_scope = set(self._actor_scope_values(actor, "line_id", "line_ids"))
        station_scope = set(self._actor_scope_values(actor, "station_id", "station_ids"))

        organizations = self.repo.list_organizations()
        if role != UserRole.SUPER_ADMIN and org_scope:
            organizations = [o for o in organizations if o.get("organization_id") in org_scope]

        branches = self.repo.list_branches()
        projects = self.repo.list_projects()
        lines = self.repo.list_lines()
        stations = self.repo.list_stations()
        devices = self.repo.list_devices()
        recipes = self.repo.list_recipes()
        users = self.repo.list_users()

        if role != UserRole.SUPER_ADMIN:
            if org_scope:
                branches = [b for b in branches if b.get("organization_id") in org_scope]
                projects = [p for p in projects if p.get("organization_id") in org_scope]
                lines = [l for l in lines if l.get("organization_id") in org_scope]
                stations = [s for s in stations if s.get("organization_id") in org_scope]
                devices = [d for d in devices if d.get("organization_id") in org_scope]
                recipes = [r for r in recipes if r.get("organization_id") in org_scope]
                users = [u for u in users if u.get("organization_id") in org_scope or not u.get("organization_id")]

            if branch_scope:
                branches = [b for b in branches if b.get("branch_id") in branch_scope]
                projects = [p for p in projects if p.get("branch_id") in branch_scope]
                lines = [l for l in lines if l.get("branch_id") in branch_scope]
                stations = [s for s in stations if s.get("branch_id") in branch_scope]
                devices = [d for d in devices if d.get("branch_id") in branch_scope]
                recipes = [r for r in recipes if r.get("branch_id") in branch_scope]
                users = [u for u in users if u.get("branch_id") in branch_scope or not u.get("branch_id")]

            if project_scope:
                projects = [p for p in projects if p.get("project_id") in project_scope]
                lines = [l for l in lines if l.get("project_id") in project_scope]
                stations = [s for s in stations if s.get("project_id") in project_scope]
                devices = [d for d in devices if d.get("project_id") in project_scope]
            if line_scope:
                lines = [l for l in lines if l.get("line_id") in line_scope]
                stations = [s for s in stations if s.get("line_id") in line_scope]
                devices = [d for d in devices if d.get("line_id") in line_scope]
            if station_scope:
                stations = [s for s in stations if s.get("station_id") in station_scope]
                devices = [d for d in devices if d.get("station_id") in station_scope]

        recipe_scope_maps = self.repo.list_recipe_scope_maps()
        if role != UserRole.SUPER_ADMIN:
            if org_scope:
                recipe_scope_maps = [m for m in recipe_scope_maps if m.get("organization_id") in org_scope]
            if branch_scope:
                recipe_scope_maps = [m for m in recipe_scope_maps if m.get("branch_id") in branch_scope]

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
            "recipe_scope_maps": recipe_scope_maps,
            "mongo_enabled": self.repo.mongo_enabled,
        }

    def list_recipes_for_actor(self, actor: Dict[str, Any], filters: Optional[Dict[str, Any]] = None) -> list[Dict[str, Any]]:
        filters = filters or {}
        role = UserRole(actor["role"])
        if role == UserRole.SUPER_ADMIN:
            recipes = self.repo.list_recipes()
        else:
            org_ids = self._actor_scope_values(actor, "organization_id", "organization_ids")
            if not org_ids:
                return []
            recipes = [
                recipe
                for recipe in self.repo.list_recipes()
                if recipe.get("organization_id") in set(org_ids)
            ]

        actor_branch_ids = set(self._actor_scope_values(actor, "branch_id", "branch_ids")) if role != UserRole.SUPER_ADMIN else set()
        if actor_branch_ids:
            recipes = [recipe for recipe in recipes if recipe.get("branch_id") in actor_branch_ids]

        branch_id = filters.get("branch_id")
        if branch_id:
            recipes = [recipe for recipe in recipes if recipe.get("branch_id") == branch_id]

        project_id = filters.get("project_id")
        line_id = filters.get("line_id")
        station_id = filters.get("station_id")
        device_id = filters.get("device_id")
        unmapped_only = bool(filters.get("unmapped_only"))

        if project_id or line_id or station_id or device_id or unmapped_only:
            scope_maps = self.repo.list_recipe_scope_maps()
            device_maps = self.repo.list_recipe_device_maps()
            visible_recipe_ids = {recipe["recipe_id"] for recipe in recipes}
            scope_maps = [m for m in scope_maps if m.get("recipe_id") in visible_recipe_ids]
            device_maps = [m for m in device_maps if m.get("recipe_id") in visible_recipe_ids]
            if branch_id:
                scope_maps = [m for m in scope_maps if m.get("branch_id") == branch_id]
                device_maps = [m for m in device_maps if m.get("branch_id") == branch_id]
            if project_id:
                scope_maps = [m for m in scope_maps if m.get("project_id") == project_id]
            if line_id:
                scope_maps = [m for m in scope_maps if m.get("line_id") == line_id]
            if station_id:
                scope_maps = [m for m in scope_maps if m.get("station_id") == station_id]
            if device_id:
                device_maps = [m for m in device_maps if m.get("device_id") == device_id]

            mapped_recipe_ids = {m.get("recipe_id") for m in scope_maps}.union({m.get("recipe_id") for m in device_maps})
            if unmapped_only:
                recipes = [recipe for recipe in recipes if recipe.get("recipe_id") not in mapped_recipe_ids]
            elif project_id or line_id or station_id or device_id:
                recipes = [recipe for recipe in recipes if recipe.get("recipe_id") in mapped_recipe_ids]

        return recipes

    def recipe_dashboard(self, actor: Dict[str, Any], filters: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        filters = filters or {}
        recipes = self.list_recipes_for_actor(actor, filters)
        visible_recipe_ids = {recipe.get("recipe_id") for recipe in recipes}

        scope_maps = [m for m in self.repo.list_recipe_scope_maps() if m.get("recipe_id") in visible_recipe_ids]
        device_maps = [m for m in self.repo.list_recipe_device_maps() if m.get("recipe_id") in visible_recipe_ids]

        if filters.get("device_id"):
            device_maps = [m for m in device_maps if m.get("device_id") == filters.get("device_id")]
            visible_recipe_ids = {m.get("recipe_id") for m in device_maps}
            recipes = [r for r in recipes if r.get("recipe_id") in visible_recipe_ids]
            scope_maps = [m for m in scope_maps if m.get("recipe_id") in visible_recipe_ids]

        query = str(filters.get("q") or "").strip().lower()
        if query:
            recipes = [
                r
                for r in recipes
                if query in str(r.get("name") or "").lower() or query in str(r.get("description") or "").lower()
            ]
            visible_recipe_ids = {recipe.get("recipe_id") for recipe in recipes}
            scope_maps = [m for m in scope_maps if m.get("recipe_id") in visible_recipe_ids]
            device_maps = [m for m in device_maps if m.get("recipe_id") in visible_recipe_ids]

        mapped_recipe_ids = {m.get("recipe_id") for m in scope_maps}.union({m.get("recipe_id") for m in device_maps})
        unmapped_pool = [recipe for recipe in recipes if recipe.get("recipe_id") not in mapped_recipe_ids]

        return {
            "recipes": recipes,
            "unmapped_pool": unmapped_pool,
            "scope_mappings": scope_maps,
            "device_mappings": device_maps,
        }

    def _resolve_scope_target(self, target_type: str, target_id: str) -> Dict[str, Any]:
        if target_type == "project":
            target = self.repo.get_project(target_id)
        elif target_type == "line":
            target = self.repo.get_line(target_id)
        elif target_type == "station":
            target = self.repo.get_station(target_id)
        else:
            raise HTTPException(status_code=400, detail="Invalid mapping target type")
        if not target:
            raise HTTPException(status_code=404, detail=f"{target_type.title()} not found")
        return target

    def map_recipe_to_scope(self, actor: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
        self._assert_role(actor, {UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.ENGINEER})
        recipe = next((r for r in self.list_recipes_for_actor(actor) if r.get("recipe_id") == payload["recipe_id"]), None)
        if not recipe:
            raise HTTPException(status_code=404, detail="Recipe not found")
        target_type = str(payload.get("target_type") or "").strip().lower()
        target_id = str(payload.get("target_id") or "").strip()
        target = self._resolve_scope_target(target_type, target_id)
        target_org_id = recipe.get("organization_id")
        target_branch_id = recipe.get("branch_id")
        if target.get("organization_id") != target_org_id or target.get("branch_id") != target_branch_id:
            raise HTTPException(status_code=403, detail="Recipe can only be mapped inside its organization and branch")

        doc = {
            "map_id": str(uuid.uuid4()),
            "recipe_id": recipe["recipe_id"],
            "recipe_name": recipe["name"],
            "organization_id": target_org_id,
            "branch_id": target_branch_id,
            "project_id": target.get("project_id") if target_type in {"project", "line", "station"} else None,
            "line_id": target.get("line_id") if target_type in {"line", "station"} else None,
            "station_id": target.get("station_id") if target_type == "station" else None,
            "target_type": target_type,
            "target_id": target_id,
            "mapped_at": _utc_now(),
            "mapped_by": actor["user_id"],
        }
        return self.repo.create_recipe_scope_map(doc)

    def map_recipe_to_device(self, actor: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
        self._assert_role(actor, {UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.ENGINEER})
        recipe = next((r for r in self.list_recipes_for_actor(actor) if r.get("recipe_id") == payload["recipe_id"]), None)
        if not recipe:
            raise HTTPException(status_code=404, detail="Recipe not found")
        device = self.repo.get_device(payload["device_id"])
        if not device:
            raise HTTPException(status_code=404, detail="Device not found")
        if device.get("organization_id") != recipe.get("organization_id") or device.get("branch_id") != recipe.get("branch_id"):
            raise HTTPException(status_code=403, detail="Device mapping is allowed only inside recipe organization and branch")
        self._assert_actor_recipe_scope(actor, device.get("organization_id"), device.get("branch_id"))
        doc = {
            "map_id": str(uuid.uuid4()),
            "recipe_id": recipe["recipe_id"],
            "recipe_name": recipe["name"],
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

        organization_ids = self._normalize_scope_list(payload.get("organization_ids")) if payload.get("organization_ids") is not None else None
        branch_ids = self._normalize_scope_list(payload.get("branch_ids")) if payload.get("branch_ids") is not None else None
        project_ids = self._normalize_scope_list(payload.get("project_ids")) if payload.get("project_ids") is not None else None
        line_ids = self._normalize_scope_list(payload.get("line_ids")) if payload.get("line_ids") is not None else None
        station_ids = self._normalize_scope_list(payload.get("station_ids")) if payload.get("station_ids") is not None else None

        if actor_role == UserRole.ADMIN:
            actor_org = actor.get("organization_id")
            if organization_ids is not None and organization_ids and actor_org not in organization_ids:
                raise HTTPException(status_code=403, detail="Cannot assign users outside your organization")
            if organization_ids is not None:
                organization_ids = [actor_org] if actor_org else organization_ids
            actor_branch_scope = set(self._actor_scope_values(actor, "branch_id", "branch_ids"))
            if actor_branch_scope and branch_ids is not None and any(branch_id not in actor_branch_scope for branch_id in branch_ids):
                raise HTTPException(status_code=403, detail="Cannot assign users outside your branch scope")

        patch = {
            "username": payload["username"].strip().lower(),
            "user_group": payload.get("user_group") or "default",
            "role": new_role.value,
            "active": bool(payload.get("active", True)),
            "updated_at": _utc_now(),
        }
        if organization_ids is not None:
            patch["organization_ids"] = organization_ids
            if organization_ids:
                patch["organization_id"] = organization_ids[0]
        if branch_ids is not None:
            patch["branch_ids"] = branch_ids
            if branch_ids:
                patch["branch_id"] = branch_ids[0]
        if project_ids is not None:
            patch["project_ids"] = project_ids
            if project_ids:
                patch["project_id"] = project_ids[0]
        if line_ids is not None:
            patch["line_ids"] = line_ids
            if line_ids:
                patch["line_id"] = line_ids[0]
        if station_ids is not None:
            patch["station_ids"] = station_ids
            if station_ids:
                patch["station_id"] = station_ids[0]
        return self._safe_user(self.repo.update_user(user_id, patch) or {})

    def upsert_program_recipe(
        self,
        actor: Dict[str, Any],
        program: Dict[str, Any],
        name: Optional[str] = None,
        description: str = "Auto-synced from Program Editor",
        organization_id_override: Optional[str] = None,
        branch_id_override: Optional[str] = None,
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

        organization_id = organization_id_override or actor.get("organization_id")
        branch_id = branch_id_override or actor.get("branch_id")

        existing_visible = [
            recipe for recipe in self.list_recipes_for_actor(actor)
            if str(recipe.get("name") or "").strip().lower() == recipe_name.lower()
        ]
        if existing_visible:
            organization_id = existing_visible[0].get("organization_id")
            branch_id = existing_visible[0].get("branch_id")

        if role == UserRole.SUPER_ADMIN and not organization_id and storage_context.get("organization_code"):
            org_code = str(storage_context.get("organization_code") or "").strip().lower()
            for org in self.repo.list_organizations():
                if str(org.get("code") or "").strip().lower() == org_code:
                    organization_id = org.get("organization_id")
                    break

        if not organization_id or not branch_id:
            raise HTTPException(status_code=400, detail="Recipes must be stored under an organization and branch")

        self._assert_actor_recipe_scope(actor, organization_id, branch_id)

        doc = {
            "recipe_id": str(uuid.uuid4()),
            "name": recipe_name,
            "description": description,
            "payload": program,
            "organization_id": organization_id,
            "branch_id": branch_id,
            "updated_at": _utc_now(),
            "updated_by": actor["user_id"],
        }
        return self.repo.create_recipe(doc)

    def delete_recipe(self, actor: Dict[str, Any], recipe_id: str) -> Dict[str, Any]:
        self._assert_role(actor, {UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.ENGINEER})
        recipe = self.repo.get_recipe(recipe_id)
        if not recipe:
            raise HTTPException(status_code=404, detail="Recipe not found")

        visible = [entry for entry in self.list_recipes_for_actor(actor) if entry.get("recipe_id") == recipe_id]
        if not visible:
            self.log_audit(
                actor=actor,
                action="delete_recipe",
                target_type="recipe",
                target_id=recipe_id,
                outcome="denied",
                details={"reason": "outside_scope"},
            )
            raise HTTPException(status_code=403, detail="Recipe is outside your allowed scope")

        self._assert_actor_recipe_scope(actor, recipe.get("organization_id"), recipe.get("branch_id"))
        self.repo.delete_recipe_device_maps(recipe_id)
        self.repo.delete_recipe_scope_maps(recipe_id)
        deleted = self.repo.delete_recipe(recipe_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Recipe not found")

        self.log_audit(
            actor=actor,
            action="delete_recipe",
            target_type="recipe",
            target_id=recipe_id,
            outcome="success",
            details={
                "recipe_name": recipe.get("name"),
                "organization_id": recipe.get("organization_id"),
                "branch_id": recipe.get("branch_id"),
            },
        )
        return recipe

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
