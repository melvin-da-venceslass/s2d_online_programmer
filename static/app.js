const STEP_FIELDS = [
  {
    title: "Barcode",
    note: "Barcode mode controls the scan and workstation verification fields.",
    fields: [
      { key: "bc_title", label: "Barcode Title", type: "text" },
      { key: "bc_parent", label: "BC Parent", type: "checkbox" },
      { key: "bc_child", label: "BC Child", type: "checkbox" },
      { key: "whatloc_enabled", label: "What Location Enabled", type: "checkbox" },
      { key: "check_short_workstation", label: "Check Workstation", type: "text" },
      { key: "check_part_number", label: "Check Part Number", type: "text" },
      { key: "check_ref_designator", label: "Check Ref Designator", type: "text" },
      { key: "enable_barcode_mes", label: "Enable Barcode MES", type: "checkbox" },
    ]
  },
  {
    title: "Acknowledgement",
    note: "Acknowledgement mode is used for manual confirmation steps.",
    fields: [
      { key: "ack_title", label: "Ack Title", type: "text" },
      { key: "enable_ack_mes", label: "Enable Ack MES", type: "checkbox" },
    ]
  },
  {
    title: "Fastening",
    note: "Fastening mode holds torque, angle, and tool settings.",
    fields: [
      { key: "target_preset", label: "Target Preset", type: "text" },
      { key: "target_torque", label: "Target Torque", type: "text" },
      { key: "target_angle", label: "Target Angle", type: "text" },
      { key: "target_min_angle", label: "Target Min Angle", type: "text" },
      { key: "target_max_angle", label: "Target Max Angle", type: "text" },
      { key: "target_tolerance", label: "Target Tolerance", type: "text" },
      { key: "target_rpm", label: "Target RPM", type: "text" },
      { key: "TC_AM", label: "TC_AM", type: "checkbox" },
      { key: "AC_TM", label: "AC_TM", type: "checkbox" },
      { key: "screw_info", label: "Screw Info", type: "text" },
      { key: "remarks", label: "Remarks", type: "text" },
      { key: "mes_enable_assy", label: "MES Enable Assembly", type: "checkbox" },
      { key: "snug_torque", label: "Snug Torque", type: "text" },
      { key: "free_fastening_angle", label: "Free Fastening Angle", type: "text" },
      { key: "soft_start", label: "Soft Start", type: "text" },
      { key: "free_fastening_speed", label: "Free Fastening Speed", type: "text" },
      { key: "torque_rising_rate", label: "Torque Rising Rate", type: "text" },
      { key: "seating_point", label: "Seating Point", type: "text" },
      { key: "ramp_up_speed", label: "Ramp Up Speed", type: "text" },
      { key: "torque_compensation", label: "Torque Compensation", type: "text" },
    ]
  },
];

const state = {
  program: window.INITIAL_PROGRAM,
  currentIndex: 0,
  dirty: false,
  saving: false,
  lastSavedSnapshot: null,
  serverPrograms: [],
};

const els = {
  partname: document.getElementById('partname'),
  programSelect: document.getElementById('program-select'),
  enableMes: document.getElementById('enable_mes'),
  enableFtp: document.getElementById('enable_ftp'),
  applyProgramBtn: document.getElementById('apply-program-btn'),
  previewStepsBtn: document.getElementById('preview-steps-btn'),
  saveProgramBtn: document.getElementById('save-program-btn'),
  downloadBtn: document.getElementById('download-btn'),
  stepSpinner: document.getElementById('step-spinner'),
  insertStepBtn: document.getElementById('insert-step-btn'),
  addStepBtn: document.getElementById('add-step-btn'),
  deleteStepBtn: document.getElementById('delete-step-btn'),
  cloneStepBtn: document.getElementById('clone-step-btn'),
  uploadFile: document.getElementById('upload-file'),
  uploadZipFile: document.getElementById('upload-zip-file'),
  stepList: document.getElementById('step-list'),
  stepTitle: document.getElementById('step-title'),
  modeSummary: document.getElementById('mode-summary'),
  saveStepBtn: document.getElementById('save-step-btn'),
  formContainer: document.getElementById('form-container'),
  modeCardsWrap: document.querySelector('.mode-cards'),
  modeCards: Array.from(document.querySelectorAll('.mode-card')),
};

