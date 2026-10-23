import { escapeHtml, fieldError, icon } from '../js/ui.js';

function getDialog() {
  let dialog = document.getElementById('app-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'app-dialog';
    dialog.className = 'modal';
    document.body.appendChild(dialog);
  }
  return dialog;
}

let dialogGeneration = 0;

export function showDialog({
  title,
  description = '',
  body = '',
  footer = '',
  size = 'md',
  onMount,
  onClose,
  initialFocus = '',
} = {}) {
  const dialog = getDialog();
  const generation = ++dialogGeneration;
  if (dialog.open) dialog.close();
  dialog.innerHTML = `
    <div class="modal__panel modal__panel--${escapeHtml(size)}" role="document">
      <header class="modal__header">
        <div>
          <h2 id="app-dialog-title">${escapeHtml(title)}</h2>
          ${description ? `<p>${escapeHtml(description)}</p>` : ''}
        </div>
        <button class="icon-button" type="button" data-dialog-close aria-label="Close dialog">${icon('x', 19)}</button>
      </header>
      <div class="modal__body">${body}</div>
      ${footer ? `<footer class="modal__footer">${footer}</footer>` : ''}
    </div>
  `;
  dialog.setAttribute('aria-labelledby', 'app-dialog-title');
  let settled = false;
  const close = () => {
    if (dialog.open) dialog.close();
  };
  const clickHandler = (event) => {
    if (event.target === dialog) close();
    if (event.target.closest('[data-dialog-close]')) close();
  };
  dialog.addEventListener('click', clickHandler);
  const closeHandler = () => {
    // A close event from the previous dialog can arrive after this dialog has
    // opened. Only the handler that belongs to the current dialog may settle it.
    if (generation !== dialogGeneration) {
      dialog.removeEventListener('click', clickHandler);
      dialog.removeEventListener('close', closeHandler);
      return;
    }
    if (dialog.open) return;
    dialog.removeEventListener('click', clickHandler);
    dialog.removeEventListener('close', closeHandler);
    document.body.classList.remove('modal-open');
    onClose?.(settled);
    settled = true;
    window.setTimeout(() => {
      if (!dialog.open) dialog.innerHTML = '';
    }, 120);
  };
  dialog.addEventListener('close', closeHandler);
  document.body.classList.add('modal-open');
  dialog.showModal();
  const focusTarget = initialFocus
    ? dialog.querySelector(initialFocus)
    : dialog.querySelector('input:not([type="hidden"]), select, textarea, button');
  focusTarget?.focus();
  onMount?.(dialog, { close });

  return {
    dialog,
    close,
    setSettled() {
      settled = true;
    },
  };
}

export function confirmDialog({
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  tone = 'primary',
  details = '',
}) {
  return new Promise((resolve) => {
    let answered = false;
    let control;
    control = showDialog({
      title,
      body: `
        <div class="dialog-copy">
          <p>${escapeHtml(message)}</p>
          ${details ? `<div class="callout callout--muted">${details}</div>` : ''}
        </div>
      `,
      footer: `
        <button class="btn btn--secondary" type="button" data-confirm-cancel>${escapeHtml(cancelText)}</button>
        <button class="btn btn--${escapeHtml(tone)}" type="button" data-confirm-ok>${escapeHtml(confirmText)}</button>
      `,
      initialFocus: '[data-confirm-ok]',
      onClose: () => {
        if (!answered) resolve(false);
      },
    });
    control.dialog.querySelector('[data-confirm-ok]').addEventListener('click', () => {
      answered = true;
      control.setSettled();
      control.close();
      resolve(true);
    });
    control.dialog.querySelector('[data-confirm-cancel]').addEventListener('click', () => {
      answered = true;
      control.setSettled();
      control.close();
      resolve(false);
    });
  });
}

