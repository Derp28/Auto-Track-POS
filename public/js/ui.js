/**
 * Shared, dependency-free UI helpers.
 */
import { formatMoney } from './money.js';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

export function icon(name, size = 18) {
  const paths = {
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    cart: '<circle cx="9" cy="20" r="1"/><circle cx="19" cy="20" r="1"/><path d="M3 4h2l2.4 10.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 7H6"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    box: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5M3 16l9 5 9-5"/>',
    truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7z"/><circle cx="7" cy="18" r="1.5"/><circle cx="18" cy="18" r="1.5"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.2"/><path d="M16 14.5c2.8 0 5 2.2 5 5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/>',
    system: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M4 12l5 5L20 6"/>',
    alert: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 9v5M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 9a7 7 0 0 1 11.6-2.4L20 9M4 15l2.3 2.4A7 7 0 0 0 18 15"/>',
    filter: '<path d="M3 5h18l-7 8v5l-4 2v-7L3 5z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9h.01M18 15h.01"/>',
    split: '<path d="M4 6h4l3 4M20 6h-4l-3 4M12 10v4"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="M12 14l-4 3M12 14l4 3"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 5l3 3"/>',
    package: '<path d="M4 7l8-4 8 4v10l-8 4-8-4V7z"/><path d="M4 7l8 4 8-4M12 11v10"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    store: '<path d="M3 9l2-5h14l2 5M4 9v11h16V9M9 20v-6h6v6"/><path d="M3 9h18"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.2 2.4c-.7.3-1.2 1-1.2 1.8v.3M12 17h.01"/>',
  };
  return `<svg class="icon" aria-hidden="true" focusable="false" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.info}</svg>`;
}

export function badge(label, tone = 'neutral') {
  return `<span class="badge badge--${escapeAttr(tone)}">${escapeHtml(label)}</span>`;
}

export function saleStatusTone(status) {
  return {
    COMPLETED: 'success',
    VOIDED: 'danger',
    PARTIALLY_RETURNED: 'warning',
    RETURNED: 'info',
  }[status] || 'neutral';
}

export function saleStatusLabel(status) {
  return {
    COMPLETED: 'Completed',
    VOIDED: 'Voided',
    PARTIALLY_RETURNED: 'Partially returned',
    RETURNED: 'Returned',
  }[status] || status;
}

export function poStatusTone(status) {
  return {
    DRAFT: 'neutral',
    ORDERED: 'info',
    PARTIALLY_RECEIVED: 'warning',
    RECEIVED: 'success',
    CLOSED: 'muted',
    CANCELLED: 'danger',
  }[status] || 'neutral';
}

export function poStatusLabel(status) {
  return {
    DRAFT: 'Draft',
    ORDERED: 'Ordered',
    PARTIALLY_RECEIVED: 'Partially received',
    RECEIVED: 'Received',
    CLOSED: 'Short-closed',
    CANCELLED: 'Cancelled',
  }[status] || status;
}

export function pageHeader({ eyebrow = '', title, description = '', actions = '' }) {
  return `
    <header class="page-header">
      <div class="page-header__copy">
        ${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ''}
        <h1 tabindex="-1">${escapeHtml(title)}</h1>
        ${description ? `<p class="page-header__description">${escapeHtml(description)}</p>` : ''}
      </div>
      ${actions ? `<div class="page-header__actions">${actions}</div>` : ''}
    </header>
  `;
}

export function statCard({ label, value, hint = '', tone = '', iconName = '' }) {
  return `
    <article class="stat-card ${tone ? `stat-card--${tone}` : ''}">
      <div class="stat-card__top">
        <span class="stat-card__label">${escapeHtml(label)}</span>
        ${iconName ? `<span class="stat-card__icon">${icon(iconName, 18)}</span>` : ''}
      </div>
      <strong class="stat-card__value">${escapeHtml(value)}</strong>
      ${hint ? `<span class="stat-card__hint">${escapeHtml(hint)}</span>` : ''}
    </article>
  `;
}

