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
  retainImageMode: '',
  lastSelectedImage: '',
  lastSavedImage: '',
  stepClipboard: null,
  serverPrograms: [],
  storageConfig: {
    gcs_enabled: false,
    direct_upload_threshold_bytes: 20 * 1024 * 1024,
  },
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
  downloadPdfBtn: document.getElementById('download-pdf-btn'),
  downloadWiBtn: document.getElementById('download-wi-btn'),
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
  editorPane: document.querySelector('.editor'),
  modeCardsWrap: document.querySelector('.mode-cards'),
  modeCards: Array.from(document.querySelectorAll('.mode-card')),
  uploadOverlay: document.getElementById('upload-overlay'),
  uploadOverlayTitle: document.getElementById('upload-overlay-title'),
  uploadOverlayMessage: document.getElementById('upload-overlay-message'),
  uploadProgressBar: document.getElementById('upload-progress-bar'),
  uploadProgressText: document.getElementById('upload-progress-text'),
  uploadOverlayPath: document.getElementById('upload-overlay-path'),
  uploadCancelBtn: document.getElementById('upload-cancel-btn'),
};

const uploadState = {
  xhr: null,
  active: false,
};

function applyEditorModeTheme(step) {
  if (!els.editorPane) return;
  els.editorPane.classList.remove('mode-barcode', 'mode-ack', 'mode-fastening', 'mode-none');

  const activeMode = step ? getActiveMode(step) : null;
  if (activeMode === 'Barcode') {
    els.editorPane.classList.add('mode-barcode');
  } else if (activeMode === 'Acknowledgement') {
    els.editorPane.classList.add('mode-ack');
  } else if (activeMode === 'Fastening') {
    els.editorPane.classList.add('mode-fastening');
  } else {
    els.editorPane.classList.add('mode-none');
  }
}

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

