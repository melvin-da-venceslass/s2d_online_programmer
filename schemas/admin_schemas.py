from __future__ import annotations

from typing import Any, Dict, Optional

from pydantic import BaseModel, Field

from enums.roles import UserRole


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=3, max_length=256)


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    code: str = Field(min_length=2, max_length=32)


class BranchCreate(BaseModel):
    organization_id: str = Field(min_length=3, max_length=64)
    name: str = Field(min_length=2, max_length=120)
    code: str = Field(min_length=2, max_length=32)


class ProjectCreate(BaseModel):
    organization_id: str = Field(min_length=3, max_length=64)
    branch_id: str = Field(min_length=3, max_length=64)
    name: str = Field(min_length=2, max_length=120)
    code: str = Field(min_length=2, max_length=32)


class LineCreate(BaseModel):
    organization_id: str = Field(min_length=3, max_length=64)
    branch_id: str = Field(min_length=3, max_length=64)
    project_id: str = Field(min_length=3, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    code: str = Field(min_length=1, max_length=32)


class StationCreate(BaseModel):
    organization_id: str = Field(min_length=3, max_length=64)
    branch_id: str = Field(min_length=3, max_length=64)
    project_id: str = Field(min_length=3, max_length=64)
    line_id: str = Field(min_length=3, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    code: str = Field(min_length=1, max_length=32)


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=3, max_length=256)
    user_group: str = Field(min_length=1, max_length=64)
    role: UserRole
    organization_id: Optional[str] = None
    branch_id: Optional[str] = None
    project_id: Optional[str] = None
    line_id: Optional[str] = None
    station_id: Optional[str] = None


class DeviceCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    device_code: str = Field(min_length=2, max_length=64)
    organization_id: str = Field(min_length=3, max_length=64)
    branch_id: str = Field(min_length=3, max_length=64)
    project_id: str = Field(min_length=3, max_length=64)
    line_id: str = Field(min_length=3, max_length=64)
    station_id: str = Field(min_length=3, max_length=64)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class RecipeCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    payload: Dict[str, Any] = Field(default_factory=dict)
    description: str = ""
    organization_id: str = Field(min_length=3, max_length=64)
    branch_id: Optional[str] = None
    project_id: Optional[str] = None
    line_id: Optional[str] = None
    station_id: Optional[str] = None


class StorageContextSet(BaseModel):
    organization_code: str = Field(min_length=1, max_length=64)
    branch_code: str = Field(min_length=1, max_length=64)
    project_code: str = Field(min_length=1, max_length=64)
    line_code: str = Field(min_length=1, max_length=64)
    station_code: str = Field(min_length=1, max_length=64)


class RecipeDeviceMap(BaseModel):
    recipe_name: str = Field(min_length=1, max_length=120)
    device_id: str = Field(min_length=3, max_length=64)


class NameCodeUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    code: str = Field(min_length=2, max_length=32)


class DeviceUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    device_code: str = Field(min_length=2, max_length=64)


class UserUpdate(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    user_group: str = Field(min_length=1, max_length=64)
    role: UserRole
    active: bool = True
