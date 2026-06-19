const AUTH_TOKEN_KEY = 'admin_token';
const AUTH_EXPIRY_KEY = 'admin_expiry_epoch_ms';

const state = {
  token: localStorage.getItem(AUTH_TOKEN_KEY) || '',
  expiryEpochMs: Number(localStorage.getItem(AUTH_EXPIRY_KEY) || '0'),
  user: null,
};

const els = {
  sessionInfo: document.getElementById('session-info'),
  logoutBtn: document.getElementById('logout-btn'),
  navManageRecipe: document.getElementById('nav-manage-recipe'),
  navEditor: document.getElementById('nav-editor'),
  navAdmin: document.getElementById('nav-admin'),
  authPanel: document.getElementById('auth-panel'),
  welcomePanel: document.getElementById('welcome-panel'),
  welcomeTitle: document.getElementById('welcome-title'),
  welcomeMessage: document.getElementById('welcome-message'),
  welcomeActions: document.getElementById('welcome-actions'),
  adminFeature: document.getElementById('admin-feature'),
  bootstrapWrap: document.getElementById('bootstrap-wrap'),
  loginWrap: document.getElementById('login-wrap'),
  authStatus: document.getElementById('auth-status'),
};

function setStatus(message, type = '') {
  if (!els.authStatus) return;
  els.authStatus.textContent = message || '';
  els.authStatus.className = `recipe-status ${type}`.trim();
}

function clearAuthState() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_EXPIRY_KEY);
  state.token = '';
  state.expiryEpochMs = 0;
  state.user = null;
}

function authHeaders(initialHeaders = {}) {
  const headers = new Headers(initialHeaders);
  if (state.token && !headers.has('X-Admin-Token')) {
    headers.set('X-Admin-Token', state.token);
  }
  return headers;
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: authHeaders(init.headers || {}),
    credentials: 'same-origin',
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    clearAuthState();
  }
  if (!response.ok) {
    throw new Error(body.detail || body.message || `Request failed: ${response.status}`);
  }
  return body;
}

function formDataToObject(form) {
  const data = {};
  new FormData(form).forEach((value, key) => {
    data[key] = String(value).trim();
  });
  return data;
}

function authCard(title, buttonLabel, onSubmit) {
  const form = document.createElement('form');
  form.className = 'home-login-card';
  form.innerHTML = `
    <h3>${title}</h3>
    <label class="field-label">Username
      <input name="username" placeholder="Username" autocomplete="username" required />
    </label>
    <label class="field-label">Password
      <div class="password-field">
        <input name="password" placeholder="Password" type="password" autocomplete="current-password" required />
        <button type="button" class="secondary password-toggle" aria-label="Show password">Show</button>
      </div>
    </label>
    <label class="remember-me"><input name="remember" type="checkbox" /> Remember me</label>
    <button class="primary" type="submit">${buttonLabel}</button>
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

function setNavVisibility() {
  const isLoggedIn = Boolean(state.user);
  const role = state.user?.role || '';

  if (els.navManageRecipe) {
    els.navManageRecipe.style.display = isLoggedIn ? '' : 'none';
  }
  if (els.navEditor) {
    els.navEditor.style.display = isLoggedIn ? '' : 'none';
  }
  if (els.navAdmin) {
    els.navAdmin.style.display = role === 'super_admin' || role === 'admin' ? '' : 'none';
  }
  if (els.adminFeature) {
    els.adminFeature.style.display = role === 'super_admin' || role === 'admin' ? '' : 'none';
  }
  if (els.logoutBtn) {
    els.logoutBtn.hidden = !isLoggedIn;
  }
  if (els.sessionInfo) {
    els.sessionInfo.textContent = isLoggedIn ? `${state.user.username} (${role})` : 'Guest';
  }
}

function setWelcomeMode(isLoggedIn) {
  if (els.authPanel) {
    els.authPanel.hidden = isLoggedIn;
  }
  if (els.welcomePanel) {
    els.welcomePanel.hidden = !isLoggedIn;
  }
  if (els.welcomeActions) {
    els.welcomeActions.hidden = !isLoggedIn;
  }
}

function renderWelcome() {
  if (!state.user) {
    setWelcomeMode(false);
    setNavVisibility();
    return;
  }

  const role = state.user.role || 'user';
  if (els.welcomeTitle) {
    els.welcomeTitle.textContent = `Welcome ${state.user.username}`;
  }
  if (els.welcomeMessage) {
    els.welcomeMessage.textContent = role === 'engineer'
      ? 'Your workspace gives you access to recipie records and cooking tools. Administration features stay hidden for your role.'
      : 'Your workspace gives you access to recipie records, cooking tools, and administration features for hierarchy management.';
  }

  setWelcomeMode(true);
  setNavVisibility();
}

function installSessionTimer() {
  if (!state.expiryEpochMs || !Number.isFinite(state.expiryEpochMs)) return;
  const timeoutMs = Math.max(0, state.expiryEpochMs - Date.now());
  window.setTimeout(() => {
    clearAuthState();
    renderWelcome();
    initAuth().catch((error) => setStatus(String(error), 'error'));
    setStatus('Session expired. Please sign in again.', 'error');
  }, timeoutMs);
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
        setStatus('Super admin created. You can log in now.', 'ok');
        await initAuth();
      } catch (error) {
        setStatus(String(error), 'error');
      }
    });
    els.bootstrapWrap.appendChild(bootstrapForm);
  }

  const loginForm = authCard('Role Login', 'Sign In', async (event) => {
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
      state.user = result.user || null;
      localStorage.setItem(AUTH_TOKEN_KEY, state.token);
      localStorage.setItem(AUTH_EXPIRY_KEY, String(state.expiryEpochMs));
      installSessionTimer();
      renderWelcome();
      setStatus('Authenticated successfully.', 'ok');
    } catch (error) {
      setStatus(String(error), 'error');
    }
  });

  els.loginWrap.appendChild(loginForm);
}

async function restoreSession() {
  if (!state.token || !state.expiryEpochMs || Date.now() >= state.expiryEpochMs) {
    clearAuthState();
    return false;
  }
  const payload = await fetchJson('/api/admin/me');
  state.user = payload.user || null;
  installSessionTimer();
  return Boolean(state.user);
}

function bindEvents() {
  if (els.logoutBtn) {
    els.logoutBtn.addEventListener('click', async () => {
      try {
        await fetch('/api/admin/logout', {
          method: 'POST',
          headers: authHeaders(),
          credentials: 'same-origin',
        });
      } catch (_) {
      }
      clearAuthState();
      setStatus('Logged out.', '');
      setWelcomeMode(false);
      setNavVisibility();
      initAuth().catch((error) => setStatus(String(error), 'error'));
    });
  }
}

(async function init() {
  bindEvents();
  const restored = await restoreSession().catch(() => false);
  renderWelcome();
  if (!restored) {
    await initAuth();
  }
})();