function retainedImageForAutoload() {
  if (state.retainImageMode === 'selected' && state.lastSelectedImage) {
    return state.lastSelectedImage;
  }
  if (state.retainImageMode === 'saved' && state.lastSavedImage) {
    return state.lastSavedImage;
  }
  return '';
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

function normalizeStepForIndex(step, index) {
  const normalized = deepClone(step);
  applyExclusiveModeFromStep(normalized, 'enable_barcode');
  if (!normalized.enable_barcode) {
    applyExclusiveModeFromStep(normalized, 'request_ack');
    if (!normalized.request_ack) {
      applyExclusiveModeFromStep(normalized, 'enable_fastening');
    }
  }
  normalized.step_no = index + 1;
  enforceBcRoleByStepNo(normalized, normalized.step_no);
  return normalized;
}

function snapshotStepForClipboard(index) {
  if (index === state.currentIndex && state.dirty) {
    return removeStepImageData(collectFormStep());
  }
  return removeStepImageData(deepClone(state.program.steps[index]));
}

function removeStepImageData(step) {
  const sanitized = deepClone(step);
  // Keep copy/paste focused on parameters only and never carry image payloads.
  sanitized.upload_image = '';
  return sanitized;
}

function copyStepParameters(index) {
  if (index < 0 || index >= state.program.steps.length) return;
  state.stepClipboard = {
    sourceIndex: index,
    step: snapshotStepForClipboard(index),
  };
  renderStepList();
}

function pasteStepParameters(index) {
  if (!state.stepClipboard || !state.stepClipboard.step) {
    alert('Copy a step first.');
    return;
  }
  if (index < 0 || index >= state.program.steps.length) return;

  if (state.dirty && state.currentIndex !== index) {
    state.program.steps[state.currentIndex] = collectFormStep();
  }

  const targetStep =
    index === state.currentIndex && state.dirty
      ? collectFormStep()
      : deepClone(state.program.steps[index]);

  const pastedStep = normalizeStepForIndex(state.stepClipboard.step, index);
  pastedStep.upload_image = String(targetStep.upload_image || '').trim();

  state.program.steps[index] = pastedStep;
  state.currentIndex = index;
  state.dirty = true;
  renderEditor();
}

function renderStepList() {
  els.stepList.innerHTML = '';
  let previousMode = '';
  let modeRunCount = 0;

  state.program.steps.forEach((step, index) => {
    const li = document.createElement('li');
    li.dataset.index = index;
    const activeMode = getActiveMode(step);
    let modeText = modeLabels(step);
    if (activeMode) {
      if (activeMode === previousMode) {
        modeRunCount += 1;
      } else {
        previousMode = activeMode;
        modeRunCount = 1;
      }
      modeText = `${activeMode} (${modeRunCount})`;
    } else {
      previousMode = '';
      modeRunCount = 0;
    }

    const summary = document.createElement('div');
    summary.className = 'step-list-summary';
    const stepName = document.createElement('span');
    stepName.textContent = `Step ${step.step_no}`;
    const stepMode = document.createElement('span');
    stepMode.textContent = modeText;
    summary.append(stepName, stepMode);

    const actions = document.createElement('div');
    actions.className = 'step-list-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'secondary';
    copyBtn.textContent = 'Copy';
    copyBtn.title = 'Copy all parameters from this step';
    copyBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      copyStepParameters(index);
    });

    const pasteBtn = document.createElement('button');
    pasteBtn.type = 'button';
    pasteBtn.className = 'secondary';
    pasteBtn.textContent = 'Paste';
    pasteBtn.title = 'Paste copied parameters to this step';
    pasteBtn.disabled = !state.stepClipboard;
    pasteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      pasteStepParameters(index);
    });

    actions.append(copyBtn, pasteBtn);
    li.append(summary, actions);
    if (index === state.currentIndex) li.classList.add('active');
    if (state.dirty && index === state.currentIndex) li.classList.add('unsaved');
    if (state.stepClipboard && state.stepClipboard.sourceIndex === index) li.classList.add('copied');
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
  const DEFAULT_CANVAS_DISPLAY_SCALE = 1.5;
  const viewportSafeWidth = Math.max(320, Math.floor(window.innerWidth * 0.58));
  const viewportSafeHeight = Math.max(220, Math.floor(window.innerHeight * 0.5));
  const CANVAS_MAX_WIDTH = Math.max(240, Math.floor(Math.min(864, viewportSafeWidth)));
  const CANVAS_MAX_HEIGHT = Math.max(160, Math.floor(Math.min(486, viewportSafeHeight)));

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

  const originalStepImage = String(step.upload_image || '').trim();

  if (hidden.value && !state.lastSelectedImage) {
    state.lastSelectedImage = hidden.value;
  }
  if (hidden.value && !state.lastSavedImage) {
    state.lastSavedImage = hidden.value;
  }

  const retainModeRow = document.createElement('div');
  retainModeRow.className = 'retain-mode-row';

  const retainOriginalLabel = document.createElement('label');
  retainOriginalLabel.className = 'checkbox-row';
  const retainOriginalInput = document.createElement('input');
  retainOriginalInput.type = 'checkbox';
  retainOriginalInput.checked = state.retainImageMode === 'selected';
  const retainOriginalText = document.createElement('span');
  retainOriginalText.textContent = 'Retain original image';
  retainOriginalLabel.append(retainOriginalInput, retainOriginalText);

  const retainSavedLabel = document.createElement('label');
  retainSavedLabel.className = 'checkbox-row';
  const retainSavedInput = document.createElement('input');
  retainSavedInput.type = 'checkbox';
  retainSavedInput.checked = state.retainImageMode === 'saved';
  const retainSavedText = document.createElement('span');
  retainSavedText.textContent = 'Retain last edited image';
  retainSavedLabel.append(retainSavedInput, retainSavedText);

  function setRetainMode(mode) {
    state.retainImageMode = mode || '';
    const currentImage = String(hidden.value || '').trim();
    if (mode === 'selected' && currentImage) {
      state.lastSelectedImage = currentImage;
    }
    if (mode === 'saved' && currentImage) {
      state.lastSavedImage = currentImage;
    }
    if (!mode && originalStepImage) {
      hidden.value = originalStepImage;
      const storedImageSrc = resolveStoredImageSrc(originalStepImage);
      if (storedImageSrc) {
        setCanvasFromImageSrc(storedImageSrc, false);
      }
    }
    retainOriginalInput.checked = mode === 'selected';
    retainSavedInput.checked = mode === 'saved';
  }

  retainOriginalInput.addEventListener('change', () => {
    if (retainOriginalInput.checked) {
      setRetainMode('selected');
      return;
    }
    setRetainMode('');
  });

  retainSavedInput.addEventListener('change', () => {
    if (retainSavedInput.checked) {
      setRetainMode('saved');
      return;
    }
    setRetainMode('');
  });

  retainModeRow.append(retainOriginalLabel, retainSavedLabel);

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
  textSize.value = '18';
  textSize.className = 'image-size-input';

  const zoomWrap = document.createElement('label');
  zoomWrap.className = 'image-zoom-wrap';
  zoomWrap.textContent = 'Zoom';

  const zoomSlider = document.createElement('input');
  zoomSlider.type = 'range';
  zoomSlider.min = '10';
  zoomSlider.max = '200';
  zoomSlider.step = '5';
  zoomSlider.value = String(Math.round(DEFAULT_CANVAS_DISPLAY_SCALE * 100));
  zoomSlider.className = 'image-zoom-slider';

  const zoomValue = document.createElement('span');
  zoomValue.className = 'image-zoom-value';
  zoomValue.textContent = `${zoomSlider.value}%`;

  zoomWrap.append(zoomSlider, zoomValue);

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

  const rotateLeftBtn = document.createElement('button');
  rotateLeftBtn.type = 'button';
  rotateLeftBtn.className = 'secondary';
  rotateLeftBtn.textContent = 'Rotate Left';

  const rotateRightBtn = document.createElement('button');
  rotateRightBtn.type = 'button';
  rotateRightBtn.className = 'secondary';
  rotateRightBtn.textContent = 'Rotate Right';

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'image-canvas-wrap';

  const canvas = document.createElement('canvas');
  canvas.className = 'image-canvas';
  canvas.width = CANVAS_MAX_WIDTH;
  canvas.height = CANVAS_MAX_HEIGHT;
  canvasWrap.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  const MAX_HISTORY = 30;
  let history = [];
  let historyIndex = -1;
  let canvasDisplayScale = DEFAULT_CANVAS_DISPLAY_SCALE;

  function setCanvasZoom(zoomPercent) {
    const normalized = Number.isFinite(zoomPercent) ? zoomPercent : 100;
    const clamped = Math.min(200, Math.max(10, normalized));
    canvasDisplayScale = clamped / 100;
    zoomSlider.value = String(Math.round(clamped));
    zoomValue.textContent = `${Math.round(clamped)}%`;
    updateCanvasDisplaySize();
  }

  function updateCanvasDisplaySize() {
    const displayWidth = Math.max(140, Math.round(canvas.width * canvasDisplayScale));
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = 'auto';
  }

  zoomSlider.addEventListener('input', () => {
    setCanvasZoom(Number(zoomSlider.value));
  });

  function resolveStoredImageSrc(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.startsWith('data:image')) return raw;

    const normalized = raw.replace(/\\/g, '/');
    const cacheBuster = '?t=' + Date.now();
    
    if (normalized.startsWith('/programs/')) {
      const sep = normalized.includes('?') ? '&' : '?';
      return normalized + sep + 't=' + Date.now();
    }
    if (normalized.startsWith('programs/')) return `/${normalized}${cacheBuster}`;

    if (/^https?:\/\//i.test(normalized)) {
      try {
        const parsed = new URL(normalized);
        if (parsed.pathname.startsWith('/programs/')) {
          const sep = parsed.search ? '&' : '?';
          return `${parsed.pathname}${parsed.search || ''}${sep}t=${Date.now()}`;
        }
      } catch (_error) {
      }
      return normalized;
    }

    if (/^[^/]+\/[^/]+$/i.test(normalized)) {
      return `/programs/${normalized}${cacheBuster}`;
    }

    if (/^[^/]+\.(jpg|jpeg|png|gif|webp)$/i.test(normalized)) {
      return `/programs/${sanitizeFilename(step.partname || state.program.partname)}/imgs/${normalized}${cacheBuster}`;
    }

    return normalized;
  }

  function updateUndoButton() {
    undoBtn.disabled = historyIndex <= 0;
  }

  function pushHistory(markAsEdited = true, updateHidden = true) {
    const snapshotData = canvas.toDataURL('image/png');
    if (historyIndex >= 0 && history[historyIndex] === snapshotData) {
      if (updateHidden) {
        hidden.value = snapshotData;
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
      state.lastSavedImage = snapshotData;
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
      updateCanvasDisplaySize();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      hidden.value = dataUrl;
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
      const maxWidth = CANVAS_MAX_WIDTH;
      const maxHeight = CANVAS_MAX_HEIGHT;
      const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      canvas.width = maxWidth;
      canvas.height = maxHeight;
      updateCanvasDisplaySize();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const x = Math.round((canvas.width - w) / 2);
      const y = Math.round((canvas.height - h) / 2);
      ctx.drawImage(img, x, y, w, h);
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
    canvas.width = CANVAS_MAX_WIDTH;
    canvas.height = CANVAS_MAX_HEIGHT;
    updateCanvasDisplaySize();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#8c97ad';
    ctx.font = '22px sans-serif';
    ctx.fillText('Upload image and edit here', 24, 44);
  }

  function rotateCanvas(clockwise = true) {
    const sourceWidth = canvas.width;
    const sourceHeight = canvas.height;
    if (sourceWidth <= 0 || sourceHeight <= 0) return;

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = sourceWidth;
    sourceCanvas.height = sourceHeight;
    const sourceCtx = sourceCanvas.getContext('2d');
    sourceCtx.drawImage(canvas, 0, 0);

    canvas.width = sourceHeight;
    canvas.height = sourceWidth;
    updateCanvasDisplaySize();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    if (clockwise) {
      ctx.translate(canvas.width, 0);
      ctx.rotate(Math.PI / 2);
    } else {
      ctx.translate(0, canvas.height);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.drawImage(sourceCanvas, 0, 0);
    ctx.restore();

    drawing = false;
    snapshot = null;
    pushHistory(true, true);
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
      ctx.font = `${Math.max(10, Number(textSize.value) || 18)}px sans-serif`;
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

  const retainedImage = retainedImageForAutoload();
  if (retainedImage) {
    hidden.value = retainedImage;
  }
  const initialImageSrc = resolveStoredImageSrc(hidden.value);

  fileInput.addEventListener('change', () => {
    const [file] = fileInput.files || [];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const selectedImage = String(reader.result || '');
      state.lastSelectedImage = selectedImage;
      state.lastSavedImage = selectedImage;
      setCanvasFromImageSrc(selectedImage, true);
    };
    reader.readAsDataURL(file);
  });

  clearBtn.addEventListener('click', () => {
    fileInput.value = '';
    hidden.value = '';
    if (state.retainImageMode === 'selected') {
      state.lastSelectedImage = '';
    }
    if (state.retainImageMode === 'saved') {
      state.lastSavedImage = '';
    }
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

  rotateLeftBtn.addEventListener('click', () => {
    rotateCanvas(false);
  });

  rotateRightBtn.addEventListener('click', () => {
    rotateCanvas(true);
  });

  if (initialImageSrc) {
    setCanvasFromImageSrc(initialImageSrc, false);
  } else {
    resetCanvasBlank();
    pushHistory(false, false);
  }

  setCanvasZoom(Number(zoomSlider.value));

  controls.append(fileInput, toolSelect, colorPicker, textInput, textSize, zoomWrap, saveEditBtn, undoBtn, rotateLeftBtn, rotateRightBtn, clearBtn);
  panel.append(retainModeRow, controls, canvasWrap, hidden);
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
    if (step.upload_image || retainedImageForAutoload()) {
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
      grid.className = section.title === 'Fastening' ? 'field-grid field-grid-fastening' : 'field-grid';
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
    applyEditorModeTheme(null);
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
  applyEditorModeTheme(step);
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
  const savedImageCandidate = String(payload.upload_image || '').trim();
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
  if (savedImageCandidate) {
    state.lastSavedImage = savedImageCandidate;
  }
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

async function loadStorageConfig() {
  try {
    const response = await fetch('/api/storage-config');
    if (!response.ok) {
      return;
    }
    const payload = await response.json();
    state.storageConfig = {
      gcs_enabled: Boolean(payload.gcs_enabled),
      direct_upload_threshold_bytes: Number(payload.direct_upload_threshold_bytes) || 20 * 1024 * 1024,
    };
  } catch (_) {
    // Keep local upload flow as fallback when config endpoint is unavailable.
  }
}

function setUploadOverlayProgress(percent, message) {
  if (!els.uploadOverlay) return;
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  if (els.uploadProgressBar) {
    els.uploadProgressBar.style.width = `${clamped}%`;
  }
  if (els.uploadProgressText) {
    els.uploadProgressText.textContent = `${Math.round(clamped)}%`;
  }
  if (els.uploadOverlayMessage && message) {
    els.uploadOverlayMessage.textContent = message;
  }
  const track = els.uploadOverlay.querySelector('.upload-progress-track');
  if (track) {
    track.setAttribute('aria-valuenow', String(Math.round(clamped)));
  }
}

function setUploadOverlayPath(pathText) {
  if (!els.uploadOverlayPath) return;
  els.uploadOverlayPath.textContent = pathText || '';
}

function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function showUploadOverlay(title, message) {
  if (!els.uploadOverlay) return;
  if (els.uploadOverlayTitle) {
    els.uploadOverlayTitle.textContent = title || 'Uploading';
  }
  setUploadOverlayProgress(0, message || 'Preparing upload...');
  setUploadOverlayPath('');
  els.uploadOverlay.hidden = false;
  document.body.classList.add('uploading');
  uploadState.active = true;
}

function hideUploadOverlay() {
  if (!els.uploadOverlay) return;
  els.uploadOverlay.hidden = true;
  document.body.classList.remove('uploading');
  setUploadOverlayProgress(0, 'Preparing upload...');
  setUploadOverlayPath('');
  if (els.uploadOverlayTitle) {
    els.uploadOverlayTitle.textContent = 'Uploading';
  }
  uploadState.active = false;
  uploadState.xhr = null;
}

function cancelCurrentUpload() {
  if (uploadState.xhr) {
    uploadState.xhr.abort();
  }
}

function uploadFileWithProgress(endpoint, file, title) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);

    const fileLabel = `${file.name} • ${formatFileSize(file.size)}`;

    const xhr = new XMLHttpRequest();
  uploadState.xhr = xhr;
    xhr.open('POST', endpoint);
    xhr.responseType = 'text';

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) {
        setUploadOverlayProgress(65, `Uploading ${fileLabel}...`);
        return;
      }
      const percent = Math.min(98, (event.loaded / event.total) * 100);
      setUploadOverlayProgress(percent, `Uploading ${fileLabel}...`);
    });

    xhr.addEventListener('load', () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(xhr.responseText || `Upload failed (${xhr.status})`));
        return;
      }
      setUploadOverlayProgress(100, `Processing ${fileLabel}...`);
      try {
        const payload = xhr.responseText ? JSON.parse(xhr.responseText) : {};
        const uploadedProgram = payload && typeof payload === 'object' && payload.program ? payload.program : payload;
        if (payload && typeof payload === 'object' && payload.storage_path) {
          setUploadOverlayPath(`Bucket path: ${payload.storage_path}`);
        }
        setUploadOverlayProgress(100, `Finalizing ${fileLabel} in the bucket...`);
        resolve(uploadedProgram);
      } catch (error) {
        reject(error);
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error during upload.')));
    xhr.addEventListener('abort', () => reject(new Error('Upload canceled.')));

    showUploadOverlay(title || 'Uploading', `Preparing ${fileLabel}...`);
    xhr.send(formData);
  });
}

