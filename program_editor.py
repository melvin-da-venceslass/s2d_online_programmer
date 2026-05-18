from __future__ import annotations

import copy
import json
import threading
import base64
import io
import os
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = BASE_DIR / "template.json"
STATIC_DIR = BASE_DIR / "static"
INDEX_FILE = BASE_DIR / "templates" / "index.html"
PREVIEW_FILE = BASE_DIR / "templates" / "preview.html"
PROGRAMS_DIR = BASE_DIR / "programs"

app = FastAPI(title="Program Editor")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
PROGRAMS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/programs", StaticFiles(directory=PROGRAMS_DIR), name="programs")

STATE_LOCK = threading.Lock()
CURRENT_DATA: Dict[str, Any] = {}

STEP_TEMPLATE: Dict[str, Any] = {
    "upload_image": "",
    "enable_barcode": False,
    "bc_title": "",
    "bc_parent": False,
    "bc_child": True,
    "whatloc_enabled": False,
    "check_short_workstation": "",
    "check_part_number": "",
    "check_ref_designator": "",
    "enable_barcode_mes": False,
    "ack_title": "",
    "request_ack": False,
    "enable_ack_mes": False,
    "enable_fastening": False,
    "step_no": 1,
    "target_preset": "",
    "target_torque": "",
    "target_angle": "",
    "target_min_angle": "",
    "target_max_angle": "",
    "target_tolerance": "",
    "target_rpm": "",
    "TC_AM": True,
    "AC_TM": False,
    "screw_info": "",
    "remarks": "",
    "mes_enable_assy": False,
    "snug_torque": "",
    "free_fastening_angle": "",
    "soft_start": "",
    "free_fastening_speed": "",
    "torque_rising_rate": "",
    "seating_point": "",
    "ramp_up_speed": "",
    "torque_compensation": "",
}


DEFAULT_DATA: Dict[str, Any] = {
    "partname": "IBE333333_A",
    "enable_mes": False,
    "enable_ftp": False,
    "steps": [
        {
            "enable_barcode": True,
            "bc_title": "Scan the Master serial Number on the Chasis",
            "bc_parent": True,
            "bc_child": False,
            "whatloc_enabled": False,
            "check_short_workstation": "PRNM",
            "check_part_number": "IBE333333",
            "check_ref_designator": "NA",
            "enable_barcode_mes": True,
            "ack_title": "",
            "request_ack": False,
            "enable_ack_mes": False,
            "enable_fastening": False,
            "step_no": 1,
            "target_preset": "",
            "target_torque": "",
            "target_angle": "",
            "target_min_angle": "",
            "target_max_angle": "",
            "target_tolerance": "",
            "target_rpm": "",
            "TC_AM": True,
            "AC_TM": False,
            "screw_info": "",
            "remarks": "",
            "mes_enable_assy": False,
            "snug_torque": "",
            "free_fastening_angle": "",
            "soft_start": "",
            "free_fastening_speed": "",
            "torque_rising_rate": "",
            "seating_point": "",
            "ramp_up_speed": "",
            "torque_compensation": "",
        }
    ],
}


def _load_default_data() -> Dict[str, Any]:
    if DATA_FILE.exists():
        try:
            with DATA_FILE.open("r", encoding="utf-8") as handle:
                loaded = json.load(handle)
            return normalize_program(loaded)
        except Exception:
            pass
    return normalize_program(copy.deepcopy(DEFAULT_DATA))


def normalize_program(program: Dict[str, Any]) -> Dict[str, Any]:
    data = copy.deepcopy(program or {})
    data.setdefault("partname", "")
    data.setdefault("enable_mes", False)
    data.setdefault("enable_ftp", False)
    data.setdefault("steps", [])
    data["steps"] = [normalize_step(step, i + 1) for i, step in enumerate(data["steps"])]
    renumber_steps(data["steps"])
    return data


def normalize_step(step: Dict[str, Any], step_no: int) -> Dict[str, Any]:
    normalized = copy.deepcopy(STEP_TEMPLATE)
    if isinstance(step, dict):
        normalized.update(step)
    normalized["step_no"] = int(step.get("step_no", step_no)) if isinstance(step, dict) else step_no
    for key, value in normalized.items():
        if isinstance(STEP_TEMPLATE.get(key), bool):
            normalized[key] = bool(value)
        elif isinstance(STEP_TEMPLATE.get(key), str):
            normalized[key] = "" if value is None else str(value)

    # Keep the three mode flags mutually exclusive.
    if normalized["enable_barcode"]:
        normalized["request_ack"] = False
        normalized["enable_fastening"] = False
    elif normalized["request_ack"]:
        normalized["enable_barcode"] = False
        normalized["enable_fastening"] = False
    elif normalized["enable_fastening"]:
        normalized["enable_barcode"] = False
        normalized["request_ack"] = False

    # Validation rule: step 1 is BC Parent, all following steps are BC Child.
    if normalized["step_no"] == 1:
        normalized["bc_parent"] = True
        normalized["bc_child"] = False
    else:
        normalized["bc_parent"] = False
        normalized["bc_child"] = True
    return normalized


