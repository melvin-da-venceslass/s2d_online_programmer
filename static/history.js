'use strict';

const logTypeEl  = document.getElementById('hist-log-type');
const queryEl    = document.getElementById('hist-query');
const searchBtn  = document.getElementById('hist-search-btn');
const statusEl   = document.getElementById('hist-status');
const resultsCard = document.getElementById('hist-results-card');
const resultsTitle = document.getElementById('hist-results-title');
const resultsBody  = document.getElementById('hist-results-body');

function setStatus(msg, type) {
  statusEl.textContent = msg || '';
  statusEl.className = type || '';
}

// ── JSON pretty-print with syntax highlighting ─────────────────────────────
function syntaxHighlight(obj) {
  if (obj === null || obj === undefined) return '<span class="hist-json-empty">— no data —</span>';
  const json = JSON.stringify(obj, null, 2);
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      if (/^"/.test(match)) {
        if (/:$/.test(match)) return `<span class="jk">${esc(match)}</span>`;
        return `<span class="jv">${esc(match)}</span>`;
      }
      if (/true|false/.test(match)) return `<span class="jb">${match}</span>`;
      if (/null/.test(match)) return `<span class="jnull">${match}</span>`;
      return `<span class="jn">${match}</span>`;
    }
  );
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Render assy results as table ───────────────────────────────────────────
function renderAssyTable(data) {
  if (!data.rows || !data.rows.length) {
    resultsBody.innerHTML = '<div class="hist-no-results">No records found for the given query.</div>';
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'hist-table-wrap';

  const table = document.createElement('table');
  table.className = 'hist-table';

  const thead = document.createElement('thead');
  const hRow = document.createElement('tr');
  data.columns.forEach((col) => {
    const th = document.createElement('th');
    th.textContent = col;
    hRow.appendChild(th);
  });
  thead.appendChild(hRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  data.rows.forEach((row) => {
    const tr = document.createElement('tr');
    row.forEach((cell) => {
      const td = document.createElement('td');
      const val = cell === null || cell === undefined ? '' : String(cell);
      td.textContent = val;
      td.title = val;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  resultsBody.appendChild(wrap);
}

// ── Render conduit results as side-by-side JSON panels ────────────────────
function renderConduitResults(data) {
  if (!data.results || !data.results.length) {
    resultsBody.innerHTML = '<div class="hist-no-results">No conduit log entries found for the given serial.</div>';
    return;
  }

  const container = document.createElement('div');
  container.className = 'hist-conduit-results';

  data.results.forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'hist-conduit-item';

    const header = document.createElement('div');
    header.className = 'hist-conduit-header';
    header.innerHTML = 'Serial &nbsp;<span class="serial-badge">' + esc(entry.serial) + '</span>';
    item.appendChild(header);

    const panes = document.createElement('div');
    panes.className = 'hist-conduit-panes';

    // Left: request
    const leftPane = document.createElement('div');
    leftPane.className = 'hist-conduit-pane';
    leftPane.innerHTML = '<div class="hist-pane-title">&#x1F4E4; Request &nbsp;<span style="font-weight:400;color:#aab;text-transform:none;letter-spacing:0;">' +
      esc(entry.serial) + '.json</span></div>';
    const leftView = document.createElement('pre');
    leftView.className = 'hist-json-view';
    leftView.innerHTML = syntaxHighlight(entry.request);
    leftPane.appendChild(leftView);

    // Right: response
    const rightPane = document.createElement('div');
    rightPane.className = 'hist-conduit-pane';
    rightPane.innerHTML = '<div class="hist-pane-title">&#x1F4E5; Response &nbsp;<span style="font-weight:400;color:#aab;text-transform:none;letter-spacing:0;">' +
      esc(entry.serial) + '_response.json</span></div>';
    const rightView = document.createElement('pre');
    rightView.className = 'hist-json-view';
    rightView.innerHTML = syntaxHighlight(entry.response);
    rightPane.appendChild(rightView);

    panes.append(leftPane, rightPane);
    item.appendChild(panes);
    container.appendChild(item);
  });

  resultsBody.appendChild(container);
}

// ── Search ─────────────────────────────────────────────────────────────────
async function doSearch() {
  const logType = logTypeEl.value;
  const query   = queryEl.value.trim();
  if (!query) {
    setStatus('Please enter a serial number or search value.', 'error');
    return;
  }

  setStatus('Searching…', '');
  searchBtn.disabled = true;
  resultsCard.hidden = true;
  resultsBody.innerHTML = '';

  const params = new URLSearchParams({ log_type: logType, query });
  try {
    const resp = await fetch(`/api/logs/search?${params}`);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      setStatus(err.detail || `Server error ${resp.status}`, 'error');
      return;
    }
    const data = await resp.json();
    const count = data.log_type === 'assy'
      ? (data.rows ? data.rows.length : 0)
      : (data.results ? data.results.length : 0);

    const typeLabel = data.log_type === 'assy' ? 'Assembly Log' : 'Conduit Log';
    resultsTitle.textContent = `${typeLabel} — "${query}" — ${count} result${count !== 1 ? 's' : ''}`;
    resultsCard.hidden = false;

    if (data.log_type === 'assy') {
      renderAssyTable(data);
    } else {
      renderConduitResults(data);
    }

    setStatus(count ? `Found ${count} result${count !== 1 ? 's' : ''}.` : 'No results found.', count ? 'ok' : '');
  } catch (e) {
    setStatus(`Search failed: ${e}`, 'error');
  } finally {
    searchBtn.disabled = false;
  }
}

searchBtn.addEventListener('click', doSearch);
queryEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

// Hide loader
const loader = document.getElementById('app-loader');
if (loader) {
  setTimeout(() => {
    loader.style.opacity = '0';
    setTimeout(() => loader.remove(), 400);
  }, 600);
}
