from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from enums.roles import UserRole


@dataclass(frozen=True)
class OrganizationEntity:
    organization_id: str
    name: str
    code: str


@dataclass(frozen=True)
class BranchEntity:
    branch_id: str
    organization_id: str
    name: str
    code: str


@dataclass(frozen=True)
class ProjectEntity:
    project_id: str
    organization_id: str
    branch_id: str
    name: str
    code: str


@dataclass(frozen=True)
class LineEntity:
    line_id: str
    organization_id: str
    branch_id: str
    project_id: str
    name: str
    code: str


@dataclass(frozen=True)
class StationEntity:
    station_id: str
    organization_id: str
    branch_id: str
    project_id: str
    line_id: str
    name: str
    code: str


@dataclass(frozen=True)
class DeviceEntity:
    device_id: str
    organization_id: str
    branch_id: str
    project_id: str
    line_id: str
    station_id: str
    name: str
    device_code: str
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RecipeEntity:
    recipe_id: str
    organization_id: str
    branch_id: Optional[str]
    project_id: Optional[str]
    line_id: Optional[str]
    station_id: Optional[str]
    name: str
    payload: Dict[str, Any]
    description: str = ""


@dataclass(frozen=True)
class UserEntity:
    user_id: str
    username: str
    password_hash: str
    user_group: str
    role: UserRole
    organization_id: Optional[str] = None
    branch_id: Optional[str] = None
    project_id: Optional[str] = None
    line_id: Optional[str] = None
    station_id: Optional[str] = None
    active: bool = True