async function uploadProgram(file) {
  try {
    const endpoint = state.storageConfig.gcs_enabled ? '/api/upload-to-gcs' : '/api/upload';
    state.program = await uploadFileWithProgress(endpoint, file, 'Uploading program');
  } catch (error) {
    if (String(error).includes('canceled')) {
      return;
    }
    alert(String(error));
    return;
  } finally {
    hideUploadOverlay();
  }

  state.currentIndex = 0;
  resetDirty();
  renderEditor();
  await refreshProgramSelect();
}

async function uploadRecipeZip(file) {
  try {
    const endpoint = state.storageConfig.gcs_enabled ? '/api/upload-to-gcs' : '/api/upload-zip';
    state.program = await uploadFileWithProgress(endpoint, file, 'Uploading recipe');
  } catch (error) {
    if (String(error).includes('canceled')) {
      return;
    }
    alert(String(error));
    return;
  } finally {
    hideUploadOverlay();
  }

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
  els.downloadPdfBtn.addEventListener('click', async () => {
    const payload = buildDownloadPayload();
    const response = await fetch('/download-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      alert('PDF export failed.');
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFilename(payload.partname)}_steps.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  els.downloadWiBtn.addEventListener('click', async () => {
    const payload = buildDownloadPayload();
    const response = await fetch('/download-wi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      alert('WI PDF export failed.');
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFilename(payload.partname)}_wi.pdf`;
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

  if (els.uploadCancelBtn) {
    els.uploadCancelBtn.addEventListener('click', cancelCurrentUpload);
  }

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
  loadStorageConfig();
  refreshProgramSelect();
}

init();