export function emptyState({ iconName = 'box', title, message, action = '' }) {
  return `
    <div class="state-card" role="status">
      <span class="state-card__icon">${icon(iconName, 26)}</span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
      ${action ? `<div class="state-card__action">${action}</div>` : ''}
    </div>
  `;
}

export function loadingState(label = 'Loading shop data…') {
  return `
    <div class="state-card state-card--loading" role="status" aria-busy="true">
      <span class="spinner" aria-hidden="true"></span>
      <h3>${escapeHtml(label)}</h3>
      <p>This is a simulated loading state. No network request is made.</p>
    </div>
  `;
}

export function errorState({ title = 'Could not load this view', message = 'Check the shop server and try again.', retry = true } = {}) {
  return `
    <div class="state-card state-card--error" role="alert">
      <span class="state-card__icon">${icon('alert', 26)}</span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
      ${retry ? '<button class="btn btn--secondary" type="button" data-retry-view>Retry view</button>' : ''}
    </div>
  `;
}

export function money(cents, currency = 'PHP') {
  return formatMoney(cents, currency);
}

export function metricRow(label, value, options = {}) {
  const { strong = false, tone = '', hint = '' } = options;
  return `
    <div class="metric-row ${strong ? 'metric-row--strong' : ''} ${tone ? `metric-row--${tone}` : ''}">
      <span>${escapeHtml(label)}${hint ? `<small>${escapeHtml(hint)}</small>` : ''}</span>
      <span>${escapeHtml(value)}</span>
    </div>
  `;
}

export function fieldError(message, id) {
  if (!message) return '';
  return `<span class="field-error" id="${escapeAttr(id)}" role="alert">${icon('alert', 14)} ${escapeHtml(message)}</span>`;
}

export function setFormFieldError(form, name, message) {
  const field = form?.elements?.namedItem(name);
  if (!field) return;
  const wrapper = field.closest('.field') || field.parentElement;
  if (!wrapper) return;
  wrapper.classList.toggle('field--invalid', Boolean(message));
  field.setAttribute('aria-invalid', message ? 'true' : 'false');
  const existing = wrapper.querySelector('.field-error');
  if (existing) existing.remove();
  if (message) {
    const error = document.createElement('span');
    error.className = 'field-error';
    error.setAttribute('role', 'alert');
    error.innerHTML = `${icon('alert', 14)} ${escapeHtml(message)}`;
    wrapper.appendChild(error);
    if (!field.getAttribute('aria-describedby')) field.setAttribute('aria-describedby', `${name}-error`);
  }
}

export function clearFormErrors(form) {
  form?.querySelectorAll('.field--invalid').forEach((field) => field.classList.remove('field--invalid'));
  form?.querySelectorAll('.field-error').forEach((error) => error.remove());
  form?.querySelectorAll('[aria-invalid]').forEach((field) => field.setAttribute('aria-invalid', 'false'));
}

export function debounce(fn, delay = 180) {
  let timeout;
  return (...args) => {
    window.clearTimeout(timeout);
    timeout = window.setTimeout(() => fn(...args), delay);
  };
}

export function printPrototype(kind = 'report') {
  // Receipts print with no page margin so the browser cannot draw its own
  // header/footer (URL, date, page numbers) around the receipt. The receipt
  // supplies its own padding instead.
  const receiptPage = kind === 'receipt' ? document.createElement('style') : null;
  if (receiptPage) {
    receiptPage.textContent = '@media print { @page { margin: 0; } body.print-receipt .receipt-print { padding: 3mm 2mm; } }';
    document.head.append(receiptPage);
  }
  document.body.classList.add(`print-${kind}`);
  window.setTimeout(() => {
    window.print();
    window.setTimeout(() => {
      document.body.classList.remove(`print-${kind}`);
      receiptPage?.remove();
    }, 200);
  }, 50);
}

export function amountInputValue(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

export function categoryOptions(categories, selectedId = '') {
  return categories
    .filter((category) => category.active)
    .map(
      (category) =>
        `<option value="${escapeAttr(category.id)}" ${category.id === selectedId ? 'selected' : ''}>${escapeHtml(category.name)}</option>`,
    )
    .join('');
}