function hasSelectedStep() {
  return state.currentIndex >= 0 && state.currentIndex < state.program.steps.length;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeFilename(value) {
  const cleaned = String(value || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^[_\.]+|[_\.]+$/g, '');
  return cleaned || 'program';
}

function expectedProgramFileName() {
  return `${sanitizeFilename(state.program.partname)}.json`;
}

function renderProgramSelect() {
  if (!els.programSelect) return;
  const selectedFile = expectedProgramFileName();
  els.programSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '-- Select Program --';
  els.programSelect.appendChild(placeholder);

  state.serverPrograms.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    if (name === selectedFile) {
      option.selected = true;
    }
    els.programSelect.appendChild(option);
  });
}

async function refreshProgramSelect() {
  const response = await fetch('/api/programs');
  if (!response.ok) {
    return;
  }
  const payload = await response.json();
  state.serverPrograms = Array.isArray(payload.programs) ? payload.programs : [];
  renderProgramSelect();
}

async function loadProgramFromServer(programFile) {
  const response = await fetch(`/api/programs/${encodeURIComponent(programFile)}`, {
    method: 'POST',
  });
  if (!response.ok) {
    alert(await response.text());
    await refreshProgramSelect();
    return;
  }
  state.program = await response.json();
  state.currentIndex = 0;
  resetDirty();
  renderEditor();
  await refreshProgramSelect();
}

function blankStep() {
  return deepClone(window.INITIAL_STEP_TEMPLATE || {
    upload_image: '',
    enable_barcode: false,
    bc_title: '',
    bc_parent: false,
    bc_child: true,
    whatloc_enabled: false,
    check_short_workstation: '',
    check_part_number: '',
    check_ref_designator: '',
    enable_barcode_mes: false,
    ack_title: '',
    request_ack: false,
    enable_ack_mes: false,
    enable_fastening: false,
    step_no: 1,
    target_preset: '',
    target_torque: '',
    target_angle: '',
    target_min_angle: '',
    target_max_angle: '',
    target_tolerance: '',
    target_rpm: '',
    TC_AM: true,
    AC_TM: false,
    screw_info: '',
    remarks: '',
    mes_enable_assy: false,
    snug_torque: '',
    free_fastening_angle: '',
    soft_start: '',
    free_fastening_speed: '',
    torque_rising_rate: '',
    seating_point: '',
    ramp_up_speed: '',
    torque_compensation: '',
  });
}

function blankProgram() {
  const step = blankStep();
  step.step_no = 1;
  step.bc_parent = true;
  step.bc_child = false;
  return {
    partname: '',
    enable_mes: false,
    enable_ftp: false,
    steps: [step],
  };
}

function isReloadNavigation() {
  const entries = performance.getEntriesByType('navigation');
  if (entries.length > 0 && entries[0].type) {
    return entries[0].type === 'reload';
  }
  if (performance.navigation && typeof performance.navigation.type === 'number') {
    return performance.navigation.type === 1;
  }
  return false;
}

function updateProgramInfoFields() {
  els.partname.value = state.program.partname || '';
  els.enableMes.checked = Boolean(state.program.enable_mes);
  els.enableFtp.checked = Boolean(state.program.enable_ftp);
}

function updateSpinnerBounds() {
  const count = state.program.steps.length || 1;
  els.stepSpinner.min = 1;
  els.stepSpinner.max = count;
  if (!els.stepSpinner.value || Number(els.stepSpinner.value) > count) {
    els.stepSpinner.value = Math.min(state.currentIndex + 1, count);
  }
}

function modeLabels(step) {
  const labels = [];
  if (step.enable_barcode) labels.push('Barcode');
  if (step.request_ack) labels.push('Acknowledgement');
  if (step.enable_fastening) labels.push('Fastening');
  return labels.length ? labels.join(' · ') : 'No mode enabled';
}

function getActiveMode(step) {
  if (step.enable_barcode) return 'Barcode';
  if (step.request_ack) return 'Acknowledgement';
  if (step.enable_fastening) return 'Fastening';
  return null;
}

function setExclusiveMode(mode) {
  const step = state.program.steps[state.currentIndex];
  step.enable_barcode = mode === 'Barcode';
  step.request_ack = mode === 'Acknowledgement';
  step.enable_fastening = mode === 'Fastening';
  markDirty();
  renderEditor();
}

