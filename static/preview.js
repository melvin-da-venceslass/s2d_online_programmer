const state = {
  program: null,
  index: 0,
  dirty: false,
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
  saveChangesBtn: document.getElementById('save-changes-btn'),
  loadRecipeSelect: document.getElementById('preview-load-recipe-select'),
  loadPartBtn: document.getElementById('preview-load-part-btn'),
  loadPartStatus: document.getElementById('preview-load-part-status'),
  reorderList: document.getElementById('reorder-list'),
  reorderStatus: document.getElementById('reorder-status'),
  toggleReorderBtn: document.getElementById('toggle-reorder-btn'),
  reorderContent: document.getElementById('reorder-content'),
};

const HIDDEN_KEYS = new Set(['step_no']);

function setLoadPartStatus(msg, type = '') {
  if (!els.loadPartStatus) return;
  els.loadPartStatus.textContent = msg || '';
  els.loadPartStatus.className = ('recipe-status ' + type).trim();
}

function setReorderStatus(msg, type = '') {
  if (!els.reorderStatus) return;
  els.reorderStatus.textContent = msg || '';
  els.reorderStatus.className = ('recipe-status ' + type).trim();
}

function markDirty() {
  state.dirty = true;
  if (els.saveChangesBtn) els.saveChangesBtn.disabled = false;
}

function clearDirty() {
  state.dirty = false;
  if (els.saveChangesBtn) els.saveChangesBtn.disabled = true;
}

function normalizeProgramPayload(payload) {
  const normalized = payload && payload.program ? payload.program : payload;
  if (!normalized || typeof normalized !== 'object') return { partname: '', steps: [] };
  if (!Array.isArray(normalized.steps)) normalized.steps = [];
  return normalized;
}

function sanitizePartFolder(value) {
  return String(value || '').trim()
    .split('').map(ch => (/^[a-zA-Z0-9_-]$/.test(ch) ? ch : '_')).join('')
    .replace(/^[_.]+|[_.]+$/g, '') || 'program';
}

