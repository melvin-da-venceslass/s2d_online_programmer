const AUTH_TOKEN_KEY = 'admin_token';

const state = {
  program: null,
  index: 0,
  editorTree: null,
};

const els = {
  partname: document.getElementById('preview-partname'),
  count: document.getElementById('preview-count'),
  stepTitle: document.getElementById('preview-step-title'),
  mode: document.getElementById('preview-mode'),
  fields: document.getElementById('preview-fields'),
  imageWrap: document.getElementById('preview-image-wrap'),
  image: document.getElementById('preview-image'),
  spinner: document.getElementById('preview-step-spinner'),
  prevBtn: document.getElementById('prev-step-btn'),
  nextBtn: document.getElementById('next-step-btn'),
  refreshBtn: document.getElementById('refresh-preview-btn'),
  loadOrgSelect: document.getElementById('preview-load-org-select'),
  loadBranchSelect: document.getElementById('preview-load-branch-select'),
  loadProjectSelect: document.getElementById('preview-load-project-select'),
  loadLineSelect: document.getElementById('preview-load-line-select'),
  loadStationSelect: document.getElementById('preview-load-station-select'),
  loadRecipeSelect: document.getElementById('preview-load-recipe-select'),
  loadPartBtn: document.getElementById('preview-load-part-btn'),
  loadPartStatus: document.getElementById('preview-load-part-status'),
};

const HIDDEN_KEYS = new Set(['step_no']);

function authHeaders(initialHeaders = {}) {
  const headers = new Headers(initialHeaders);
  const token = localStorage.getItem(AUTH_TOKEN_KEY) || '';
  if (token && !headers.has('X-Admin-Token')) {
    headers.set('X-Admin-Token', token);
  }
  return headers;
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: authHeaders(init.headers || {}),
    credentials: 'same-origin',
  });
  return response;
}

function setLoadPartStatus(message, type = '') {
  if (!els.loadPartStatus) return;
  els.loadPartStatus.textContent = message || '';
  els.loadPartStatus.className = `recipe-status ${type}`.trim();
}

function sanitizePartFolder(value) {
  const cleaned = String(value || '')
    .trim()
    .split('')
    .map((ch) => (/^[a-zA-Z0-9_-]$/.test(ch) ? ch : '_'))
    .join('')
    .replace(/^[_\.]+|[_\.]+$/g, '');
  return cleaned || 'program';
}

function normalizeProgramPayload(payload) {
  const normalized = payload && payload.program ? payload.program : payload;
  if (!normalized || typeof normalized !== 'object') {
    return { partname: '', steps: [] };
  }
  if (!Array.isArray(normalized.steps)) {
    normalized.steps = [];
  }
  return normalized;
}

function resolveStepImage(step) {
  const src = String(step?.upload_image || '').trim();
  if (!src) {
    return '';
  }
  if (src.startsWith('data:image') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/')) {
    return src;
  }

  const normalized = src.replace(/\\/g, '/');
  if (normalized.startsWith('programs/')) {
    return `/${normalized}`;
  }
  if (/^[^/]+\/(imgs\/)?[^/]+\.(jpg|jpeg|png|gif|webp)$/i.test(normalized)) {
    return `/programs/${normalized}`;
  }
  if (/^[^/]+\.(jpg|jpeg|png|gif|webp)$/i.test(normalized)) {
    const partFolder = sanitizePartFolder(state.program?.partname);
    return `/programs/${partFolder}/imgs/${normalized}`;
  }
  return `/${normalized.replace(/^\/+/, '')}`;
}

function modeLabel(step) {
  if (step.enable_barcode) return 'Barcode';
  if (step.request_ack) return 'Acknowledgement';
  if (step.enable_fastening) return 'Fastening';
  return 'No mode selected';
}

function displayValue(value) {
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (value === null || value === undefined || value === '') return 'NA';
  return String(value);
}

