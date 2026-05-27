from __future__ import annotations

import copy
from typing import Any, Dict, List, Optional

from pymongo import MongoClient


class AdminRepository:
    """Repository that persists admin domain data in MongoDB, with in-memory fallback."""

    def __init__(self, mongo_uri: str, db_name: str) -> None:
        self._mongo_enabled = bool(mongo_uri.strip())
        self._db = None
        self._mem: Dict[str, List[Dict[str, Any]]] = {
            "users": [],
            "organizations": [],
            "branches": [],
            "projects": [],
            "lines": [],
            "stations": [],
            "devices": [],
            "recipes": [],
            "recipe_device_maps": [],
        }

        if self._mongo_enabled:
            try:
                print(mongo_uri)
                client = MongoClient(mongo_uri, serverSelectionTimeoutMS=2500)
                client.admin.command("ping")
                self._db = client[db_name]
                self._ensure_indexes()
            except Exception as e:
                # Fall back to in-memory mode if Mongo is not reachable.
                print(f"[WARNING] Could not connect to MongoDB: {e}. Falling back to in-memory mode.")
                self._mongo_enabled = False
                self._db = None

    @property
    def mongo_enabled(self) -> bool:
        return self._mongo_enabled and self._db is not None

    def _ensure_indexes(self) -> None:
        if self._db is None:
            return
        self._db.users.create_index("username", unique=True)
        self._db.organizations.create_index([("name", 1), ("code", 1)], unique=True)
        self._db.branches.create_index([("organization_id", 1), ("code", 1)], unique=True)
        self._db.projects.create_index([("branch_id", 1), ("code", 1)], unique=True)
        self._db.lines.create_index([("project_id", 1), ("code", 1)], unique=True)
        self._db.stations.create_index([("line_id", 1), ("code", 1)], unique=True)
        self._db.devices.create_index([("station_id", 1), ("device_code", 1)], unique=True)

    def _strip_id(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        out = copy.deepcopy(doc)
        out.pop("_id", None)
        return out

    def _mem_find_one(self, collection: str, filters: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        for item in self._mem[collection]:
            if all(item.get(k) == v for k, v in filters.items()):
                return copy.deepcopy(item)
        return None

    def _mem_find_many(self, collection: str, filters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        rows = []
        filters = filters or {}
        for item in self._mem[collection]:
            if all(item.get(k) == v for k, v in filters.items()):
                rows.append(copy.deepcopy(item))
        return rows

    def _mem_insert(self, collection: str, doc: Dict[str, Any]) -> Dict[str, Any]:
        self._mem[collection].append(copy.deepcopy(doc))
        return copy.deepcopy(doc)

    def _mem_update_one(self, collection: str, filters: Dict[str, Any], patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        for index, item in enumerate(self._mem[collection]):
            if all(item.get(k) == v for k, v in filters.items()):
                updated = copy.deepcopy(item)
                updated.update(copy.deepcopy(patch))
                self._mem[collection][index] = updated
                return copy.deepcopy(updated)
        return None

    def _find_one(self, collection: str, filters: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if self.mongo_enabled:
            doc = self._db[collection].find_one(filters)
            return self._strip_id(doc) if doc else None
        return self._mem_find_one(collection, filters)

    def _find_many(self, collection: str, filters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        if self.mongo_enabled:
            cursor = self._db[collection].find(filters or {})
            return [self._strip_id(doc) for doc in cursor]
        return self._mem_find_many(collection, filters)

    def _insert_one(self, collection: str, doc: Dict[str, Any]) -> Dict[str, Any]:
        if self.mongo_enabled:
            self._db[collection].insert_one(copy.deepcopy(doc))
            return copy.deepcopy(doc)
        return self._mem_insert(collection, doc)

    def _update_one(self, collection: str, filters: Dict[str, Any], patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if self.mongo_enabled:
            self._db[collection].update_one(filters, {"$set": patch})
            return self._find_one(collection, filters)
        return self._mem_update_one(collection, filters, patch)

    # User methods
    def get_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        return self._find_one("users", {"username": username})

    def get_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        return self._find_one("users", {"user_id": user_id})

    def list_users(self, filters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        return self._find_many("users", filters)

    def create_user(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert_one("users", doc)

    # Organization tree methods
    def create_organization(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert_one("organizations", doc)

    def create_branch(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert_one("branches", doc)

    def create_project(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert_one("projects", doc)

    def create_line(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert_one("lines", doc)

    def create_station(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert_one("stations", doc)

    def create_device(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert_one("devices", doc)

    def create_recipe(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        existing = self._find_one(
            "recipes",
            {
                "name": doc["name"],
                "organization_id": doc["organization_id"],
                "branch_id": doc.get("branch_id"),
                "project_id": doc.get("project_id"),
                "line_id": doc.get("line_id"),
                "station_id": doc.get("station_id"),
            },
        )
        if existing:
            return self._update_one("recipes", {"recipe_id": existing["recipe_id"]}, doc) or doc
        return self._insert_one("recipes", doc)

    def list_organizations(self) -> List[Dict[str, Any]]:
        return self._find_many("organizations")

    def list_branches(self, filters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        return self._find_many("branches", filters)

    def list_projects(self, filters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        return self._find_many("projects", filters)

    def list_lines(self, filters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        return self._find_many("lines", filters)

    def list_stations(self, filters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        return self._find_many("stations", filters)

    def list_devices(self, filters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        return self._find_many("devices", filters)

    def list_recipes(self, filters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        return self._find_many("recipes", filters)

    def create_recipe_device_map(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        existing = self._find_one("recipe_device_maps", {
            "recipe_name": doc["recipe_name"],
            "organization_id": doc["organization_id"],
            "device_id": doc["device_id"],
        })
        if existing:
            return self._update_one("recipe_device_maps", {"map_id": existing["map_id"]}, doc) or doc
        return self._insert_one("recipe_device_maps", doc)

    def list_recipe_device_maps(self, filters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        return self._find_many("recipe_device_maps", filters)

    def get_organization(self, organization_id: str) -> Optional[Dict[str, Any]]:
        return self._find_one("organizations", {"organization_id": organization_id})

    def get_branch(self, branch_id: str) -> Optional[Dict[str, Any]]:
        return self._find_one("branches", {"branch_id": branch_id})

    def get_project(self, project_id: str) -> Optional[Dict[str, Any]]:
        return self._find_one("projects", {"project_id": project_id})

    def get_line(self, line_id: str) -> Optional[Dict[str, Any]]:
        return self._find_one("lines", {"line_id": line_id})

    def get_station(self, station_id: str) -> Optional[Dict[str, Any]]:
        return self._find_one("stations", {"station_id": station_id})

    def get_device(self, device_id: str) -> Optional[Dict[str, Any]]:
        return self._find_one("devices", {"device_id": device_id})

    # Update methods
    def update_organization(self, org_id: str, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return self._update_one("organizations", {"organization_id": org_id}, patch)

    def update_branch(self, branch_id: str, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return self._update_one("branches", {"branch_id": branch_id}, patch)

    def update_project(self, project_id: str, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return self._update_one("projects", {"project_id": project_id}, patch)

    def update_line(self, line_id: str, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return self._update_one("lines", {"line_id": line_id}, patch)

    def update_station(self, station_id: str, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return self._update_one("stations", {"station_id": station_id}, patch)

    def update_device(self, device_id: str, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return self._update_one("devices", {"device_id": device_id}, patch)

    def update_user(self, user_id: str, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return self._update_one("users", {"user_id": user_id}, patch)
