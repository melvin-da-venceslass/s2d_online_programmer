'use strict';

const TEXT_FIELDS = ['MesUrl', 'ConduitUrl', 'MesStationId', 'MesDataSource', 'MesFTP', 'MesFTPDir', 'ftp_user', 'smbPath'];
const PASS_FIELDS = ['ftp_pass'];
const BOOL_FIELDS = ['ftp', 'smb', 'save_conduit_log', 'save_assy_log', 'show_ok_alert', 'show_ng_alert'];

const statusEl = document.getElementById('cfg-status');

function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = type || '';
}

function getEl(key) {
  return document.getElementById(`cfg-${key}`);
}

function populateForm(cfg) {
  [...TEXT_FIELDS, ...PASS_FIELDS].forEach((key) => {
    const el = getEl(key);
    if (el) el.value = cfg[key] !== undefined ? cfg[key] : '';
  });
  BOOL_FIELDS.forEach((key) => {
    const el = getEl(key);
    if (el) el.checked = !!cfg[key];
  });
}

function collectForm() {
  const cfg = {};
  [...TEXT_FIELDS, ...PASS_FIELDS].forEach((key) => {
    const el = getEl(key);
    if (el) cfg[key] = el.value;
  });
  BOOL_FIELDS.forEach((key) => {
    const el = getEl(key);
    if (el) cfg[key] = el.checked;
  });
  return cfg;
}

async function loadConfig() {
  setStatus('Loading…', '');
  try {
    const resp = await fetch('/api/config/mes');
    if (!resp.ok) throw new Error(`Server error ${resp.status}`);
    const data = await resp.json();
    const cfg = data.mes_config || data || {};
    populateForm(cfg);
    setStatus('', '');
  } catch (err) {
    setStatus(`Failed to load config: ${err}`, 'error');
  }
}

document.getElementById('cfg-save-btn').addEventListener('click', async () => {
  const cfg = collectForm();
  setStatus('Saving…', '');
  try {
    const resp = await fetch('/api/config/mes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mes_config: cfg }),
    });
    if (!resp.ok) {
      let detail = `Server error ${resp.status}`;
      try { const err = await resp.json(); detail = err.detail || detail; } catch (_) {}
      setStatus(detail, 'error');
      return;
    }
    setStatus('Configuration saved successfully.', 'ok');
  } catch (err) {
    setStatus(`Save failed: ${err}`, 'error');
  }
});

document.getElementById('cfg-reload-btn').addEventListener('click', loadConfig);

// Auto-load on page open
loadConfig();
