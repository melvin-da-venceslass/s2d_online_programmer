const state = {
  program: null,
  index: 0,
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
};

const HIDDEN_KEYS = new Set(['step_no']);

function sanitizePartFolder(value) {
  const cleaned = String(value || '')
    .trim()
    .split('')
    .map((ch) => (/^[a-zA-Z0-9_-]$/.test(ch) ? ch : '_'))
    .join('')
    .replace(/^[_\.]+|[_\.]+$/g, '');
  return cleaned || 'program';
}

function resolveStepImage(step) {
  const src = step?.upload_image;
  if (typeof src === 'string' && src.trim()) {
    if (src.startsWith('data:image') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/')) {
      return src;
    }
    return `/${src.replace(/^\/+/, '')}`;
  }
  const partFolder = sanitizePartFolder(state.program?.partname);
  return `/programs/${partFolder}/${step.step_no}.jpg`;
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

function visibleEntries(step) {
  return Object.entries(step)
    .filter(([k, v]) => !HIDDEN_KEYS.has(k) && k !== 'upload_image' && v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => ({ key: k, value: displayValue(v) }));
}

function renderStep() {
  const steps = state.program?.steps || [];
  if (!steps.length) {
    els.stepTitle.textContent = 'No steps';
    els.mode.textContent = '';
    els.fields.innerHTML = '';
    els.imageWrap.classList.add('hidden');
    els.count.textContent = '0 / 0';
    return;
  }

  const step = steps[state.index];
  els.stepTitle.textContent = `Step ${step.step_no}`;
  els.mode.textContent = modeLabel(step);
  els.count.textContent = `${state.index + 1} / ${steps.length}`;
  els.spinner.max = String(steps.length);
  els.spinner.value = String(state.index + 1);

  const resolvedImage = resolveStepImage(step);
  els.image.onload = () => {
    els.imageWrap.classList.remove('hidden');
  };
  els.image.onerror = () => {
    els.image.removeAttribute('src');
    els.imageWrap.classList.add('hidden');
  };
  els.image.src = resolvedImage;

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

async function loadProgram() {
  const resp = await fetch('/api/program');
  if (!resp.ok) {
    throw new Error('Failed to load program');
  }
  state.program = await resp.json();
  els.partname.textContent = state.program.partname || 'Program';
  goto(0);
}

function bindEvents() {
  els.prevBtn.addEventListener('click', () => goto(state.index - 1));
  els.nextBtn.addEventListener('click', () => goto(state.index + 1));
  els.spinner.addEventListener('change', () => goto(Number(els.spinner.value) - 1));
  els.refreshBtn.addEventListener('click', async () => {
    const current = state.index;
    await loadProgram();
    goto(current);
  });
}

(async function init() {
  bindEvents();
  try {
    await loadProgram();
  } catch (err) {
    els.stepTitle.textContent = 'Unable to load preview';
    els.mode.textContent = String(err);
  }
})();
