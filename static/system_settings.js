'use strict';

const statusEl = document.getElementById('ss-status');
const dtInput  = document.getElementById('dt-input');
const modal    = document.getElementById('confirm-modal');
const modalTitle   = document.getElementById('modal-title');
const modalBody    = document.getElementById('modal-body');
const modalConfirm = document.getElementById('modal-confirm-btn');
const modalCancel  = document.getElementById('modal-cancel-btn');

function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = type || '';
}

// Pre-fill input with current browser time
function fillNow() {
  const now = new Date();
  // datetime-local value format: YYYY-MM-DDTHH:MM
  const pad = (n) => String(n).padStart(2, '0');
  dtInput.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

document.getElementById('dt-now-btn').addEventListener('click', fillNow);

document.getElementById('dt-set-btn').addEventListener('click', async () => {
  if (!dtInput.value) { setStatus('Please select a date and time.', 'error'); return; }
  setStatus('Updating…', '');
  try {
    const resp = await fetch('/api/system/datetime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datetime: dtInput.value + ':00' }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      setStatus(err.detail || `Error ${resp.status}`, 'error');
      return;
    }
    const data = await resp.json();
    setStatus(`Server time updated to ${data.datetime}.`, 'ok');
  } catch (e) {
    setStatus(`Failed: ${e}`, 'error');
  }
});

// Power action buttons
let pendingAction = null;

const ACTION_LABELS = {
  shutdown: { title: 'Confirm Shutdown', body: 'This will immediately power off the server. Continue?' },
  reboot:   { title: 'Confirm Reboot',   body: 'This will reboot the server. Continue?' },
  reset:    { title: 'Confirm Display Reset', body: 'This will kill the Xorg display session (pkill Xorg). Continue?' },
  clear_logs: { title: 'Clear Logs', body: '' },  // body set dynamically
};

document.querySelectorAll('[data-action]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    pendingAction = action;
    const info = ACTION_LABELS[action] || { title: 'Confirm', body: 'Are you sure?' };
    modalTitle.textContent = info.title;
    modalBody.textContent  = info.body;
    modal.classList.add('open');
  });
});

modalCancel.addEventListener('click', () => {
  modal.classList.remove('open');
  pendingAction = null;
});

modal.addEventListener('click', (e) => {
  if (e.target === modal) { modal.classList.remove('open'); pendingAction = null; }
});

modalConfirm.addEventListener('click', async () => {
  modal.classList.remove('open');
  if (!pendingAction) return;
  const action = pendingAction;
  pendingAction = null;

  if (action === 'clear_logs') {
    const logType = document.getElementById('cl-log-type').value;
    const clStatus = document.getElementById('cl-status');
    clStatus.textContent = 'Clearing…';
    clStatus.className = '';
    try {
      const resp = await fetch(`/api/logs/clear?log_type=${encodeURIComponent(logType)}`, { method: 'POST' });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        clStatus.textContent = err.detail || `Error ${resp.status}`;
        clStatus.className = 'error';
        return;
      }
      const data = await resp.json();
      clStatus.textContent = `Cleared ${data.deleted} file(s) from ${logType} log(s).`;
      clStatus.className = 'ok';
    } catch (e) {
      clStatus.textContent = `Failed: ${e}`;
      clStatus.className = 'error';
    }
    return;
  }

  setStatus(`Sending ${action} command…`, '');
  try {
    const resp = await fetch(`/api/system/${action}`, { method: 'POST' });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      setStatus(err.detail || `Error ${resp.status}`, 'error');
      return;
    }
    setStatus(`${action.charAt(0).toUpperCase() + action.slice(1)} command sent.`, 'ok');
  } catch (e) {
    setStatus(`Failed: ${e}`, 'error');
  }
});

// Init: pre-fill datetime with current browser time
fillNow();

// ── Clear Logs ────────────────────────────────────────────────────────────────

document.getElementById('cl-clear-btn').addEventListener('click', () => {
  const logType = document.getElementById('cl-log-type').value;
  const labelMap = { system: 'System', conduit: 'Conduit', assy: 'Assy', all: 'ALL' };
  const label = labelMap[logType] || logType;
  pendingAction = 'clear_logs';
  modalTitle.textContent = 'Confirm Clear Logs';
  modalBody.textContent  = `This will permanently delete all files in the ${label} log directory. This cannot be undone. Continue?`;
  modal.classList.add('open');
});

// ── Download Logs ─────────────────────────────────────────────────────────────

document.getElementById('dl-download-btn').addEventListener('click', async () => {
  const logType  = document.getElementById('dl-log-type').value;
  const startDate = document.getElementById('dl-start-date').value;
  const endDate   = document.getElementById('dl-end-date').value;
  const dlStatus  = document.getElementById('dl-status');

  if (startDate && endDate && startDate > endDate) {
    dlStatus.textContent = 'Start date must be before or equal to end date.';
    dlStatus.className = 'error';
    return;
  }

  const params = new URLSearchParams({ log_type: logType });
  if (startDate) params.set('start_date', startDate);
  if (endDate)   params.set('end_date', endDate);

  dlStatus.textContent = 'Preparing download…';
  dlStatus.className = '';
  document.getElementById('dl-download-btn').disabled = true;

  try {
    const response = await fetch(`/api/logs/download?${params.toString()}`);
    if (!response.ok) {
      let detail = `Server error ${response.status}`;
      try { const err = await response.json(); detail = err.detail || detail; } catch (_) {}
      dlStatus.textContent = detail;
      dlStatus.className = 'error';
      return;
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const fnMatch = disposition.match(/filename="?([^"]+)"?/);
    const filename = fnMatch ? fnMatch[1] : `${logType}_logs.zip`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    dlStatus.textContent = 'Download started.';
    dlStatus.className = 'ok';
  } catch (e) {
    dlStatus.textContent = `Download failed: ${e}`;
    dlStatus.className = 'error';
  } finally {
    document.getElementById('dl-download-btn').disabled = false;
  }
});
