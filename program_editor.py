from __future__ import annotations

import copy
import json
import threading
import base64
import io
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
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
PROGRAMS_DIR = Path(settings.programs_dir)

DIRECT_UPLOAD_THRESHOLD_BYTES = 20 * 1024 * 1024

app = FastAPI(title=settings.app_name)
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
    json_path = PROGRAMS_DIR / f"{part}.json"
    image_dir = PROGRAMS_DIR / part / "imgs"
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
            source_rel = image_value[len("/programs/"):]
            source_path = PROGRAMS_DIR / source_rel
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
            step["upload_image"] = ""

    for pattern in ("*.png", "*.jpg", "*.jpeg"):
        for existing in image_dir.glob(pattern):
            if existing.name not in active_image_names:
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
def index():
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
        raise HTTPException(status_code=400, detail=f"Invalid program JSON: {exc}") from exc

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


@app.get("/{full_path:path}")
def catch_all(full_path: str):
    return RedirectResponse(url="/")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "program_editor:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
