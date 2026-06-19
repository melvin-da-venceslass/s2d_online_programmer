const state = {
  token: localStorage.getItem('admin_token') || '',
  expiryEpochMs: Number(localStorage.getItem('admin_expiry_epoch_ms') || '0'),
  user: null,
  tree: null,
};

const els = {
  loginShell: document.getElementById('login-shell'),
  dashboard: document.getElementById('admin-dashboard'),
  authStatus: document.getElementById('auth-status'),
  createStatus: document.getElementById('create-status'),
  bootstrapWrap: document.getElementById('bootstrap-wrap'),
  loginWrap: document.getElementById('login-wrap'),
  refreshTreeBtn: document.getElementById('refresh-tree-btn'),
  treeView: document.getElementById('tree-view'),
  usersView: document.getElementById('users-view'),
  logoutBtn: document.getElementById('logout-btn'),
  navUser: document.getElementById('admin-nav-user'),
  editModal: document.getElementById('edit-modal'),
  editForm: document.getElementById('edit-form'),
  editModalTitle: document.getElementById('edit-modal-title'),
  editModalFields: document.getElementById('edit-modal-fields'),
  editModalStatus: document.getElementById('edit-modal-status'),
  editModalClose: document.getElementById('edit-modal-close'),
  editCancelBtn: document.getElementById('edit-cancel-btn'),
};

const formIdsByRole = {
  super_admin: ['org-form', 'branch-form', 'project-form', 'line-form', 'station-form', 'user-form', 'device-form'],
  admin: ['branch-form', 'project-form', 'line-form', 'station-form', 'user-form', 'device-form'],
  engineer: [],
};

function setDashboardVisible(visible) {
  if (els.loginShell) {
    els.loginShell.style.display = visible ? 'none' : 'flex';
  }
  if (els.dashboard) {
    els.dashboard.style.display = visible ? '' : 'none';
  }
}

function clearAuthState() {
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_expiry_epoch_ms');
  state.token = '';
  state.expiryEpochMs = 0;
}

function installSessionTimer() {
  if (!state.expiryEpochMs || !Number.isFinite(state.expiryEpochMs)) return;
  const timeoutMs = Math.max(0, state.expiryEpochMs - Date.now());
  window.setTimeout(async () => {
    try {
      await fetch('/api/admin/logout', {
        method: 'POST',
        headers: headers(),
      });
    } catch (_error) {
    }
    clearAuthState();
    state.user = null;
    state.tree = null;
    applyRoleOptions();
    renderTree();
    setStatus(els.authStatus, 'Session expired. Please login again.', 'error');
  }, timeoutMs);
}

function setStatus(target, message, type = '') {
  if (!target) return;
  target.textContent = message;
  target.className = `status ${type}`.trim();
}

function headers() {
  const out = { 'Content-Type': 'application/json' };
  if (state.token) out['X-Admin-Token'] = state.token;
  return out;
}

async function fetchJson(url, options = {}) {
  const resp = await fetch(url, options);
  const body = await resp.json().catch(() => ({}));
  if (resp.status === 401) {
    clearAuthState();
  }
  if (!resp.ok) {
    throw new Error(body.detail || body.message || `Request failed: ${resp.status}`);
  }
  return body;
}

