import { clearFormErrors, escapeHtml, icon, setFormFieldError } from '../js/ui.js';
import { showDialog } from './dialog.js';
import { toast } from './toast.js';

export function openUserForm({ state, user = null, onSaved }) {
  const creating = !user;
  const lastAdmin = state.store.users.filter((candidate) => candidate.role === 'ADMIN' && candidate.active).length === 1 && user?.role === 'ADMIN' && user.active;
  let control;
  control = showDialog({
    title: creating ? 'New user' : 'Edit user',
    description: creating ? 'Create a shop account. A one-time temporary password is generated for the new user.' : `Update ${user.displayName}.`,
    body: `
      <form id="user-form" class="form-grid" novalidate>
        <div class="field">
          <label for="user-display-name">Display name <span class="required">*</span></label>
          <input id="user-display-name" name="displayName" maxlength="80" value="${escapeHtml(user?.displayName || '')}" required>
        </div>
        <div class="field">
          <label for="user-username">Username <span class="required">*</span></label>
          <input id="user-username" name="username" maxlength="32" autocomplete="off" value="${escapeHtml(user?.username || '')}" required>
          <small class="field-hint">Lowercase letters, numbers, dots, underscores, or hyphens.</small>
        </div>
        <div class="field">
          <label for="user-role">Role <span class="required">*</span></label>
          <select id="user-role" name="role" required>
            <option value="CASHIER" ${user?.role !== 'ADMIN' ? 'selected' : ''}>Cashier</option>
            <option value="ADMIN" ${user?.role === 'ADMIN' ? 'selected' : ''}>Administrator</option>
          </select>
        </div>
        <div class="form-grid__wide check-row">
          <input id="user-active" name="active" type="checkbox" ${user?.active !== false ? 'checked' : ''}>
          <label for="user-active">Active user</label>
        </div>
        ${lastAdmin ? `<div class="form-grid__wide callout callout--warning">${icon('lock', 16)} <span>This is the only active administrator. The server blocks demotion or deactivation.</span></div>` : ''}
        <div class="form-grid__wide callout callout--muted">${icon('info', 16)} <span>Role changes and deactivation revoke the user's active sessions. Passwords are stored only as scrypt hashes.</span></div>
        <div class="form-grid__wide" data-user-error></div>
      </form>
    `,
    footer: `
      <button class="btn btn--secondary" type="button" data-user-cancel>Cancel</button>
      <button class="btn btn--primary" type="submit" form="user-form">${creating ? 'Create user' : 'Update user'}</button>
    `,
    initialFocus: '#user-display-name',
  });
  const form = control.dialog.querySelector('#user-form');
  control.dialog.querySelector('[data-user-cancel]').addEventListener('click', () => control.close());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors(form);
    const submit = control.dialog.querySelector('[form="user-form"]');
    submit.disabled = true;
    const data = new FormData(form);
    const input = {
      displayName: String(data.get('displayName') || ''),
      username: String(data.get('username') || ''),
      role: String(data.get('role') || ''),
      active: Boolean(data.get('active')),
    };
    try {
      const saved = creating
        ? await state.store.createUser(input)
        : await state.store.updateUser(user.id, input);
      control.setSettled();
      control.close();
      if (creating) {
        showDialog({
          title: 'User created',
          description: `${saved.user.displayName} must change this temporary password at first sign-in.`,
          body: `
            <div class="field">
              <label for="temporary-password">Temporary password</label>
              <input id="temporary-password" value="${escapeHtml(saved.temporaryPassword || '')}" readonly>
              <small class="field-hint">Share it privately. It is shown only once and cannot be recovered.</small>
            </div>
          `,
          footer: `<button class="btn btn--primary" type="button" data-dialog-close>I have saved it</button>`,
          initialFocus: '#temporary-password',
        });
      }
      toast(`User ${creating ? 'created' : 'updated'} on the shop server.`, { tone: 'success', title: creating ? 'User created' : 'User updated' });
      onSaved?.(saved.user || saved);
    } catch (error) {
      if (error.fieldErrors) {
        Object.entries(error.fieldErrors).forEach(([field, message]) => setFormFieldError(form, field, message));
      } else {
        control.dialog.querySelector('[data-user-error]').innerHTML = `<div class="form-error" role="alert">${icon('alert', 16)} ${escapeHtml(error.message)}</div>`;
      }
    } finally {
      submit.disabled = false;
    }
  });
}
