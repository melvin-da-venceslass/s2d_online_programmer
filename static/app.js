
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
      { key: "enable_barcode_mes_t", label: "Enable Barcode MES (T)", type: "checkbox" },
      { key: "enable_barcode_mes_nt", label: "Enable Barcode MES (NT)", type: "checkbox" },
      { key: "restart_on_failure", label: "Restart On Failure", type: "checkbox" },
      { key: "reg_ex_validator", label: "Regex Validator", type: "text" },
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

const FULL_ROW_FIELD_KEYS = new Set(['remarks', 'screw_info', 'ack_title', 'bc_title', 'reg_ex_validator']);
const IMAGE_PRELOAD_CACHE = new Map();

const state = {
  program: window.INITIAL_PROGRAM,
  editorUnlocked: false,
  imagePanelCollapsed: false,
  partRecipeCollapsed: false,
  mapDeviceCollapsed: false,
  stepsCollapsed: false,
  currentIndex: 0,
  dirty: false,
  saving: false,
  lastSavedSnapshot: null,
  retainImageMode: '',
  lastSelectedImage: '',
  lastSavedImage: '',
  stepClipboard: null,
  serverPrograms: [],
  editorTree: null,
  storageConfig: {
    remote_storage_enabled: false,
    direct_upload_threshold_bytes: 20 * 1024 * 1024,
  },
};

const els = {
  sessionInfo: document.getElementById('session-info'),
  navAdmin: document.getElementById('nav-admin'),
  logoutBtn: document.getElementById('logout-btn'),
  partname: document.getElementById('partname'),
  enableMes: document.getElementById('enable_mes'),
  enableFtp: document.getElementById('enable_ftp'),
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
  editorWorkspace: document.getElementById('editor-workspace'),
  imageSidePanel: document.getElementById('image-side-panel'),
  imagePanelContent: document.getElementById('image-panel-content'),
  toggleImagePanelBtn: document.getElementById('toggle-image-panel-btn'),
  layout: document.querySelector('.layout'),
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
  recipeDescription: document.getElementById('recipe-description'),
  saveRecipeBtn: document.getElementById('save-recipe-btn'),
  newPartBtn: document.getElementById('new-part-btn'),
  recipeStatus: document.getElementById('recipe-status'),
  // Load Part pane
  loadOrgSelect: document.getElementById('load-org-select'),
  loadBranchSelect: document.getElementById('load-branch-select'),
  loadProjectSelect: document.getElementById('load-project-select'),
  loadLineSelect: document.getElementById('load-line-select'),
  loadStationSelect: document.getElementById('load-station-select'),
  loadRecipeSelect: document.getElementById('load-recipe-select'),
  loadPartBtn: document.getElementById('load-part-btn'),
  loadPartStatus: document.getElementById('load-part-status'),
  // Map to Device section
  mapOrgSelect: document.getElementById('map-org-select'),
  mapBranchSelect: document.getElementById('map-branch-select'),
  mapProjectSelect: document.getElementById('map-project-select'),
  mapLineSelect: document.getElementById('map-line-select'),
  mapStationSelect: document.getElementById('map-station-select'),
  mapDeviceSelect: document.getElementById('map-device-select'),
  mapDeviceBtn: document.getElementById('map-device-btn'),
  mapStatus: document.getElementById('map-status'),
  togglePartRecipeBtn: document.getElementById('toggle-part-recipe-btn'),
  partRecipeContent: document.getElementById('part-recipe-content'),
  toggleMapDeviceBtn: document.getElementById('toggle-map-device-btn'),
  mapDeviceContent: document.getElementById('map-device-content'),
  toggleStepsBtn: document.getElementById('toggle-steps-btn'),
  stepsContent: document.getElementById('steps-content'),
};

const uploadState = {
  xhr: null,
  active: false,
};

const userSession = {
  user: null,
};

function setRecipeStatus(message, type = '') {
  if (!els.recipeStatus) return;
  els.recipeStatus.textContent = message || '';
  els.recipeStatus.className = `recipe-status ${type}`.trim();
}

function setLoadPartStatus(message, type = '') {
  if (!els.loadPartStatus) return;
  els.loadPartStatus.textContent = message || '';
  els.loadPartStatus.className = `recipe-status ${type}`.trim();
}

function setMapStatus(message, type = '') {
  if (!els.mapStatus) return;
  els.mapStatus.textContent = message || '';
  els.mapStatus.className = `recipe-status ${type}`.trim();
}

function setSidebarSectionCollapsed(sectionKey, collapsed) {
  const isCollapsed = Boolean(collapsed);
  const sectionMap = {
    partRecipe: {
      toggleBtn: els.togglePartRecipeBtn,
      content: els.partRecipeContent,
      stateKey: 'partRecipeCollapsed',
    },
    mapDevice: {
      toggleBtn: els.toggleMapDeviceBtn,
      content: els.mapDeviceContent,
      stateKey: 'mapDeviceCollapsed',
    },
    steps: {
      toggleBtn: els.toggleStepsBtn,
      content: els.stepsContent,
      stateKey: 'stepsCollapsed',
    },
  };

  const section = sectionMap[sectionKey];
  if (!section) return;

  state[section.stateKey] = isCollapsed;
  if (section.content) {
    section.content.hidden = isCollapsed;
    section.content.setAttribute('aria-hidden', String(isCollapsed));
  }
  if (section.toggleBtn) {
    section.toggleBtn.textContent = isCollapsed ? 'Expand' : 'Collapse';
    section.toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
  }
}

