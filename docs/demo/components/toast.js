import { escapeHtml, icon } from '../js/ui.js';

const ICONS = {
  success: 'check',
  danger: 'alert',
  warning: 'alert',
  info: 'info',
};

export function toast(message, { tone = 'info', title = 'Auto-Track', duration = 4200 } = {}) {
  const region = document.getElementById('toast-region');
  if (!region) return;
  const node = document.createElement('div');
  node.className = `toast toast--${tone}`;
  node.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
  node.innerHTML = `
    <span class="toast__icon">${icon(ICONS[tone] || 'info', 18)}</span>
    <div class="toast__copy">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(message)}</span>
    </div>
    <button class="icon-button icon-button--small" type="button" aria-label="Dismiss notification" data-toast-close>
      ${icon('x', 15)}
    </button>
  `;
  region.appendChild(node);
  const remove = () => {
    node.classList.add('toast--leaving');
    window.setTimeout(() => node.remove(), 180);
  };
  node.querySelector('[data-toast-close]')?.addEventListener('click', remove);
  while (region.children.length > 4) region.firstElementChild?.remove();
  window.setTimeout(remove, duration);
}
