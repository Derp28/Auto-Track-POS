import { escapeHtml, icon } from '../js/ui.js';
import { roleLabel } from '../js/permissions.js';
import { toast } from '../components/toast.js';
import { navigate, rerender } from '../js/router.js';
import {
  changePassword,
  login as loginRequest,
  logout,
  me,
  setup as setupRequest,
} from '../js/api.js';

function setBanner(text) {
  const banner = document.querySelector('#connection-banner');
  if (!banner) return;
  banner.className = 'prototype-banner';
  banner.textContent = text;
}

function liveBanner(state) {
  setBanner(`Demo · ${state.store.meta.dataSource || 'sample data'} · ${state.store.meta.businessDate || 'ready'}`);
}

function errorHtml(error) {
  return `<div class="form-error" role="alert">${icon('alert', 16)} ${escapeHtml(error.message || 'The request failed.')}</div>`;
}

async function afterSignIn(state, result) {
  await state.store.refresh();
  state.hydrate(result.user);
  state.setSetupStatus({ setupRequired: false, setupEnabled: state.setupEnabled });
  liveBanner(state);
  if (state.currentUser.mustChangePassword) {
    rerender();
    toast('Set a new password before using the shop.', { tone: 'warning', title: 'Password change required' });
    return;
  }
  navigate('/dashboard', { replace: true });
  toast(`Signed in as ${state.currentUser.displayName}.`, { tone: 'success', title: 'Welcome back' });
}

function loginForm(state) {
  return `
    <form id="login-form" novalidate>
      <div class="field">
        <label for="login-username">Username</label>
        <input id="login-username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>
        <div data-error="username"></div>
      </div>
      <div class="field">
        <label for="login-password">Password</label>
        <input id="login-password" name="password" type="password" autocomplete="current-password" required>
        <div data-error="password"></div>
      </div>
      <div data-form-error></div>
      <button class="btn btn--primary btn--block" type="submit">Sign in ${icon('arrowRight', 17)}</button>
    </form>
  `;
}

function setupForm(state) {
  if (!state.setupEnabled) {
    return `
      <div class="callout callout--warning">
        ${icon('lock', 17)}
        <span><strong>Setup is locked.</strong> An administrator must start the server with a <code>BOOTSTRAP_TOKEN</code> value, then reload this page to create the first account.</span>
      </div>
    `;
  }
  return `
    <form id="setup-form" novalidate>
      <div class="field">
        <label for="setup-token">Setup token</label>
        <input id="setup-token" name="token" autocomplete="off" spellcheck="false" required>
        <small class="field-hint">The one-time token configured by the person who started the server.</small>
        <div data-error="token"></div>
      </div>
      <div class="field">
        <label for="setup-username">Administrator username</label>
        <input id="setup-username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>
        <div data-error="username"></div>
      </div>
      <div class="field">
        <label for="setup-name">Display name</label>
        <input id="setup-name" name="displayName" autocomplete="name" required>
        <div data-error="displayName"></div>
      </div>
      <div class="field">
        <label for="setup-password">Password</label>
        <input id="setup-password" name="password" type="password" autocomplete="new-password" minlength="12" required>
        <small class="field-hint">At least 12 characters. Use a unique passphrase, not a shared shop password.</small>
        <div data-error="password"></div>
      </div>
      <div class="field">
        <label for="setup-confirm">Confirm password</label>
        <input id="setup-confirm" name="confirm" type="password" autocomplete="new-password" minlength="12" required>
        <div data-error="confirm"></div>
      </div>
      <div data-form-error></div>
      <button class="btn btn--primary btn--block" type="submit">Create administrator ${icon('arrowRight', 17)}</button>
    </form>
  `;
}