function setEditorUnlocked(unlocked) {
  state.editorUnlocked = Boolean(unlocked);
  if (els.layout) {
    els.layout.classList.toggle('editor-locked', !state.editorUnlocked);
  }
  if (els.editorPane) {
    els.editorPane.hidden = !state.editorUnlocked;
    els.editorPane.setAttribute('aria-hidden', String(!state.editorUnlocked));
  }
}

function setImagePanelCollapsed(collapsed) {
  state.imagePanelCollapsed = Boolean(collapsed);
  if (els.editorWorkspace) {
    els.editorWorkspace.classList.toggle('image-panel-collapsed', state.imagePanelCollapsed);
  }
  if (els.imageSidePanel) {
    els.imageSidePanel.classList.toggle('is-collapsed', state.imagePanelCollapsed);
  }
  if (els.toggleImagePanelBtn) {
    els.toggleImagePanelBtn.textContent = state.imagePanelCollapsed ? 'Expand' : 'Collapse';
    els.toggleImagePanelBtn.setAttribute('aria-expanded', String(!state.imagePanelCollapsed));
  }
}

function setImagePanelVisible(visible) {
  const isVisible = Boolean(visible);
  if (els.editorWorkspace) {
    els.editorWorkspace.classList.toggle('no-image-panel', !isVisible);
  }
  if (els.imageSidePanel) {
    els.imageSidePanel.hidden = !isVisible;
    els.imageSidePanel.setAttribute('aria-hidden', String(!isVisible));
  }
  if (!isVisible) {
    setImagePanelCollapsed(false);
  }
}

function flattenEditorTree() {
  const tree = state.editorTree;
  const organizations = tree?.organizations || [];
  const branches = [], projects = [], lines = [], stations = [], devices = [];
  for (const org of organizations) {
    for (const branch of org.branches || []) {
      branches.push(branch);
      for (const project of branch.projects || []) {
        projects.push(project);
        for (const line of project.lines || []) {
          lines.push(line);
          for (const station of line.stations || []) {
            stations.push(station);
            for (const device of station.devices || []) {
              devices.push(device);
            }
          }
        }
      }
    }
  }
  return { organizations, branches, projects, lines, stations, devices };
}

async function loadEditorTree() {
  // Admin tree removed
}

function populateEditorOrgSelects() {
  const { organizations } = flattenEditorTree();
  const orgsHtml = '<option value="">-- Organization --</option>' +
    organizations.map(o => `<option value="${o.organization_id}">${o.name}</option>`).join('');
  if (els.loadOrgSelect) els.loadOrgSelect.innerHTML = orgsHtml;
  if (els.mapOrgSelect) els.mapOrgSelect.innerHTML = orgsHtml;
}

function attachEditorCascading(prefix) {
  const get = id => document.getElementById(`${prefix}${id}`);
  const orgSel     = get('org-select');
  const branchSel  = get('branch-select');
  const projectSel = get('project-select');
  const lineSel    = get('line-select');
  const stationSel = get('station-select');
  const labels = ['Branch', 'Project', 'Line', 'Station'];
  const reset = (...sels) => sels.forEach((s, i) => { if (s) s.innerHTML = `<option value="">-- ${labels[i]} --</option>`; });

  if (orgSel) {
    orgSel.addEventListener('change', () => {
      const { branches } = flattenEditorTree();
      const filtered = branches.filter(b => b.organization_id === orgSel.value);
      if (branchSel) branchSel.innerHTML = '<option value="">-- Branch --</option>' + filtered.map(b => `<option value="${b.branch_id}">${b.name}</option>`).join('');
      reset(projectSel, lineSel, stationSel);
      if (prefix === 'load-') refreshLoadRecipeSelect();
      if (prefix === 'map-') refreshMapDeviceSelect();
    });
  }
  if (branchSel) {
    branchSel.addEventListener('change', () => {
      const { projects } = flattenEditorTree();
      const filtered = projects.filter(p => p.branch_id === branchSel.value);
      if (projectSel) projectSel.innerHTML = '<option value="">-- Project --</option>' + filtered.map(p => `<option value="${p.project_id}">${p.name}</option>`).join('');
      reset(lineSel, stationSel);
      if (prefix === 'load-') refreshLoadRecipeSelect();
      if (prefix === 'map-') refreshMapDeviceSelect();
    });
  }
  if (projectSel) {
    projectSel.addEventListener('change', () => {
      const { lines } = flattenEditorTree();
      const filtered = lines.filter(l => l.project_id === projectSel.value);
      if (lineSel) lineSel.innerHTML = '<option value="">-- Line --</option>' + filtered.map(l => `<option value="${l.line_id}">${l.name}</option>`).join('');
      reset(stationSel);
      if (prefix === 'load-') refreshLoadRecipeSelect();
      if (prefix === 'map-') refreshMapDeviceSelect();
    });
  }
  if (lineSel) {
    lineSel.addEventListener('change', () => {
      const { stations } = flattenEditorTree();
      const filtered = stations.filter(s => s.line_id === lineSel.value);
      if (stationSel) stationSel.innerHTML = '<option value="">-- Station --</option>' + filtered.map(s => `<option value="${s.station_id}">${s.name}</option>`).join('');
      if (prefix === 'load-') refreshLoadRecipeSelect();
      if (prefix === 'map-') refreshMapDeviceSelect();
    });
  }
  if (stationSel) {
    stationSel.addEventListener('change', () => {
      if (prefix === 'load-') refreshLoadRecipeSelect();
      if (prefix === 'map-') refreshMapDeviceSelect();
    });
  }
}

