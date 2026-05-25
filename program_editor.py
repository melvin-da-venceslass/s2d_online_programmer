from __future__ import annotations

import copy
import mimetypes
import json
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import base64
import io
import uuid
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from google.api_core.exceptions import NotFound
from google.cloud import storage
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from config import settings

BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = BASE_DIR / "template.json"
STATIC_DIR = BASE_DIR / "static"
INDEX_FILE = BASE_DIR / "templates" / "index.html"
PREVIEW_FILE = BASE_DIR / "templates" / "preview.html"
PROGRAMS_DIR = BASE_DIR / "programs"

GCS_BUCKET_NAME = settings.gcs_bucket_name
GCS_PREFIX = settings.gcs_prefix
GCS_DIRECT_UPLOAD_THRESHOLD_BYTES = max(
    1_000_000,
    settings.gcs_direct_upload_threshold_bytes,
)
GCS_KEY_FILE = settings.gcs_key_file

app = FastAPI(title=settings.app_name)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
PROGRAMS_DIR.mkdir(parents=True, exist_ok=True)

STATE_LOCK = threading.Lock()
CURRENT_DATA: Dict[str, Any] = {}
GCS_CLIENT: Optional[storage.Client] = None

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


def _resolve_gcs_key_file() -> Optional[Path]:
    candidates: List[Path] = []
    if GCS_KEY_FILE:
        candidates.append(Path(GCS_KEY_FILE))
    candidates.extend(
        [
            BASE_DIR / "bucket_key.json",
            BASE_DIR / "key.json",
            BASE_DIR / "service-account.json",
        ]
    )
    for candidate in candidates:
        resolved = candidate if candidate.is_absolute() else (BASE_DIR / candidate)
        if resolved.exists() and resolved.is_file():
            return resolved
    return None


def get_gcs_client() -> Optional[storage.Client]:
    global GCS_CLIENT
    if not GCS_BUCKET_NAME:
        return None
    if GCS_CLIENT is not None:
        return GCS_CLIENT

    key_file = _resolve_gcs_key_file()
    try:
        if key_file is not None:
            GCS_CLIENT = storage.Client.from_service_account_json(str(key_file))
        else:
            GCS_CLIENT = storage.Client()
    except Exception:
        return None
    return GCS_CLIENT


def get_gcs_bucket() -> Optional[storage.Bucket]:
    client = get_gcs_client()
    if client is None:
        return None
    return client.bucket(GCS_BUCKET_NAME)


def gcs_enabled() -> bool:
    return get_gcs_bucket() is not None


if not GCS_BUCKET_NAME:
    app.mount("/programs", StaticFiles(directory=PROGRAMS_DIR), name="programs")


def gcs_blob_name(relative_path: str) -> str:
    rel = str(relative_path).strip("/ ")
    if not rel:
        raise ValueError("GCS blob path cannot be empty")
    return f"{GCS_PREFIX}/{rel}" if GCS_PREFIX else rel


def upload_bytes_to_gcs(relative_path: str, payload: bytes, content_type: str) -> None:
    bucket = get_gcs_bucket()
    if bucket is None:
        return
    blob = bucket.blob(gcs_blob_name(relative_path))
    blob.upload_from_string(payload, content_type=content_type)


def read_program_asset_bytes(relative_path: str) -> Optional[bytes]:
    rel = str(relative_path).strip("/ ")
    if not rel:
        return None

    if gcs_enabled():
        return download_bytes_from_gcs(rel)

    local_path = (BASE_DIR / rel).resolve()
    if local_path.exists() and local_path.is_file() and str(local_path).startswith(str(BASE_DIR.resolve())):
        return local_path.read_bytes()
    return None


def _list_local_program_names() -> List[str]:
    return sorted({fp.name for fp in PROGRAMS_DIR.glob("*.json")})


def scan_program_names_from_gcs() -> List[str]:
    bucket = get_gcs_bucket()
    if bucket is None:
        return []

    prefix = f"{GCS_PREFIX.rstrip('/')}/" if GCS_PREFIX else ""
    names: List[str] = []
    for blob in bucket.list_blobs(prefix=prefix):
        if not blob.name.endswith(".json"):
            continue
        tail = blob.name[len(prefix) :] if prefix else blob.name
        if "/" in tail:
            continue
        names.append(Path(tail).name)
    return sorted(set(names))


def download_bytes_from_gcs(relative_path: str) -> Optional[bytes]:
    bucket = get_gcs_bucket()
    if bucket is None:
        return None
    blob = bucket.blob(gcs_blob_name(relative_path))
    if not blob.exists():
        return None
    return blob.download_as_bytes()