function formDataToObject(form) {
  const data = {};
  new FormData(form).forEach((value, key) => {
    const str = String(value).trim();
    data[key] = str || null;
  });
  return data;
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildEditFields(type, record) {
  const fi = (label, name, value) =>
    `<label class="field-label">${label}
      <input name="${name}" value="${escHtml(value)}" required />
    </label>`;
  const fs = (label, name, value, opts) =>
    `<label class="field-label">${label}
      <select name="${name}">${opts.map(o => `<option value="${o.v}"${o.v === String(value) ? ' selected' : ''}>${o.t}</option>`).join('')}</select>
    </label>`;
  switch (type) {
    case 'org':
    case 'branch':
    case 'project':
    case 'line':
    case 'station':
      return fi('Name', 'name', record.name) + fi('Code', 'code', record.code);
    case 'device':
      return fi('Name', 'name', record.name) + fi('Device Code', 'device_code', record.device_code);
    case 'user': {
      const actorRole = state.user?.role || '';
      const roleOpts = actorRole === 'super_admin'
        ? [{ v: 'admin', t: 'Admin' }, { v: 'engineer', t: 'Engineer' }]
        : [{ v: 'engineer', t: 'Engineer' }];
      return fi('Username', 'username', record.username)
        + fi('User Group', 'user_group', record.user_group || '')
        + fs('Role', 'role', record.role, roleOpts)
        + fs('Status', 'active', record.active !== false ? 'true' : 'false', [
            { v: 'true', t: 'Active' },
            { v: 'false', t: 'Inactive' },
          ]);
    }
    default: return '';
  }
}

function openEditModal(type, id) {
  const flat = flattenTree(state.tree);
  const finders = {
    org:     () => (state.tree?.organizations || []).find(o => o.organization_id === id),
    branch:  () => flat.branches.find(b => b.branch_id === id),
    project: () => flat.projects.find(p => p.project_id === id),
    line:    () => flat.lines.find(l => l.line_id === id),
    station: () => flat.stations.find(s => s.station_id === id),
    device:  () => flat.devices.find(d => d.device_id === id),
    user:    () => (state.tree?.users || []).find(u => u.user_id === id),
  };
  const record = finders[type]?.();
  if (!record) return;
  const labels = { org: 'Organization', branch: 'Branch', project: 'Project', line: 'Line', station: 'Station', device: 'Device', user: 'User' };
  els.editModalTitle.textContent = `Edit ${labels[type] || type}`;
  els.editModalFields.innerHTML = buildEditFields(type, record);
  els.editForm.dataset.etype = type;
  els.editForm.dataset.eid = id;
  setStatus(els.editModalStatus, '', '');
  els.editModal.showModal();
}

function optionMarkup(items, key, label) {
  const rows = ['<option value="">-- select --</option>'];
  for (const item of items || []) {
    rows.push(`<option value="${item[key]}">${item[label]} (${item.code || item[key]})</option>`);
  }
  return rows.join('');
}

function setFormVisibility(formId, visible) {
  const tabId = formId.replace('-form', '');
  const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (tabBtn) {
    if (visible) tabBtn.removeAttribute('hidden');
    else tabBtn.setAttribute('hidden', '');
  }
}

function activateTab(tabId) {
  for (const btn of document.querySelectorAll('.tab-btn')) {
    btn.classList.toggle('is-active', btn.dataset.tab === tabId);
  }
  for (const pane of document.querySelectorAll('.tab-pane')) {
    pane.classList.toggle('is-active', pane.dataset.tabPane === tabId);
  }
}

function activateFirstVisibleTab() {
  const first = document.querySelector('.tab-btn:not([hidden])');
  if (first) activateTab(first.dataset.tab);
}

function applyRoleOptions() {
  const role = state.user?.role || '';
  const allowed = new Set(formIdsByRole[role] || []);

  const allFormIds = formIdsByRole.super_admin;
  for (const formId of allFormIds) {
    setFormVisibility(formId, allowed.has(formId));
  }

  const roleSelect = document.querySelector('#user-form select[name="role"]');
  if (roleSelect) {
    if (role === 'super_admin') {
      roleSelect.innerHTML = '<option value="admin">Admin</option><option value="engineer">Engineer</option>';
    } else if (role === 'admin') {
      roleSelect.innerHTML = '<option value="engineer">Engineer</option>';
    }
  }

  const createHeader = document.querySelector('#create-panel h2');
  if (createHeader) {
    if (role === 'admin') {
      createHeader.textContent = 'Admin Operations';
    } else {
      createHeader.textContent = 'Create & Map';
    }
  }
  activateFirstVisibleTab();
}

function flattenTree(tree) {
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

function fillSelect(formId, fieldName, html) {
  const select = document.querySelector(`#${formId} select[name="${fieldName}"]`);
  if (select) select.innerHTML = html;
}

// Attach cascading change listeners to a form's hierarchy selects.
// Listeners read state.tree dynamically so they stay fresh after refreshes.
function attachCascadingSelects(formId) {
  const form = document.getElementById(formId);
  if (!form) return;

  const orgSel     = form.querySelector('select[name="organization_id"]');
  const branchSel  = form.querySelector('select[name="branch_id"]');
  const projectSel = form.querySelector('select[name="project_id"]');
  const lineSel    = form.querySelector('select[name="line_id"]');
  const stationSel = form.querySelector('select[name="station_id"]');

  const empty = '<option value="">-- select --</option>';
  const reset = (...sels) => sels.forEach(s => { if (s) s.innerHTML = empty; });

  if (orgSel) {
    orgSel.addEventListener('change', () => {
      const flat = flattenTree(state.tree);
      const branches = flat.branches.filter(b => b.organization_id === orgSel.value);
      if (branchSel) branchSel.innerHTML = optionMarkup(branches, 'branch_id', 'name');
      reset(projectSel, lineSel, stationSel);
    });
  }
  if (branchSel) {
    branchSel.addEventListener('change', () => {
      const flat = flattenTree(state.tree);
      const projects = flat.projects.filter(p => p.branch_id === branchSel.value);
      if (projectSel) projectSel.innerHTML = optionMarkup(projects, 'project_id', 'name');
      reset(lineSel, stationSel);
    });
  }
  if (projectSel) {
    projectSel.addEventListener('change', () => {
      const flat = flattenTree(state.tree);
      const lines = flat.lines.filter(l => l.project_id === projectSel.value);
      if (lineSel) lineSel.innerHTML = optionMarkup(lines, 'line_id', 'name');
      reset(stationSel);
    });
  }
  if (lineSel) {
    lineSel.addEventListener('change', () => {
      const flat = flattenTree(state.tree);
      const stations = flat.stations.filter(s => s.line_id === lineSel.value);
      if (stationSel) stationSel.innerHTML = optionMarkup(stations, 'station_id', 'name');
    });
  }
}

function refreshSelects() {
  const flat = flattenTree(state.tree);
  const orgOptions = optionMarkup(flat.organizations, 'organization_id', 'name');
  const empty = '<option value="">-- select --</option>';

  const formIds = ['branch-form', 'project-form', 'line-form', 'station-form', 'user-form', 'device-form'];
  for (const formId of formIds) {
    fillSelect(formId, 'organization_id', orgOptions);
    fillSelect(formId, 'branch_id', empty);
    fillSelect(formId, 'project_id', empty);
    fillSelect(formId, 'line_id', empty);
    fillSelect(formId, 'station_id', empty);
  }
}

function renderTree() {
  const tree = state.tree;
  if (!tree) {
    els.treeView.innerHTML = '<p style="padding:.5rem;color:var(--muted);font-size:.84rem">No data.</p>';
    return;
  }

  const tag = (type, label) => `<span class="tree-tag ${type}">${label}</span>`;

  // A leaf row (no toggle chevron)
  const leafRow = (typeStr, typeLabel, name, code, extra = '') =>
    `<div class="tree-row tree-leaf">${tag(typeStr, typeLabel)}<span class="path">${name} <span class="tree-code">${code}</span></span>${extra}</div>`;

  // A collapsible node — children is an HTML string
  const foldNode = (typeStr, typeLabel, name, code, children, open = false, extra = '') =>
    `<details class="tree-details"${open ? ' open' : ''}>
      <summary class="tree-row">${tag(typeStr, typeLabel)}<span class="path">${name} <span class="tree-code">${code}</span></span>${extra}</summary>
      <div class="tree-children">${children}</div>
    </details>`;

  function buildDevices(devices) {
    return (devices || []).map(d =>
      leafRow('device', 'DEVICE', d.name, d.device_code,
        `<span class="tree-btns"><button class="tree-edit-btn" data-etype="device" data-eid="${d.device_id}" type="button" title="Edit">✎</button></span>`)
    ).join('');
  }

  function buildStations(stations, pathPrefix) {
    return (stations || []).map(s => {
      const key = `${pathPrefix} > ${s.name}`;
      const extra = `<span class="tree-btns"><button class="tree-action-btn" data-station-id="${s.station_id}" data-path="${key}">Set Storage</button><button class="tree-edit-btn" data-etype="station" data-eid="${s.station_id}" type="button" title="Edit">✎</button></span>`;
      const devHtml = buildDevices(s.devices);
      return devHtml
        ? foldNode('station', 'STATION', s.name, s.code, devHtml, false, extra)
        : leafRow('station', 'STATION', s.name, s.code, extra);
    }).join('');
  }

  function buildLines(lines, pathPrefix) {
    return (lines || []).map(l => {
      const extra = `<span class="tree-btns"><button class="tree-edit-btn" data-etype="line" data-eid="${l.line_id}" type="button" title="Edit">✎</button></span>`;
      const stHtml = buildStations(l.stations, `${pathPrefix} > ${l.name}`);
      return stHtml
        ? foldNode('line', 'LINE', l.name, l.code, stHtml, false, extra)
        : leafRow('line', 'LINE', l.name, l.code, extra);
    }).join('');
  }

  function buildProjects(projects, pathPrefix) {
    return (projects || []).map(p => {
      const extra = `<span class="tree-btns"><button class="tree-edit-btn" data-etype="project" data-eid="${p.project_id}" type="button" title="Edit">✎</button></span>`;
      const lnHtml = buildLines(p.lines, `${pathPrefix} > ${p.name}`);
      return lnHtml
        ? foldNode('project', 'PROJECT', p.name, p.code, lnHtml, false, extra)
        : leafRow('project', 'PROJECT', p.name, p.code, extra);
    }).join('');
  }

  function buildBranches(branches, pathPrefix) {
    return (branches || []).map(b => {
      const extra = `<span class="tree-btns"><button class="tree-edit-btn" data-etype="branch" data-eid="${b.branch_id}" type="button" title="Edit">✎</button></span>`;
      const prHtml = buildProjects(b.projects, `${pathPrefix} > ${b.name}`);
      return prHtml
        ? foldNode('branch', 'BRANCH', b.name, b.code, prHtml, false, extra)
        : leafRow('branch', 'BRANCH', b.name, b.code, extra);
    }).join('');
  }

  const orgsHtml = (tree.organizations || []).map(org => {
    const extra = `<span class="tree-btns"><button class="tree-edit-btn" data-etype="org" data-eid="${org.organization_id}" type="button" title="Edit">✎</button></span>`;
    const brHtml = buildBranches(org.branches, org.name);
    return brHtml
      ? foldNode('org', 'ORG', org.name, org.code, brHtml, true, extra)
      : leafRow('org', 'ORG', org.name, org.code, extra);
  }).join('');

  els.treeView.innerHTML = orgsHtml || '<p style="padding:.5rem;color:var(--muted);font-size:.84rem">No hierarchy yet.</p>';

  const users = tree.users || [];
  if (users.length === 0) {
    els.usersView.innerHTML = '<div class="user-row"><span class="user-name" style="color:var(--muted)">No users yet.</span></div>';
  } else {
    els.usersView.innerHTML = users.map((u) => {
      const roleClass = (u.role || '').replace('_', '-');
      const roleLabel = (u.role || '').replace('_', ' ');
      const inactiveTag = u.active === false ? ' <span class="role-badge" style="background:#fee2e2;color:#b91c1c">inactive</span>' : '';
      return `<div class="user-row"><span class="user-name">${u.username}</span><span class="role-badge ${roleClass}">${roleLabel}</span>${inactiveTag}<span class="user-group">${u.user_group || ''}</span><button class="tree-edit-btn" data-etype="user" data-eid="${u.user_id}" type="button" title="Edit user" style="margin-left:auto">✎</button></div>`;
    }).join('');
  }

  for (const btn of els.treeView.querySelectorAll('button[data-station-id]')) {
    const role = state.user?.role || '';
    const canActivateStorage = role === 'super_admin' || role === 'admin';
    btn.style.display = canActivateStorage ? '' : 'none';
    if (!canActivateStorage) continue;

    btn.addEventListener('click', async () => {
      const stationId = btn.dataset.stationId;
      try {
        const result = await fetchJson(`/api/admin/stations/${encodeURIComponent(stationId)}/activate-storage`, {
          method: 'POST',
          headers: headers(),
        });
        setStatus(els.createStatus, `Storage path activated: ${result.storage_path}`, 'ok');
      } catch (error) {
        setStatus(els.createStatus, String(error), 'error');
      }
    });
  }
}

async function loadTree() {
  if (!state.token) return;
  try {
    state.tree = await fetchJson('/api/admin/tree', { headers: headers() });
    refreshSelects();
    applyRoleOptions();
    renderTree();
    if (els.navUser && state.user) {
      els.navUser.textContent = `${state.user.username} · ${state.user.role}`;
    }
    setStatus(els.authStatus, `Logged in as ${state.user?.username || 'user'} (${state.user?.role || 'unknown'})`, 'ok');
  } catch (error) {
    setStatus(els.authStatus, String(error), 'error');
  }
}

function authCard(title, buttonLabel, onSubmit) {
  const form = document.createElement('form');
  form.className = 'login-card';
  form.innerHTML = `
    <h3>${title}</h3>
    <label class="field-label">Username
      <input name="username" placeholder="Username" autocomplete="username" required />
    </label>
    <label class="field-label">Password
      <div class="password-field">
        <input name="password" placeholder="Password" type="password" autocomplete="current-password" required />
        <button type="button" class="btn ghost password-toggle" aria-label="Show password">Show</button>
      </div>
    </label>
    <label class="remember-me"><input name="remember" type="checkbox" /> Remember me</label>
    <button class="btn primary" type="submit">${buttonLabel}</button>
  `;
  const passwordInput = form.querySelector('input[name="password"]');
  const toggleBtn = form.querySelector('.password-toggle');
  toggleBtn?.addEventListener('click', () => {
    const show = passwordInput.type === 'password';
    passwordInput.type = show ? 'text' : 'password';
    toggleBtn.textContent = show ? 'Hide' : 'Show';
    toggleBtn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
  form.addEventListener('submit', onSubmit);
  return form;
}

async function initAuth() {
  const bootstrapState = await fetchJson('/api/admin/bootstrap-state');

  els.bootstrapWrap.innerHTML = '';
  els.loginWrap.innerHTML = '';

  if (!bootstrapState.super_admin_exists) {
    const bootstrapForm = authCard('Bootstrap Super Admin', 'Create Super Admin', async (event) => {
      event.preventDefault();
      const payload = formDataToObject(event.target);
      try {
        await fetchJson('/api/admin/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        setStatus(els.authStatus, 'Super admin created. You can log in now.', 'ok');
        await initAuth();
      } catch (error) {
        setStatus(els.authStatus, String(error), 'error');
      }
    });
    els.bootstrapWrap.appendChild(bootstrapForm);
  }

  const loginForm = authCard('Login', 'Login', async (event) => {
    event.preventDefault();
    const payload = formDataToObject(event.target);
    try {
      const result = await fetchJson('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      state.token = result.token;
      state.expiryEpochMs = Number(result.expires_at_epoch || 0) * 1000;
      state.user = result.user;
      if (state.user?.role === 'engineer') {
        window.location.href = '/';
        return;
      }
      localStorage.setItem('admin_token', state.token);
      localStorage.setItem('admin_expiry_epoch_ms', String(state.expiryEpochMs));
      installSessionTimer();
      applyRoleOptions();
      setDashboardVisible(true);
      setStatus(els.authStatus, 'Authenticated successfully.', 'ok');
      await loadTree();
    } catch (error) {
      setStatus(els.authStatus, String(error), 'error');
    }
  });

  els.loginWrap.appendChild(loginForm);
}

function bindForm(formId, endpoint) {
  const form = document.getElementById(formId);
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.token) {
      setStatus(els.createStatus, 'Login first to create records.', 'error');
      return;
    }

    const payload = formDataToObject(form);
    try {
      await fetchJson(endpoint, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(payload),
      });
      setStatus(els.createStatus, 'Saved successfully.', 'ok');
      form.reset();
      await loadTree();
    } catch (error) {
      setStatus(els.createStatus, String(error), 'error');
    }
  });
}

function bindEvents() {
  els.refreshTreeBtn.addEventListener('click', () => loadTree());
  els.logoutBtn.addEventListener('click', async () => {
    try {
      await fetchJson('/api/admin/logout', {
        method: 'POST',
        headers: headers(),
      });
    } catch (_error) {
    }
    clearAuthState();
    state.user = null;
    state.tree = null;
    setDashboardVisible(false);
    applyRoleOptions();
    renderTree();
    setStatus(els.authStatus, 'Logged out.', '');
  });

  bindForm('org-form', '/api/admin/organizations');
  bindForm('branch-form', '/api/admin/branches');
  bindForm('project-form', '/api/admin/projects');
  bindForm('line-form', '/api/admin/lines');
  bindForm('station-form', '/api/admin/stations');
  bindForm('user-form', '/api/admin/users');
  bindForm('device-form', '/api/admin/devices');

  for (const btn of document.querySelectorAll('.tab-btn')) {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  }

  // Attach cascading dropdown listeners once; they read state.tree at event time
  for (const formId of ['branch-form', 'project-form', 'line-form', 'station-form', 'user-form', 'device-form']) {
    attachCascadingSelects(formId);
  }

  // Edit modal
  if (els.editForm) {
    els.editForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const type = els.editForm.dataset.etype;
      const id = els.editForm.dataset.eid;
      const payload = formDataToObject(els.editForm);
      if (type === 'user' && payload.active !== null) {
        payload.active = payload.active === 'true';
      }
      const endpoints = {
        org:     `/api/admin/organizations/${id}`,
        branch:  `/api/admin/branches/${id}`,
        project: `/api/admin/projects/${id}`,
        line:    `/api/admin/lines/${id}`,
        station: `/api/admin/stations/${id}`,
        device:  `/api/admin/devices/${id}`,
        user:    `/api/admin/users/${id}`,
      };
      try {
        await fetchJson(endpoints[type], {
          method: 'PUT',
          headers: headers(),
          body: JSON.stringify(payload),
        });
        setStatus(els.editModalStatus, 'Saved successfully.', 'ok');
        setTimeout(() => els.editModal?.close(), 900);
        await loadTree();
      } catch (err) {
        setStatus(els.editModalStatus, String(err), 'error');
      }
    });
  }
  if (els.editModalClose) els.editModalClose.addEventListener('click', () => els.editModal.close());
  if (els.editCancelBtn) els.editCancelBtn.addEventListener('click', () => els.editModal.close());

  // Delegate edit-button clicks from tree and users views
  [els.treeView, els.usersView].forEach(container => {
    if (!container) return;
    container.addEventListener('click', event => {
      const btn = event.target.closest('[data-etype]');
      if (btn) openEditModal(btn.dataset.etype, btn.dataset.eid);
    });
  });
}

(async function init() {
  setDashboardVisible(false);
  applyRoleOptions();
  bindEvents();
  await initAuth();
  if (state.token && state.expiryEpochMs && Date.now() < state.expiryEpochMs) {
    try {
      installSessionTimer();
      const me = await fetchJson('/api/admin/me', { headers: headers() });
      state.user = me.user;
      if (state.user?.role === 'engineer') {
        window.location.href = '/';
        return;
      }
      applyRoleOptions();
      setDashboardVisible(true);
      state.tree = await fetchJson('/api/admin/tree', { headers: headers() });
      refreshSelects();
      renderTree();
      if (els.navUser && state.user) {
        els.navUser.textContent = `${state.user.username} · ${state.user.role}`;
      }
      setStatus(els.authStatus, 'Session restored.', 'ok');
    } catch (_error) {
      clearAuthState();
    }
  } else if (state.token && state.expiryEpochMs && Date.now() >= state.expiryEpochMs) {
    clearAuthState();
  }
})();