function changePasswordForm(user) {
  return `
    <div class="callout callout--warning">
      ${icon('lock', 17)}
      <span><strong>Password change required.</strong> ${escapeHtml(user.displayName)}, replace the temporary password before opening the shop.</span>
    </div>
    <form id="change-password-form" novalidate>
      <div class="field">
        <label for="current-password">Current password</label>
        <input id="current-password" name="currentPassword" type="password" autocomplete="current-password" required>
        <div data-error="currentPassword"></div>
      </div>
      <div class="field">
        <label for="new-password">New password</label>
        <input id="new-password" name="newPassword" type="password" autocomplete="new-password" minlength="12" required>
        <small class="field-hint">At least 12 characters. This signs out your other sessions.</small>
        <div data-error="newPassword"></div>
      </div>
      <div class="field">
        <label for="new-password-confirm">Confirm new password</label>
        <input id="new-password-confirm" name="confirm" type="password" autocomplete="new-password" minlength="12" required>
        <div data-error="confirm"></div>
      </div>
      <div data-form-error></div>
      <button class="btn btn--primary btn--block" type="submit">Save password ${icon('arrowRight', 17)}</button>
    </form>
  `;
}

function signedInPanel(state) {
  const user = state.currentUser;
  return `
    <div class="callout callout--success">
      ${icon('check', 16)} Signed in as <strong>${escapeHtml(user.displayName)}</strong> (${escapeHtml(roleLabel(user))}).
    </div>
    <button class="btn btn--primary btn--block" type="button" data-login-continue>Continue to dashboard ${icon('arrowRight', 17)}</button>
    <button class="btn btn--secondary btn--block" type="button" data-login-signout>Sign out</button>
  `;
}