function refreshLoadRecipeSelect() {
  if (!els.loadRecipeSelect) return;
  const orgId     = els.loadOrgSelect?.value || '';
  const branchId  = els.loadBranchSelect?.value || '';
  const projectId = els.loadProjectSelect?.value || '';
  const lineId    = els.loadLineSelect?.value || '';
  const stationId = els.loadStationSelect?.value || '';
  const recipes = (state.editorTree?.recipes || []).filter(r => {
    if (orgId && r.organization_id !== orgId) return false;
    if (branchId && r.branch_id && r.branch_id !== branchId) return false;
    if (projectId && r.project_id && r.project_id !== projectId) return false;
    if (lineId && r.line_id && r.line_id !== lineId) return false;
    if (stationId && r.station_id && r.station_id !== stationId) return false;
    return true;
  });
  els.loadRecipeSelect.innerHTML = '<option value="">-- Select Part --</option>' +
    recipes.map(r => `<option value="${r.recipe_id}" data-desc="${r.description || ''}">${r.name || 'Unnamed'}</option>`).join('');
}

function refreshMapDeviceSelect() {
  if (!els.mapDeviceSelect) return;
  const stationId = els.mapStationSelect?.value || '';
  if (!stationId) {
    els.mapDeviceSelect.innerHTML = '<option value="">-- select station first --</option>';
    return;
  }
  const { devices } = flattenEditorTree();
  const stationDevices = devices.filter(d => d.station_id === stationId);
  els.mapDeviceSelect.innerHTML = '<option value="">-- Device --</option>' +
    stationDevices.map(d => `<option value="${d.device_id}">${d.name} (${d.device_code})</option>`).join('');
}

async function loadPartFromRecipe() {
  const programFile = els.loadRecipeSelect?.value;
  if (!programFile) {
    setLoadPartStatus('Select a program first.', 'error');
    return;
  }
  if (state.dirty && !confirm('Unsaved changes will be lost. Continue?')) return;
  await loadProgramFromServer(programFile);
  setLoadPartStatus(`Loaded: ${programFile}`, 'ok');
}

async function mapRecipeToDevice() {
  // Admin feature removed
  setMapStatus('Device mapping is not available in this version.', 'error');
}

async function loadUserSession() {
  // Auth removed — no-op
}

async function refreshRecipeSelect() {
  // Replaced by hierarchy-filtered load; refresh the full tree
  await loadEditorTree();
}

async function upsertRecipeRecord() {
  // Replaced by saveProgram — no-op here
}

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

function resolveImageSource(value, partnameHint = '') {
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
    return `/programs/${sanitizeFilename(partnameHint || state.program.partname)}/imgs/${normalized}`;
  }

  return normalized;
}

function preloadImageSource(src) {
  const resolved = String(src || '').trim();
  if (!resolved || resolved.startsWith('data:image')) {
    return Promise.resolve();
  }
  if (IMAGE_PRELOAD_CACHE.has(resolved)) {
    return IMAGE_PRELOAD_CACHE.get(resolved);
  }

  const loadingPromise = new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = resolved;
  });

  IMAGE_PRELOAD_CACHE.set(resolved, loadingPromise);
  return loadingPromise;
}

function collectProgramImageSources(program) {
  const steps = Array.isArray(program?.steps) ? program.steps : [];
  const partName = program?.partname || '';
  const sources = [];
  const seen = new Set();

  steps.forEach((step) => {
    const resolved = resolveImageSource(step?.upload_image, step?.partname || partName);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    sources.push(resolved);
  });

  return sources;
}

