/**
 * Demo shell: installs the in-browser API, adds the demo toolbar, and makes
 * the sample accounts one click away. Loaded before ../js/app.js.
 */
import { installDemoBackend } from './mock/api.js';
import { navigate, rerender } from '../js/router.js';

const PASSWORD = 'demo1234';
const ACCOUNTS = [
  { username: 'admin', label: 'Admin · Maria', role: 'Administrator' },
  { username: 'cashier', label: 'Cashier · Jomar', role: 'Cashier' },
];

function demoBannerText() {
  const meta = window.__AUTOTRACK__?.state?.store?.meta;
  const date = meta?.businessDate ? ` · ${meta.businessDate}` : '';
  return `Demo · Sample data in your browser — nothing is saved${date}`;
}

function showDemoBanner() {
  const banner = document.querySelector('#connection-banner');
  if (!banner) return;
  banner.className = 'prototype-banner';
  banner.textContent = demoBannerText();
}

const backend = installDemoBackend();
window.__AUTOTRACK_DEMO__ = { backend, password: PASSWORD };

function waitFor(predicate, { timeout = 6000, interval = 60 } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      let value;
      try {
        value = predicate();
      } catch {
        value = null;
      }
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() - started > timeout) {
        reject(new Error('The demo app did not finish loading.'));
        return;
      }
      setTimeout(tick, interval);
    };
    tick();
  });
}

async function signInAs(username) {
  const app = window.__AUTOTRACK__;
  if (!app) throw new Error('The demo app is still starting.');
  await waitFor(() => app.booted);
  if (app.state.currentUser) {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* the demo session is in memory only */
    }
    app.state.signOut();
  }
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || 'Demo sign-in failed.');
  await app.state.store.refresh();
  app.state.hydrate(payload.user);
  app.state.setSetupStatus({ setupRequired: false, setupEnabled: false });
  navigate('/dashboard', { replace: true });
  rerender();
  showDemoBanner();
  return payload.user;
}

function buildToolbar() {
  const bar = document.createElement('div');
  bar.className = 'demo-pill';
  bar.id = 'demo-pill';
  bar.innerHTML = `
    <span class="demo-pill__tag">DEMO</span>
    <span class="demo-pill__copy">Sample data · nothing is saved</span>
    <span class="demo-pill__actions">
      ${ACCOUNTS.map((account) => `<button type="button" class="demo-pill__button" data-demo-user="${account.username}" title="Sign in as ${account.label} (${account.role})">${account.label}</button>`).join('')}
      <button type="button" class="demo-pill__button demo-pill__button--ghost" data-demo-reset title="Reload the sample shop">Reset</button>
    </span>
  `;
  document.body.appendChild(bar);
  bar.addEventListener('click', async (event) => {
    const account = event.target.closest('[data-demo-user]');
    if (account) {
      bar.classList.add('is-busy');
      try {
        await signInAs(account.dataset.demoUser);
      } catch (error) {
        console.error(error);
        window.alert(error.message);
      } finally {
        bar.classList.remove('is-busy');
      }
      return;
    }
    if (event.target.closest('[data-demo-reset]')) {
      location.href = `${location.pathname}${location.search}`;
    }
  });
  return bar;
}

function enhanceLogin() {
  const form = document.querySelector('#login-form');
  if (!form || form.dataset.demoEnhanced === '1') return;
  form.dataset.demoEnhanced = '1';
  const block = document.createElement('div');
  block.className = 'demo-accounts';
  block.innerHTML = `
    <p><strong>Demo accounts</strong> · password <code>${PASSWORD}</code></p>
    <div class="demo-accounts__row">
      ${ACCOUNTS.map((account) => `<button type="button" class="btn btn--secondary btn--small" data-demo-fill="${account.username}">${account.label}</button>`).join('')}
    </div>
  `;
  form.parentElement.insertBefore(block, form);
  block.addEventListener('click', (event) => {
    const button = event.target.closest('[data-demo-fill]');
    if (!button) return;
    form.username.value = button.dataset.demoFill;
    form.password.value = PASSWORD;
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.querySelector('[type="submit"]')?.click();
  });
}

function watchLogin() {
  const main = document.querySelector('#main-content');
  if (!main) return;
  const sync = () => {
    enhanceLogin();
    if (document.querySelector('#login-form')) showDemoBanner();
  };
  const observer = new MutationObserver(sync);
  observer.observe(main, { childList: true, subtree: true });
  sync();
}

async function bootDemoUi() {
  buildToolbar();
  watchLogin();
  const demoUser = new URLSearchParams((location.hash.split('?')[1] || '')).get('demo');
  if (demoUser) {
    try {
      await signInAs(demoUser);
    } catch (error) {
      console.error(error);
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootDemoUi, { once: true });
} else {
  bootDemoUi();
}