function applyExclusiveModeFromStep(step, changedKey) {
  if (changedKey === 'enable_barcode' && step.enable_barcode) {
    step.request_ack = false;
    step.enable_fastening = false;
  } else if (changedKey === 'request_ack' && step.request_ack) {
    step.enable_barcode = false;
    step.enable_fastening = false;
  } else if (changedKey === 'enable_fastening' && step.enable_fastening) {
    step.enable_barcode = false;
    step.request_ack = false;
  }
  return step;
}

function renderModeCards(step) {
  const activeMode = getActiveMode(step);
  els.modeCards.forEach((card) => {
    const title = card.querySelector('h3').textContent;
    card.classList.toggle('active', activeMode === title);
    card.classList.toggle('selectable', true);
  });
}

function renderStepList() {
  els.stepList.innerHTML = '';
  state.program.steps.forEach((step, index) => {
    const li = document.createElement('li');
    li.dataset.index = index;
    li.innerHTML = `<span>Step ${step.step_no}</span><span>${modeLabels(step)}</span>`;
    if (index === state.currentIndex) li.classList.add('active');
    if (state.dirty && index === state.currentIndex) li.classList.add('unsaved');
    li.addEventListener('click', () => selectStep(index));
    els.stepList.appendChild(li);
  });
  updateSpinnerBounds();
}

function createField(field, value, index) {
  const wrapper = document.createElement('div');
  wrapper.className = field.type === 'checkbox' ? 'field checkbox' : 'field';

  const inputId = `step-${index}-${field.key}`;

  if (field.type === 'checkbox') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = inputId;
    input.checked = Boolean(value);
    if (field.key === 'bc_parent' || field.key === 'bc_child') {
      input.disabled = true;
      input.title = 'This value is set automatically by step number.';
    }
    input.dataset.key = field.key;
    input.addEventListener('change', () => {
      if (field.key === 'enable_barcode' || field.key === 'request_ack' || field.key === 'enable_fastening') {
        const step = state.program.steps[state.currentIndex];
        applyExclusiveModeFromStep(step, field.key);
        renderEditor();
        markDirty();
        return;
      }
      if (field.key === 'bc_parent' && input.checked) {
        const child = els.formContainer.querySelector('[data-key="bc_child"]');
        if (child) child.checked = false;
      }
      if (field.key === 'bc_child' && input.checked) {
        const parent = els.formContainer.querySelector('[data-key="bc_parent"]');
        if (parent) parent.checked = false;
      }
      markDirty();
    });
    const label = document.createElement('label');
    label.htmlFor = inputId;
    label.textContent = field.label;
    wrapper.append(input, label);
    return wrapper;
  }

  const label = document.createElement('label');
  label.htmlFor = inputId;
  label.textContent = field.label;
  const input = document.createElement('input');
  input.type = 'text';
  input.id = inputId;
  input.value = value ?? '';
  input.dataset.key = field.key;
  input.addEventListener('input', markDirty);
  wrapper.append(label, input);
  return wrapper;
}

function enforceBcRoleByStepNo(step, stepNo) {
  if (stepNo === 1) {
    step.bc_parent = true;
    step.bc_child = false;
  } else {
    step.bc_parent = false;
    step.bc_child = true;
  }
}

