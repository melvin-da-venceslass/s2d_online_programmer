const AUTH_TOKEN_KEY = 'admin_token';
const AUTH_EXPIRY_KEY = 'admin_expiry_epoch_ms';

function clearAuthAndRedirect() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_EXPIRY_KEY);
  window.location.href = '/';
}

function installAuthFetchGuard() {
  const token = localStorage.getItem(AUTH_TOKEN_KEY) || '';
  const expiryEpochMs = Number(localStorage.getItem(AUTH_EXPIRY_KEY) || '0');

  if (!token || !Number.isFinite(expiryEpochMs) || Date.now() >= expiryEpochMs) {
    clearAuthAndRedirect();
    return;
  }

  const timeoutMs = Math.max(0, expiryEpochMs - Date.now());
  window.setTimeout(() => {
    clearAuthAndRedirect();
  }, timeoutMs);

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const headers = new Headers(init.headers || {});
    if (!headers.has('X-Admin-Token')) {
      headers.set('X-Admin-Token', token);
    }
    const response = await nativeFetch(input, { ...init, headers, credentials: 'same-origin' });
    if (response.status === 401) {
      clearAuthAndRedirect();
      throw new Error('Session expired. Please login again.');
    }
    return response;
  };
}

installAuthFetchGuard();

const state = {
  editorTree: null,
  storageConfig: {
    gcs_enabled: false,
  },
};

const els = {
  sessionInfo: document.getElementById('session-info'),
  navAdmin: document.getElementById('nav-admin'),
  logoutBtn: document.getElementById('logout-btn'),

  saveProgramBtn: document.getElementById('save-program-btn'),
  downloadJsonBtn: document.getElementById('download-json-btn'),
  downloadCurrentRecipeBtn: document.getElementById('download-current-recipe-btn'),
  programActionsStatus: document.getElementById('program-actions-status'),

  createOrgSelect: document.getElementById('create-org-select'),
  createBranchSelect: document.getElementById('create-branch-select'),
  createProjectSelect: document.getElementById('create-project-select'),
  createLineSelect: document.getElementById('create-line-select'),
  createStationSelect: document.getElementById('create-station-select'),
  createRecipeName: document.getElementById('create-recipe-name'),
  createRecipeDescription: document.getElementById('create-recipe-description'),
  createRecipeBtn: document.getElementById('create-recipe-btn'),
  createOpenEditorBtn: document.getElementById('create-open-editor-btn'),
  createRecipeStatus: document.getElementById('create-recipe-status'),

  loadOrgSelect: document.getElementById('load-org-select'),
  loadBranchSelect: document.getElementById('load-branch-select'),
  loadProjectSelect: document.getElementById('load-project-select'),
  loadLineSelect: document.getElementById('load-line-select'),
  loadStationSelect: document.getElementById('load-station-select'),
  loadDeviceSelect: document.getElementById('load-device-select'),
  loadRecipeSelect: document.getElementById('load-recipe-select'),
  openEditorBtn: document.getElementById('open-editor-btn'),
  downloadSelectedZipBtn: document.getElementById('download-selected-zip-btn'),
  deleteSelectedRecipeBtn: document.getElementById('delete-selected-recipe-btn'),
  loadRecipeStatus: document.getElementById('load-recipe-status'),

  uploadZipFile: document.getElementById('upload-zip-file'),
  uploadZipBtn: document.getElementById('upload-zip-btn'),
  uploadRecipeStatus: document.getElementById('upload-recipe-status'),

  mapOrgSelect: document.getElementById('map-org-select'),
  mapBranchSelect: document.getElementById('map-branch-select'),
  mapProjectSelect: document.getElementById('map-project-select'),
  mapLineSelect: document.getElementById('map-line-select'),
  mapStationSelect: document.getElementById('map-station-select'),
  mapDeviceSelect: document.getElementById('map-device-select'),
  mapTargetTypeSelect: document.getElementById('map-target-type-select'),
  mapTargetIdSelect: document.getElementById('map-target-id-select'),
  mapRecipeSelect: document.getElementById('map-recipe-select'),
  mapDeviceBtn: document.getElementById('map-device-btn'),
  mapScopeBtn: document.getElementById('map-scope-btn'),
  mapStatus: document.getElementById('map-status'),

  dashOrgSelect: document.getElementById('dash-org-select'),
  dashBranchSelect: document.getElementById('dash-branch-select'),
  dashProjectSelect: document.getElementById('dash-project-select'),
  dashLineSelect: document.getElementById('dash-line-select'),
  dashStationSelect: document.getElementById('dash-station-select'),
  dashDeviceSelect: document.getElementById('dash-device-select'),
  dashSearchInput: document.getElementById('dash-search-input'),
  dashUnmappedSelect: document.getElementById('dash-unmapped-select'),
  dashRefreshBtn: document.getElementById('dash-refresh-btn'),
  dashStatus: document.getElementById('dash-status'),
  dashSummary: document.getElementById('dash-summary'),
  dashRecipesList: document.getElementById('dash-recipes-list'),
  dashScopeList: document.getElementById('dash-scope-list'),
  dashDeviceList: document.getElementById('dash-device-list'),
};