def renumber_steps(steps: List[Dict[str, Any]]) -> None:
    for index, step in enumerate(steps, start=1):
        step["step_no"] = index


def sanitize_filename(value: str, fallback: str = "program") -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in (value or "").strip())
    cleaned = cleaned.strip("._")
    return cleaned or fallback


def decode_image_data_url(data_url: str) -> Optional[bytes]:
    if not isinstance(data_url, str) or not data_url.startswith("data:image"):
        return None
    try:
        _, encoded = data_url.split(",", 1)
        return base64.b64decode(encoded)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image payload in upload_image")


def persist_program_locked() -> None:
    part = sanitize_filename(CURRENT_DATA.get("partname", "program"))
    json_path = PROGRAMS_DIR / f"{part}.json"
    image_dir = PROGRAMS_DIR / part
    image_dir.mkdir(parents=True, exist_ok=True)

    active_image_names = set()
    for step in CURRENT_DATA.get("steps", []):
        step_no = int(step.get("step_no", 0) or 0)
        if step_no <= 0:
            continue
        image_name = f"{step_no}.jpg"
        image_path = image_dir / image_name
        image_value = step.get("upload_image", "")

        decoded = decode_image_data_url(image_value) if isinstance(image_value, str) else None
        if decoded is not None:
            image_path.write_bytes(decoded)
            step["upload_image"] = f"/programs/{part}/{image_name}"
            active_image_names.add(image_name)
            continue

        if isinstance(image_value, str) and image_value.startswith("/programs/"):
            source_path = BASE_DIR / image_value.lstrip("/")
            if source_path.exists():
                image_path.write_bytes(source_path.read_bytes())
                step["upload_image"] = f"/programs/{part}/{image_name}"
                active_image_names.add(image_name)
            elif image_path.exists():
                step["upload_image"] = f"/programs/{part}/{image_name}"
                active_image_names.add(image_name)
            else:
                step["upload_image"] = ""
            continue

        if not image_value:
            if image_path.exists():
                image_path.unlink()
            step["upload_image"] = ""

    for existing in image_dir.glob("*.jpg"):
        if existing.name not in active_image_names:
            existing.unlink()

    json_path.write_text(json.dumps(CURRENT_DATA, indent=4), encoding="utf-8")


def get_state() -> Dict[str, Any]:
    with STATE_LOCK:
        return copy.deepcopy(CURRENT_DATA)


def set_state(data: Dict[str, Any]) -> Dict[str, Any]:
    normalized = normalize_program(data)
    with STATE_LOCK:
        CURRENT_DATA.clear()
        CURRENT_DATA.update(normalized)
        persist_program_locked()
    return copy.deepcopy(CURRENT_DATA)


def update_step(index: int, step_data: Dict[str, Any]) -> Dict[str, Any]:
    with STATE_LOCK:
        if index < 0 or index >= len(CURRENT_DATA["steps"]):
            raise HTTPException(status_code=404, detail="Step not found")
        CURRENT_DATA["steps"][index] = normalize_step(step_data, index + 1)
        renumber_steps(CURRENT_DATA["steps"])
        persist_program_locked()
        return copy.deepcopy(CURRENT_DATA)


