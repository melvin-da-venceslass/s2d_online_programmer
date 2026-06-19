'use strict';

/**
 * Auto-logout after TIMEOUT_MS of no user interaction.
 * Resets on: mousemove, mousedown, keydown, touchstart, scroll, click.
 */
(function () {
  const TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
  const WARN_MS    = 30 * 1000;       // show warning 30s before logout

  let logoutTimer = null;
  let warnTimer   = null;
  let warningEl   = null;

  function createWarningBanner() {
    const el = document.createElement('div');
    el.id = 'idle-warning';
    el.style.cssText = [
      'display:none', 'position:fixed', 'bottom:60px', 'left:50%',
      'transform:translateX(-50%)', 'z-index:9998',
      'background:#232629', 'color:#fff',
      'padding:12px 24px', 'border-radius:8px',
      'font-family:Inter,"Segoe UI",sans-serif',
      'font-size:.88rem', 'box-shadow:0 4px 16px rgba(0,0,0,.3)',
      'white-space:nowrap',
    ].join(';');
    el.textContent = '⏱ Session expiring in 30 seconds due to inactivity.';
    document.body.appendChild(el);
    return el;
  }

  async function doLogout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (_) {}
    window.location.replace('/login');
  }

  function resetTimers() {
    clearTimeout(logoutTimer);
    clearTimeout(warnTimer);
    if (warningEl) warningEl.style.display = 'none';

    warnTimer = setTimeout(() => {
      if (!warningEl) warningEl = createWarningBanner();
      warningEl.style.display = 'block';
    }, TIMEOUT_MS - WARN_MS);

    logoutTimer = setTimeout(doLogout, TIMEOUT_MS);
  }

  const EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
  EVENTS.forEach((ev) => document.addEventListener(ev, resetTimers, { passive: true }));

  // Start the timer immediately
  window.addEventListener('DOMContentLoaded', () => {
    warningEl = createWarningBanner();
    resetTimers();
  });
})();
