from __future__ import annotations

import copy
import json
import os
import re
import threading
import base64
import io
import zipfile
from datetime import datetime, date
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import shutil
import subprocess

import hashlib
import secrets

import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from config import settings

BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = BASE_DIR / "template.json"
STATIC_DIR = BASE_DIR / "static"
LOGIN_FILE = BASE_DIR / "templates" / "login.html"
INDEX_FILE = BASE_DIR / "templates" / "index.html"
PREVIEW_FILE = BASE_DIR / "templates" / "preview.html"
DOWNLOAD_LOGS_FILE = BASE_DIR / "templates" / "download_logs.html"
CONFIGURE_FILE = BASE_DIR / "templates" / "configure.html"
SYSTEM_SETTINGS_FILE = BASE_DIR / "templates" / "system_settings.html"
RECIPE_MANAGEMENT_FILE = BASE_DIR / "templates" / "recipe_management.html"
PROGRAMS_DIR = Path(settings.programs_dir)
CREDENTIALS_FILE = BASE_DIR / "credentials.json"

DIRECT_UPLOAD_THRESHOLD_BYTES = 20 * 1024 * 1024

# ── Credentials helpers ────────────────────────────────────────────────────────

def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def _load_credentials() -> Dict[str, str]:
    if CREDENTIALS_FILE.exists():
        try:
            return json.loads(CREDENTIALS_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    # Default credentials
    creds = {"username": "Admin", "password_hash": _hash_password("admin@1234")}
    CREDENTIALS_FILE.write_text(json.dumps(creds, indent=2), encoding="utf-8")
    return creds

def _save_credentials(username: str, password: str) -> None:
    creds = {"username": username, "password_hash": _hash_password(password)}
    CREDENTIALS_FILE.write_text(json.dumps(creds, indent=2), encoding="utf-8")

def _verify_credentials(username: str, password: str) -> bool:
    creds = _load_credentials()
    return (
        secrets.compare_digest(username, creds.get("username", "")) and
        secrets.compare_digest(_hash_password(password), creds.get("password_hash", ""))
    )

# ── Session auth helper ────────────────────────────────────────────────────────

def _is_authenticated(request: Request) -> bool:
    return request.session.get("authenticated") is True

def _require_auth(request: Request) -> None:
    """Raise a redirect if not authenticated."""
    if not _is_authenticated(request):
        raise _LoginRedirect()

class _LoginRedirect(Exception):
    pass

# ── App setup ─────────────────────────────────────────────────────────────────

_SESSION_SECRET = os.environ.get("SESSION_SECRET") or secrets.token_hex(32)

app = FastAPI(title=settings.app_name, version="1.0.0", docs_url=None, redoc_url=None)
app.add_middleware(SessionMiddleware, secret_key=_SESSION_SECRET, session_cookie="pe_session", max_age=86400 * 7)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
PROGRAMS_DIR.mkdir(parents=True, exist_ok=True)

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
    "enable_barcode_mes_t": False,
    "enable_barcode_mes_nt": False,
    "restart_on_failure": False,
    "reg_ex_validator": "",
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
            "enable_barcode_mes_t": True,
            "enable_barcode_mes_nt": False,
            "restart_on_failure": False,
            "reg_ex_validator": "",
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

app.mount("/programs", StaticFiles(directory=PROGRAMS_DIR), name="programs")


def _list_local_program_names() -> List[str]:
    names: List[str] = []
    for fp in PROGRAMS_DIR.rglob("*.json"):
        try:
            rel = fp.relative_to(PROGRAMS_DIR).as_posix()
        except Exception:
            continue
        names.append(rel)
    return sorted(set(names))


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

    if normalized["enable_barcode"]:
        normalized["request_ack"] = False
        normalized["enable_fastening"] = False
    elif normalized["request_ack"]:
        normalized["enable_barcode"] = False
        normalized["enable_fastening"] = False
    elif normalized["enable_fastening"]:
        normalized["enable_barcode"] = False
        normalized["request_ack"] = False

    if normalized["step_no"] == 1:
        normalized["bc_parent"] = True
        normalized["bc_child"] = False
    else:
        normalized["bc_parent"] = False
        normalized["bc_child"] = True

    if normalized["enable_barcode"]:
        normalized["remarks"] = normalized.get("bc_title", "")
    elif normalized["request_ack"]:
        normalized["remarks"] = normalized.get("ack_title", "")
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


def resolve_step_image_bytes(program: Dict[str, Any], step: Dict[str, Any]) -> Optional[bytes]:
    image_value = step.get("upload_image", "")
    if not isinstance(image_value, str) or not image_value.strip():
        return None

    decoded = decode_image_data_url(image_value)
    if decoded is not None:
        return decoded

    parsed = urlparse(image_value)
    image_path = parsed.path if parsed.path else image_value

    if image_path.startswith("/programs/"):
        source_path = PROGRAMS_DIR / image_path[len("/programs/"):]
        if source_path.exists() and source_path.is_file():
            return source_path.read_bytes()

    part = sanitize_filename(program.get("partname", "program"))
    fallback_path = PROGRAMS_DIR / part / "imgs" / Path(image_path).name
    if fallback_path.exists() and fallback_path.is_file():
        return fallback_path.read_bytes()
    return None


def prettify_step_key(key: str) -> str:
    acronyms = {"ac", "am", "bc", "ftp", "mes", "rpm", "tc"}
    words = []
    for part in str(key).split("_"):
        lowered = part.lower()
        if lowered in acronyms:
            words.append(lowered.upper())
        else:
            words.append(lowered.capitalize())
    return " ".join(words)


def mode_label(step: Dict[str, Any]) -> str:
    if step.get("enable_barcode"):
        return "Barcode"
    if step.get("request_ack"):
        return "Acknowledgement"
    if step.get("enable_fastening"):
        return "Fastening"
    return "No mode selected"


def mode_pdf_style(mode: str) -> Dict[str, str]:
    styles: Dict[str, Dict[str, str]] = {
        "Barcode": {
            "card_border": "#b9c9f0",
            "step_fill": "#f3f7ff",
            "header_fill": "#edf3ff",
            "accent": "#1f4fb8",
            "badge_fill": "#dce8ff",
            "badge_text": "#173f96",
        },
        "Acknowledgement": {
            "card_border": "#c9c0ea",
            "step_fill": "#f7f4ff",
            "header_fill": "#f3efff",
            "accent": "#5a3db0",
            "badge_fill": "#e8defd",
            "badge_text": "#4b3197",
        },
        "Fastening": {
            "card_border": "#b8dfd8",
            "step_fill": "#f1fbf8",
            "header_fill": "#ebfaf6",
            "accent": "#1d7d69",
            "badge_fill": "#d8f2ea",
            "badge_text": "#166453",
        },
    }
    return styles.get(
        mode,
        {
            "card_border": "#cbd2df",
            "step_fill": "#f6f8fc",
            "header_fill": "#f6f8fc",
            "accent": "#10233f",
            "badge_fill": "#e8edf6",
            "badge_text": "#3e506e",
        },
    )


_BARCODE_KEYS = [
    "bc_title", "bc_parent", "bc_child", "whatloc_enabled",
    "enable_barcode_mes_t", "enable_barcode_mes_nt",
    "restart_on_failure", "reg_ex_validator",
]
_WHATLOC_KEYS = ["check_short_workstation", "check_part_number", "check_ref_designator"]
_ACK_KEYS = ["ack_title", "enable_ack_mes"]
_FASTENING_KEYS = [
    "target_preset", "target_torque", "target_angle",
    "target_min_angle", "target_max_angle", "target_tolerance", "target_rpm",
    "TC_AM", "AC_TM", "screw_info", "mes_enable_assy",
    "snug_torque", "free_fastening_angle", "soft_start",
    "free_fastening_speed", "torque_rising_rate",
    "seating_point", "ramp_up_speed", "torque_compensation",
]


def visible_step_entries(step: Dict[str, Any], include_checkbox_fields: bool = True) -> List[tuple]:
    entries: List[tuple] = []

    def _add(key: str) -> None:
        value = step.get(key)
        if value in ("", None):
            return
        if not include_checkbox_fields and isinstance(value, bool):
            return
        display = ("Yes" if value else "No") if isinstance(value, bool) else str(value)
        entries.append((prettify_step_key(key), display))

    # Always show step number and remarks
    step_no = step.get("step_no")
    if step_no is not None:
        entries.append(("Step No", str(step_no)))
    if step.get("remarks"):
        entries.append(("Remarks", str(step["remarks"])))

    # Mode-specific fields
    if step.get("enable_barcode"):
        for k in _BARCODE_KEYS:
            _add(k)
            if k == "whatloc_enabled" and step.get("whatloc_enabled"):
                for wk in _WHATLOC_KEYS:
                    _add(wk)
    elif step.get("request_ack"):
        for k in _ACK_KEYS:
            _add(k)
    elif step.get("enable_fastening"):
        for k in _FASTENING_KEYS:
            _add(k)

    return entries


def wrap_pdf_text(text: str, font_name: str, font_size: float, max_width: float) -> List[str]:
    raw = str(text or "")
    if not raw:
        return [""]

    lines: List[str] = []
    for paragraph in raw.splitlines() or [raw]:
        words = paragraph.split()
        if not words:
            lines.append("")
            continue

        current = words[0]
        for word in words[1:]:
            trial = f"{current} {word}"
            if stringWidth(trial, font_name, font_size) <= max_width:
                current = trial
                continue
            lines.append(current)
            if stringWidth(word, font_name, font_size) <= max_width:
                current = word
                continue

            fragment = ""
            for char in word:
                trial_fragment = f"{fragment}{char}"
                if fragment and stringWidth(trial_fragment, font_name, font_size) > max_width:
                    lines.append(fragment)
                    fragment = char
                else:
                    fragment = trial_fragment
            current = fragment

        lines.append(current)
    return lines or [""]


def draw_step_pdf_block(
    pdf: canvas.Canvas,
    program: Dict[str, Any],
    step: Dict[str, Any],
    x: float,
    y: float,
    width: float,
    height: float,
    include_checkbox_fields: bool = True,
) -> None:
    mode = mode_label(step)
    style = mode_pdf_style(mode)

    pdf.setStrokeColor(colors.HexColor(style["card_border"]))
    pdf.setFillColor(colors.HexColor(style["step_fill"]))
    pdf.roundRect(x, y, width, height, 10, stroke=1, fill=1)

    header_h = 38
    pdf.setFillColor(colors.HexColor(style["header_fill"]))
    pdf.roundRect(x + 1, y + height - header_h - 1, width - 2, header_h, 8, stroke=0, fill=1)

    padding = 18
    image_area_width = width * 0.52
    gutter = 14
    image_area_x = x + width - image_area_width
    image_x = image_area_x + (padding * 0.35)
    image_y = y + padding
    image_w = image_area_width - (padding * 0.9)
    image_h = height - (padding * 2)
    text_x = x + padding
    text_y_top = y + height - 26
    text_w = image_area_x - gutter - text_x

    pdf.setStrokeColor(colors.HexColor(style["card_border"]))
    pdf.setLineWidth(0.8)
    pdf.roundRect(image_x - 3, image_y - 3, image_w + 6, image_h + 6, 6, stroke=1, fill=0)

    pdf.setFont("Helvetica-Bold", 13.5)
    pdf.setFillColor(colors.HexColor(style["accent"]))
    pdf.drawString(x + padding, text_y_top, f"Step {step.get('step_no', '')}")

    mode_text = mode
    badge_w = max(66, stringWidth(mode_text, "Helvetica-Bold", 8.7) + 16)
    badge_h = 14
    badge_y = text_y_top - 24
    pdf.setFillColor(colors.HexColor(style["badge_fill"]))
    pdf.roundRect(x + padding, badge_y, badge_w, badge_h, 4, stroke=0, fill=1)
    pdf.setFillColor(colors.HexColor(style["badge_text"]))
    pdf.setFont("Helvetica-Bold", 8.7)
    pdf.drawString(x + padding + 8, badge_y + 4, mode_text)

    current_y = text_y_top - 40

    image_bytes = resolve_step_image_bytes(program, step)
    if image_bytes:
        try:
            reader = ImageReader(io.BytesIO(image_bytes))
            img_w, img_h = reader.getSize()
            scale = min(image_w / img_w, image_h / img_h)
            draw_w = img_w * scale
            draw_h = img_h * scale
            draw_x = image_x + (image_w - draw_w) / 2
            draw_y = image_y + (image_h - draw_h) / 2
            pdf.drawImage(reader, draw_x, draw_y, draw_w, draw_h, preserveAspectRatio=True, mask="auto")
        except Exception:
            image_bytes = None

    if not image_bytes:
        pdf.setStrokeColor(colors.HexColor("#d7dce5"))
        pdf.setFillColor(colors.HexColor("#f5f7fb"))
        pdf.rect(image_x, image_y, image_w, image_h, stroke=1, fill=1)
        pdf.setFillColor(colors.HexColor("#77839a"))
        pdf.setFont("Helvetica", 11)
        pdf.drawCentredString(image_x + (image_w / 2), image_y + (image_h / 2), "No image available")

    value_color = colors.HexColor("#4a5973")
    key_color = colors.HexColor(style["accent"])
    line_height = 10.5
    row_gap = 7

    for label, value in visible_step_entries(step, include_checkbox_fields=include_checkbox_fields):
        row_x = text_x + 3
        label_text = f"{label}:"
        label_font = "Helvetica-Bold"
        label_size = 8.6
        value_font = "Helvetica"
        value_size = 8.4
        label_width = stringWidth(label_text, label_font, label_size)
        # Use stacked layout when label is too wide to leave room for value inline
        inline_value_width = text_w - label_width - 6
        stacked = inline_value_width < 60
        if stacked:
            value_max_width = max(60, text_w - 12)
            value_lines = wrap_pdf_text(value, value_font, value_size, value_max_width)
            line_count = max(1, len(value_lines))
            block_height = (line_count + 1) * line_height + row_gap
        else:
            value_max_width = inline_value_width
            value_lines = wrap_pdf_text(value, value_font, value_size, value_max_width)
            line_count = max(1, len(value_lines))
            block_height = (line_count * line_height) + row_gap
        if current_y - block_height < y + padding:
            break

        pdf.setFillColor(key_color)
        pdf.setFont(label_font, label_size)
        pdf.drawString(row_x, current_y, label_text)

        pdf.setFillColor(value_color)
        pdf.setFont(value_font, value_size)
        if stacked:
            current_y -= line_height
            for line in value_lines:
                pdf.drawString(row_x + 8, current_y, line)
                current_y -= line_height
            current_y += line_height  # will be decremented below
        elif value_lines:
            pdf.drawString(row_x + label_width + 4, current_y, value_lines[0])
            for line in value_lines[1:]:
                current_y -= line_height
                pdf.drawString(row_x + label_width + 4, current_y, line)
        else:
            pdf.drawString(row_x + label_width + 4, current_y, "-")

        current_y -= line_height
        current_y -= row_gap


def build_steps_pdf(program: Dict[str, Any], include_checkbox_fields: bool = True) -> bytes:
    normalized_program = normalize_program(program)
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    page_width, page_height = A4
    margin = 16
    gap = 14
    header_height = 26
    usable_height = page_height - (margin * 2) - header_height - gap
    block_height = usable_height / 2
    block_width = page_width - (margin * 2)

    steps = normalized_program.get("steps", [])
    if not steps:
        pdf.setFillColor(colors.HexColor("#f4f7fc"))
        pdf.rect(0, 0, page_width, page_height, stroke=0, fill=1)
        pdf.setFillColor(colors.HexColor("#10233f"))
        pdf.setFont("Helvetica-Bold", 18)
        pdf.drawString(margin, page_height - margin - 10, normalized_program.get("partname") or "Program")
        pdf.setFillColor(colors.HexColor("#4b5b76"))
        pdf.setFont("Helvetica", 11)
        pdf.drawString(margin, page_height - margin - 32, "No steps available.")
        pdf.save()
        return buffer.getvalue()

    for index, step in enumerate(steps):
        slot = index % 2
        if slot == 0:
            pdf.setFillColor(colors.HexColor("#f4f7fc"))
            pdf.rect(0, 0, page_width, page_height, stroke=0, fill=1)
            pdf.setFillColor(colors.white)
            pdf.roundRect(margin, page_height - margin - 24, page_width - (margin * 2), 20, 6, stroke=0, fill=1)
            pdf.setFont("Helvetica-Bold", 14)
            pdf.setFillColor(colors.HexColor("#10233f"))
            pdf.drawString(margin + 8, page_height - margin - 10, normalized_program.get("partname") or "Program")
            pdf.setFont("Helvetica", 9.5)
            pdf.setFillColor(colors.HexColor("#4b5b76"))
            pdf.drawRightString(page_width - margin - 8, page_height - margin - 10, f"Work Instruction Sheet {index // 2 + 1}")

        y = page_height - margin - header_height - block_height if slot == 0 else margin
        if slot == 0:
            y += gap
        draw_step_pdf_block(
            pdf,
            normalized_program,
            step,
            margin,
            y,
            block_width,
            block_height - (gap if slot == 0 else 0),
            include_checkbox_fields=include_checkbox_fields,
        )

        if slot == 1 or index == len(steps) - 1:
            pdf.showPage()

    pdf.save()
    return buffer.getvalue()


def persist_program_locked() -> None:
    part = sanitize_filename(CURRENT_DATA.get("partname", "program"))
    json_path = PROGRAMS_DIR / f"{part}.json"
    image_dir = PROGRAMS_DIR / part / "imgs"
    image_dir.mkdir(parents=True, exist_ok=True)

    steps = CURRENT_DATA.get("steps", [])

    # ── Phase 1: resolve every step's image bytes into memory ────────────────
    # Reading ALL sources before writing prevents rename collisions when steps
    # are reordered (e.g. swap: step 1↔2 would overwrite step 2's file before
    # step 2 had a chance to read it).
    resolved: Dict[int, Optional[bytes]] = {}  # step_no → image bytes or None
    for step in steps:
        step_no = int(step.get("step_no", 0) or 0)
        if step_no <= 0:
            resolved[step_no] = None
            continue
        image_value = step.get("upload_image", "")
        decoded = decode_image_data_url(image_value) if isinstance(image_value, str) else None
        if decoded is not None:
            resolved[step_no] = decoded
            continue
        if isinstance(image_value, str) and image_value.startswith("/programs/"):
            source_rel = image_value[len("/programs/"):]
            source_path = PROGRAMS_DIR / source_rel
            resolved[step_no] = source_path.read_bytes() if source_path.exists() else None
        else:
            resolved[step_no] = None

    # ── Phase 2: write images and update step paths ───────────────────────────
    active_image_names: set = set()
    for step in steps:
        step_no = int(step.get("step_no", 0) or 0)
        if step_no <= 0:
            step["upload_image"] = ""
            continue
        image_name = f"{step_no}.png"
        image_path = image_dir / image_name
        img_bytes = resolved.get(step_no)

        if img_bytes is not None:
            image_path.write_bytes(img_bytes)
            step["upload_image"] = f"/programs/{part}/imgs/{image_name}"
            active_image_names.add(image_name)
        elif image_path.exists():
            # already on disk under the correct name (no move needed)
            step["upload_image"] = f"/programs/{part}/imgs/{image_name}"
            active_image_names.add(image_name)
        else:
            step["upload_image"] = ""

    # ── Phase 3: remove orphaned image files ─────────────────────────────────
    for pattern in ("*.png", "*.jpg", "*.jpeg"):
        for existing in image_dir.glob(pattern):
            if existing.name not in active_image_names:
                existing.unlink()

    json_path.write_text(json.dumps(CURRENT_DATA, indent=4), encoding="utf-8")


def parse_program_json_bytes(raw: bytes, source_label: str) -> Dict[str, Any]:
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON in uploaded file.") from exc


def parse_program_from_zip_bytes(raw: bytes) -> Dict[str, Any]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid or corrupt ZIP file.") from exc

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
        raise HTTPException(status_code=400, detail="Invalid JSON inside ZIP.") from exc

    image_members: Dict[int, str] = {}
    for info in archive.infolist():
        if info.is_dir():
            continue
        rel = str(Path(info.filename)).replace("\\\\", "/").lstrip("/")
        if not rel or ".." in Path(rel).parts:
            continue
        if not rel.lower().endswith((".png", ".jpg", ".jpeg")):
            continue
        name = Path(rel).name
        stem = Path(name).stem
        if stem.isdigit():
            image_members[int(stem)] = rel

    if isinstance(program, dict) and isinstance(program.get("steps"), list):
        for step in program["steps"]:
            if not isinstance(step, dict):
                continue
            step_no = int(step.get("step_no", 0) or 0)
            rel = image_members.get(step_no)
            if rel:
                step["upload_image"] = f"/programs/{rel}"

    for info in archive.infolist():
        if info.is_dir():
            continue
        rel = str(Path(info.filename)).replace("\\\\", "/").lstrip("/")
        if not rel or ".." in Path(rel).parts:
            continue
        target = (PROGRAMS_DIR / rel).resolve()
        if not str(target).startswith(str(PROGRAMS_DIR.resolve())):
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(archive.read(info))
    return program


def get_state() -> Dict[str, Any]:
    with STATE_LOCK:
        return copy.deepcopy(CURRENT_DATA)


def set_state(data: Dict[str, Any], persist: bool = True) -> Dict[str, Any]:
    normalized = normalize_program(data)
    with STATE_LOCK:
        CURRENT_DATA.clear()
        CURRENT_DATA.update(normalized)
        if persist:
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


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    if not _is_authenticated(request):
        return RedirectResponse(url="/login")
    return RedirectResponse(url="/recipe-management")


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    if _is_authenticated(request):
        return RedirectResponse(url="/recipe-management")
    return HTMLResponse(content=LOGIN_FILE.read_text(encoding="utf-8"))


@app.post("/api/auth/login")
async def api_login(request: Request):
    body = await request.json()
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", ""))
    if not _verify_credentials(username, password):
        raise HTTPException(status_code=401, detail="Invalid credentials.")
    request.session["authenticated"] = True
    return {"redirect": "/recipe-management"}


@app.post("/api/auth/logout")
def api_logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/login", status_code=303)


@app.post("/api/auth/change-credentials")
async def api_change_credentials(request: Request):
    if not _is_authenticated(request):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    body = await request.json()
    current_password = str(body.get("current_password", ""))
    new_username = str(body.get("new_username", "")).strip()
    new_password = str(body.get("new_password", "")).strip()
    # Verify current password first
    creds = _load_credentials()
    if not secrets.compare_digest(_hash_password(current_password), creds.get("password_hash", "")):
        raise HTTPException(status_code=403, detail="Current password is incorrect.")
    if not new_username:
        raise HTTPException(status_code=400, detail="Username cannot be empty.")
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters.")
    _save_credentials(new_username, new_password)
    return {"status": "ok"}


@app.get("/editor", response_class=HTMLResponse)
def editor_page(request: Request):
    if not _is_authenticated(request):
        return RedirectResponse(url="/login")
    html = INDEX_FILE.read_text(encoding="utf-8")
    html = html.replace("{{ initial_program | safe }}", json.dumps(get_state()))
    html = html.replace("{{ initial_step_template | safe }}", json.dumps(STEP_TEMPLATE))
    return HTMLResponse(content=html)


@app.get("/preview", response_class=HTMLResponse)
def preview_page(request: Request):
    if not _is_authenticated(request):
        return RedirectResponse(url="/login")
    return HTMLResponse(content=PREVIEW_FILE.read_text(encoding="utf-8"))


@app.get("/api/program")
def api_get_program():
    return get_state()


@app.post("/api/program")
def api_set_program(program: Dict[str, Any]):
    return {"program": set_state(program), "storage_path": str(PROGRAMS_DIR / sanitize_filename(program.get("partname", "program")))}


@app.get("/api/programs")
def api_list_programs():
    return {"programs": _list_local_program_names()}


@app.post("/api/programs/{program_file}")
def api_load_program(program_file: str):
    safe_rel = str(Path(program_file)).replace("\\\\", "/").lstrip("/")
    if not safe_rel.lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="Program file must be a .json file")
    if ".." in Path(safe_rel).parts:
        raise HTTPException(status_code=400, detail="Invalid program file path")

    target = (PROGRAMS_DIR / safe_rel).resolve()
    if not str(target).startswith(str(PROGRAMS_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid program file path")

    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Program file not found")
    try:
        program = json.loads(target.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid program JSON.") from exc

    return set_state(program)


@app.get("/api/storage-config")
def api_storage_config():
    return {
        "remote_storage_enabled": False,
        "direct_upload_threshold_bytes": DIRECT_UPLOAD_THRESHOLD_BYTES,
        "programs_dir": str(PROGRAMS_DIR),
    }


@app.post("/api/upload-zip")
async def api_upload_zip(file: UploadFile = File(...)):
    raw = await file.read()
    program = parse_program_from_zip_bytes(raw)
    saved_program = set_state(program, persist=True)
    return {"program": saved_program, "storage_path": str(PROGRAMS_DIR / sanitize_filename(saved_program.get("partname", "program")))}


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


@app.post("/api/reorder-steps")
def api_reorder_steps(payload: Dict[str, Any]):
    order: List[int] = payload.get("order", [])
    with STATE_LOCK:
        steps = CURRENT_DATA.get("steps", [])
        n = len(steps)
        if not order or sorted(order) != list(range(n)):
            raise HTTPException(status_code=400, detail="Invalid order: must be a permutation of all step indices")

        part = sanitize_filename(CURRENT_DATA.get("partname", "program"))
        image_dir = PROGRAMS_DIR / part / "imgs"

        # Phase 1: rename existing images to temp names (avoids collisions)
        for i, old_idx in enumerate(order):
            old_path = image_dir / f"{old_idx + 1}.png"
            tmp_path = image_dir / f"_tmp_{i}.png"
            if old_path.exists():
                old_path.replace(tmp_path)

        # Phase 2: rename temp names to final step numbers
        for i in range(n):
            tmp_path = image_dir / f"_tmp_{i}.png"
            new_path = image_dir / f"{i + 1}.png"
            if tmp_path.exists():
                tmp_path.replace(new_path)

        # Reorder steps, update step_no, bc_parent/bc_child, and image paths
        new_steps = []
        for i, old_idx in enumerate(order):
            step = copy.deepcopy(steps[old_idx])
            step["step_no"] = i + 1
            step["bc_parent"] = (i == 0)
            step["bc_child"] = (i != 0)
            new_image_path = image_dir / f"{i + 1}.png"
            if new_image_path.exists():
                step["upload_image"] = f"/programs/{part}/imgs/{i + 1}.png"
            else:
                step["upload_image"] = ""
            new_steps.append(step)

        CURRENT_DATA["steps"] = new_steps
        persist_program_locked()
        return copy.deepcopy(CURRENT_DATA)


@app.get("/download-recipe")
def download_recipe_zip():
    with STATE_LOCK:
        persist_program_locked()
        program = copy.deepcopy(CURRENT_DATA)

    part = sanitize_filename(program.get("partname"), fallback="program")

    mem = io.BytesIO()
    with zipfile.ZipFile(mem, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{part}/", "")
        zf.writestr(f"{part}/imgs/", "")
        zf.writestr(f"{part}.json", json.dumps(program, indent=4))

        added_arc = set()
        for step in program.get("steps", []):
            image_bytes = resolve_step_image_bytes(program, step)
            if image_bytes is None:
                continue
            step_no = int(step.get("step_no", 0) or 0)
            if step_no <= 0:
                continue
            arc = str(Path(part) / "imgs" / f"{step_no}.png")
            if arc in added_arc:
                continue
            zf.writestr(arc, image_bytes)
            added_arc.add(arc)

    mem.seek(0)
    zip_name = f"mviis_recipie_{part}.zip"
    return Response(
        content=mem.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_name}"'},
    )


@app.post("/download-pdf")
async def download_steps_pdf(request: Request):
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON payload for PDF export") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid program payload for PDF export")

    program = normalize_program(payload)
    pdf_bytes = build_steps_pdf(program)
    part = sanitize_filename(program.get("partname"), fallback="program")
    filename = f"{part}_steps.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/download-wi")
async def download_steps_wi_pdf(request: Request):
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON payload for WI PDF export") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid program payload for WI PDF export")

    program = normalize_program(payload)
    pdf_bytes = build_steps_pdf(program, include_checkbox_fields=False)
    part = sanitize_filename(program.get("partname"), fallback="program")
    filename = f"{part}_wi.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/template")