function formatFieldKey(key) {
  return String(key || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function visibleEntries(step) {
  return Object.entries(step)
    .filter(([k, v]) => !HIDDEN_KEYS.has(k) && k !== 'upload_image' && v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => ({ key: formatFieldKey(k), value: displayValue(v) }));
}

function renderStep() {
  const steps = state.program?.steps || [];
  if (!steps.length) {
    els.stepTitle.textContent = 'No steps';
    els.mode.textContent = '';
    els.fields.innerHTML = '';
    els.imageWrap.classList.add('hidden');
    els.count.textContent = '0 / 0';
    els.spinner.max = '1';
    els.spinner.value = '1';
    return;
  }

  const step = steps[state.index];
  els.stepTitle.textContent = `Step ${step.step_no || state.index + 1}`;
  els.mode.textContent = modeLabel(step);
  els.count.textContent = `${state.index + 1} / ${steps.length}`;
  els.spinner.max = String(steps.length);
  els.spinner.value = String(state.index + 1);

  const resolvedImage = resolveStepImage(step);
  if (resolvedImage) {
    els.image.onload = () => {
      els.imageWrap.classList.remove('hidden');
    };
    els.image.onerror = () => {
      els.image.removeAttribute('src');
      els.imageWrap.classList.add('hidden');
    };
    els.image.src = resolvedImage;
  } else {
    els.image.removeAttribute('src');
    els.imageWrap.classList.add('hidden');
  }

  els.fields.innerHTML = '';
  for (const entry of visibleEntries(step)) {
    const card = document.createElement('div');
    card.className = 'preview-field';
    card.innerHTML = `<span class="k">${entry.key}</span><span class="v">${entry.value}</span>`;
    els.fields.appendChild(card);
  }

  els.prevBtn.disabled = state.index === 0;
  els.nextBtn.disabled = state.index === steps.length - 1;
}

function goto(index) {
  const steps = state.program?.steps || [];
  if (!steps.length) return;
  state.index = Math.max(0, Math.min(index, steps.length - 1));
  renderStep();
}

function flattenEditorTree() {
  const tree = state.editorTree;
  const organizations = tree?.organizations || [];
  const branches = [];
  const projects = [];
  const lines = [];
  const stations = [];

  for (const org of organizations) {
    for (const branch of org.branches || []) {
      branches.push(branch);
      for (const project of branch.projects || []) {
        projects.push(project);
        for (const line of project.lines || []) {
          lines.push(line);
          for (const station of line.stations || []) {
            stations.push(station);
          }
        }
      }
    }
  }

  return { organizations, branches, projects, lines, stations };
}

function resetSelect(selectElement, placeholderLabel) {
  if (!selectElement) return;
  selectElement.innerHTML = `<option value="">-- ${placeholderLabel} --</option>`;
}

function populateOrgSelect() {
  const { organizations } = flattenEditorTree();
  const orgsHtml = '<option value="">-- Organization --</option>' +
    organizations.map((o) => `<option value="${o.organization_id}">${o.name}</option>`).join('');
  if (els.loadOrgSelect) {
    els.loadOrgSelect.innerHTML = orgsHtml;
  }
}

function refreshLoadRecipeSelect() {
  if (!els.loadRecipeSelect) return;

  const orgId = els.loadOrgSelect?.value || '';
  const branchId = els.loadBranchSelect?.value || '';
  const projectId = els.loadProjectSelect?.value || '';
  const lineId = els.loadLineSelect?.value || '';
  const stationId = els.loadStationSelect?.value || '';

  const recipes = (state.editorTree?.recipes || []).filter((recipe) => {
    if (orgId && recipe.organization_id !== orgId) return false;
    if (branchId && recipe.branch_id && recipe.branch_id !== branchId) return false;
    if (projectId && recipe.project_id && recipe.project_id !== projectId) return false;
    if (lineId && recipe.line_id && recipe.line_id !== lineId) return false;
    if (stationId && recipe.station_id && recipe.station_id !== stationId) return false;
    return true;
  });

  els.loadRecipeSelect.innerHTML = '<option value="">-- Select Part --</option>' +
    recipes.map((recipe) => `<option value="${recipe.recipe_id}">${recipe.name || 'Unnamed'}</option>`).join('');
}

function attachLoadCascading() {
  if (els.loadOrgSelect) {
    els.loadOrgSelect.addEventListener('change', () => {
      const { branches } = flattenEditorTree();
      const filtered = branches.filter((branch) => branch.organization_id === els.loadOrgSelect.value);
      if (els.loadBranchSelect) {
        els.loadBranchSelect.innerHTML = '<option value="">-- Branch --</option>' +
          filtered.map((branch) => `<option value="${branch.branch_id}">${branch.name}</option>`).join('');
      }
      resetSelect(els.loadProjectSelect, 'Project');
      resetSelect(els.loadLineSelect, 'Line');
      resetSelect(els.loadStationSelect, 'Station');
      refreshLoadRecipeSelect();
    });
  }

  if (els.loadBranchSelect) {
    els.loadBranchSelect.addEventListener('change', () => {
      const { projects } = flattenEditorTree();
      const filtered = projects.filter((project) => project.branch_id === els.loadBranchSelect.value);
      if (els.loadProjectSelect) {
        els.loadProjectSelect.innerHTML = '<option value="">-- Project --</option>' +
          filtered.map((project) => `<option value="${project.project_id}">${project.name}</option>`).join('');
      }
      resetSelect(els.loadLineSelect, 'Line');
      resetSelect(els.loadStationSelect, 'Station');
      refreshLoadRecipeSelect();
    });
  }

  if (els.loadProjectSelect) {
    els.loadProjectSelect.addEventListener('change', () => {
      const { lines } = flattenEditorTree();
      const filtered = lines.filter((line) => line.project_id === els.loadProjectSelect.value);
      if (els.loadLineSelect) {
        els.loadLineSelect.innerHTML = '<option value="">-- Line --</option>' +
          filtered.map((line) => `<option value="${line.line_id}">${line.name}</option>`).join('');
      }
      resetSelect(els.loadStationSelect, 'Station');
      refreshLoadRecipeSelect();
    });
  }

  if (els.loadLineSelect) {
    els.loadLineSelect.addEventListener('change', () => {
      const { stations } = flattenEditorTree();
      const filtered = stations.filter((station) => station.line_id === els.loadLineSelect.value);
      if (els.loadStationSelect) {
        els.loadStationSelect.innerHTML = '<option value="">-- Station --</option>' +
          filtered.map((station) => `<option value="${station.station_id}">${station.name}</option>`).join('');
      }
      refreshLoadRecipeSelect();
    });
  }

  if (els.loadStationSelect) {
    els.loadStationSelect.addEventListener('change', refreshLoadRecipeSelect);
  }
}

async function loadEditorTree() {
  try {
    const response = await fetchJson('/api/admin/tree');
    if (!response.ok) {
      return;
    }
    state.editorTree = await response.json();
    populateOrgSelect();
    refreshLoadRecipeSelect();
  } catch (_error) {
  }
}

async function loadPartFromRecipe() {
  if (!els.loadRecipeSelect?.value) {
    setLoadPartStatus('Select a part / recipe first.', 'error');
    return;
  }

  const recipe = (state.editorTree?.recipes || []).find((entry) => entry.recipe_id === els.loadRecipeSelect.value);
  if (!recipe?.payload) {
    setLoadPartStatus('Recipe has no preview data.', 'error');
    return;
  }

  state.program = normalizeProgramPayload(recipe.payload);
  if (!Array.isArray(state.program.steps) || !state.program.steps.length) {
    state.program.steps = [];
  }

  els.partname.textContent = state.program.partname || recipe.name || 'Program';
  goto(0);
  setLoadPartStatus(`Loaded: ${recipe.name || 'Part'}`, 'ok');
}

async function loadProgram() {
  const response = await fetchJson('/api/program');
  if (!response.ok) {
    throw new Error('Failed to load current program');
  }
  const payload = await response.json();
  state.program = normalizeProgramPayload(payload);
  els.partname.textContent = state.program.partname || 'Program';
  goto(0);
}

function bindEvents() {
  els.prevBtn.addEventListener('click', () => goto(state.index - 1));
  els.nextBtn.addEventListener('click', () => goto(state.index + 1));
  els.spinner.addEventListener('change', () => goto(Number(els.spinner.value) - 1));

  if (els.refreshBtn) {
    els.refreshBtn.addEventListener('click', async () => {
      const current = state.index;
      await loadProgram();
      goto(current);
    });
  }

  if (els.loadPartBtn) {
    els.loadPartBtn.addEventListener('click', loadPartFromRecipe);
  }

  attachLoadCascading();
}

(async function init() {
  bindEvents();
  try {
    await loadProgram();
    await loadEditorTree();
  } catch (err) {
    els.stepTitle.textContent = 'Unable to load preview';
    els.mode.textContent = String(err);
  }
})();
