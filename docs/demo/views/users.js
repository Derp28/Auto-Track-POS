import { badge, escapeHtml, icon, pageHeader } from '../js/ui.js';
import { formatDateTime } from '../js/money.js';
import { confirmDialog, showDialog } from '../components/dialog.js';
import { openUserForm } from '../components/user-form.js';
import { toast } from '../components/toast.js';

let userQuery = '';
let userRole = '';
let userActive = 'all';

function filtered(state) {
  const query = userQuery.trim().toLowerCase();
  return state.store.getUsers().filter((user) => {
    if (userRole && user.role !== userRole) return false;
    if (userActive === 'active' && !user.active) return false;
    if (userActive === 'inactive' && user.active) return false;
    if (query) {
      const haystack = `${user.displayName} ${user.username}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

function rows(state) {
  const activeAdmins = state.store.users.filter((user) => user.role === 'ADMIN' && user.active).length;
  return filtered(state).map((user) => `
    <tr class="${user.active ? '' : 'row--muted'}">
      <td>
        <div class="product-cell">
          <span class="avatar avatar--small" aria-hidden="true">${escapeHtml(user.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join(''))}</span>
          <div><strong>${escapeHtml(user.displayName)}</strong><small>${escapeHtml(user.username)}${user.id === state.currentUser.id ? ' · you' : ''}</small></div>
        </div>
      </td>
      <td>${badge(user.role === 'ADMIN' ? 'Administrator' : 'Cashier', user.role === 'ADMIN' ? 'accent' : 'warning')}</td>
      <td>${user.active ? badge('Active', 'success') : badge('Inactive', 'muted')}${user.role === 'ADMIN' && user.active && activeAdmins === 1 ? ' <span class="muted">last admin</span>' : ''}</td>
      <td>${user.lastLoginAt ? formatDateTime(user.lastLoginAt) : '<span class="muted">Never</span>'}</td>
      <td class="numeric"><div class="row-actions"><button class="icon-button icon-button--small" type="button" data-edit-user="${escapeHtml(user.id)}" aria-label="Edit ${escapeHtml(user.displayName)}" title="Edit user">${icon('edit', 15)}</button><button class="icon-button icon-button--small" type="button" data-reset-user="${escapeHtml(user.id)}" aria-label="Reset password for ${escapeHtml(user.displayName)}" title="Reset password">${icon('key', 15)}</button></div></td>
    </tr>
  `).join('');
}

export function renderUsers(ctx) {
  const { state } = ctx;
  return {
    html: `
      ${pageHeader({
        eyebrow: 'Administration · accounts',
        title: 'Users & roles',
        description: 'Administrator and cashier accounts. Role changes and password resets revoke existing sessions.',
        actions: `<button class="btn btn--primary" type="button" data-new-user>${icon('plus', 17)} New user</button>`,
      })}
      <div class="callout callout--warning">${icon('lock', 17)} <span>Administrator and cashier permissions are enforced by the server. Give each cashier their own account; do not share passwords.</span></div>
      <div class="toolbar toolbar--wrap">
        <div class="search-field search-field--compact">
          <span class="search-field__icon">${icon('search', 17)}</span>
          <input id="user-search" type="search" placeholder="Search name or username…" value="${escapeHtml(userQuery)}">
        </div>
        <label class="filter-field"><span>Role</span>
          <select id="user-role-filter">
            <option value="">All roles</option>
            <option value="ADMIN" ${userRole === 'ADMIN' ? 'selected' : ''}>Administrator</option>
            <option value="CASHIER" ${userRole === 'CASHIER' ? 'selected' : ''}>Cashier</option>
          </select>
        </label>
        <label class="filter-field"><span>Status</span>
          <select id="user-active-filter">
            <option value="all" ${userActive === 'all' ? 'selected' : ''}>All users</option>
            <option value="active" ${userActive === 'active' ? 'selected' : ''}>Active only</option>
            <option value="inactive" ${userActive === 'inactive' ? 'selected' : ''}>Inactive only</option>
          </select>
        </label>
      </div>
      <section class="card card--table">
        <div class="card__head"><div><h2>Shop users</h2><p id="user-count">${filtered(state).length} user${filtered(state).length === 1 ? '' : 's'} shown.</p></div>${badge('Last admin is protected', 'muted')}</div>
        <div id="user-table-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead><tbody>${rows(state)}</tbody></table></div></div>
      </section>
    `,
    after(container) {
      const body = container.querySelector('#user-table-body');
      const count = container.querySelector('#user-count');
      const refresh = () => {
        const list = filtered(state);
        count.textContent = `${list.length} user${list.length === 1 ? '' : 's'} shown.`;
        body.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead><tbody>${rows(state)}</tbody></table></div>`;
      };
      let timer;
      container.querySelector('#user-search').addEventListener('input', (event) => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          userQuery = event.target.value;
          refresh();
        }, 140);
      });
      container.querySelector('#user-role-filter').addEventListener('change', (event) => {
        userRole = event.target.value;
        refresh();
      });
      container.querySelector('#user-active-filter').addEventListener('change', (event) => {
        userActive = event.target.value;
        refresh();
      });
      container.querySelector('[data-new-user]').addEventListener('click', () => openUserForm({ state, onSaved: refresh }));
      body.addEventListener('click', async (event) => {
        const edit = event.target.closest('[data-edit-user]');
        if (edit) {
          const user = state.store.getUser(edit.dataset.editUser);
          if (user) openUserForm({ state, user, onSaved: refresh });
          return;
        }
        const reset = event.target.closest('[data-reset-user]');
        if (reset) {
          const user = state.store.getUser(reset.dataset.resetUser);
          if (!user) return;
          const confirmed = await confirmDialog({
            title: 'Reset this password?',
            message: `Generate a new temporary password for ${user.displayName}.`,
            confirmText: 'Reset password',
            details: 'All of this user’s sessions will be signed out. The temporary password is shown once.',
          });
          if (!confirmed) return;
          reset.disabled = true;
          try {
            const result = await state.store.resetUserPassword(user.id);
            showDialog({
              title: 'Temporary password',
              body: `<div class="dialog-copy"><p>Share this privately with ${escapeHtml(user.displayName)}. It is shown only once and must be changed at sign-in.</p><div class="temp-password"><span>Temporary password</span><strong>${escapeHtml(result.temporaryPassword)}</strong></div><div class="callout callout--warning">${icon('alert', 16)} <span>Existing sessions for this user were revoked.</span></div></div>`,
              footer: '<button class="btn btn--primary" type="button" data-dialog-close>I have saved it</button>',
              initialFocus: '#app-dialog [data-dialog-close]',
            });
            toast(`Password reset for ${user.displayName}.`, { tone: 'success', title: 'Password reset' });
          } catch (error) {
            toast(error.message, { tone: 'danger', title: 'Could not reset' });
          } finally {
            reset.disabled = false;
          }
        }
      });
    },
    focus: 'h1',
  };
}