def api_template():
    return copy.deepcopy(STEP_TEMPLATE)


# ── System Settings ───────────────────────────────────────────────────────────

@app.get("/system-settings", response_class=HTMLResponse)
def system_settings_page(request: Request):
    if not _is_authenticated(request):
        return RedirectResponse(url="/login")
    return HTMLResponse(content=SYSTEM_SETTINGS_FILE.read_text(encoding="utf-8"))


@app.post("/api/system/shutdown")
def api_shutdown():
    try:
        subprocess.Popen(["sudo", "shutdown", "now"])
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to initiate shutdown.")
    return {"status": "ok", "action": "shutdown"}


@app.post("/api/system/reboot")
def api_reboot():
    try:
        subprocess.Popen(["sudo", "reboot", "now"])
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to initiate reboot.")
    return {"status": "ok", "action": "reboot"}


@app.post("/api/system/reset")
def api_reset():
    try:
        subprocess.Popen(["sudo", "pkill", "Xorg"])
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to initiate reset.")
    return {"status": "ok", "action": "reset"}


@app.post("/api/system/datetime")
async def api_set_datetime(request: Request):
    try:
        payload = await request.json()
        iso_str = payload.get("datetime", "")
        # Validate format: ISO 8601 e.g. "2026-06-19T14:30:00"
        dt = datetime.fromisoformat(iso_str)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid datetime. Use ISO 8601 format.")
    try:
        formatted = dt.strftime("%Y-%m-%d %H:%M:%S")
        subprocess.run(["sudo", "date", "-s", formatted], check=True, capture_output=True)
    except subprocess.CalledProcessError:
        raise HTTPException(status_code=500, detail="Failed to update system date/time.")
    return {"status": "ok", "datetime": dt.isoformat()}