def insert_step_after(index: int, step_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    with STATE_LOCK:
        steps = CURRENT_DATA["steps"]
        if index < -1 or index >= len(steps):
            raise HTTPException(status_code=404, detail="Step not found")
        new_step = normalize_step(step_data or STEP_TEMPLATE, index + 2)
        steps.insert(index + 1, new_step)
        renumber_steps(steps)
        persist_program_locked()
        return copy.deepcopy(CURRENT_DATA)


def delete_step(index: int) -> Dict[str, Any]:
    with STATE_LOCK:
        steps = CURRENT_DATA["steps"]
        if index < 0 or index >= len(steps):
            raise HTTPException(status_code=404, detail="Step not found")
        del steps[index]
        if not steps:
            steps.append(normalize_step(STEP_TEMPLATE, 1))
        renumber_steps(steps)
        persist_program_locked()
        return copy.deepcopy(CURRENT_DATA)


@app.on_event("startup")
def startup() -> None:
    global CURRENT_DATA
    with STATE_LOCK:
        CURRENT_DATA = _load_default_data()
        persist_program_locked()


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    html = INDEX_FILE.read_text(encoding="utf-8")
    html = html.replace("{{ initial_program | safe }}", json.dumps(get_state()))
    html = html.replace("{{ initial_step_template | safe }}", json.dumps(STEP_TEMPLATE))
    return HTMLResponse(content=html)


@app.get("/preview", response_class=HTMLResponse)
def preview_page():
    return HTMLResponse(content=PREVIEW_FILE.read_text(encoding="utf-8"))


@app.get("/api/program")
def api_get_program():
    return get_state()


@app.get("/api/programs")
def api_list_programs():
    programs = []
    for fp in sorted(PROGRAMS_DIR.glob("*.json")):
        programs.append(fp.name)
    return {"programs": programs}


@app.post("/api/programs/{program_file}")
def api_load_program(program_file: str):
    name = Path(program_file).name
    if not name.lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="Program file must be a .json file")

    target = (PROGRAMS_DIR / name).resolve()
    if not str(target).startswith(str(PROGRAMS_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid program file path")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Program file not found")

    try:
        program = json.loads(target.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid program JSON: {exc}") from exc

    return set_state(program)


@app.post("/api/program")
def api_set_program(program: Dict[str, Any]):
    return set_state(program)


@app.post("/api/upload")
async def api_upload(file: UploadFile = File(...)):
    raw = await file.read()
    try:
        program = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON file: {exc}") from exc
    return set_state(program)


@app.post("/api/upload-zip")
async def api_upload_zip(file: UploadFile = File(...)):
    raw = await file.read()
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid ZIP file: {exc}") from exc

    json_entry = None
    for info in archive.infolist():
        if info.is_dir():
            continue
        if info.filename.lower().endswith(".json"):
            json_entry = info
            break

    if json_entry is None:
        raise HTTPException(status_code=400, detail="ZIP does not contain a JSON recipe file")

    try:
        program = json.loads(archive.read(json_entry).decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON inside ZIP: {exc}") from exc

    # Extract ZIP entries into /programs safely so referenced images are available.
    for info in archive.infolist():
        if info.is_dir():
            continue
        rel = Path(info.filename)
        target = (PROGRAMS_DIR / rel).resolve()
        if not str(target).startswith(str(PROGRAMS_DIR.resolve())):
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(archive.read(info))

    return set_state(program)


@app.put("/api/steps/{index}")
def api_save_step(index: int, step: Dict[str, Any]):
    return update_step(index, step)


@app.post("/api/steps/{index}/insert")
def api_insert_step(index: int, step: Optional[Dict[str, Any]] = None):
    return insert_step_after(index, step)


@app.delete("/api/steps/{index}")
def api_delete_step(index: int):
    return delete_step(index)


@app.post("/api/steps/{index}/clone")
def api_clone_step(index: int):
    with STATE_LOCK:
        steps = CURRENT_DATA["steps"]
        if index < 0 or index >= len(steps):
            raise HTTPException(status_code=404, detail="Step not found")
        cloned = copy.deepcopy(steps[index])
    return insert_step_after(index, cloned)


@app.get("/download")
def download_program():
    program = get_state()
    payload = json.dumps(program, indent=4)
    filename = f"{sanitize_filename(program.get('partname'))}.json"
    return Response(
        content=payload,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/download-recipe")
def download_recipe_zip():
    with STATE_LOCK:
        # Ensure latest data and images are persisted before packaging.
        persist_program_locked()
        program = copy.deepcopy(CURRENT_DATA)

    part = sanitize_filename(program.get("partname"), fallback="program")
    image_dir = PROGRAMS_DIR / part

    mem = io.BytesIO()
    with zipfile.ZipFile(mem, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        # Keep a stable recipe layout: <part>.json and <part>/ image folder.
        zf.writestr(f"{part}/", "")
        zf.writestr(f"{part}.json", json.dumps(program, indent=4))

        added_arc = set()
        if image_dir.exists() and image_dir.is_dir():
            for fp in sorted(image_dir.rglob("*")):
                if fp.is_file():
                    arc = str(Path(part) / fp.relative_to(image_dir))
                    zf.write(fp, arcname=arc)
                    added_arc.add(arc)

        for step in program.get("steps", []):
            image_value = step.get("upload_image", "")
            if not isinstance(image_value, str) or not image_value:
                continue
            parsed = urlparse(image_value)
            image_path = parsed.path if parsed.path else image_value
            if not image_path.startswith("/programs/"):
                continue
            source_path = BASE_DIR / image_path.lstrip("/")
            if not source_path.exists() or not source_path.is_file():
                continue
            arc = str(Path(part) / source_path.name)
            if arc in added_arc:
                continue
            zf.write(source_path, arcname=arc)
            added_arc.add(arc)

    mem.seek(0)
    zip_name = f"{part}_recipe.zip"
    return Response(
        content=mem.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_name}"'},
    )


@app.get("/api/template")
def api_template():
    return copy.deepcopy(STEP_TEMPLATE)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "program_editor:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8000")),
        reload=False,
    )