function setStatus(el, message, type = '') {
  if (!el) return;
  el.textContent = message || '';
  el.className = `recipe-status ${type}`.trim();
}

function sanitizeFilename(value) {
  const cleaned = String(value || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^[_\.]+|[_\.]+$/g, '');
  return cleaned || 'program';
}

function blankProgram(partName = '') {
  return {
    partname: partName,
    enable_mes: false,
    enable_ftp: false,
    steps: [
      {
        upload_image: '...',
        enable_barcode: false,
        bc_title: '...',
        bc_parent: true,
        bc_child: false,
        whatloc_enabled: false,
        check_short_workstation: '...',
        check_part_number: '...',
        check_ref_designator: '...',
        enable_barcode_mes: false,
        ack_title: '...',
        request_ack: false,
        enable_ack_mes: false,
        enable_fastening: false,
        step_no: 1,
        target_preset: '...',
        target_torque: '...',
        target_angle: '...',
        target_min_angle: '...',
        target_max_angle: '...',
        target_tolerance: '...',
        target_rpm: '...',
        TC_AM: false,
        AC_TM: false,
        screw_info: '...',
        remarks: '...',
        mes_enable_assy: false,
        snug_torque: '...',
        free_fastening_angle: '...',
        soft_start: '...',
        free_fastening_speed: '...',
        torque_rising_rate: '...',
        seating_point: '...',
        ramp_up_speed: '...',
        torque_compensation: '...',
      },
    ],
  };
}