# ── Recipe Management ─────────────────────────────────────────────────────────

@app.get("/recipe-management", response_class=HTMLResponse)
def recipe_management_page(request: Request):
    if not _is_authenticated(request):
        return RedirectResponse(url="/login")
    return HTMLResponse(content=RECIPE_MANAGEMENT_FILE.read_text(encoding="utf-8"))


@app.get("/api/recipes")
def api_list_recipes():
    recipes = []
    for fp in sorted(PROGRAMS_DIR.glob("*.json")):
        try:
            data = json.loads(fp.read_text(encoding="utf-8"))
            recipes.append({
                "file": fp.name,
                "partname": data.get("partname", fp.stem),
                "steps": len(data.get("steps", [])),
            })
        except Exception:
            recipes.append({"file": fp.name, "partname": fp.stem, "steps": 0})
    return {"recipes": recipes}


@app.post("/api/recipes/new")
async def api_create_recipe(request: Request):
    body = await request.json()
    partname = str(body.get("partname", "")).strip()
    if not partname:
        raise HTTPException(status_code=400, detail="partname is required.")
    safe_stem = sanitize_filename(partname)
    if not safe_stem:
        raise HTTPException(status_code=400, detail="Invalid partname.")
    json_path = PROGRAMS_DIR / f"{safe_stem}.json"
    if json_path.exists():
        raise HTTPException(status_code=409, detail="A recipe with that name already exists.")
    # Load template and set partname
    template_path = Path("template.json")
    if template_path.exists():
        template = json.loads(template_path.read_text(encoding="utf-8"))
    else:
        template = {"partname": "", "enable_mes": False, "enable_ftp": False, "steps": []}
    template["partname"] = partname
    # Assign step_no = 1 to the first template step if present
    if template.get("steps"):
        template["steps"][0]["step_no"] = 1
    # Create folder structure
    img_dir = PROGRAMS_DIR / safe_stem / "imgs"
    img_dir.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(template, indent=4), encoding="utf-8")
    return {"file": json_path.name, "partname": partname, "steps": len(template.get("steps", []))}


