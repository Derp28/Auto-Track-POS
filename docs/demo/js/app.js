import { createApiStore } from './api-store.js';
import { createAppState } from './state.js';
import { roleLabel } from './permissions.js';
import { escapeHtml, icon } from './ui.js';
import { renderNav } from '../components/nav.js';
import { confirmDialog, showDialog } from '../components/dialog.js';
import { toast } from '../components/toast.js';
import { logout, me, onUnauthorized, setupStatus } from './api.js';
import {
  currentPath,
  navigate,
  rerender,
  setBeforeNavigate,
  startRouter,
} from './router.js';

const store = createApiStore();
const state = createAppState(store);
const sidebar = document.querySelector('#app-sidebar');
const topbar = document.querySelector('#app-topbar');
const main = document.querySelector('#main-content');
const banner = document.querySelector('#connection-banner');
let lastChromeRoute = { path: '/dashboard', query: {}, route: { title: 'Dashboard' } };
let booted = false;
const bootRequestedPath = (location.hash.replace(/^#/, '').split('?')[0] || '/dashboard');

export function setConnectionBanner(text, tone = '') {
  if (!banner) return;
  banner.className = `prototype-banner ${tone ? `prototype-banner--${tone}` : ''}`;
  banner.textContent = text;
}

export function showBootMessage(message) {
  state.bootError = message;
  rerender();
}

function setNavOpen(open) {
  document.body.classList.toggle('nav-open', open);
  const menuButton = topbar.querySelector('[data-nav-toggle]');
  menuButton?.setAttribute('aria-expanded', open ? 'true' : 'false');
  sidebar.setAttribute('aria-hidden', open ? 'false' : 'true');
}

function loginTopbar() {
  return `
    <div class="topbar__login">
      <a class="brand brand--topbar" href="#/login" data-nav aria-label="Auto-Track sign in">
        <span class="brand__mark" aria-hidden="true">AT</span>
        <span class="brand__copy"><strong>Auto-Track</strong><small>Parts &amp; Service POS</small></span>
      </a>
      <span class="topbar__login-note">${icon('lock', 15)} In-browser demo sign-in</span>
    </div>
  `;
}

function renderChrome(routeInfo) {
  lastChromeRoute = routeInfo;
  const user = state.currentUser;
  const loggedOut = !user;
  document.body.classList.toggle('is-logged-out', loggedOut);
  document.body.classList.remove('nav-open');
  sidebar.innerHTML = loggedOut ? '' : renderNav(user, routeInfo.path || '/dashboard', state.store);
  sidebar.setAttribute('aria-hidden', loggedOut ? 'true' : 'false');
  if (!user) {
    topbar.innerHTML = loginTopbar();
    return;
  }
  const title = routeInfo.route?.title || 'Auto-Track';
  topbar.innerHTML = `
    <button class="icon-button topbar__menu" type="button" data-nav-toggle aria-label="Open navigation" aria-controls="app-sidebar" aria-expanded="false">${icon('dashboard', 20)}</button>
    <div class="topbar__context">
      <span class="topbar__shop">${escapeHtml(state.store.settings.shopName)}</span>
      <span class="topbar__slash">/</span>
      <strong>${escapeHtml(title)}</strong>
      <span class="badge badge--live">${icon('check', 12)} Live</span>
    </div>
    <div class="topbar__actions">
      <button class="terminal-chip" type="button" data-terminal-edit title="Edit this browser's terminal label">
        ${icon('store', 16)}
        <span><small>Terminal</small><strong>${escapeHtml(state.terminalLabel)}</strong></span>
        ${icon('edit', 13)}
      </button>
      <div class="user-chip" title="Signed in">
        <span class="avatar avatar--small" aria-hidden="true">${escapeHtml(user.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join(''))}</span>
        <span><strong>${escapeHtml(user.displayName)}</strong><small>${escapeHtml(roleLabel(user))}</small></span>
      </div>
      <button class="icon-button" type="button" data-sign-out aria-label="Sign out" title="Sign out">${icon('x', 17)}</button>
    </div>
  `;
}

async function signOut() {
  if (state.cart.length) {
    const allowed = await confirmDialog({
      title: 'Sign out with an unfinished sale?',
      message: 'The current cart will be discarded. Completed sales stay saved on the server.',
      confirmText: 'Discard cart and sign out',
      tone: 'danger',
      details: 'The cart exists only in this browser session.',
    });
    if (!allowed) return;
    state.clearCart();
  }
  const name = state.currentUser?.displayName;
  try {
    await logout();
  } catch (error) {
    toast(error.message, { tone: 'danger', title: 'Sign out failed' });
    return;
  }
  state.signOut();
  navigate('/login', { replace: true });
  toast(`${name || 'User'} signed out.`, { tone: 'info', title: 'Signed out' });
}

function openTerminalDialog() {
  let control;
  control = showDialog({
    title: 'Terminal label',
    description: 'This label is used on sales from this browser. It is not a shop-wide setting.',
    body: `
      <div class="field">
        <label for="terminal-label">Terminal label</label>
        <input id="terminal-label" maxlength="40" value="${escapeHtml(state.terminalLabel)}" autocomplete="off">
        <small class="field-hint">Shown in the top bar, checkout, and receipts.</small>
        <div data-terminal-error></div>
      </div>
    `,
    footer: `
      <button class="btn btn--secondary" type="button" data-terminal-cancel>Cancel</button>
      <button class="btn btn--primary" type="button" data-terminal-save>Update label</button>
    `,
    initialFocus: '#terminal-label',
  });
  const input = control.dialog.querySelector('#terminal-label');
  const errorSlot = control.dialog.querySelector('[data-terminal-error]');
  const save = () => {
    errorSlot.innerHTML = '';
    try {
      state.setTerminalLabel(input.value);
      control.setSettled();
      control.close();
      renderChrome(lastChromeRoute);
      rerender();
      toast('Terminal label updated for this browser.', { tone: 'success', title: 'Terminal updated' });
    } catch (error) {
      errorSlot.innerHTML = `<span class="field-error" role="alert">${icon('alert', 14)} ${escapeHtml(error.message)}</span>`;
      input.focus();
    }
  };
  control.dialog.querySelector('[data-terminal-save]').addEventListener('click', save);
  control.dialog.querySelector('[data-terminal-cancel]').addEventListener('click', () => control.close());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      save();
    }
  });
}