function flattenEditorTree() {
  const tree = state.editorTree;
  const organizations = tree?.organizations || [];
  const branches = [];
  const projects = [];
  const lines = [];
  const stations = [];
  const devices = [];

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

function populateOrgSelects() {
  const { organizations } = flattenEditorTree();
  const html = '<option value="">-- Organization --</option>' + organizations.map((entry) => (
    `<option value="${entry.organization_id}">${entry.name}</option>`
  )).join('');

  [els.createOrgSelect, els.loadOrgSelect, els.mapOrgSelect, els.dashOrgSelect].forEach((select) => {
    if (select) select.innerHTML = html;
  });
}

function resetSelect(select, label) {
  if (!select) return;
  select.innerHTML = `<option value="">-- ${label} --</option>`;
}

function attachCascading(prefix) {
  const get = (id) => document.getElementById(`${prefix}${id}`);
  const orgSel = get('org-select');
  const branchSel = get('branch-select');
  const projectSel = get('project-select');
  const lineSel = get('line-select');
  const stationSel = get('station-select');

  if (orgSel) {
    orgSel.addEventListener('change', () => {
      const { branches } = flattenEditorTree();
      const filtered = branches.filter((entry) => entry.organization_id === orgSel.value);
      if (branchSel) {
        branchSel.innerHTML = '<option value="">-- Branch --</option>' + filtered.map((entry) => `<option value="${entry.branch_id}">${entry.name}</option>`).join('');
      }
      resetSelect(projectSel, 'Project');
      resetSelect(lineSel, 'Line');
      resetSelect(stationSel, 'Station');
      if (prefix === 'load-') {
        resetSelect(els.loadDeviceSelect, 'Optional Device Filter');
      } else if (prefix === 'dash-') {
        resetSelect(els.dashDeviceSelect, 'Device');
      }
      refreshRecipeSelects();
      refreshMapDeviceSelect();
      refreshMapTargetSelect();
    });
  }

  if (branchSel) {
    branchSel.addEventListener('change', () => {
      const { projects } = flattenEditorTree();
      const filtered = projects.filter((entry) => entry.branch_id === branchSel.value);
      if (projectSel) {
        projectSel.innerHTML = '<option value="">-- Project --</option>' + filtered.map((entry) => `<option value="${entry.project_id}">${entry.name}</option>`).join('');
      }
      resetSelect(lineSel, 'Line');
      resetSelect(stationSel, 'Station');
      if (prefix === 'load-') {
        resetSelect(els.loadDeviceSelect, 'Optional Device Filter');
      } else if (prefix === 'dash-') {
        resetSelect(els.dashDeviceSelect, 'Device');
      }
      refreshRecipeSelects();
      refreshMapDeviceSelect();
      refreshMapTargetSelect();
    });
  }

  if (projectSel) {
    projectSel.addEventListener('change', () => {
      const { lines } = flattenEditorTree();
      const filtered = lines.filter((entry) => entry.project_id === projectSel.value);
      if (lineSel) {
        lineSel.innerHTML = '<option value="">-- Line --</option>' + filtered.map((entry) => `<option value="${entry.line_id}">${entry.name}</option>`).join('');
      }
      resetSelect(stationSel, 'Station');
      if (prefix === 'load-') {
        resetSelect(els.loadDeviceSelect, 'Optional Device Filter');
      } else if (prefix === 'dash-') {
        resetSelect(els.dashDeviceSelect, 'Device');
      }
      refreshRecipeSelects();
      refreshMapDeviceSelect();
      refreshMapTargetSelect();
    });
  }

  if (lineSel) {
    lineSel.addEventListener('change', () => {
      const { stations } = flattenEditorTree();
      const filtered = stations.filter((entry) => entry.line_id === lineSel.value);
      if (stationSel) {
        stationSel.innerHTML = '<option value="">-- Station --</option>' + filtered.map((entry) => `<option value="${entry.station_id}">${entry.name}</option>`).join('');
      }
      if (prefix === 'load-') {
        refreshLoadDeviceSelect();
      } else if (prefix === 'dash-') {
        refreshDashDeviceSelect();
      }
      refreshRecipeSelects();
      refreshMapDeviceSelect();
      refreshMapTargetSelect();
    });
  }

  if (stationSel) {
    stationSel.addEventListener('change', () => {
      if (prefix === 'load-') {
        refreshLoadDeviceSelect();
      } else if (prefix === 'dash-') {
        refreshDashDeviceSelect();
      }
      refreshRecipeSelects();
      refreshMapDeviceSelect();
      refreshMapTargetSelect();
    });
  }
}

function filterRecipesByScope(scope) {
  const recipes = state.editorTree?.recipes || [];
  return recipes.filter((recipe) => {
    if (scope.organization_id && recipe.organization_id !== scope.organization_id) return false;
    if (scope.branch_id && recipe.branch_id && recipe.branch_id !== scope.branch_id) return false;
    return true;
  });
}

function refreshRecipeSelects() {
  const loadScope = {
    organization_id: els.loadOrgSelect?.value || '',
    branch_id: els.loadBranchSelect?.value || '',
    project_id: els.loadProjectSelect?.value || '',
    line_id: els.loadLineSelect?.value || '',
    station_id: els.loadStationSelect?.value || '',
  };
  const mapScope = {
    organization_id: els.mapOrgSelect?.value || '',
    branch_id: els.mapBranchSelect?.value || '',
    project_id: els.mapProjectSelect?.value || '',
    line_id: els.mapLineSelect?.value || '',
    station_id: els.mapStationSelect?.value || '',
  };

  const loadRecipes = filterRecipesByScope(loadScope);
  if (els.loadRecipeSelect && !(els.loadDeviceSelect?.value || '')) {
    els.loadRecipeSelect.innerHTML = '<option value="">-- Select Recipie --</option>' + loadRecipes.map((entry) => (
      `<option value="${entry.recipe_id}">${entry.name || 'Unnamed'}</option>`
    )).join('');
  }

  const mapRecipes = filterRecipesByScope(mapScope);
  if (els.mapRecipeSelect) {
    els.mapRecipeSelect.innerHTML = '<option value="">-- Select Recipie --</option>' + mapRecipes.map((entry) => (
      `<option value="${entry.recipe_id}">${entry.name || 'Unnamed'}</option>`
    )).join('');
  }
}

function refreshLoadDeviceSelect() {
  if (!els.loadDeviceSelect) return;
  const stationId = els.loadStationSelect?.value || '';
  if (!stationId) {
    els.loadDeviceSelect.innerHTML = '<option value="">-- Optional Device Filter --</option>';
    return;
  }

  const { devices } = flattenEditorTree();
  const stationDevices = devices.filter((entry) => entry.station_id === stationId);
  els.loadDeviceSelect.innerHTML = '<option value="">-- Optional Device Filter --</option>' + stationDevices.map((entry) => (
    `<option value="${entry.device_id}">${entry.name} (${entry.device_code})</option>`
  )).join('');
}

function refreshDashDeviceSelect() {
  if (!els.dashDeviceSelect) return;
  const stationId = els.dashStationSelect?.value || '';
  if (!stationId) {
    els.dashDeviceSelect.innerHTML = '<option value="">-- Device --</option>';
    return;
  }
  const { devices } = flattenEditorTree();
  const stationDevices = devices.filter((entry) => entry.station_id === stationId);
  els.dashDeviceSelect.innerHTML = '<option value="">-- Device --</option>' + stationDevices.map((entry) => (
    `<option value="${entry.device_id}">${entry.name} (${entry.device_code})</option>`
  )).join('');
}

async function refreshMappedRecipeSelect() {
  if (!els.loadRecipeSelect) return;
  const deviceId = els.loadDeviceSelect?.value || '';
  if (!deviceId) {
    refreshRecipeSelects();
    return;
  }

  try {
    const response = await fetch(`/list-recipes/${encodeURIComponent(deviceId)}`);
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const payload = await response.json();
    const mappedIds = new Set((payload.recipes || []).map((entry) => entry.recipe_id));
    const mappedRecipes = (state.editorTree?.recipes || []).filter((entry) => mappedIds.has(entry.recipe_id));
    els.loadRecipeSelect.innerHTML = '<option value="">-- Select Recipie --</option>' + mappedRecipes.map((entry) => (
      `<option value="${entry.recipe_id}">${entry.name || 'Unnamed'}</option>`
    )).join('');
  } catch (error) {
    setStatus(els.loadRecipeStatus, `Mapped recipie filter failed: ${error}`, 'error');
  }
}

function refreshMapDeviceSelect() {
  const stationId = els.mapStationSelect?.value || '';
  if (!els.mapDeviceSelect) return;
  if (!stationId) {
    els.mapDeviceSelect.innerHTML = '<option value="">-- Select Device --</option>';
    return;
  }

  const { devices } = flattenEditorTree();
  const stationDevices = devices.filter((entry) => entry.station_id === stationId);
  els.mapDeviceSelect.innerHTML = '<option value="">-- Select Device --</option>' + stationDevices.map((entry) => (
    `<option value="${entry.device_id}">${entry.name} (${entry.device_code})</option>`
  )).join('');
}

function refreshMapTargetSelect() {
  const targetType = els.mapTargetTypeSelect?.value || '';
  if (!els.mapTargetIdSelect) return;

  if (!targetType) {
    els.mapTargetIdSelect.innerHTML = '<option value="">-- Select Target --</option>';
    return;
  }

  const { projects, lines, stations } = flattenEditorTree();
  let options = [];
  if (targetType === 'project') {
    const branchId = els.mapBranchSelect?.value || '';
    options = projects.filter((entry) => !branchId || entry.branch_id === branchId)
      .map((entry) => ({ id: entry.project_id, name: entry.name }));
  } else if (targetType === 'line') {
    const projectId = els.mapProjectSelect?.value || '';
    options = lines.filter((entry) => !projectId || entry.project_id === projectId)
      .map((entry) => ({ id: entry.line_id, name: entry.name }));
  } else if (targetType === 'station') {
    const lineId = els.mapLineSelect?.value || '';
    options = stations.filter((entry) => !lineId || entry.line_id === lineId)
      .map((entry) => ({ id: entry.station_id, name: entry.name }));
  }

  els.mapTargetIdSelect.innerHTML = '<option value="">-- Select Target --</option>' + options.map((entry) => (
    `<option value="${entry.id}">${entry.name}</option>`
  )).join('');
}

function selectedRecipe(select) {
  const recipeId = select?.value || '';
  if (!recipeId) return null;
  return (state.editorTree?.recipes || []).find((entry) => entry.recipe_id === recipeId) || null;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadStorageConfig() {
  try {
    const response = await fetch('/api/storage-config');
    if (!response.ok) return;
    const payload = await response.json();
    state.storageConfig.gcs_enabled = Boolean(payload.gcs_enabled);
  } catch (_) {
  }
}

async function loadEditorTree() {
  const response = await fetch('/api/admin/tree');
  if (!response.ok) {
    throw new Error(await response.text());
  }
  state.editorTree = await response.json();
  populateOrgSelects();
  refreshRecipeSelects();
  refreshMapDeviceSelect();
  refreshMapTargetSelect();
  refreshDashDeviceSelect();
}

function renderList(el, items, formatter) {
  if (!el) return;
  if (!items.length) {
    el.innerHTML = '<em>No data</em>';
    return;
  }
  el.innerHTML = `<ul>${items.map((item) => `<li>${formatter(item)}</li>`).join('')}</ul>`;
}

async function refreshDashboard() {
  try {
    const payload = {
      organization_id: els.dashOrgSelect?.value || null,
      branch_id: els.dashBranchSelect?.value || null,
      project_id: els.dashProjectSelect?.value || null,
      line_id: els.dashLineSelect?.value || null,
      station_id: els.dashStationSelect?.value || null,
      device_id: els.dashDeviceSelect?.value || null,
      q: (els.dashSearchInput?.value || '').trim() || null,
      unmapped_only: (els.dashUnmappedSelect?.value || 'false') === 'true',
    };
    const response = await fetch('/api/admin/recipes/dashboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = await response.json();
    const recipes = data.recipes || [];
    const unmappedPool = data.unmapped_pool || [];
    const scopeMappings = data.scope_mappings || [];
    const deviceMappings = data.device_mappings || [];

    if (els.dashSummary) {
      els.dashSummary.textContent = `Pool: ${recipes.length} | Unmapped: ${unmappedPool.length} | Scope maps: ${scopeMappings.length} | Device maps: ${deviceMappings.length}`;
    }

    renderList(els.dashRecipesList, recipes, (entry) => `${entry.name} (${entry.branch_id || 'n/a'})`);
    renderList(els.dashScopeList, scopeMappings, (entry) => `${entry.recipe_name} -> ${entry.target_type}:${entry.target_id}`);
    renderList(els.dashDeviceList, deviceMappings, (entry) => `${entry.recipe_name} -> device:${entry.device_id}`);
    setStatus(els.dashStatus, 'Dashboard refreshed.', 'ok');
  } catch (error) {
    setStatus(els.dashStatus, `Dashboard failed: ${error}`, 'error');
  }
}

async function loadUserSession() {
  const response = await fetch('/api/admin/me');
  if (!response.ok) {
    throw new Error('Failed to load current user session');
  }
  const payload = await response.json();
  const user = payload.user || null;
  const role = user?.role || 'unknown';

  if (els.sessionInfo) {
    els.sessionInfo.textContent = `${user?.username || 'user'} (${role})`;
  }
  if (els.navAdmin) {
    els.navAdmin.style.display = role === 'super_admin' || role === 'admin' ? '' : 'none';
  }
}

async function logoutAndRedirect() {
  try {
    await fetch('/api/admin/logout', { method: 'POST' });
  } catch (_) {
  }
  clearAuthAndRedirect();
}

async function saveProgram() {
  try {
    const currentResponse = await fetch('/api/program');
    if (!currentResponse.ok) throw new Error(await currentResponse.text());
    const program = await currentResponse.json();

    const saveResponse = await fetch('/api/program', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(program),
    });
    if (!saveResponse.ok) throw new Error(await saveResponse.text());

    setStatus(els.programActionsStatus, 'Program saved.', 'ok');
    await loadEditorTree();
  } catch (error) {
    setStatus(els.programActionsStatus, `Save failed: ${error}`, 'error');
  }
}

async function downloadCurrentJson() {
  try {
    const response = await fetch('/api/program');
    if (!response.ok) throw new Error(await response.text());
    const program = await response.json();
    const partName = sanitizeFilename(program.partname || 'program');
    const blob = new Blob([JSON.stringify(program, null, 4)], { type: 'application/json' });
    downloadBlob(blob, `${partName}.json`);
    setStatus(els.programActionsStatus, 'JSON downloaded.', 'ok');
  } catch (error) {
    setStatus(els.programActionsStatus, `Download failed: ${error}`, 'error');
  }
}

function downloadCurrentRecipeZip() {
  window.location.href = '/download-recipe';
}

function createRecipePayload() {
  const recipeName = (els.createRecipeName?.value || '').trim();
  const description = (els.createRecipeDescription?.value || '').trim();
  const organizationId = els.createOrgSelect?.value || '';
  const branchId = els.createBranchSelect?.value || '';

  if (!recipeName) {
    throw new Error('Enter recipie name.');
  }
  if (!organizationId) {
    throw new Error('Select organization.');
  }
  if (!branchId) {
    throw new Error('Select branch.');
  }

  return {
    name: recipeName,
    description,
    organization_id: organizationId,
    branch_id: branchId,
    payload: blankProgram(recipeName),
  };
}

async function createRecipe(openEditorAfterCreate = false) {
  try {
    const payload = createRecipePayload();
    const response = await fetch('/api/admin/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const created = await response.json();

    setStatus(els.createRecipeStatus, `Recipie '${payload.name}' created.`, 'ok');
    await loadEditorTree();
    await refreshDashboard();

    if (openEditorAfterCreate && created?.recipe_id) {
      window.location.href = `/cook-recipie?recipe_id=${encodeURIComponent(created.recipe_id)}`;
    }
  } catch (error) {
    setStatus(els.createRecipeStatus, `Create failed: ${error}`, 'error');
  }
}

function openSelectedRecipeInEditor() {
  const recipe = selectedRecipe(els.loadRecipeSelect);
  if (!recipe) {
    setStatus(els.loadRecipeStatus, 'Select recipie first.', 'error');
    return;
  }
  window.location.href = `/cook-recipie?recipe_id=${encodeURIComponent(recipe.recipe_id)}`;
}

async function downloadSelectedRecipeZip() {
  const recipe = selectedRecipe(els.loadRecipeSelect);
  if (!recipe) {
    setStatus(els.loadRecipeStatus, 'Select recipie first.', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/editor/recipes/${encodeURIComponent(recipe.recipe_id)}/download`);
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const blob = await response.blob();
    downloadBlob(blob, `${sanitizeFilename(recipe.name || 'program')}.zip`);
    setStatus(els.loadRecipeStatus, 'ZIP downloaded.', 'ok');
  } catch (error) {
    setStatus(els.loadRecipeStatus, `Download failed: ${error}`, 'error');
  }
}

async function deleteSelectedRecipe() {
  const recipe = selectedRecipe(els.loadRecipeSelect);
  if (!recipe) {
    setStatus(els.loadRecipeStatus, 'Select recipie first.', 'error');
    return;
  }

  const confirmed = window.confirm(`Delete recipie '${recipe.name}'? This removes MongoDB data and associated images.`);
  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch(`/api/editor/recipes/${encodeURIComponent(recipe.recipe_id)}`, {
      method: 'DELETE',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.detail || `Delete failed: ${response.status}`);
    }

    if (els.loadRecipeSelect) {
      els.loadRecipeSelect.value = '';
    }
    setStatus(els.loadRecipeStatus, `Deleted '${recipe.name}'.`, 'ok');
    await loadEditorTree();
    await refreshDashboard();
  } catch (error) {
    setStatus(els.loadRecipeStatus, `Delete failed: ${error}`, 'error');
  }
}

async function uploadRecipeZip() {
  const file = els.uploadZipFile?.files?.[0];
  if (!file) {
    setStatus(els.uploadRecipeStatus, 'Select a ZIP file first.', 'error');
    return;
  }

  try {
    const endpoint = state.storageConfig.gcs_enabled ? '/api/upload-to-gcs' : '/api/upload-zip';
    const organizationId = els.createOrgSelect?.value || '';
    const branchId = els.createBranchSelect?.value || '';
    if (!organizationId || !branchId) {
      throw new Error('Select organization and branch for upload.');
    }
    const formData = new FormData();
    formData.append('file', file);
    formData.append('organization_id', organizationId);
    formData.append('branch_id', branchId);

    const response = await fetch(endpoint, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }

    setStatus(els.uploadRecipeStatus, 'Recipie ZIP uploaded successfully.', 'ok');
    if (els.uploadZipFile) {
      els.uploadZipFile.value = '';
    }
    await loadEditorTree();
    await refreshDashboard();
  } catch (error) {
    setStatus(els.uploadRecipeStatus, `Upload failed: ${error}`, 'error');
  }
}

async function mapRecipeToDevice() {
  const recipe = selectedRecipe(els.mapRecipeSelect);
  const deviceId = els.mapDeviceSelect?.value || '';

  if (!recipe) {
    setStatus(els.mapStatus, 'Select recipie first.', 'error');
    return;
  }
  if (!deviceId) {
    setStatus(els.mapStatus, 'Select device first.', 'error');
    return;
  }

  try {
    const response = await fetch('/api/admin/recipe-device-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipe_id: recipe.recipe_id, device_id: deviceId }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    setStatus(els.mapStatus, `Mapped '${recipe.name}' to selected device.`, 'ok');
    await refreshDashboard();
  } catch (error) {
    setStatus(els.mapStatus, `Map failed: ${error}`, 'error');
  }
}

async function mapRecipeToScope() {
  const recipe = selectedRecipe(els.mapRecipeSelect);
  const targetType = els.mapTargetTypeSelect?.value || '';
  const targetId = els.mapTargetIdSelect?.value || '';

  if (!recipe) {
    setStatus(els.mapStatus, 'Select recipie first.', 'error');
    return;
  }
  if (!targetType || !targetId) {
    setStatus(els.mapStatus, 'Select target type and target.', 'error');
    return;
  }

  try {
    const response = await fetch('/api/admin/recipe-scope-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipe_id: recipe.recipe_id, target_type: targetType, target_id: targetId }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    setStatus(els.mapStatus, `Mapped '${recipe.name}' to ${targetType}.`, 'ok');
    await refreshDashboard();
  } catch (error) {
    setStatus(els.mapStatus, `Scope map failed: ${error}`, 'error');
  }
}

function bindEvents() {
  if (els.logoutBtn) {
    els.logoutBtn.addEventListener('click', logoutAndRedirect);
  }
  if (els.saveProgramBtn) {
    els.saveProgramBtn.addEventListener('click', saveProgram);
  }
  if (els.downloadJsonBtn) {
    els.downloadJsonBtn.addEventListener('click', downloadCurrentJson);
  }
  if (els.downloadCurrentRecipeBtn) {
    els.downloadCurrentRecipeBtn.addEventListener('click', downloadCurrentRecipeZip);
  }
  if (els.createRecipeBtn) {
    els.createRecipeBtn.addEventListener('click', () => createRecipe(false));
  }
  if (els.createOpenEditorBtn) {
    els.createOpenEditorBtn.addEventListener('click', () => createRecipe(true));
  }
  if (els.openEditorBtn) {
    els.openEditorBtn.addEventListener('click', openSelectedRecipeInEditor);
  }
  if (els.downloadSelectedZipBtn) {
    els.downloadSelectedZipBtn.addEventListener('click', downloadSelectedRecipeZip);
  }
  if (els.deleteSelectedRecipeBtn) {
    els.deleteSelectedRecipeBtn.addEventListener('click', deleteSelectedRecipe);
  }
  if (els.loadDeviceSelect) {
    els.loadDeviceSelect.addEventListener('change', () => {
      refreshMappedRecipeSelect();
    });
  }
  if (els.uploadZipBtn) {
    els.uploadZipBtn.addEventListener('click', uploadRecipeZip);
  }
  if (els.mapDeviceBtn) {
    els.mapDeviceBtn.addEventListener('click', mapRecipeToDevice);
  }
  if (els.mapScopeBtn) {
    els.mapScopeBtn.addEventListener('click', mapRecipeToScope);
  }
  if (els.mapTargetTypeSelect) {
    els.mapTargetTypeSelect.addEventListener('change', refreshMapTargetSelect);
  }
  if (els.dashRefreshBtn) {
    els.dashRefreshBtn.addEventListener('click', refreshDashboard);
  }

  attachCascading('create-');
  attachCascading('load-');
  attachCascading('map-');
  attachCascading('dash-');

  document.querySelectorAll('.manage-tab-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.target;
      document.querySelectorAll('.manage-tab-btn').forEach((entry) => {
        entry.classList.toggle('is-active', entry === button);
      });
      document.querySelectorAll('.manage-tab-section').forEach((section) => {
        const sectionGroup = section.dataset.tabGroup || section.id;
        section.classList.toggle('is-active', sectionGroup === target || section.id === target);
      });
    });
  });
}

async function init() {
  bindEvents();
  await loadStorageConfig();
  await loadUserSession();
  await loadEditorTree();
  refreshLoadDeviceSelect();
  await refreshDashboard();
}

init().catch((error) => {
  setStatus(els.programActionsStatus, String(error), 'error');
});
