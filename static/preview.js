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
  gotoBtn: document.getElementById('goto-step-btn'),
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
  stepLoader: document.getElementById('step-loader'),
  contentArea: document.querySelector('.preview-content-area'),
};

// ── Field group definitions ─────────────────────────────────────────────────
const BARCODE_KEYS   = ['bc_title','bc_parent','bc_child','whatloc_enabled',
                        'enable_barcode_mes_t','enable_barcode_mes_nt',
                        'restart_on_failure','reg_ex_validator'];
const WHATLOC_KEYS   = ['check_short_workstation','check_part_number','check_ref_designator'];
const ACK_KEYS       = ['ack_title','enable_ack_mes'];
const FASTENING_KEYS = ['target_preset','target_torque','target_angle',
                        'target_min_angle','target_max_angle','target_tolerance','target_rpm',
                        'TC_AM','AC_TM','screw_info','mes_enable_assy',
                        'snug_torque','free_fastening_angle','soft_start',
                        'free_fastening_speed','torque_rising_rate',
                        'seating_point','ramp_up_speed','torque_compensation'];

const MODE_STYLES = {
  'Barcode':          { bg: '#FF7733', color: '#ffffff' },
  'Acknowledgement':  { bg: '#232629', color: '#ffffff' },
  'Fastening':        { bg: '#232629', color: '#FF7733' },
  'No mode selected': { bg: '#f0f0f0', color: '#232629' },
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function setLoadPartStatus(msg, type) {
  if (!els.loadPartStatus) return;
  els.loadPartStatus.textContent = msg || '';
  els.loadPartStatus.className = ('recipe-status ' + (type || '')).trim();
}
function setReorderStatus(msg, type) {
  if (!els.reorderStatus) return;
  els.reorderStatus.textContent = msg || '';
  els.reorderStatus.className = ('recipe-status ' + (type || '')).trim();
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
  const n = payload && payload.program ? payload.program : payload;
  if (!n || typeof n !== 'object') return { partname: '', steps: [] };
  if (!Array.isArray(n.steps)) n.steps = [];
  return n;
}
function sanitizePartFolder(value) {
  return String(value || '').trim().split('')
    .map(ch => (/^[a-zA-Z0-9_-]$/.test(ch) ? ch : '_')).join('')
    .replace(/^[_.]+|[_.]+$/g, '') || 'program';
}
function resolveStepImage(step) {
  const src = String((step && step.upload_image) || '').trim();
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
function formatFieldKey(key) {
  return String(key || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function showStepLoader(visible) {
  if (els.stepLoader) els.stepLoader.style.display = visible ? 'block' : 'none';
  if (els.contentArea) els.contentArea.style.display = visible ? 'none' : '';
}

/**
 * Returns an ordered list of [key, value] pairs to display for a step.
 * - Always: step_no, remarks
 * - Mode fields: barcode / ack / fastening
 * - Whatloc sub-fields: only when whatloc_enabled == true (inside barcode section)
 */
function getVisibleFields(step) {
  const out = [];
  // Common
  if (step.step_no !== undefined && step.step_no !== '') out.push(['step_no', step.step_no]);
  if (step.remarks !== undefined && step.remarks !== '') out.push(['remarks', step.remarks]);

  // Mode-specific
  if (step.enable_barcode) {
    for (const k of BARCODE_KEYS) {
      if (k in step) out.push([k, step[k]]);
      if (k === 'whatloc_enabled' && step.whatloc_enabled) {
        for (const wk of WHATLOC_KEYS) {
          if (wk in step) out.push([wk, step[wk]]);
        }
      }
    }
  } else if (step.request_ack) {
    for (const k of ACK_KEYS) {
      if (k in step) out.push([k, step[k]]);
    }
  } else if (step.enable_fastening) {
    for (const k of FASTENING_KEYS) {
      if (k in step) out.push([k, step[k]]);
    }
  }
  return out;
}

// ── Render step ──────────────────────────────────────────────────────────────
function renderStep() {
  const steps = (state.program && state.program.steps) || [];
  if (!steps.length) {
    els.stepTitle.textContent = 'No steps';
    els.mode.textContent = '';
    els.mode.style.cssText = '';
    els.fields.innerHTML = '';
    els.imageWrap.classList.add('hidden');
    els.count.textContent = '0 / 0';
    els.spinner.max = '1';
    els.spinner.value = '1';
    return;
  }

  const step = steps[state.index];
  const label = modeLabel(step);
  const modeStyle = MODE_STYLES[label] || MODE_STYLES['No mode selected'];

  els.stepTitle.textContent = 'Step ' + (step.step_no || state.index + 1);
  els.mode.textContent = label;
  els.mode.style.background = modeStyle.bg;
  els.mode.style.color = modeStyle.color;
  els.count.textContent = (state.index + 1) + ' / ' + steps.length;
  els.spinner.max = String(steps.length);
  els.spinner.value = String(state.index + 1);

  // Image
  const resolvedImage = resolveStepImage(step);
  if (resolvedImage) {
    els.image.onload  = () => { els.imageWrap.classList.remove('hidden'); showStepLoader(false); };
    els.image.onerror = () => { els.image.removeAttribute('src'); els.imageWrap.classList.add('hidden'); showStepLoader(false); };
    els.image.src = resolvedImage;
  } else {
    els.image.removeAttribute('src');
    els.imageWrap.classList.add('hidden');
    showStepLoader(false);
  }

  // Build structured field list
  const visibleFields = getVisibleFields(step);
  const boolFields = visibleFields.filter(([, v]) => typeof v === 'boolean');
  const textFields = visibleFields.filter(([, v]) => typeof v !== 'boolean');

  els.fields.innerHTML = '';

  // Boolean grid — 3 per row, colored checkboxes
  if (boolFields.length) {
    const boolGrid = document.createElement('div');
    boolGrid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px;';
    for (const [k, v] of boolFields) {
      const cell = document.createElement('div');
      cell.style.cssText = 'display:flex;align-items:center;gap:5px;padding:5px 8px;border-radius:6px;font-size:12px;font-weight:600;' +
        (v ? 'background:rgba(255,119,51,.12);color:#FF7733;' : 'background:rgba(35,38,41,.08);color:#232629;');
      const icon = document.createElement('span');
      icon.style.cssText = 'font-size:14px;line-height:1;';
      icon.innerHTML = v ? '&#x2611;' : '&#x2610;';
      const lbl = document.createElement('span');
      lbl.textContent = formatFieldKey(k);
      lbl.style.lineHeight = '1.2';
      cell.append(icon, lbl);
      boolGrid.appendChild(cell);
    }
    els.fields.appendChild(boolGrid);
  }

  // Text fields
  for (const [k, v] of textFields) {
    const card = document.createElement('div');
    card.className = 'preview-field';
    card.innerHTML = '<span class="k">' + formatFieldKey(k) + '</span><span class="v">' + String(v) + '</span>';
    els.fields.appendChild(card);
  }

  els.prevBtn.disabled = state.index === 0;
  els.nextBtn.disabled = state.index === steps.length - 1;
}

// ── Reorder list ─────────────────────────────────────────────────────────────
function renderReorderList() {
  if (!els.reorderList) return;
  const steps = (state.program && state.program.steps) || [];
  els.reorderList.innerHTML = '';
  steps.forEach((step, i) => {
    const li = document.createElement('li');
    li.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 4px;' +
      (i === state.index ? 'background:rgba(255,119,51,.08);border-radius:4px;' : '');
    const lbl = document.createElement('span');
    lbl.style.cssText = 'flex:1;font-size:13px;cursor:pointer;';
    lbl.textContent = 'Step ' + (step.step_no || i + 1) + ' \u2014 ' + modeLabel(step);
    lbl.addEventListener('click', () => goto(i));
    const upBtn = document.createElement('button');
    upBtn.type = 'button'; upBtn.className = 'secondary'; upBtn.textContent = '\u25b2';
    upBtn.style.cssText = 'padding:2px 6px;font-size:11px;min-width:0;'; upBtn.disabled = i === 0;
    upBtn.addEventListener('click', () => moveStep(i, i - 1));
    const downBtn = document.createElement('button');
    downBtn.type = 'button'; downBtn.className = 'secondary'; downBtn.textContent = '\u25bc';
    downBtn.style.cssText = 'padding:2px 6px;font-size:11px;min-width:0;'; downBtn.disabled = i === steps.length - 1;
    downBtn.addEventListener('click', () => moveStep(i, i + 1));
    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'danger'; delBtn.textContent = '\ud83d\uddd1';
    delBtn.style.cssText = 'padding:2px 6px;font-size:11px;min-width:0;';
    delBtn.addEventListener('click', () => deleteStepLocal(i));
    li.append(lbl, upBtn, downBtn, delBtn);
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
  setReorderStatus('Reordered \u2014 click Save Changes to persist.', '');
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
  setReorderStatus('Step deleted \u2014 click Save Changes to persist.', '');
  renderReorderList();
  renderStep();
}

function renumberSteps(steps) {
  steps.forEach((s, i) => {
    s.step_no  = i + 1;
    s.bc_parent = (i === 0);
    s.bc_child  = (i !== 0);
  });
}

// ── Save changes ─────────────────────────────────────────────────────────────
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

// ── Navigation ────────────────────────────────────────────────────────────────
function goto(index) {
  const steps = (state.program && state.program.steps) || [];
  if (!steps.length) return;
  const newIdx = Math.max(0, Math.min(index, steps.length - 1));
  if (newIdx === state.index) { renderStep(); renderReorderList(); return; }
  showStepLoader(true);
  state.index = newIdx;
  requestAnimationFrame(() => { renderStep(); renderReorderList(); });
}

// ── Program loading ───────────────────────────────────────────────────────────
async function refreshProgramSelect() {
  if (!els.loadRecipeSelect) return;
  try {
    const resp = await fetch('/api/programs');
    if (!resp.ok) return;
    const payload = await resp.json();
    const programs = Array.isArray(payload.programs) ? payload.programs : [];
    els.loadRecipeSelect.innerHTML = '<option value="">-- Select Program --</option>' +
      programs.map(n => '<option value="' + n + '">' + n.replace(/\.json$/i, '') + '</option>').join('');
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
    els.partname.textContent = (state.program && state.program.partname) || programFile.replace(/\.json$/i, '');
    clearDirty();
    setReorderStatus('', '');
    goto(0);
    setLoadPartStatus('Loaded: ' + programFile.replace(/\.json$/i, ''), 'ok');
    renderReorderList();
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

// ── Event binding ─────────────────────────────────────────────────────────────
function bindEvents() {
  els.prevBtn.addEventListener('click', () => goto(state.index - 1));
  els.nextBtn.addEventListener('click', () => goto(state.index + 1));
  els.spinner.addEventListener('change', () => goto(Number(els.spinner.value) - 1));
  if (els.gotoBtn) els.gotoBtn.addEventListener('click', () => goto(Number(els.spinner.value) - 1));
  if (els.refreshBtn) {
    els.refreshBtn.addEventListener('click', async () => {
      if (state.dirty && !confirm('Discard unsaved changes?')) return;
      const current = state.index;
      await loadCurrentProgram();
      goto(current);
    });
  }
  if (els.saveChangesBtn) els.saveChangesBtn.addEventListener('click', saveChanges);
  if (els.loadPartBtn) els.loadPartBtn.addEventListener('click', loadPartFromSelect);
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
  // Access guard: only allow entry from Recipe Management
  const fromRM = sessionStorage.getItem('rm_auto_load');
  const sessionActive = sessionStorage.getItem('rm_recipe_active');
  if (!fromRM && !sessionActive) {
    window.location.replace('/recipe-management');
    return;
  }
  sessionStorage.removeItem('rm_auto_load');
  sessionStorage.setItem('rm_recipe_active', '1');

  bindEvents();
  await refreshProgramSelect();
  try {
    await loadCurrentProgram();
    renderReorderList();
  } catch (err) {
    els.stepTitle.textContent = 'Unable to load preview';
    els.mode.textContent = String(err);
  }
})();