def list_programs_from_gcs() -> List[str]:
    return scan_program_names_from_gcs()


def program_storage_path(program: Dict[str, Any]) -> str:
    part = sanitize_filename(program.get("partname", "program"), fallback="program")
    if gcs_enabled():
        return f"gs://{GCS_BUCKET_NAME}/{gcs_blob_name(f'{part}.json')}"
    return str((PROGRAMS_DIR / f"{part}.json").resolve())


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

    # Set remarks based on mode
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
    if image_path.startswith("/"):
        source_path = BASE_DIR / image_path.lstrip("/")
    else:
        source_path = BASE_DIR / image_path

    if source_path.exists() and source_path.is_file():
        return source_path.read_bytes()

    gcs_candidate = image_path.lstrip("/")
    gcs_bytes = download_bytes_from_gcs(gcs_candidate)
    if gcs_bytes is not None:
        return gcs_bytes

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


def visible_step_entries(step: Dict[str, Any], include_checkbox_fields: bool = True) -> List[tuple[str, str]]:
    entries: List[tuple[str, str]] = []
    for key, value in step.items():
        if key in {"upload_image", "step_no"}:
            continue
        if value in ("", None):
            continue
        if not include_checkbox_fields and isinstance(value, bool):
            continue
        if isinstance(value, bool):
            display = "Yes" if value else "No"
        else:
            display = str(value)
        entries.append((prettify_step_key(key), display))
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

    # Top accent panel gives each mode a distinct visual identity.
    header_h = 38
    pdf.setFillColor(colors.HexColor(style["header_fill"]))
    pdf.roundRect(x + 1, y + height - header_h - 1, width - 2, header_h, 8, stroke=0, fill=1)

    padding = 18
    image_area_width = width * 0.75
    gutter = 14
    image_area_x = x + width - image_area_width
    image_x = image_area_x + (padding * 0.35)
    image_y = y + padding
    image_w = image_area_width - (padding * 0.9)
    image_h = height - (padding * 2)
    text_x = x + padding
    text_y_top = y + height - 26
    text_w = image_area_x - gutter - text_x

    # Keep a unified step background and only subtle structural separators.
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
        value_max_width = max(36, text_w - 10 - label_width)
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
        if value_lines:
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
    if gcs_enabled():
        # Keep step saves responsive in Cloud Run by avoiding bucket-wide scans.
        active_program = copy.deepcopy(CURRENT_DATA)

        for step in active_program.get("steps", []):
            step_no = int(step.get("step_no", 0) or 0)
            if step_no <= 0:
                continue

            image_value = step.get("upload_image", "")
            if not isinstance(image_value, str) or not image_value:
                step["upload_image"] = ""
                continue

            decoded = decode_image_data_url(image_value)
            if decoded is not None:
                image_name = f"{step_no}.png"
                upload_bytes_to_gcs(
                    f"{part}/imgs/{image_name}",
                    decoded,
                    "image/png",
                )
                step["upload_image"] = f"/programs/{part}/imgs/{image_name}"

        payload = json.dumps(active_program, indent=4).encode("utf-8")
        upload_bytes_to_gcs(f"{part}.json", payload, "application/json")
        CURRENT_DATA.clear()
        CURRENT_DATA.update(active_program)
        return

    json_path = PROGRAMS_DIR / f"{part}.json"
    image_root = PROGRAMS_DIR / part
    image_dir = image_root / "imgs"
    image_dir.mkdir(parents=True, exist_ok=True)

    active_image_names = set()
    for step in CURRENT_DATA.get("steps", []):
        step_no = int(step.get("step_no", 0) or 0)
        if step_no <= 0:
            continue
        image_name = f"{step_no}.png"
        image_path = image_dir / image_name
        image_value = step.get("upload_image", "")

        decoded = decode_image_data_url(image_value) if isinstance(image_value, str) else None
        if decoded is not None:
            image_path.write_bytes(decoded)
            step["upload_image"] = f"/programs/{part}/imgs/{image_name}"
            active_image_names.add(image_name)
            continue

        if isinstance(image_value, str) and image_value.startswith("/programs/"):
            source_path = BASE_DIR / image_value.lstrip("/")
            if source_path.exists():
                image_path.write_bytes(source_path.read_bytes())
                step["upload_image"] = f"/programs/{part}/imgs/{image_name}"
                active_image_names.add(image_name)
            elif image_path.exists():
                step["upload_image"] = f"/programs/{part}/imgs/{image_name}"
                active_image_names.add(image_name)
            else:
                step["upload_image"] = ""
            continue

        if not image_value:
            if image_path.exists():
                image_path.unlink()
            legacy_png = image_root / f"{step_no}.png"
            legacy_jpg = image_dir / f"{step_no}.jpg"
            legacy_jpeg = image_dir / f"{step_no}.jpeg"
            legacy_root_jpg = image_root / f"{step_no}.jpg"
            legacy_root_jpeg = image_root / f"{step_no}.jpeg"
            if legacy_png.exists():
                legacy_png.unlink()
            if legacy_jpg.exists():
                legacy_jpg.unlink()
            if legacy_jpeg.exists():
                legacy_jpeg.unlink()
            if legacy_root_jpg.exists():
                legacy_root_jpg.unlink()
            if legacy_root_jpeg.exists():
                legacy_root_jpeg.unlink()
            step["upload_image"] = ""

    for pattern in ("*.png", "*.jpg", "*.jpeg"):
        for existing in image_dir.glob(pattern):
            if existing.name not in active_image_names:
                existing.unlink()

    # Remove legacy images that used to live directly under /programs/<part>/.
    for pattern in ("*.png", "*.jpg", "*.jpeg"):
        for existing in image_root.glob(pattern):
            step_num = existing.stem
            if step_num.isdigit() and f"{step_num}.png" not in active_image_names:
                existing.unlink()

    json_path.write_text(json.dumps(CURRENT_DATA, indent=4), encoding="utf-8")