function resolveStepImage(step) {
  const src = String(step && step.upload_image || '').trim();
  if (!src) return '';
  if (src.startsWith('data:image') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/')) return src;
  const n = src.replace(/\\/g, '/');
  if (n.startsWith('programs/')) return '/' + n;
  if (/^[^/]+\/(imgs\/)?[^/]+\.(jpg|jpeg|png|gif|webp)$/i.test(n)) return '/programs/' + n;
  if (/^[^/]+\.(jpg|jpeg|png|gif|webp)$/i.test(n)) return '/programs/' + sanitizePartFolder(state.program && state.program.partname) + '/imgs/' + n;
  return '/' + n.replace(/^\/+/, '');
}

function modeLabel(step) {
  if (step.enable_barcode) return 'Barcode';
  if (step.request_ack) return 'Acknowledgement';
  if (step.enable_fastening) return 'Fastening';
  return 'No mode selected';
}

function displayValue(v) {
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (v === null || v === undefined || v === '') return 'NA';
  return String(v);
}

function formatFieldKey(key) {
  return String(key || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function visibleEntries(step) {
  return Object.entries(step)
    .filter(([k, v]) => !HIDDEN_KEYS.has(k) && k !== 'upload_image' && v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => ({ key: formatFieldKey(k), value: displayValue(v) }));
}

function renderStep() {
  const steps = (state.program && state.program.steps) || [];
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
  els.stepTitle.textContent = 'Step ' + (step.step_no || state.index + 1);
  els.mode.textContent = modeLabel(step);
  els.count.textContent = (state.index + 1) + ' / ' + steps.length;
  els.spinner.max = String(steps.length);
  els.spinner.value = String(state.index + 1);

  const resolvedImage = resolveStepImage(step);
  if (resolvedImage) {
    els.image.onload = () => els.imageWrap.classList.remove('hidden');
    els.image.onerror = () => { els.image.removeAttribute('src'); els.imageWrap.classList.add('hidden'); };
    els.image.src = resolvedImage;
  } else {
    els.image.removeAttribute('src');
    els.imageWrap.classList.add('hidden');
  }

  els.fields.innerHTML = '';
  for (const entry of visibleEntries(step)) {
    const card = document.createElement('div');
    card.className = 'preview-field';
    card.innerHTML = '<span class="k">' + entry.key + '</span><span class="v">' + entry.value + '</span>';
    els.fields.appendChild(card);
  }

  els.prevBtn.disabled = state.index === 0;
  els.nextBtn.disabled = state.index === steps.length - 1;
}

function renderReorderList() {
  if (!els.reorderList) return;
  const steps = (state.program && state.program.steps) || [];
  els.reorderList.innerHTML = '';

  steps.forEach((step, i) => {
    const li = document.createElement('li');
    li.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 4px;';
    if (i === state.index) li.style.background = 'var(--color-accent-light, #eef3ff)';

    const label = document.createElement('span');
    label.style.cssText = 'flex:1;font-size:13px;cursor:pointer;';
    label.textContent = 'Step ' + (step.step_no || i + 1) + ' — ' + modeLabel(step);
    label.addEventListener('click', () => goto(i));

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'secondary';
    upBtn.textContent = '▲';
    upBtn.style.cssText = 'padding:2px 6px;font-size:11px;min-width:0;';
    upBtn.disabled = i === 0;
    upBtn.title = 'Move up';
    upBtn.addEventListener('click', () => moveStep(i, i - 1));

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'secondary';
    downBtn.textContent = '▼';
    downBtn.style.cssText = 'padding:2px 6px;font-size:11px;min-width:0;';
    downBtn.disabled = i === steps.length - 1;
    downBtn.title = 'Move down';
    downBtn.addEventListener('click', () => moveStep(i, i + 1));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'danger';
    delBtn.textContent = '🗑';
    delBtn.style.cssText = 'padding:2px 6px;font-size:11px;min-width:0;';
    delBtn.title = 'Delete step';
    delBtn.addEventListener('click', () => deleteStepLocal(i));

    li.append(label, upBtn, downBtn, delBtn);
    els.reorderList.appendChild(li);
  });
}

function moveStep(fromIdx, toIdx) {
  const steps = (state.program && state.program.steps) || [];
  if (toIdx < 0 || toIdx >= steps.length) return;
  const moved = steps.splice(fromIdx, 1)[0];
  steps.splice(toIdx, 0, moved);
  renumberSteps(steps);
  if (state.index === fromIdx) state.index = toIdx;
  else if (fromIdx < toIdx && state.index > fromIdx && state.index <= toIdx) state.index--;
  else if (fromIdx > toIdx && state.index >= toIdx && state.index < fromIdx) state.index++;
  markDirty();
  setReorderStatus('Reordered — click Save Changes to persist.', '');
  renderReorderList();
  renderStep();
}

function deleteStepLocal(idx) {
  const steps = (state.program && state.program.steps) || [];
  if (steps.length <= 1) { setReorderStatus('Cannot delete the last step.', 'error'); return; }
  if (!confirm('Delete Step ' + (steps[idx].step_no || idx + 1) + '?')) return;
  steps.splice(idx, 1);
  renumberSteps(steps);
  if (state.index >= steps.length) state.index = steps.length - 1;
  markDirty();
  setReorderStatus('Step deleted — click Save Changes to persist.', '');
  renderReorderList();
  renderStep();
}

function renumberSteps(steps) {
  steps.forEach((s, i) => {
    s.step_no = i + 1;
    s.bc_parent = (i === 0);
    s.bc_child = (i !== 0);
  });
}

async function saveChanges() {
  if (!state.program) return;
  try {
    if (els.saveChangesBtn) { els.saveChangesBtn.disabled = true; els.saveChangesBtn.textContent = 'Saving...'; }
    const resp = await fetch('/api/program', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.program),
    });
    if (!resp.ok) { setReorderStatus('Save failed: ' + await resp.text(), 'error'); return; }
    const payload = await resp.json();
    state.program = normalizeProgramPayload(payload);
    clearDirty();
    setReorderStatus('Saved successfully.', 'ok');
    renderReorderList();
    renderStep();
  } catch (err) {
    setReorderStatus('Save error: ' + err, 'error');
  } finally {
    if (els.saveChangesBtn) els.saveChangesBtn.textContent = 'Save Changes';
  }
}

function goto(index) {
  const steps = (state.program && state.program.steps) || [];
  if (!steps.length) return;
  state.index = Math.max(0, Math.min(index, steps.length - 1));
  renderStep();
  renderReorderList();
}

async function refreshProgramSelect() {
  if (!els.loadRecipeSelect) return;
  try {
    const resp = await fetch('/api/programs');
    if (!resp.ok) return;
    const payload = await resp.json();
    const programs = Array.isArray(payload.programs) ? payload.programs : [];
    els.loadRecipeSelect.innerHTML = '<option value="">-- Select Program --</option>' +
      programs.map(name => '<option value="' + name + '">' + name.replace(/\.json$/i, '') + '</option>').join('');
  } catch (_) {}
}

async function loadPartFromSelect() {
  const programFile = els.loadRecipeSelect && els.loadRecipeSelect.value;
  if (!programFile) { setLoadPartStatus('Select a program first.', 'error'); return; }
  if (state.dirty && !confirm('You have unsaved changes. Discard and load?')) return;
  try {
    setLoadPartStatus('Loading...', '');
    const resp = await fetch('/api/programs/' + encodeURIComponent(programFile), { method: 'POST' });
    if (!resp.ok) { setLoadPartStatus('Failed: ' + await resp.text(), 'error'); return; }
    const payload = await resp.json();
    state.program = normalizeProgramPayload(payload);
    els.partname.textContent = state.program.partname || programFile;
    clearDirty();
    setReorderStatus('', '');
    goto(0);
    setLoadPartStatus('Loaded: ' + programFile.replace(/\.json$/i, ''), 'ok');
  } catch (err) {
    setLoadPartStatus('Error: ' + err, 'error');
  }
}

async function loadCurrentProgram() {
  const resp = await fetch('/api/program');
  if (!resp.ok) throw new Error('Failed to load current program');
  const payload = await resp.json();
  state.program = normalizeProgramPayload(payload);
  els.partname.textContent = (state.program && state.program.partname) || 'Program';
  clearDirty();
  goto(0);
}

function bindEvents() {
  els.prevBtn.addEventListener('click', () => goto(state.index - 1));
  els.nextBtn.addEventListener('click', () => goto(state.index + 1));
  els.spinner.addEventListener('change', () => goto(Number(els.spinner.value) - 1));

  if (els.refreshBtn) {
    els.refreshBtn.addEventListener('click', async () => {
      if (state.dirty && !confirm('Discard unsaved changes?')) return;
      const current = state.index;
      await loadCurrentProgram();
      goto(current);
    });
  }

  if (els.saveChangesBtn) {
    els.saveChangesBtn.addEventListener('click', saveChanges);
  }

  if (els.loadPartBtn) {
    els.loadPartBtn.addEventListener('click', loadPartFromSelect);
  }

  if (els.toggleReorderBtn && els.reorderContent) {
    els.toggleReorderBtn.addEventListener('click', () => {
      const collapsed = els.reorderContent.hidden;
      els.reorderContent.hidden = !collapsed;
      els.toggleReorderBtn.textContent = collapsed ? 'Collapse' : 'Expand';
      els.toggleReorderBtn.setAttribute('aria-expanded', String(collapsed));
    });
  }
}

(async function init() {
  bindEvents();
  await refreshProgramSelect();
  try {
    await loadCurrentProgram();
  } catch (err) {
    els.stepTitle.textContent = 'Unable to load preview';
    els.mode.textContent = String(err);
  }
})();