def _safe_program_path(filename: str) -> Path:
    """Resolve a program JSON path safely within PROGRAMS_DIR."""
    safe = Path(filename).name  # strip any directory components
    if not safe.lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="Invalid filename.")
    target = (PROGRAMS_DIR / safe).resolve()
    if not str(target).startswith(str(PROGRAMS_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid filename.")
    return target


@app.delete("/api/recipes/{filename}")
def api_delete_recipe(filename: str):
    target = _safe_program_path(filename)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Recipe not found.")

    # Also remove the associated image folder
    folder = PROGRAMS_DIR / target.stem
    if folder.exists() and folder.is_dir():
        shutil.rmtree(folder)
    target.unlink()
    return {"status": "ok", "deleted": filename}


@app.post("/api/recipes/{filename}/rename")
async def api_rename_recipe(filename: str, request: Request):
    try:
        payload = await request.json()
        new_name: str = payload.get("new_name", "").strip()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON.")

    if not new_name:
        raise HTTPException(status_code=400, detail="new_name is required.")

    new_safe = sanitize_filename(new_name)
    if not new_safe:
        raise HTTPException(status_code=400, detail="Invalid new name.")

    target = _safe_program_path(filename)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Recipe not found.")

    new_json = PROGRAMS_DIR / f"{new_safe}.json"
    if new_json.exists():
        raise HTTPException(status_code=409, detail="A recipe with that name already exists.")

    # Read, update partname, write to new file
    data = json.loads(target.read_text(encoding="utf-8"))
    data["partname"] = new_name
    new_json.write_text(json.dumps(data, indent=4), encoding="utf-8")

    # Rename image folder if present
    old_folder = PROGRAMS_DIR / target.stem
    new_folder = PROGRAMS_DIR / new_safe
    if old_folder.exists() and old_folder.is_dir():
        old_folder.rename(new_folder)

    target.unlink()
    return {"status": "ok", "file": new_json.name, "partname": new_name}


@app.post("/api/recipes/{filename}/duplicate")
async def api_duplicate_recipe(filename: str, request: Request):
    try:
        payload = await request.json()
        new_name: str = payload.get("new_name", "").strip()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON.")

    if not new_name:
        raise HTTPException(status_code=400, detail="new_name is required.")

    new_safe = sanitize_filename(new_name)
    if not new_safe:
        raise HTTPException(status_code=400, detail="Invalid new name.")

    target = _safe_program_path(filename)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Recipe not found.")

    new_json = PROGRAMS_DIR / f"{new_safe}.json"
    if new_json.exists():
        raise HTTPException(status_code=409, detail="A recipe with that name already exists.")

    # Copy JSON with updated partname
    data = json.loads(target.read_text(encoding="utf-8"))
    data["partname"] = new_name
    new_json.write_text(json.dumps(data, indent=4), encoding="utf-8")

    # Copy image folder if present
    old_folder = PROGRAMS_DIR / target.stem
    new_folder = PROGRAMS_DIR / new_safe
    if old_folder.exists() and old_folder.is_dir():
        shutil.copytree(old_folder, new_folder)

    return {"status": "ok", "file": new_json.name, "partname": new_name}


@app.get("/api/recipes/{filename}/download")
def api_download_recipe_zip(filename: str):
    target = _safe_program_path(filename)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Recipe not found.")

    program = json.loads(target.read_text(encoding="utf-8"))
    part = sanitize_filename(program.get("partname"), fallback=target.stem)
    image_dir = PROGRAMS_DIR / target.stem / "imgs"

    mem = io.BytesIO()
    with zipfile.ZipFile(mem, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{part}/", "")
        zf.writestr(f"{part}/imgs/", "")
        zf.writestr(f"{part}.json", json.dumps(program, indent=4))
        if image_dir.exists():
            for img in image_dir.iterdir():
                if img.is_file():
                    zf.write(img, arcname=str(Path(part) / "imgs" / img.name))

    mem.seek(0)
    zip_name = f"mviis_recipe_{part}.zip"
    return Response(
        content=mem.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_name}"'},
    )


@app.get("/api/recipes/{filename}/pdf")
def api_download_recipe_pdf(filename: str):
    target = _safe_program_path(filename)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Recipe not found.")
    program = normalize_program(json.loads(target.read_text(encoding="utf-8")))
    pdf_bytes = build_steps_pdf(program)
    part = sanitize_filename(program.get("partname"), fallback=target.stem)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{part}_steps.pdf"'},
    )


@app.get("/api/recipes/{filename}/wi")
def api_download_recipe_wi(filename: str):
    target = _safe_program_path(filename)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Recipe not found.")
    program = normalize_program(json.loads(target.read_text(encoding="utf-8")))
    pdf_bytes = build_steps_pdf(program, include_checkbox_fields=False)
    part = sanitize_filename(program.get("partname"), fallback=target.stem)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{part}_wi.pdf"'},
    )