async function preloadProgramImages(program, onProgress) {
  const sources = collectProgramImageSources(program);
  if (!sources.length) return;

  let completed = 0;
  for (const source of sources) {
    await preloadImageSource(source);
    completed += 1;
    if (onProgress) {
      onProgress(completed, sources.length);
    }
  }
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
  const sel = els.loadRecipeSelect;
  if (!sel) return;
  const selectedFile = expectedProgramFileName();
  sel.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '-- Select Program --';
  sel.appendChild(placeholder);

  state.serverPrograms.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name.replace(/\.json$/i, '');
    if (name === selectedFile) {
      option.selected = true;
    }
    sel.appendChild(option);
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
  try {
    const responseData = await requestJsonWithProgress(
      `/api/programs/${encodeURIComponent(programFile)}`,
      { method: 'POST' },
      'Loading program',
      `Loading ${programFile}...`,
      'Program loaded'
    );
    state.program = responseData && responseData.program ? responseData.program : responseData;
    state.currentIndex = 0;
    resetDirty();
    preloadProgramImages(state.program).catch(() => {
    });
    renderEditor();
    await refreshProgramSelect();
  } catch (error) {
    alert(String(error));
    await refreshProgramSelect();
  } finally {
    hideUploadOverlay();
  }
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
    enable_barcode_mes_t: false,
    enable_barcode_mes_nt: false,
    restart_on_failure: false,
    reg_ex_validator: '',
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
  if (FULL_ROW_FIELD_KEYS.has(field.key)) {
    wrapper.classList.add('full-row');
  }

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

  const TOOL_OPTIONS = [
    { value: 'rectangle', label: 'Rectangle' },
    { value: 'square', label: 'Square' },
    { value: 'circle', label: 'Circle' },
    { value: 'text', label: 'Text' },
    { value: 'pip', label: 'Picture-in-Picture' },
  ];
  const toolButtonsWrap = document.createElement('div');
  toolButtonsWrap.className = 'image-tool-buttons';
  const toolButtons = new Map();
  let selectedTool = 'rectangle';

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

  const pipFileInput = document.createElement('input');
  pipFileInput.type = 'file';
  pipFileInput.accept = 'image/*';
  pipFileInput.className = 'image-pip-file';
  pipFileInput.title = 'Choose PiP image';

  const pipCropZoom = document.createElement('input');
  pipCropZoom.type = 'range';
  pipCropZoom.min = '100';
  pipCropZoom.max = '400';
  pipCropZoom.step = '5';
  pipCropZoom.value = '100';
  pipCropZoom.className = 'image-pip-slider';
  pipCropZoom.title = 'PiP crop zoom';
  pipCropZoom.disabled = true;

  const pipCropX = document.createElement('input');
  pipCropX.type = 'range';
  pipCropX.min = '0';
  pipCropX.max = '100';
  pipCropX.step = '1';
  pipCropX.value = '50';
  pipCropX.className = 'image-pip-slider';
  pipCropX.title = 'PiP crop horizontal';
  pipCropX.disabled = true;

  const pipCropY = document.createElement('input');
  pipCropY.type = 'range';
  pipCropY.min = '0';
  pipCropY.max = '100';
  pipCropY.step = '1';
  pipCropY.value = '50';
  pipCropY.className = 'image-pip-slider';
  pipCropY.title = 'PiP crop vertical';
  pipCropY.disabled = true;

  const pipApplyBtn = document.createElement('button');
  pipApplyBtn.type = 'button';
  pipApplyBtn.className = 'primary';
  pipApplyBtn.textContent = 'Apply PiP';
  pipApplyBtn.disabled = true;

  const pipCancelBtn = document.createElement('button');
  pipCancelBtn.type = 'button';
  pipCancelBtn.className = 'secondary';
  pipCancelBtn.textContent = 'Cancel PiP';
  pipCancelBtn.disabled = true;

  const pipHelp = document.createElement('span');
  pipHelp.className = 'image-pip-help';
  pipHelp.textContent = 'PiP: choose image -> click canvas to place -> drag blue handle to resize -> adjust crop sliders -> Apply PiP.';

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'image-canvas-wrap';

  const canvas = document.createElement('canvas');
  canvas.className = 'image-canvas';
  canvas.width = CANVAS_MAX_WIDTH;
  canvas.height = CANVAS_MAX_HEIGHT;
  canvasWrap.appendChild(canvas);

  function updateCanvasCursor() {
    canvas.style.cursor = selectedTool === 'pip' ? 'move' : 'crosshair';
  }

  function setSelectedTool(nextTool) {
    if (!TOOL_OPTIONS.some((tool) => tool.value === nextTool)) return;
    if (selectedTool === 'pip' && nextTool !== 'pip' && pipEdit) {
      applyPendingPip();
    }
    selectedTool = nextTool;
    toolButtons.forEach((button, tool) => {
      const isActive = tool === selectedTool;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
    updateCanvasCursor();
  }

  TOOL_OPTIONS.forEach((tool) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'image-tool-btn';
    button.textContent = tool.label;
    button.addEventListener('click', () => {
      setSelectedTool(tool.value);
    });
    toolButtons.set(tool.value, button);
    toolButtonsWrap.appendChild(button);
  });

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
    return resolveImageSource(value, step.partname || state.program.partname);
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

  const PIP_HANDLE_SIZE = 14;
  let pipSourceImage = null;
  let pipEdit = null;
  let pipDragging = false;
  let pipDragMode = '';
  let pipDragOffsetX = 0;
  let pipDragOffsetY = 0;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function setPipControlsEnabled(enabled) {
    const active = Boolean(enabled);
    pipCropZoom.disabled = !active;
    pipCropX.disabled = !active;
    pipCropY.disabled = !active;
    pipApplyBtn.disabled = !active;
    pipCancelBtn.disabled = !active;
  }

  function drawPipIntoCanvas(targetCtx, overlay, drawFrame = false) {
    if (!pipSourceImage || !overlay) return;

    const zoom = Math.max(1, Number(overlay.cropZoom) || 1);
    const srcW = pipSourceImage.width;
    const srcH = pipSourceImage.height;
    const cropW = clamp(Math.round(srcW / zoom), 1, srcW);
    const cropH = clamp(Math.round(srcH / zoom), 1, srcH);
    const maxCropX = Math.max(0, srcW - cropW);
    const maxCropY = Math.max(0, srcH - cropH);
    const sx = Math.round(maxCropX * (clamp(Number(overlay.cropX), 0, 1)));
    const sy = Math.round(maxCropY * (clamp(Number(overlay.cropY), 0, 1)));

    targetCtx.drawImage(
      pipSourceImage,
      sx,
      sy,
      cropW,
      cropH,
      overlay.x,
      overlay.y,
      overlay.w,
      overlay.h
    );

    if (drawFrame) {
      targetCtx.save();
      targetCtx.strokeStyle = '#1a6bb5';
      targetCtx.lineWidth = 2;
      targetCtx.setLineDash([8, 5]);
      targetCtx.strokeRect(overlay.x, overlay.y, overlay.w, overlay.h);
      targetCtx.setLineDash([]);
      targetCtx.fillStyle = '#1a6bb5';
      targetCtx.fillRect(
        overlay.x + overlay.w - PIP_HANDLE_SIZE,
        overlay.y + overlay.h - PIP_HANDLE_SIZE,
        PIP_HANDLE_SIZE,
        PIP_HANDLE_SIZE
      );
      targetCtx.restore();
    }
  }

  function renderPipPreview() {
    if (!pipEdit) return;
    ctx.putImageData(pipEdit.baseImageData, 0, 0);
    drawPipIntoCanvas(ctx, pipEdit, true);
  }

  function beginPipEditAt(x, y) {
    if (!pipSourceImage) {
      alert('Choose PiP image first.');
      return;
    }

    const defaultWidth = clamp(Math.round(canvas.width * 0.34), 80, canvas.width);
    const aspect = pipSourceImage.height > 0 ? pipSourceImage.width / pipSourceImage.height : 1;
    const defaultHeight = clamp(Math.round(defaultWidth / Math.max(aspect, 0.01)), 60, canvas.height);
    const placedX = clamp(Math.round(x - defaultWidth / 2), 0, Math.max(0, canvas.width - defaultWidth));
    const placedY = clamp(Math.round(y - defaultHeight / 2), 0, Math.max(0, canvas.height - defaultHeight));

    pipEdit = {
      baseImageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
      x: placedX,
      y: placedY,
      w: defaultWidth,
      h: defaultHeight,
      cropZoom: Number(pipCropZoom.value) / 100,
      cropX: Number(pipCropX.value) / 100,
      cropY: Number(pipCropY.value) / 100,
    };
    setPipControlsEnabled(true);
    renderPipPreview();
  }

  function pipHitMode(x, y) {
    if (!pipEdit) return '';
    const handleX = pipEdit.x + pipEdit.w - PIP_HANDLE_SIZE;
    const handleY = pipEdit.y + pipEdit.h - PIP_HANDLE_SIZE;

    if (x >= handleX && y >= handleY && x <= handleX + PIP_HANDLE_SIZE && y <= handleY + PIP_HANDLE_SIZE) {
      return 'resize';
    }
    if (x >= pipEdit.x && y >= pipEdit.y && x <= pipEdit.x + pipEdit.w && y <= pipEdit.y + pipEdit.h) {
      return 'move';
    }
    return '';
  }

  function applyPendingPip() {
    if (!pipEdit) return;
    ctx.putImageData(pipEdit.baseImageData, 0, 0);
    drawPipIntoCanvas(ctx, pipEdit, false);
    pipEdit = null;
    pipDragging = false;
    pipDragMode = '';
    setPipControlsEnabled(false);
    pushHistory(true, true);
  }

  function cancelPendingPip() {
    if (!pipEdit) return;
    ctx.putImageData(pipEdit.baseImageData, 0, 0);
    pipEdit = null;
    pipDragging = false;
    pipDragMode = '';
    setPipControlsEnabled(false);
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

    if (selectedTool === 'rectangle') {
      ctx.strokeRect(x1, y1, w, h);
    } else if (selectedTool === 'square') {
      ctx.strokeRect(x1, y1, sx, sy);
    } else if (selectedTool === 'circle') {
      const r = Math.sqrt(w * w + h * h);
      ctx.beginPath();
      ctx.arc(x1, y1, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  canvas.addEventListener('mousedown', (event) => {
    const pt = canvasPoint(event);

    if (selectedTool === 'pip') {
      if (!pipSourceImage) {
        alert('Choose PiP image first.');
        return;
      }

      if (!pipEdit) {
        beginPipEditAt(pt.x, pt.y);
        return;
      }

      const hitMode = pipHitMode(pt.x, pt.y);
      if (!hitMode) {
        beginPipEditAt(pt.x, pt.y);
        return;
      }

      pipDragging = true;
      pipDragMode = hitMode;
      pipDragOffsetX = pt.x - pipEdit.x;
      pipDragOffsetY = pt.y - pipEdit.y;
      return;
    }

    if (selectedTool === 'text') {
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
    if (selectedTool === 'pip') {
      if (!pipDragging || !pipEdit) return;
      const pt = canvasPoint(event);
      if (pipDragMode === 'move') {
        pipEdit.x = clamp(Math.round(pt.x - pipDragOffsetX), 0, Math.max(0, canvas.width - pipEdit.w));
        pipEdit.y = clamp(Math.round(pt.y - pipDragOffsetY), 0, Math.max(0, canvas.height - pipEdit.h));
      } else if (pipDragMode === 'resize') {
        const newW = clamp(Math.round(pt.x - pipEdit.x), 24, canvas.width - pipEdit.x);
        const newH = clamp(Math.round(pt.y - pipEdit.y), 24, canvas.height - pipEdit.y);
        pipEdit.w = newW;
        pipEdit.h = newH;
      }
      renderPipPreview();
      return;
    }

    if (!drawing || !snapshot) return;
    const pt = canvasPoint(event);
    ctx.putImageData(snapshot, 0, 0);
    strokePreview(startX, startY, pt.x, pt.y);
  });

  canvas.addEventListener('mouseup', () => {
    if (selectedTool === 'pip') {
      pipDragging = false;
      pipDragMode = '';
      return;
    }

    if (!drawing) return;
    drawing = false;
    snapshot = null;
    pushHistory(true, true);
  });

  canvas.addEventListener('mouseleave', () => {
    if (selectedTool === 'pip') {
      pipDragging = false;
      pipDragMode = '';
      return;
    }

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
    pipSourceImage = null;
    pipFileInput.value = '';
    cancelPendingPip();
    resetCanvasBlank();
    pushHistory(true, false);
  });

  saveEditBtn.addEventListener('click', () => {
    if (pipEdit) {
      applyPendingPip();
      return;
    }
    pushHistory(true, true);
  });

  undoBtn.addEventListener('click', () => {
    if (pipEdit) {
      cancelPendingPip();
      return;
    }
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    restoreFromHistory(historyIndex, true);
  });

  rotateLeftBtn.addEventListener('click', () => {
    if (pipEdit) {
      applyPendingPip();
    }
    rotateCanvas(false);
  });

  rotateRightBtn.addEventListener('click', () => {
    if (pipEdit) {
      applyPendingPip();
    }
    rotateCanvas(true);
  });

  pipFileInput.addEventListener('change', () => {
    const [file] = pipFileInput.files || [];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const pipImg = new Image();
      pipImg.onload = () => {
        pipSourceImage = pipImg;
        setSelectedTool('pip');
      };
      pipImg.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });

  pipCropZoom.addEventListener('input', () => {
    if (!pipEdit) return;
    pipEdit.cropZoom = Number(pipCropZoom.value) / 100;
    renderPipPreview();
  });

  pipCropX.addEventListener('input', () => {
    if (!pipEdit) return;
    pipEdit.cropX = Number(pipCropX.value) / 100;
    renderPipPreview();
  });

  pipCropY.addEventListener('input', () => {
    if (!pipEdit) return;
    pipEdit.cropY = Number(pipCropY.value) / 100;
    renderPipPreview();
  });

  pipApplyBtn.addEventListener('click', () => {
    applyPendingPip();
  });

  pipCancelBtn.addEventListener('click', () => {
    cancelPendingPip();
  });

  if (initialImageSrc) {
    setCanvasFromImageSrc(initialImageSrc, false);
  } else {
    resetCanvasBlank();
    pushHistory(false, false);
  }

  setCanvasZoom(Number(zoomSlider.value));
  setSelectedTool(selectedTool);

  controls.append(
    fileInput,
    toolButtonsWrap,
    colorPicker,
    textInput,
    textSize,
    zoomWrap,
    pipFileInput,
    pipCropZoom,
    pipCropX,
    pipCropY,
    pipApplyBtn,
    pipCancelBtn,
    pipHelp,
    saveEditBtn,
    undoBtn,
    rotateLeftBtn,
    rotateRightBtn,
    clearBtn
  );
  panel.append(retainModeRow, canvasWrap, controls, hidden);
  sectionEl.appendChild(panel);
  return sectionEl;
}

function renderStepForm() {
  if (!hasSelectedStep()) {
    els.formContainer.innerHTML = '';
    if (els.imagePanelContent) els.imagePanelContent.innerHTML = '';
    setImagePanelVisible(false);
    return;
  }
  const step = state.program.steps[state.currentIndex];
  enforceBcRoleByStepNo(step, state.currentIndex + 1);
  els.formContainer.innerHTML = '';
  if (els.imagePanelContent) els.imagePanelContent.innerHTML = '';
  const activeMode = getActiveMode(step);
  const shouldShowImagePanel = Boolean(activeMode || step.upload_image || retainedImageForAutoload());
  if (!activeMode) {
    if (shouldShowImagePanel && els.imagePanelContent) {
      els.imagePanelContent.appendChild(createCommonImageSection(step, state.currentIndex + 1));
      setImagePanelVisible(true);
    } else {
      setImagePanelVisible(false);
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
  if (shouldShowImagePanel && els.imagePanelContent) {
    els.imagePanelContent.appendChild(createCommonImageSection(step, state.currentIndex + 1));
    setImagePanelVisible(true);
  } else {
    setImagePanelVisible(false);
  }
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

  // Collect fields from the form container (mode-specific fields)
  const inputs = els.formContainer.querySelectorAll('[data-key]');
  inputs.forEach((input) => {
    const key = input.dataset.key;
    step[key] = input.type === 'checkbox' ? input.checked : input.value;
  });

  // Also collect upload_image from the image side panel (it lives outside formContainer)
  if (els.imagePanelContent) {
    const imageInput = els.imagePanelContent.querySelector('[data-key="upload_image"]');
    if (imageInput) {
      step['upload_image'] = imageInput.value || '';
    }
  }

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

async function saveStep(showProgress = true) {
  const updateProgress = (percent, message) => {
    if (!showProgress) return;
    setUploadOverlayProgress(percent, message);
  };

  syncProgramInfoToState();
  const payload = collectFormStep();

  // Warn if no mode selected
  if (!payload.enable_barcode && !payload.request_ack && !payload.enable_fastening) {
    alert(`Step ${payload.step_no} has no mode selected. Please choose Barcode, Acknowledgement, or Fastening.`);
    return false;
  }

  if (showProgress) {
    showUploadOverlay('Saving step', 'Preparing step save...');
    updateProgress(12, 'Preparing step save...');
  }

  const savedImageCandidate = String(payload.upload_image || '').trim();

  updateProgress(55, 'Saving step to server...');
  state.program.steps[state.currentIndex] = payload;
  try {
    const response = await fetch(`/api/steps/${state.currentIndex}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }

    updateProgress(74, 'Loading latest data from server...');
    const latestResponse = await fetch('/api/program');
    if (!latestResponse.ok) {
      throw new Error(await latestResponse.text());
    }
    const latestProgram = await latestResponse.json();

    state.program = latestProgram && latestProgram.program ? latestProgram.program : latestProgram;
    if (savedImageCandidate) {
      state.lastSavedImage = savedImageCandidate;
    }

    updateProgress(90, 'Refreshing screen...');
    syncProgramInfoToState();
    resetDirty();
    renderEditor();

    // Keep loader visible until browser paints the refreshed server data.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    updateProgress(100, 'Step saved');
    return true;
  } catch (error) {
    alert(`Save failed: ${error}`);
    return false;
  } finally {
    if (showProgress) {
      hideUploadOverlay();
    }
  }
}

async function saveProgram() {
  // Warn if any step has no mode
  const noModeSteps = state.program.steps
    .filter(s => !s.enable_barcode && !s.request_ack && !s.enable_fastening)
    .map(s => s.step_no);
  if (noModeSteps.length > 0) {
    if (!confirm(`Step(s) ${noModeSteps.join(', ')} have no mode selected (Barcode / Acknowledgement / Fastening). Save anyway?`)) return;
  }
  if (state.dirty) {
    const saved = await saveStep(false);
    if (!saved) {
      return;
    }
  }
  syncProgramInfoToState();
  try {
    const responseData = await requestJsonWithProgress(
      '/api/program',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.program),
      },
      'Saving program',
      'Saving program...',
      'Program saved'
    );
    state.program = responseData && responseData.program ? responseData.program : responseData;
    if (state.program && state.program.program) {
      state.program = state.program.program;
    }
    setRecipeStatus(`Program '${state.program.partname || ''}' saved.`, 'ok');
    resetDirty();
    renderEditor();
    await loadEditorTree();
  } catch (error) {
    alert(`Program save failed: ${error}`);
    setRecipeStatus(`Program save failed: ${error}`, 'error');
    return;
  } finally {
    hideUploadOverlay();
  }
}

async function loadStorageConfig() {
  state.storageConfig = {
    remote_storage_enabled: false,
    direct_upload_threshold_bytes: 20 * 1024 * 1024,
  };
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

function dataUrlToBlob(dataUrl) {
  const raw = String(dataUrl || '');
  const parts = raw.split(',');
  if (parts.length !== 2 || !parts[0].startsWith('data:')) {
    throw new Error('Invalid image payload');
  }

  const match = parts[0].match(/^data:([^;]+);base64$/i);
  const mimeType = match ? match[1] : 'image/png';
  const binary = atob(parts[1]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
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

async function requestJsonWithProgress(url, options, title, startMessage, endMessage) {
  showUploadOverlay(title, startMessage);
  setUploadOverlayProgress(10, startMessage);

  const timer = window.setInterval(() => {
    if (!els.uploadProgressBar) return;
    const current = Number.parseFloat(els.uploadProgressBar.style.width || '0') || 0;
    if (current < 90) {
      setUploadOverlayProgress(Math.min(90, current + 7), startMessage);
    }
  }, 160);

  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(await response.text());
    }
    setUploadOverlayProgress(96, endMessage || 'Finalizing...');
    const payload = await response.json();
    setUploadOverlayProgress(100, endMessage || 'Done');
    return payload;
  } finally {
    window.clearInterval(timer);
  }
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
          setUploadOverlayPath(`Storage path: ${payload.storage_path}`);
        }
        setUploadOverlayProgress(100, `Finalizing ${fileLabel}...`);
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
    const endpoint = '/api/upload';
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
  preloadProgramImages(state.program).catch(() => {
  });
  setEditorUnlocked(true);
  renderEditor();
  await refreshProgramSelect();
}

async function uploadRecipeZip(file) {
  try {
    const endpoint = '/api/upload-zip';
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
  preloadProgramImages(state.program).catch(() => {
  });
  setEditorUnlocked(true);
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
  if (els.previewStepsBtn) {
    els.previewStepsBtn.addEventListener('click', () => {
      window.open('/preview', '_blank', 'noopener,noreferrer');
    });
  }
  if (els.downloadBtn) {
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
  }
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

  if (els.logoutBtn) {
    els.logoutBtn.addEventListener('click', logoutAndRedirect);
  }

  if (els.saveRecipeBtn) {
    els.saveRecipeBtn.addEventListener('click', saveProgram);
  }

  if (els.newPartBtn) {
    els.newPartBtn.addEventListener('click', () => {
      if (state.dirty && !confirm('Unsaved changes will be lost. Continue?')) return;
      state.program = blankProgram();
      state.currentIndex = 0;
      resetDirty();
      if (els.partname) els.partname.value = '';
      if (els.recipeDescription) els.recipeDescription.value = '';
      if (els.enableMes) els.enableMes.checked = false;
      if (els.enableFtp) els.enableFtp.checked = false;
      setRecipeStatus('', '');
      setEditorUnlocked(true);
      renderEditor();
    });
  }

  if (els.loadPartBtn) {
    els.loadPartBtn.addEventListener('click', loadPartFromRecipe);
  }

  if (els.mapDeviceBtn) {
    els.mapDeviceBtn.addEventListener('click', mapRecipeToDevice);
  }

  if (els.toggleImagePanelBtn) {
    els.toggleImagePanelBtn.addEventListener('click', () => {
      if (els.imageSidePanel?.hidden) return;
      setImagePanelCollapsed(!state.imagePanelCollapsed);
    });
  }

  if (els.togglePartRecipeBtn) {
    els.togglePartRecipeBtn.addEventListener('click', () => {
      setSidebarSectionCollapsed('partRecipe', !state.partRecipeCollapsed);
    });
  }

  if (els.toggleMapDeviceBtn) {
    els.toggleMapDeviceBtn.addEventListener('click', () => {
      setSidebarSectionCollapsed('mapDevice', !state.mapDeviceCollapsed);
    });
  }

  if (els.toggleStepsBtn) {
    els.toggleStepsBtn.addEventListener('click', () => {
      setSidebarSectionCollapsed('steps', !state.stepsCollapsed);
    });
  }

  // Part / Recipe tab switching
  document.querySelectorAll('.part-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.ptab;
      document.querySelectorAll('.part-tab-btn').forEach(b => b.classList.toggle('is-active', b === btn));
      document.querySelectorAll('.part-tab-pane').forEach(p => p.classList.toggle('is-active', p.id === `${target}-pane`));
    });
  });
}

async function init() {
  // Always start with a blank program on fresh load
  state.program = blankProgram();
  const hasProgram = true;
  setEditorUnlocked(hasProgram);
  setSidebarSectionCollapsed('partRecipe', false);
  setSidebarSectionCollapsed('steps', false);
  state.currentIndex = 0;
  state.lastSavedSnapshot = deepClone(state.program);
  bindEvents();
  syncProgramInfoToState();
  updateProgramInfoFields();
  await refreshProgramSelect();
  preloadProgramImages(state.program).catch(() => {
  });
  renderEditor();
  loadStorageConfig();

  // Hide app loader after minimum 1 second
  const loader = document.getElementById('app-loader');
  if (loader) {
    setTimeout(() => {
      loader.style.opacity = '0';
      setTimeout(() => loader.remove(), 400);
    }, 1000);
  }
}

init();