def parse_program_json_bytes(raw: bytes, source_label: str) -> Dict[str, Any]:
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON {source_label}: {exc}") from exc


def parse_program_from_zip_bytes(raw: bytes) -> Dict[str, Any]:
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

    image_members: Dict[int, str] = {}
    for info in archive.infolist():
        if info.is_dir():
            continue
        rel = str(Path(info.filename)).replace("\\", "/").lstrip("/")
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

    if gcs_enabled():
        bucket = get_gcs_bucket()
        if bucket is not None:
            safe_entries: List[tuple[str, bytes, str]] = []
            for info in archive.infolist():
                if info.is_dir():
                    continue
                rel = str(Path(info.filename)).replace("\\", "/").lstrip("/")
                if not rel or ".." in Path(rel).parts:
                    continue
                payload = archive.read(info)
                content_type = mimetypes.guess_type(rel)[0] or "application/octet-stream"
                safe_entries.append((rel, payload, content_type))

            max_workers = min(12, max(4, len(safe_entries)))
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = [
                    executor.submit(
                        bucket.blob(gcs_blob_name(rel)).upload_from_string,
                        payload,
                        content_type=content_type,
                    )
                    for rel, payload, content_type in safe_entries
                ]
                for future in as_completed(futures):
                    future.result()
        return program

    # Local mode: preserve the same ZIP directory structure under /programs.
    for info in archive.infolist():
        if info.is_dir():
            continue
        rel = str(Path(info.filename)).replace("\\", "/").lstrip("/")
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
    if gcs_enabled():
        try:
            return {"programs": list_programs_from_gcs()}
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"Unable to list programs from GCS: {exc}") from exc

    return {"programs": _list_local_program_names()}