setBeforeNavigate(async (targetPath, fromPath) => {
  if (state.cart.length && fromPath.startsWith('/checkout') && !targetPath.startsWith('/checkout')) {
    const allowed = await confirmDialog({
      title: 'Leave checkout with an unfinished sale?',
      message: 'The current cart will be discarded if you leave this screen.',
      confirmText: 'Leave and clear cart',
      tone: 'danger',
      details: 'Completed sales stay saved on the server. The cart exists only in this browser session.',
    });
    if (!allowed) return false;
    state.clearCart();
  }
  return true;
});

document.addEventListener('click', (event) => {
  const navLink = event.target.closest('a[data-nav]');
  if (navLink) {
    event.preventDefault();
    setNavOpen(false);
    const href = navLink.getAttribute('href') || '';
    if (href.startsWith('#')) navigate(href.slice(1));
    return;
  }
  const navToggle = event.target.closest('[data-nav-toggle]');
  if (navToggle) {
    event.preventDefault();
    setNavOpen(!document.body.classList.contains('nav-open'));
    return;
  }
  if (event.target.closest('[data-terminal-edit]')) {
    openTerminalDialog();
    return;
  }
  if (event.target.closest('[data-sign-out]')) {
    signOut();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'F2') {
    if (document.querySelector('#app-dialog[open]')) return;
    event.preventDefault();
    if (state.currentUser) navigate('/checkout');
  }
  if (event.key === 'Escape' && document.body.classList.contains('nav-open')) {
    setNavOpen(false);
  }
});

window.addEventListener('beforeunload', (event) => {
  if (!state.cart.length) return;
  event.preventDefault();
  event.returnValue = '';
});

document.addEventListener('pos:terminal-changed', () => {
  renderChrome(lastChromeRoute);
});

document.addEventListener('pos:refresh-error', () => {
  setConnectionBanner('Server data could not be refreshed. The last confirmed data is shown.', 'error');
});

window.addEventListener('error', () => {
  document.body.classList.remove('is-loading');
});

window.addEventListener('unhandledrejection', (event) => {
  console.error(event.reason);
  toast(event.reason?.message || 'An unexpected error occurred.', { tone: 'danger', title: 'Action failed' });
});

onUnauthorized(() => {
  if (!state.currentUser) return;
  state.signOut();
  setConnectionBanner('Your session expired. Sign in again.', 'error');
  navigate('/login', { replace: true });
  toast('Your session expired. Sign in again to continue.', { tone: 'warning', title: 'Session expired' });
});

async function boot() {
  setConnectionBanner('Loading the demo shop…');
  try {
    const status = await setupStatus();
    state.setSetupStatus(status);
    if (!status.setupRequired) {
      try {
        const result = await me();
        await store.refresh();
        state.hydrate(result.user);
        setConnectionBanner(`Demo · ${store.meta.dataSource} · ${store.meta.businessDate}`);
      } catch (error) {
        if (error.status !== 401) throw error;
      }
    } else {
      setConnectionBanner('Initial setup required · create the first administrator');
    }
  } catch (error) {
    state.bootError = error.message;
    setConnectionBanner('Cannot reach the shop server. Check the server and network.', 'error');
  }
  booted = true;
  rerender();

  if (state.currentUser) {
    if (state.currentUser.mustChangePassword || bootRequestedPath === '/login') {
      navigate('/login', { replace: true });
    } else {
      navigate(bootRequestedPath, { replace: true });
    }
  }
}

startRouter({
  state,
  main,
  onRoute(routeInfo) {
    renderChrome(routeInfo);
  },
});

boot();

window.__AUTOTRACK__ = {
  get state() { return state; },
  get booted() { return booted; },
};
