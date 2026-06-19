'use strict';

const tbody   = document.getElementById('rm-tbody');
const statusEl = document.getElementById('rm-status');
const searchEl = document.getElementById('rm-search');

// Name modal (shared by rename + duplicate)
const nameModal   = document.getElementById('name-modal');
const nameTitle   = document.getElementById('name-modal-title');
const nameDesc    = document.getElementById('name-modal-desc');
const nameInput   = document.getElementById('name-modal-input');
const nameCancel  = document.getElementById('name-modal-cancel');
const nameConfirm = document.getElementById('name-modal-confirm');

// Delete modal
const deleteModal   = document.getElementById('delete-modal');
const deleteBody    = document.getElementById('delete-modal-body');
const deleteCancel  = document.getElementById('delete-modal-cancel');
const deleteConfirm = document.getElementById('delete-modal-confirm');

// Create modal
const createModal   = document.getElementById('create-modal');
const createInput   = document.getElementById('create-modal-input');
const createError   = document.getElementById('create-modal-error');
const createCancel  = document.getElementById('create-modal-cancel');
const createConfirm = document.getElementById('create-modal-confirm');

document.getElementById('create-recipe-btn').addEventListener('click', () => {
  createInput.value = '';
  createError.textContent = '';
  createModal.classList.add('open');
  setTimeout(() => createInput.focus(), 80);
});

createCancel.addEventListener('click', () => createModal.classList.remove('open'));
createModal.addEventListener('click', (e) => { if (e.target === createModal) createModal.classList.remove('open'); });

createInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') createConfirm.click(); });

createConfirm.addEventListener('click', async () => {
  const partname = createInput.value.trim();
  if (!partname) { createError.textContent = 'Part name is required.'; return; }
  createError.textContent = '';
  createConfirm.disabled = true;
  try {
    const resp = await fetch('/api/recipes/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partname }),
    });
    const data = await resp.json();
    if (!resp.ok) { createError.textContent = data.detail || `Error ${resp.status}`; return; }
    createModal.classList.remove('open');
    setStatus(`Recipe "${data.partname}" created.`, 'ok');
    await loadRecipes();
  } catch (e) {
    createError.textContent = `Failed: ${e}`;
  } finally {
    createConfirm.disabled = false;
  }
});



let allRecipes = [];
let pendingNameAction = null; // { type: 'rename'|'duplicate', file, partname }
let pendingDeleteFile = null;

function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = type || '';
}

// ── Fetch & render ────────────────────────────────────────────────────────────

async function loadRecipes() {
  try {
    const resp = await fetch('/api/recipes');
    if (!resp.ok) throw new Error(`Server error ${resp.status}`);
    const data = await resp.json();
    allRecipes = data.recipes || [];
    renderTable(allRecipes);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Failed to load recipes.</td></tr>`;
  }
}

function renderTable(recipes) {
  if (!recipes.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No recipes found.</td></tr>`;
    return;
  }
  tbody.innerHTML = recipes.map((r) => `
    <tr data-file="${esc(r.file)}">
      <td>${esc(r.partname)}</td>
      <!--<td style="color:#6b7a95;font-size:.82rem;">${esc(r.file)}</td> -->
      <td><span class="step-badge">${r.steps} step${r.steps !== 1 ? 's' : ''}</span></td>
      <td>
        <div class="rm-actions">
          <button class="primary btn-edit" data-file="${esc(r.file)}" data-partname="${esc(r.partname)}">Edit</button>
          <button class="secondary btn-preview" data-file="${esc(r.file)}" data-partname="${esc(r.partname)}">Preview</button>
         
          <button class="secondary btn-rename" data-file="${esc(r.file)}" data-partname="${esc(r.partname)}">Rename</button>
          <button class="secondary btn-duplicate" data-file="${esc(r.file)}" data-partname="${esc(r.partname)}">Duplicate</button>
          <button class="danger btn-delete" data-file="${esc(r.file)}" data-partname="${esc(r.partname)}">Delete</button>
        <a class="secondary" href="/api/recipes/${esc(r.file)}/download" download>↓ Recipie (.zip)</a>
          <a class="secondary" href="/api/recipes/${esc(r.file)}/pdf" download>↓ Step(.pdf)</a>
          <a class="secondary" href="/api/recipes/${esc(r.file)}/wi" download>↓ Work Instructions(.pdf)</a>
        </div>
      </td>
    </tr>`).join('');
  attachRowListeners();
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Load & navigate ───────────────────────────────────────────────────────────

async function loadAndGo(file, destination) {
  setStatus('Loading recipe…', '');
  try {
    const resp = await fetch(`/api/programs/${encodeURIComponent(file)}`, { method: 'POST' });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      setStatus(err.detail || `Error ${resp.status}`, 'error');
      return;
    }
    // Signal the destination page to read from server state
    sessionStorage.setItem('rm_auto_load', '1');
    window.location.href = destination;
  } catch (e) {
    setStatus(`Failed to load recipe: ${e}`, 'error');
  }
}