export function renderLogin(ctx) {
  const { state } = ctx;
  let title = 'Sign in';
  let intro = 'Demo accounts are listed below — pick a role to explore the shop. Nothing you do is saved.';
  let panel = loginForm(state);
  if (state.bootError) {
    title = 'Server unavailable';
    intro = 'The sign-in screen is ready, but the shop server did not answer.';
    panel = `
      <div class="form-error" role="alert">${icon('alert', 16)} ${escapeHtml(state.bootError)}</div>
      <button class="btn btn--primary btn--block" type="button" data-login-retry>Retry connection ${icon('refresh', 17)}</button>
    `;
  } else if (state.currentUser?.mustChangePassword) {
    title = 'Set a new password';
    intro = 'Your temporary password has expired. Choose a private password to continue.';
    panel = changePasswordForm(state.currentUser);
  } else if (state.currentUser) {
    title = 'Signed in';
    intro = 'Your shop session is active in this browser.';
    panel = signedInPanel(state);
  } else if (state.setupRequired) {
    title = 'Set up the shop';
    intro = 'No administrator exists yet. Create the first administrator to start using Auto-Track.';
    panel = setupForm(state);
  }

  return {
    html: `
      <div class="login-layout">
        <section class="login-hero">
          <p class="eyebrow">Auto Supply &amp; Service · Interactive demo</p>
          <h1>Run the counter.<br><span>Keep the bays moving.</span></h1>
          <p class="login-hero__lead">Checkout, parts inventory, purchasing, returns, and daily controls in one connected shop system.</p>
          <div class="login-hero__points">
            <div><span>${icon('cart', 18)}</span><div><strong>Counter-ready checkout</strong><small>Search, scan, discount, and take cash or external-card payments.</small></div></div>
            <div><span>${icon('layers', 18)}</span><div><strong>Stock you can trust</strong><small>Every checkout and receiving record updates the stock ledger.</small></div></div>
            <div><span>${icon('lock', 18)}</span><div><strong>Role-aware access</strong><small>Administrators and cashiers sign in with their own demo account.</small></div></div>
          </div>
          <div class="info-note info-note--dark" role="note">
            ${icon('info', 18)}
            <p><strong>Demo mode.</strong> This page runs entirely in your browser with sample data. Nothing is saved, and no database or shop server is involved.</p>
          </div>
        </section>
        <section class="login-card" aria-labelledby="login-title">
          <div class="login-card__head">
            <span class="login-card__icon">${icon('store', 24)}</span>
            <div>
              <p class="eyebrow">Auto-Track Auto Supply &amp; Service</p>
              <h2 id="login-title">${escapeHtml(title)}</h2>
            </div>
          </div>
          <p class="login-card__intro">${escapeHtml(intro)}</p>
          ${panel}
          <div class="login-card__foot">
            <span>${icon('lock', 15)} In-browser demo session</span>
            <span>${state.setupRequired ? 'First-run setup' : 'Sample data · nothing saved'}</span>
          </div>
        </section>
      </div>
    `,
    after(container) {
      const clearErrors = (form) => {
        form.querySelectorAll('[data-error]').forEach((slot) => { slot.innerHTML = ''; });
        form.querySelectorAll('.field--invalid').forEach((field) => field.classList.remove('field--invalid'));
        const general = form.querySelector('[data-form-error]');
        if (general) general.innerHTML = '';
      };
      const showError = (form, error) => {
        clearErrors(form);
        let shown = false;
        form.querySelectorAll('[data-error]').forEach((slot) => {
          const name = slot.dataset.error;
          const message = error?.fieldErrors?.[name];
          if (message) {
            slot.innerHTML = `<span class="field-error" role="alert">${icon('alert', 14)} ${escapeHtml(message)}</span>`;
            slot.closest('.field')?.classList.add('field--invalid');
            shown = true;
          }
        });
        if (!shown) {
          const general = form.querySelector('[data-form-error]');
          if (general) general.innerHTML = errorHtml(error);
        }
      };

      container.querySelector('[data-login-retry]')?.addEventListener('click', () => location.reload());
      container.querySelector('[data-login-continue]')?.addEventListener('click', () => navigate('/dashboard', { replace: true }));
      container.querySelector('[data-login-signout]')?.addEventListener('click', async () => {
        try {
          await logout();
          state.signOut();
          setBanner('Signed out. Sign in to reconnect.');
          rerender();
        } catch (error) {
          toast(error.message, { tone: 'danger', title: 'Sign out failed' });
        }
      });

      const loginFormElement = container.querySelector('#login-form');
      loginFormElement?.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(loginFormElement);
        const submit = loginFormElement.querySelector('[type="submit"]');
        submit.disabled = true;
        submit.textContent = 'Signing in…';
        try {
          const result = await loginRequest(
            loginFormElement.username.value.trim(),
            loginFormElement.password.value,
          );
          await afterSignIn(state, result);
        } catch (error) {
          showError(loginFormElement, error);
          loginFormElement.password.value = '';
          loginFormElement.password.focus();
        } finally {
          submit.disabled = false;
          submit.innerHTML = `Sign in ${icon('arrowRight', 17)}`;
        }
      });

      const setupFormElement = container.querySelector('#setup-form');
      setupFormElement?.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(setupFormElement);
        if (setupFormElement.password.value !== setupFormElement.confirm.value) {
          showError(setupFormElement, {
            message: 'The password confirmation does not match.',
            fieldErrors: { confirm: 'Passwords do not match.' },
          });
          return;
        }
        const submit = setupFormElement.querySelector('[type="submit"]');
        submit.disabled = true;
        submit.textContent = 'Creating administrator…';
        try {
          const result = await setupRequest({
            token: setupFormElement.token.value.trim(),
            username: setupFormElement.username.value.trim(),
            displayName: setupFormElement.displayName.value.trim(),
            password: setupFormElement.password.value,
          });
          await afterSignIn(state, result);
          toast('First administrator created. Add cashiers from Users & roles.', { tone: 'success', title: 'Shop ready' });
        } catch (error) {
          showError(setupFormElement, error);
        } finally {
          submit.disabled = false;
          submit.innerHTML = `Create administrator ${icon('arrowRight', 17)}`;
        }
      });

      const changeForm = container.querySelector('#change-password-form');
      changeForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(changeForm);
        if (changeForm.newPassword.value !== changeForm.confirm.value) {
          showError(changeForm, {
            message: 'The new password confirmation does not match.',
            fieldErrors: { confirm: 'Passwords do not match.' },
          });
          return;
        }
        const submit = changeForm.querySelector('[type="submit"]');
        submit.disabled = true;
        submit.textContent = 'Saving password…';
        try {
          await changePassword(changeForm.currentPassword.value, changeForm.newPassword.value);
          const result = await me();
          await state.store.refresh();
          state.hydrate(result.user);
          navigate('/dashboard', { replace: true });
          toast('Password updated. Other sessions were signed out.', { tone: 'success', title: 'Password saved' });
        } catch (error) {
          showError(changeForm, error);
        } finally {
          submit.disabled = false;
          submit.innerHTML = `Save password ${icon('arrowRight', 17)}`;
        }
      });
    },
    focus: '#login-title',
  };
}