function createCommonImageSection(step, index) {
  const sectionEl = document.createElement('section');
  sectionEl.className = 'section';

  const title = document.createElement('h3');
  title.textContent = 'Image Upload & Annotation';
  sectionEl.appendChild(title);

  const note = document.createElement('p');
  note.className = 'section note';
  note.textContent = 'Upload image is shared and available for all modes.';
  sectionEl.appendChild(note);

  const panel = document.createElement('div');
  panel.className = 'image-upload-panel';

  const hidden = document.createElement('input');
  hidden.type = 'hidden';
  hidden.dataset.key = 'upload_image';
  hidden.value = step.upload_image || '';

  const controls = document.createElement('div');
  controls.className = 'image-upload-controls';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.id = `step-${index}-upload-image`;

  const toolSelect = document.createElement('select');
  toolSelect.className = 'image-tool-select';
  toolSelect.innerHTML = `
    <option value="rectangle">Rectangle</option>
    <option value="square">Square</option>
    <option value="circle">Circle</option>
    <option value="text">Text</option>
  `;

  const colorPicker = document.createElement('input');
  colorPicker.type = 'color';
  colorPicker.value = '#ff0000';
  colorPicker.className = 'image-color-picker';

  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.placeholder = 'Text for image tool';
  textInput.className = 'image-text-input';

  const textSize = document.createElement('input');
  textSize.type = 'number';
  textSize.min = '10';
  textSize.max = '96';
  textSize.value = '26';
  textSize.className = 'image-size-input';

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'secondary';
  clearBtn.textContent = 'Clear Image';

  const saveEditBtn = document.createElement('button');
  saveEditBtn.type = 'button';
  saveEditBtn.className = 'primary';
  saveEditBtn.textContent = 'Apply Edits';

  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'secondary';
  undoBtn.textContent = 'Undo';
  undoBtn.disabled = true;

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'image-canvas-wrap';

  const canvas = document.createElement('canvas');
  canvas.className = 'image-canvas';
  canvas.width = 960;
  canvas.height = 540;
  canvasWrap.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  const MAX_HISTORY = 30;
  let history = [];
  let historyIndex = -1;

  function resolveStoredImageSrc(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.startsWith('data:image')) return raw;

    const normalized = raw.replace(/\\/g, '/');
    if (normalized.startsWith('/programs/')) return normalized;
    if (normalized.startsWith('programs/')) return `/${normalized}`;

    if (/^https?:\/\//i.test(normalized)) {
      try {
        const parsed = new URL(normalized);
        if (parsed.pathname.startsWith('/programs/')) {
          return `${parsed.pathname}${parsed.search || ''}`;
        }
      } catch (_error) {
      }
      return normalized;
    }

    if (/^[^/]+\/[^/]+$/i.test(normalized)) {
      return `/programs/${normalized}`;
    }

    if (/^[^/]+\.(jpg|jpeg|png|gif|webp)$/i.test(normalized)) {
      return `/programs/${sanitizeFilename(step.partname || state.program.partname)}/${normalized}`;
    }

    return normalized;
  }

  function updateUndoButton() {
    undoBtn.disabled = historyIndex <= 0;
  }

  function pushHistory(markAsEdited = true, updateHidden = true) {
    const snapshotData = canvas.toDataURL('image/jpeg', 0.92);
    if (historyIndex >= 0 && history[historyIndex] === snapshotData) {
      if (updateHidden) {
        hidden.value = snapshotData;
        preview.src = snapshotData;
        preview.classList.add('visible');
      }
      return;
    }

    if (historyIndex < history.length - 1) {
      history = history.slice(0, historyIndex + 1);
    }
    history.push(snapshotData);
    if (history.length > MAX_HISTORY) {
      history.shift();
    }
    historyIndex = history.length - 1;

    if (updateHidden) {
      hidden.value = snapshotData;
      preview.src = snapshotData;
      preview.classList.add('visible');
    }
    if (markAsEdited) {
      markDirty();
    }
    updateUndoButton();
  }

  function restoreFromHistory(targetIndex, markAsEdited = true) {
    if (targetIndex < 0 || targetIndex >= history.length) return;
    const dataUrl = history[targetIndex];
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      hidden.value = dataUrl;
      preview.src = dataUrl;
      preview.classList.add('visible');
      if (markAsEdited) {
        markDirty();
      }
      updateUndoButton();
    };
    img.src = dataUrl;
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  function setCanvasFromImageSrc(src, markAsEdited = false) {
    const resolved = resolveStoredImageSrc(src);
    if (!resolved) {
      resetCanvasBlank();
      pushHistory(false, false);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const maxWidth = 960;
      const maxHeight = 540;
      const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      canvas.width = w;
      canvas.height = h;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      history = [];
      historyIndex = -1;
      pushHistory(markAsEdited, true);
    };
    img.onerror = () => {
      resetCanvasBlank();
      pushHistory(false, false);
    };
    img.src = resolved;
  }

  function resetCanvasBlank() {
    canvas.width = 960;
    canvas.height = 540;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#8c97ad';
    ctx.font = '22px sans-serif';
    ctx.fillText('Upload image and edit here', 24, 44);
  }

  let drawing = false;
  let startX = 0;
  let startY = 0;
  let snapshot = null;

  function strokePreview(x1, y1, x2, y2) {
    ctx.strokeStyle = colorPicker.value;
    ctx.lineWidth = 3;
    const w = x2 - x1;
    const h = y2 - y1;
    const size = Math.max(Math.abs(w), Math.abs(h));
    const sx = w < 0 ? -size : size;
    const sy = h < 0 ? -size : size;

    if (toolSelect.value === 'rectangle') {
      ctx.strokeRect(x1, y1, w, h);
    } else if (toolSelect.value === 'square') {
      ctx.strokeRect(x1, y1, sx, sy);
    } else if (toolSelect.value === 'circle') {
      const r = Math.sqrt(w * w + h * h);
      ctx.beginPath();
      ctx.arc(x1, y1, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  canvas.addEventListener('mousedown', (event) => {
    const pt = canvasPoint(event);

    if (toolSelect.value === 'text') {
      const text = (textInput.value || '').trim();
      if (!text) {
        alert('Enter text before placing it on image.');
        return;
      }
      ctx.fillStyle = colorPicker.value;
      ctx.font = `${Math.max(10, Number(textSize.value) || 26)}px sans-serif`;
      ctx.fillText(text, pt.x, pt.y);
      pushHistory(true, true);
      return;
    }

    drawing = true;
    startX = pt.x;
    startY = pt.y;
    snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
  });

  canvas.addEventListener('mousemove', (event) => {
    if (!drawing || !snapshot) return;
    const pt = canvasPoint(event);
    ctx.putImageData(snapshot, 0, 0);
    strokePreview(startX, startY, pt.x, pt.y);
  });

  canvas.addEventListener('mouseup', () => {
    if (!drawing) return;
    drawing = false;
    snapshot = null;
    pushHistory(true, true);
  });

  canvas.addEventListener('mouseleave', () => {
    if (!drawing) return;
    drawing = false;
    snapshot = null;
    pushHistory(true, true);
  });

  const preview = document.createElement('img');
  preview.className = 'image-preview';
  preview.alt = 'Step upload preview';
  const initialImageSrc = resolveStoredImageSrc(hidden.value);
  if (initialImageSrc) {
    preview.src = initialImageSrc;
    preview.classList.add('visible');
  }

  fileInput.addEventListener('change', () => {
    const [file] = fileInput.files || [];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCanvasFromImageSrc(String(reader.result || ''), true);
    };
    reader.readAsDataURL(file);
  });

  clearBtn.addEventListener('click', () => {
    fileInput.value = '';
    hidden.value = '';
    preview.removeAttribute('src');
    preview.classList.remove('visible');
    resetCanvasBlank();
    pushHistory(true, false);
  });

  saveEditBtn.addEventListener('click', () => {
    pushHistory(true, true);
  });

  undoBtn.addEventListener('click', () => {
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    restoreFromHistory(historyIndex, true);
  });

  if (initialImageSrc) {
    setCanvasFromImageSrc(initialImageSrc, false);
  } else {
    resetCanvasBlank();
    pushHistory(false, false);
  }

  controls.append(fileInput, toolSelect, colorPicker, textInput, textSize, saveEditBtn, undoBtn, clearBtn);
  panel.append(controls, canvasWrap, preview, hidden);
  sectionEl.appendChild(panel);
  return sectionEl;
}

function renderStepForm() {
  if (!hasSelectedStep()) {
    els.formContainer.innerHTML = '';
    return;
  }
  const step = state.program.steps[state.currentIndex];
  enforceBcRoleByStepNo(step, state.currentIndex + 1);
  els.formContainer.innerHTML = '';
  const activeMode = getActiveMode(step);
  if (!activeMode) {
    if (step.upload_image) {
      els.formContainer.appendChild(createCommonImageSection(step, state.currentIndex + 1));
    }
    return;
  }
  STEP_FIELDS.forEach((section) => {
    if (activeMode && section.title !== activeMode) return;
    const sectionEl = document.createElement('section');
    sectionEl.className = 'section';
    const title = document.createElement('h3');
    title.textContent = section.title;
    sectionEl.appendChild(title);

    const note = document.createElement('p');
    note.className = 'section note';
    note.textContent = section.note;
    sectionEl.appendChild(note);

    const checkboxFields = section.fields.filter((field) => field.type === 'checkbox');
    const otherFields = section.fields.filter((field) => field.type !== 'checkbox');

    if (checkboxFields.length > 0) {
      const checkboxRow = document.createElement('div');
      checkboxRow.className = 'checkbox-row-grid';
      checkboxFields.forEach((field) => {
        checkboxRow.appendChild(createField(field, step[field.key], state.currentIndex + 1));
      });
      sectionEl.appendChild(checkboxRow);
    }

    if (otherFields.length > 0) {
      const grid = document.createElement('div');
      grid.className = 'field-grid';
      otherFields.forEach((field) => {
        grid.appendChild(createField(field, step[field.key], state.currentIndex + 1));
      });
      sectionEl.appendChild(grid);
    }

    els.formContainer.appendChild(sectionEl);
  });
  els.formContainer.appendChild(createCommonImageSection(step, state.currentIndex + 1));
}

function renderEditor() {
  if (!hasSelectedStep()) {
    els.stepTitle.textContent = 'No step selected';
    els.modeSummary.textContent = '';
    els.stepSpinner.value = '';
    if (els.modeCardsWrap) {
      els.modeCardsWrap.style.display = 'none';
    }
    renderStepList();
    renderStepForm();
    updateProgramInfoFields();
    return;
  }

  const step = state.program.steps[state.currentIndex];
  els.stepTitle.textContent = `Step ${step.step_no}`;
  els.modeSummary.textContent = modeLabels(step);
  els.stepSpinner.value = step.step_no;
  if (els.modeCardsWrap) {
    els.modeCardsWrap.style.display = '';
  }
  renderModeCards(step);
  renderStepList();
  renderStepForm();
  updateProgramInfoFields();
}

function collectFormStep() {
  const step = deepClone(state.program.steps[state.currentIndex]);
  const inputs = els.formContainer.querySelectorAll('[data-key]');
  inputs.forEach((input) => {
    const key = input.dataset.key;
    step[key] = input.type === 'checkbox' ? input.checked : input.value;
  });
  applyExclusiveModeFromStep(step, 'enable_barcode');
  if (!step.enable_barcode) {
    applyExclusiveModeFromStep(step, 'request_ack');
    if (!step.request_ack) {
      applyExclusiveModeFromStep(step, 'enable_fastening');
    }
  }
  step.step_no = state.currentIndex + 1;
  enforceBcRoleByStepNo(step, step.step_no);
  return step;
}

function markDirty() {
  state.dirty = true;
  renderStepList();
}

function resetDirty() {
  state.dirty = false;
  renderStepList();
}

function ensureCanNavigate() {
  if (!state.dirty) return true;
  alert('Save the current step before moving to another step.');
  els.stepSpinner.value = state.currentIndex + 1;
  return false;
}

function selectStep(index) {
  if (index < 0 || index >= state.program.steps.length) return;
  if (index !== state.currentIndex && !ensureCanNavigate()) return;
  state.currentIndex = index;
  resetDirty();
  renderEditor();
}

async function saveStep() {
  syncProgramInfoToState();
  const payload = collectFormStep();
  state.program.steps[state.currentIndex] = payload;
  const response = await fetch(`/api/steps/${state.currentIndex}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.text();
    alert(`Save failed: ${err}`);
    return;
  }
  state.program = await response.json();
  syncProgramInfoToState();
  resetDirty();
  renderEditor();
}

async function saveProgram() {
  if (state.dirty) {
    await saveStep();
  }
  syncProgramInfoToState();
  const response = await fetch('/api/program', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.program),
  });
  if (!response.ok) {
    alert('Program save failed.');
    return;
  }
  state.program = await response.json();
  resetDirty();
  renderEditor();
  await refreshProgramSelect();
}

async function uploadProgram(file) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    alert(await response.text());
    return;
  }
  state.program = await response.json();
  state.currentIndex = 0;
  resetDirty();
  renderEditor();
  await refreshProgramSelect();
}

async function uploadRecipeZip(file) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch('/api/upload-zip', {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    alert(await response.text());
    return;
  }
  state.program = await response.json();
  state.currentIndex = 0;
  resetDirty();
  renderEditor();
  await refreshProgramSelect();
}

async function insertAfterCurrent() {
  if (state.dirty) {
    alert('Save the current step before inserting another step.');
    return;
  }
  const currentStep = state.program.steps[state.currentIndex];
  const response = await fetch(`/api/steps/${state.currentIndex}/insert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(blankStep()),
  });
  if (!response.ok) {
    alert('Insert failed.');
    return;
  }
  state.program = await response.json();
  state.currentIndex = Math.min(currentStep.step_no, state.program.steps.length - 1);
  resetDirty();
  renderEditor();
}

