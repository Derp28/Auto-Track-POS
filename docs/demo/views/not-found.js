import { emptyState, escapeHtml, icon, pageHeader } from '../js/ui.js';

export function renderNotFound(ctx) {
  return {
    html: `
      ${pageHeader({ eyebrow: 'Route not found', title: 'That screen does not exist' })}
      ${emptyState({
        iconName: 'search',
        title: 'Nothing lives at this route',
        message: 'The address may be mistyped, or the screen may not exist. Use the navigation to return to a shop screen.',
        action: '<a class="btn btn--primary" href="#/dashboard" data-nav>Back to dashboard</a>',
      })}
    `,
    focus: 'h1',
  };
}

export function renderDenied(ctx) {
  const user = ctx.state.currentUser;
  const reason = ctx.reason || 'Your role does not have access to that screen.';
  return {
    html: `
      ${pageHeader({ eyebrow: 'Role boundary', title: 'Access denied' })}
      <div class="callout callout--warning callout--large">
        ${icon('lock', 20)}
        <div>
          <strong>${escapeHtml(user ? `${user.displayName} · ${user.role === 'ADMIN' ? 'Administrator' : 'Cashier'}` : 'Signed out')}</strong>
          <p>${escapeHtml(reason)}</p>
          <p>The demo enforces role permissions for reads and writes in this tab.</p>
        </div>
      </div>
      ${emptyState({
        iconName: 'lock',
        title: 'Try a permitted screen',
        message: 'Switch to the administrator role in the top bar, or return to the dashboard for this cashier role.',
        action: '<a class="btn btn--primary" href="#/dashboard" data-nav>Back to dashboard</a>',
      })}
    `,
    focus: 'h1',
  };
}