# ── Download Logs ─────────────────────────────────────────────────────────────

@app.get("/download-logs", response_class=HTMLResponse)
def download_logs_page(request: Request):
    if not _is_authenticated(request):
        return RedirectResponse(url="/login")
    return HTMLResponse(content=DOWNLOAD_LOGS_FILE.read_text(encoding="utf-8"))


@app.post("/api/logs/clear")
def api_clear_logs(log_type: str = Query(..., description="system | conduit | assy | all")):
    log_dirs = {
        "system":  settings.system_log_path,
        "conduit": settings.conduit_log_path,
        "assy":    settings.assembly_log_path,
    }
    targets = list(log_dirs.items()) if log_type == "all" else []
    if log_type != "all":
        if log_type not in log_dirs:
            raise HTTPException(status_code=400, detail="Invalid log_type. Must be system, conduit, assy, or all.")
        targets = [(log_type, log_dirs[log_type])]

    deleted = 0
    for _, dir_str in targets:
        dir_path = Path(dir_str)
        if not dir_path.exists() or not dir_path.is_dir():
            continue
        for f in dir_path.iterdir():
            if f.is_file():
                try:
                    f.unlink()
                    deleted += 1
                except OSError:
                    pass

    return {"deleted": deleted, "log_type": log_type}


@app.get("/api/logs/download")
def api_download_logs(
    log_type: str = Query(..., description="system | conduit | assy"),
    start_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
):
    log_dirs = {
        "system": settings.system_log_path,
        "conduit": settings.conduit_log_path,
        "assy": settings.assembly_log_path,
    }
    if log_type not in log_dirs:
        raise HTTPException(status_code=400, detail="Invalid log_type. Must be system, conduit, or assy.")

    in_path = Path(log_dirs[log_type])
    if not in_path.exists() or not in_path.is_dir():
        raise HTTPException(status_code=404, detail="Log directory not found or not configured for this platform.")

    try:
        start_dt = datetime.strptime(start_date, "%Y-%m-%d").date() if start_date else None
        end_dt = datetime.strptime(end_date, "%Y-%m-%d").date() if end_date else None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.") from exc

    def _file_in_range(filepath: Path) -> bool:
        if start_dt is None and end_dt is None:
            return True
        try:
            mtime = date.fromtimestamp(filepath.stat().st_mtime)
            if start_dt and mtime < start_dt:
                return False
            if end_dt and mtime > end_dt:
                return False
            return True
        except OSError:
            return True

    if log_type in ("system", "conduit"):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            matched = False
            for f in sorted(in_path.iterdir()):
                if f.is_file() and _file_in_range(f):
                    zf.write(f, arcname=f.name)
                    matched = True
        if not matched:
            raise HTTPException(status_code=404, detail="No log files found for the given date range.")
        buf.seek(0)
        filename = f"{log_type}_logs.zip"
        return StreamingResponse(
            iter([buf.getvalue()]),
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    # ── Assy log: flatten JSON → CSV grouped by date ──────────────────────────
    df_list: List[Any] = []
    runningtime = datetime.now().strftime("%Y%m%d_%H%M%S")

    for file in sorted(in_path.iterdir()):
        try:
            if (
                file.is_file()
                and file.suffix.lower() == ".json"
                and re.match(r"^[a-zA-Z0-9-]+\.json$", file.name)
                and _file_in_range(file)
            ):
                tdf = pd.read_json(file)
                if len(tdf.get("steps", [])) > 0:
                    df_list.append(tdf)
        except Exception:
            pass

    if not df_list:
        raise HTTPException(status_code=404, detail="No assy log files found for the given date range.")

    df = pd.concat(df_list, ignore_index=True)
    ndf = pd.json_normalize(df["steps"])
    df = df.drop("steps", axis=1)
    ndf.reset_index(drop=True, inplace=True)
    df.reset_index(drop=True, inplace=True)
    df = pd.concat([df, ndf], axis=1)

    csv_buf = io.BytesIO()
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        if "date" in df.columns:
            grouped = df.groupby(df["date"].fillna("unknown_date").astype(str))
            for date_key, group_df in grouped:
                safe_date = re.sub(r"[^a-zA-Z0-9_-]+", "-", date_key).strip("-") or "unknown_date"
                csv_name = f"exported_log_{safe_date}_{runningtime}.csv"
                csv_buf = io.StringIO()
                group_df.to_csv(csv_buf, index=False)
                zf.writestr(csv_name, csv_buf.getvalue())
        else:
            csv_buf2 = io.StringIO()
            df.to_csv(csv_buf2, index=False)
            zf.writestr(f"exported_log_{runningtime}.csv", csv_buf2.getvalue())

    zip_buf.seek(0)
    return StreamingResponse(
        iter([zip_buf.getvalue()]),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="assy_logs_{runningtime}.zip"'},
    )


# ── App Configuration ─────────────────────────────────────────────────────────

@app.get("/configure", response_class=HTMLResponse)
def configure_page(request: Request):
    if not _is_authenticated(request):
        return RedirectResponse(url="/login")
    return HTMLResponse(content=CONFIGURE_FILE.read_text(encoding="utf-8"))


@app.get("/api/config/mes")
def api_get_mes_config():
    config_path = Path(settings.mes_config_file)
    if not config_path.exists():
        return {"mes_config": {}}
    try:
        return json.loads(config_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"mes_config": {}}


@app.post("/api/config/mes")
async def api_set_mes_config(request: Request):
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc

    if not isinstance(payload, dict) or "mes_config" not in payload:
        raise HTTPException(status_code=400, detail="Payload must have a 'mes_config' key")

    config_path = Path(settings.mes_config_file)
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(payload, indent=4), encoding="utf-8")

    return {"status": "ok", "mes_config": payload.get("mes_config", {})}


@app.get("/{full_path:path}")
def catch_all(full_path: str, request: Request):
    if not _is_authenticated(request):
        return RedirectResponse(url="/login")
    return RedirectResponse(url="/recipe-management")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "program_editor:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
