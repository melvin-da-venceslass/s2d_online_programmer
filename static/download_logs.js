'use strict';

const logTypeEl = document.getElementById('log-type');
const startDateEl = document.getElementById('start-date');
const endDateEl = document.getElementById('end-date');
const downloadBtn = document.getElementById('download-logs-btn');
const statusEl = document.getElementById('dl-status');

function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = type || '';
}

downloadBtn.addEventListener('click', async () => {
  const logType = logTypeEl.value;
  const startDate = startDateEl.value;
  const endDate = endDateEl.value;

  if (startDate && endDate && startDate > endDate) {
    setStatus('Start date must be before or equal to end date.', 'error');
    return;
  }

  const params = new URLSearchParams({ log_type: logType });
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);

  setStatus('Preparing download…', '');
  downloadBtn.disabled = true;

  try {
    const response = await fetch(`/api/logs/download?${params.toString()}`);

    if (!response.ok) {
      let detail = `Server error ${response.status}`;
      try { const err = await response.json(); detail = err.detail || detail; } catch (_) {}
      setStatus(detail, 'error');
      return;
    }

    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const fnMatch = disposition.match(/filename="?([^"]+)"?/);
    const filename = fnMatch ? fnMatch[1] : `${logType}_logs.zip`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setStatus('Download started.', 'ok');
  } catch (err) {
    setStatus(`Download failed: ${err}`, 'error');
  } finally {
    downloadBtn.disabled = false;
  }
});