function attachRowListeners() {
  tbody.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', () => loadAndGo(btn.dataset.file, '/editor'));
  });
  tbody.querySelectorAll('.btn-preview').forEach((btn) => {
    btn.addEventListener('click', () => loadAndGo(btn.dataset.file, '/preview'));
  });
  tbody.querySelectorAll('.btn-rename').forEach((btn) => {
    btn.addEventListener('click', () => openNameModal('rename', btn.dataset.file, btn.dataset.partname));
  });
  tbody.querySelectorAll('.btn-duplicate').forEach((btn) => {
    btn.addEventListener('click', () => openNameModal('duplicate', btn.dataset.file, btn.dataset.partname));
  });
  tbody.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', () => openDeleteModal(btn.dataset.file, btn.dataset.partname));
  });
}

// ── Search ────────────────────────────────────────────────────────────────────

searchEl.addEventListener('input', () => {
  const q = searchEl.value.trim().toLowerCase();
  renderTable(q ? allRecipes.filter((r) => r.partname.toLowerCase().includes(q) || r.file.toLowerCase().includes(q)) : allRecipes);
});

// ── Name modal (rename / duplicate) ──────────────────────────────────────────

function openNameModal(type, file, partname) {
  pendingNameAction = { type, file, partname };
  nameTitle.textContent = type === 'rename' ? 'Rename Recipe' : 'Duplicate Recipe';
  nameDesc.textContent  = type === 'rename'
    ? `Enter a new name for "${partname}".`
    : `Enter a name for the copy of "${partname}".`;
  nameInput.value = type === 'duplicate' ? `${partname}_copy` : partname;
  nameModal.classList.add('open');
  setTimeout(() => { nameInput.focus(); nameInput.select(); }, 50);
}

nameCancel.addEventListener('click', () => { nameModal.classList.remove('open'); pendingNameAction = null; });
nameModal.addEventListener('click', (e) => { if (e.target === nameModal) { nameModal.classList.remove('open'); pendingNameAction = null; } });

nameConfirm.addEventListener('click', async () => {
  if (!pendingNameAction) return;
  const newName = nameInput.value.trim();
  if (!newName) { nameInput.focus(); return; }

  const { type, file } = pendingNameAction;
  nameModal.classList.remove('open');
  pendingNameAction = null;
  setStatus(`${type === 'rename' ? 'Renaming' : 'Duplicating'}…`, '');

  try {
    const resp = await fetch(`/api/recipes/${encodeURIComponent(file)}/${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_name: newName }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      setStatus(err.detail || `Error ${resp.status}`, 'error');
      return;
    }
    setStatus(`${type === 'rename' ? 'Renamed' : 'Duplicated'} successfully.`, 'ok');
    await loadRecipes();
  } catch (e) {
    setStatus(`Failed: ${e}`, 'error');
  }
});

nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameConfirm.click(); });

// ── Delete modal ──────────────────────────────────────────────────────────────

function openDeleteModal(file, partname) {
  pendingDeleteFile = file;
  deleteBody.textContent = `This will permanently remove "${partname}" and all its images. Continue?`;
  deleteModal.classList.add('open');
}

deleteCancel.addEventListener('click', () => { deleteModal.classList.remove('open'); pendingDeleteFile = null; });
deleteModal.addEventListener('click', (e) => { if (e.target === deleteModal) { deleteModal.classList.remove('open'); pendingDeleteFile = null; } });

deleteConfirm.addEventListener('click', async () => {
  if (!pendingDeleteFile) return;
  const file = pendingDeleteFile;
  deleteModal.classList.remove('open');
  pendingDeleteFile = null;
  setStatus('Deleting…', '');

  try {
    const resp = await fetch(`/api/recipes/${encodeURIComponent(file)}`, { method: 'DELETE' });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      setStatus(err.detail || `Error ${resp.status}`, 'error');
      return;
    }
    setStatus('Recipe deleted.', 'ok');
    await loadRecipes();
  } catch (e) {
    setStatus(`Failed: ${e}`, 'error');
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadRecipes();