async function addStep() {
  if (state.dirty) {
    alert('Save the current step before adding a new one.');
    return;
  }
  const response = await fetch(`/api/steps/${state.program.steps.length - 1}/insert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(blankStep()),
  });
  if (!response.ok) {
    alert('Add step failed.');
    return;
  }
  state.program = await response.json();
  state.currentIndex = state.program.steps.length - 1;
  resetDirty();
  renderEditor();
}

async function cloneStep() {
  if (state.dirty) {
    alert('Save the current step before duplicating it.');
    return;
  }
  const response = await fetch(`/api/steps/${state.currentIndex}/clone`, { method: 'POST' });
  if (!response.ok) {
    alert('Duplicate failed.');
    return;
  }
  state.program = await response.json();
  state.currentIndex += 1;
  resetDirty();
  renderEditor();
}

async function deleteStep() {
  if (state.dirty) {
    alert('Save the current step before deleting or switching steps.');
    return;
  }
  if (!confirm(`Delete step ${state.currentIndex + 1}?`)) return;
  const response = await fetch(`/api/steps/${state.currentIndex}`, { method: 'DELETE' });
  if (!response.ok) {
    alert('Delete failed.');
    return;
  }
  state.program = await response.json();
  state.currentIndex = Math.min(state.currentIndex, state.program.steps.length - 1);
  resetDirty();
  renderEditor();
}

function applyProgramInfo() {
  syncProgramInfoToState();
  markDirty();
}

function syncProgramInfoToState() {
  state.program.partname = els.partname.value.trim();
  state.program.enable_mes = els.enableMes.checked;
  state.program.enable_ftp = els.enableFtp.checked;
}

function buildDownloadPayload() {
  const payload = deepClone(state.program);
  payload.partname = els.partname.value.trim();
  payload.enable_mes = els.enableMes.checked;
  payload.enable_ftp = els.enableFtp.checked;
  if (payload.steps[state.currentIndex]) {
    payload.steps[state.currentIndex] = collectFormStep();
  }
  return payload;
}

function bindEvents() {
  els.stepSpinner.addEventListener('change', () => {
    const nextIndex = Number(els.stepSpinner.value) - 1;
    if (nextIndex === state.currentIndex) return;
    if (!ensureCanNavigate()) return;
    selectStep(nextIndex);
  });

  els.saveStepBtn.addEventListener('click', saveStep);
  els.saveProgramBtn.addEventListener('click', saveProgram);
  els.previewStepsBtn.addEventListener('click', () => {
    window.open('/preview', '_blank', 'noopener,noreferrer');
  });
  els.applyProgramBtn.addEventListener('click', applyProgramInfo);
  els.programSelect.addEventListener('change', async () => {
    const selected = els.programSelect.value;
    if (!selected) return;
    if (state.dirty) {
      await saveStep();
      if (state.dirty) {
        renderProgramSelect();
        return;
      }
    }
    await loadProgramFromServer(selected);
  });
  els.downloadBtn.addEventListener('click', async (event) => {
    event.preventDefault();
    const payload = buildDownloadPayload();
    const blob = new Blob([JSON.stringify(payload, null, 4)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFilename(payload.partname)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  els.insertStepBtn.addEventListener('click', insertAfterCurrent);
  els.addStepBtn.addEventListener('click', addStep);
  els.cloneStepBtn.addEventListener('click', cloneStep);
  els.deleteStepBtn.addEventListener('click', deleteStep);

  els.modeCards.forEach((card) => {
    card.addEventListener('click', () => {
      setExclusiveMode(card.querySelector('h3').textContent);
    });
  });

  els.uploadFile.addEventListener('change', async () => {
    const file = els.uploadFile.files[0];
    if (!file) return;
    if (state.dirty) {
      alert('Save the current step before uploading new data.');
      els.uploadFile.value = '';
      return;
    }
    await uploadProgram(file);
    els.uploadFile.value = '';
  });

  els.uploadZipFile.addEventListener('change', async () => {
    const file = els.uploadZipFile.files[0];
    if (!file) return;
    if (state.dirty) {
      alert('Save the current step before uploading new data.');
      els.uploadZipFile.value = '';
      return;
    }
    await uploadRecipeZip(file);
    els.uploadZipFile.value = '';
  });

  els.partname.addEventListener('input', markDirty);
  els.enableMes.addEventListener('change', markDirty);
  els.enableFtp.addEventListener('change', markDirty);
}

function init() {
  state.program = isReloadNavigation() ? blankProgram() : deepClone(window.INITIAL_PROGRAM);
  state.currentIndex = 0;
  state.lastSavedSnapshot = deepClone(state.program);
  bindEvents();
  syncProgramInfoToState();
  updateProgramInfoFields();
  renderEditor();
  refreshProgramSelect();
}

init();