@app.post("/api/programs/{program_file}")
def api_load_program(program_file: str):
    name = Path(program_file).name
    if not name.lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="Program file must be a .json file")

    target = (PROGRAMS_DIR / name).resolve()
    if not str(target).startswith(str(PROGRAMS_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid program file path")
    if gcs_enabled():
        raw = download_bytes_from_gcs(name)
        if raw is None:
            raise HTTPException(status_code=404, detail="Program file not found")
        program = parse_program_json_bytes(raw, "from bucket")
    else:
        if not target.exists() or not target.is_file():
            raise HTTPException(status_code=404, detail="Program file not found")
        try:
            program = json.loads(target.read_text(encoding="utf-8"))
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid program JSON: {exc}") from exc

    return set_state(program)


@app.get("/api/storage-config")
def api_storage_config():
    return {
        "gcs_enabled": gcs_enabled(),
        "direct_upload_threshold_bytes": GCS_DIRECT_UPLOAD_THRESHOLD_BYTES,
    }


@app.post("/api/program")
def api_set_program(program: Dict[str, Any]):
    return set_state(program)


@app.post("/api/upload")
async def api_upload(file: UploadFile = File(...)):
    raw = await file.read()
    program = parse_program_json_bytes(raw, "file")
    saved_program = set_state(program, persist=True)
    return {"program": saved_program, "storage_path": program_storage_path(saved_program)}


@app.post("/api/upload-zip")
async def api_upload_zip(file: UploadFile = File(...)):
    raw = await file.read()
    program = parse_program_from_zip_bytes(raw)
    saved_program = set_state(program, persist=not gcs_enabled())
    return {"program": saved_program, "storage_path": program_storage_path(saved_program)}


@app.post("/api/upload-to-gcs")
async def api_upload_to_gcs(file: UploadFile = File(...)):
    raw = await file.read()

    filename = Path(file.filename or "upload.bin").name.lower()
    if filename.endswith(".json"):
        program = parse_program_json_bytes(raw, "file")
        saved_program = set_state(program, persist=True)
    elif filename.endswith(".zip"):
        program = parse_program_from_zip_bytes(raw)
        saved_program = set_state(program, persist=False)
    else:
        raise HTTPException(status_code=400, detail="Unsupported file type. Upload .json or .zip")

    return {"program": saved_program, "storage_path": program_storage_path(saved_program)}


@app.post("/api/upload-recipe-session")
async def api_upload_recipe_session(request: Request):
    if not gcs_enabled():
        raise HTTPException(status_code=400, detail="GCS is not enabled")

    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON payload") from exc

    filename = Path(str(payload.get("filename") or "upload.zip")).name
    if not filename.lower().endswith(".zip"):
        filename = f"{Path(filename).stem}.zip"

    content_type = str(payload.get("content_type") or "application/zip")
    size_value = payload.get("size")
    try:
        size = int(size_value) if size_value is not None and str(size_value) != "" else None
    except Exception:
        size = None

    bucket = get_gcs_bucket()
    if bucket is None:
        raise HTTPException(status_code=400, detail="GCS bucket not available")

    # Keep temp objects flat at bucket root so no extra folder-like prefixes are created.
    staging_blob_name = f"_tmp_upload_{uuid.uuid4().hex}_{filename}"
    upload_url = bucket.blob(staging_blob_name).create_resumable_upload_session(
        content_type=content_type,
        size=size,
        origin=request.headers.get("origin"),
    )
    return {
        "upload_url": upload_url,
        "staging_blob_name": staging_blob_name,
    }


@app.post("/api/finalize-recipe-upload")
async def api_finalize_recipe_upload(request: Request):
    if not gcs_enabled():
        raise HTTPException(status_code=400, detail="GCS is not enabled")

    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON payload") from exc

    staging_blob_name = str(payload.get("staging_blob_name") or "").strip()
    if not staging_blob_name:
        raise HTTPException(status_code=400, detail="Missing staging_blob_name")

    bucket = get_gcs_bucket()
    if bucket is None:
        raise HTTPException(status_code=400, detail="GCS bucket not available")

    blob = bucket.blob(staging_blob_name)
    try:
        raw = blob.download_as_bytes()
    except NotFound as exc:
        raise HTTPException(status_code=404, detail="Uploaded recipe not found in bucket") from exc

    try:
        program = parse_program_from_zip_bytes(raw)
        saved_program = set_state(program, persist=False)
        return {"program": saved_program, "storage_path": program_storage_path(saved_program)}
    finally:
        try:
            blob.delete()
        except Exception:
            pass


@app.post("/api/upload-image-to-gcs")
async def api_upload_image_to_gcs(
    file: UploadFile = File(...),
    partname: str = Form(...),
    step_no: int = Form(...),
):
    raw = await file.read()
    if not gcs_enabled():
        raise HTTPException(status_code=400, detail="GCS is not enabled")

    part = sanitize_filename(partname, fallback="program")
    image_name = f"{int(step_no)}.png"
    upload_bytes_to_gcs(
        f"{part}/imgs/{image_name}",
        raw,
        file.content_type or "image/png",
    )
    return {"storage_path": f"/programs/{part}/imgs/{image_name}"}


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
        persist_program_locked()
        program = copy.deepcopy(CURRENT_DATA)

    part = sanitize_filename(program.get("partname"), fallback="program")

    mem = io.BytesIO()
    with zipfile.ZipFile(mem, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        # Keep a stable recipe layout: <part>.json and <part>/ image folder.
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
            # Always place recipe images inside <part>/imgs in the ZIP.
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


if GCS_BUCKET_NAME:

    @app.get("/programs/{asset_path:path}")
    def serve_program_asset(asset_path: str):
        rel = str(asset_path).replace("\\", "/").lstrip("/")
        if not rel:
            raise HTTPException(status_code=404, detail="Program asset not found")

        payload = read_program_asset_bytes(rel)
        if payload is None:
            raise HTTPException(status_code=404, detail="Program asset not found")

        media_type = mimetypes.guess_type(rel)[0] or "application/octet-stream"
        return Response(content=payload, media_type=media_type)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "program_editor:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