export function reasonDialog({
  title,
  message,
  label = 'Reason',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  tone = 'primary',
  required = true,
  details = '',
  extra = '',
}) {
  return new Promise((resolve) => {
    let answered = false;
    let control;
    control = showDialog({
      title,
      body: `
        <div class="dialog-copy">
          <p>${escapeHtml(message)}</p>
          ${details ? `<div class="callout callout--muted">${details}</div>` : ''}
          ${extra}
          <div class="field">
            <label for="dialog-reason">${escapeHtml(label)} <span class="required">*</span></label>
            <textarea id="dialog-reason" name="reason" rows="3" maxlength="280" placeholder="Add a short reason for the record"></textarea>
            <div data-reason-error></div>
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn--secondary" type="button" data-reason-cancel>${escapeHtml(cancelText)}</button>
        <button class="btn btn--${escapeHtml(tone)}" type="button" data-reason-ok>${escapeHtml(confirmText)}</button>
      `,
      initialFocus: '#dialog-reason',
      onClose: () => {
        if (!answered) resolve(null);
      },
    });
    const input = control.dialog.querySelector('#dialog-reason');
    const errorSlot = control.dialog.querySelector('[data-reason-error]');
    control.dialog.querySelector('[data-reason-ok]').addEventListener('click', () => {
      const value = input.value.trim();
      if (required && !value) {
        errorSlot.innerHTML = fieldError('A reason is required.', 'dialog-reason-error');
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      answered = true;
      control.setSettled();
      control.close();
      resolve(value);
    });
    control.dialog.querySelector('[data-reason-cancel]').addEventListener('click', () => {
      answered = true;
      control.setSettled();
      control.close();
      resolve(null);
    });
  });
}

export function adminOverrideDialog({ action = 'this action', details = '' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    let control;
    control = showDialog({
      title: 'Administrator approval required',
      description: 'An active administrator must approve this correction with their own credentials.',
      body: `
        <div class="dialog-copy">
          <p>A cashier is attempting to <strong>${escapeHtml(action)}</strong>.</p>
          ${details ? `<div class="callout callout--warning">${details}</div>` : ''}
          <div class="field">
            <label for="override-username">Administrator username</label>
            <input id="override-username" autocomplete="username" autocapitalize="none" spellcheck="false">
            <div data-override-error="username"></div>
          </div>
          <div class="field">
            <label for="override-password">Administrator password</label>
            <input id="override-password" type="password" autocomplete="current-password">
            <div data-override-error="password"></div>
          </div>
          <div class="callout callout--muted">${icon('lock', 15)} The server verifies these credentials and records the approving administrator. They are never stored in the cart.</div>
        </div>
      `,
      footer: `
        <button class="btn btn--secondary" type="button" data-override-cancel>Cancel</button>
        <button class="btn btn--primary" type="button" data-override-ok>Approve for this action</button>
      `,
      initialFocus: '#override-username',
      onClose: () => {
        if (!answered) resolve(null);
      },
    });
    const username = control.dialog.querySelector('#override-username');
    const password = control.dialog.querySelector('#override-password');
    const errorSlot = control.dialog.querySelector('[data-override-error="username"]');
    const approve = () => {
      errorSlot.innerHTML = '';
      if (!username.value.trim() || !password.value) {
        errorSlot.innerHTML = fieldError('Enter the administrator username and password.', 'override-error');
        (username.value.trim() ? password : username).focus();
        return;
      }
      answered = true;
      control.setSettled();
      control.close();
      resolve({ username: username.value.trim(), password: password.value });
    };
    control.dialog.querySelector('[data-override-ok]').addEventListener('click', approve);
    password.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        approve();
      }
    });
    control.dialog.querySelector('[data-override-cancel]').addEventListener('click', () => {
      answered = true;
      control.setSettled();
      control.close();
      resolve(null);
    });
  });
}

export function closeDialog() {
  const dialog = document.getElementById('app-dialog');
  if (dialog?.open) dialog.close();
}
