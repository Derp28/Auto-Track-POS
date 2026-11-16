import { escapeHtml, icon } from '../js/ui.js';
import { can, roleLabel } from '../js/permissions.js';

const GROUPS = [
  {
    label: 'Operate',
    items: [
      {
        path: '/dashboard',
        label: 'Dashboard',
        iconName: 'dashboard',
        action: 'viewDashboard',
        description: 'This displays data about your store',
      },
      {
        path: '/checkout',
        label: 'Checkout',
        iconName: 'cart',
        action: 'viewCheckout',
        shortcut: 'F2',
        description: 'Search parts and take payment',
      },
      {
        path: '/sales',
        label: 'Sales',
        iconName: 'receipt',
        action: 'viewSales',
        description: 'Review shop sales, returns, and voids',
        cashierDescription: 'Review your sales, returns, and voids',
      },
    ],
  },
  {
    label: 'Stock',
    items: [
      {
        path: '/catalog',
        label: 'Catalog',
        iconName: 'box',
        action: 'viewCatalog',
        description: 'Prices, stock, and categories',
      },
      {
        path: '/inventory',
        label: 'Inventory',
        iconName: 'layers',
        action: 'viewInventory',
        description: 'Check stock levels and record adjustments',
        cashierDescription: 'Read-only stock levels and movement history',
      },
      {
        path: '/purchasing',
        label: 'Purchasing',
        iconName: 'truck',
        action: 'viewPurchasing',
        description: 'Open purchase orders and suppliers',
      },
    ],
  },
  {
    label: 'Insights',
    items: [{
      path: '/reports',
      label: 'Reports',
      iconName: 'chart',
      action: 'viewReports',
      description: 'Daily sales, valuation, and movements',
      cashierDescription: 'Your daily sales and sales history',
    }],
  },
  {
    label: 'Admin',
    items: [
      {
        path: '/users',
        label: 'Users & roles',
        iconName: 'users',
        action: 'viewUsers',
        description: 'Manage accounts, roles, and access',
      },
      {
        path: '/settings',
        label: 'Settings',
        iconName: 'settings',
        action: 'viewSettings',
        description: 'Shop details, tax, receipts, and targets',
      },
      {
        path: '/system',
        label: 'System status',
        iconName: 'system',
        action: 'viewSystem',
        description: 'Database health, backups, and versions',
      },
    ],
  },
];

function descriptionFor(item, user) {
  return user?.role === 'CASHIER' && item.cashierDescription
    ? item.cashierDescription
    : item.description;
}

function isActive(path, routePath) {
  if (path === '/sales') return routePath === '/sales' || routePath.startsWith('/sales/') || routePath.startsWith('/receipt/');
  if (path === '/inventory') return routePath === '/inventory' || routePath.startsWith('/inventory/');
  if (path === '/purchasing') return routePath === '/purchasing' || routePath.startsWith('/purchasing/');
  return path === routePath;
}

export function renderNav(user, routePath, store) {
  const lowStockCount = store.products.filter((product) => product.active && product.stockOnHand <= product.reorderLevel).length;
  return `
    <div class="sidebar__brand">
      <a class="brand" href="#/dashboard" data-nav aria-label="Auto-Track POS dashboard">
        <span class="brand__mark" aria-hidden="true">AT</span>
        <span class="brand__copy">
          <strong>Auto-Track</strong>
          <small>Parts &amp; Service POS</small>
        </span>
      </a>
      <button class="icon-button sidebar__close" type="button" data-nav-toggle aria-label="Close navigation">${icon('x', 20)}</button>
    </div>
    <nav class="sidebar__nav" aria-label="Primary navigation">
      ${GROUPS.map((group) => {
        const items = group.items.filter((item) => can(user, item.action));
        if (!items.length) return '';
        return `
          <div class="nav-group">
            <p class="nav-group__label">${escapeHtml(group.label)}</p>
            ${items
              .map((item) => {
                const helpText = descriptionFor(item, user);
                const helpId = `nav-help-${item.path.slice(1)}`;
                return `
                  <a class="nav-link ${isActive(item.path, routePath) ? 'is-active' : ''}" href="#${item.path}" data-nav data-nav-help="${escapeHtml(helpText)}" aria-describedby="${helpId}" ${isActive(item.path, routePath) ? 'aria-current="page"' : ''}>
                    <span class="nav-link__icon">${icon(item.iconName, 18)}</span>
                    <span>${escapeHtml(item.label)}</span>
                    ${item.path === '/inventory' && lowStockCount ? `<span class="nav-link__count" aria-label="${lowStockCount} low-stock products">${lowStockCount}</span>` : ''}
                    ${item.shortcut ? `<kbd>${escapeHtml(item.shortcut)}</kbd>` : ''}
                  </a>
                  <span id="${helpId}" hidden>${escapeHtml(helpText)}</span>
                `;
              })
              .join('')}
          </div>
        `;
      }).join('')}
    </nav>
    <div class="sidebar__foot">
      <div class="sidebar__role">
        <span class="avatar avatar--small" aria-hidden="true">${escapeHtml((user?.displayName || '?').split(' ').map((part) => part[0]).slice(0, 2).join(''))}</span>
        <span>
          <strong>${escapeHtml(user?.displayName || 'Not signed in')}</strong>
          <small>${escapeHtml(roleLabel(user))}</small>
        </span>
      </div>
      <p class="sidebar__stage"><span class="status-dot status-dot--amber"></span> Stage 2 live shop</p>
    </div>
  `;
}

let helpBound = false;
let helpTooltip = null;
let activeHelpLink = null;

function ensureHelpTooltip() {
  if (helpTooltip?.isConnected) return helpTooltip;
  helpTooltip = document.createElement('div');
  helpTooltip.className = 'nav-tooltip';
  helpTooltip.setAttribute('role', 'tooltip');
  helpTooltip.setAttribute('aria-hidden', 'true');
  helpTooltip.hidden = true;
  document.body.appendChild(helpTooltip);
  return helpTooltip;
}

function navLinkFromEvent(event) {
  const target = event.target instanceof Element ? event.target.closest('.nav-link[data-nav-help]') : null;
  return target;
}

function positionHelpTooltip(link, tooltip) {
  const gap = 10;
  const margin = 8;
  const linkRect = link.getBoundingClientRect();
  const tipRect = tooltip.getBoundingClientRect();
  const spaceRight = window.innerWidth - linkRect.right - gap - margin;
  const spaceLeft = linkRect.left - gap - margin;
  let left;
  let top;

  if (spaceRight >= tipRect.width) {
    left = linkRect.right + gap;
    top = linkRect.top + (linkRect.height - tipRect.height) / 2;
  } else if (spaceLeft >= tipRect.width) {
    left = linkRect.left - gap - tipRect.width;
    top = linkRect.top + (linkRect.height - tipRect.height) / 2;
  } else {
    left = Math.min(
      Math.max(margin, linkRect.left + (linkRect.width - tipRect.width) / 2),
      window.innerWidth - tipRect.width - margin,
    );
    const below = linkRect.bottom + gap;
    const above = linkRect.top - gap - tipRect.height;
    top = below + tipRect.height <= window.innerHeight - margin ? below : above;
  }

  top = Math.max(margin, Math.min(top, window.innerHeight - tipRect.height - margin));
  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
}

function showHelp(link) {
  if (!link?.isConnected || !link.dataset.navHelp) return;
  const tooltip = ensureHelpTooltip();
  activeHelpLink = link;
  tooltip.textContent = link.dataset.navHelp;
  tooltip.hidden = false;
  tooltip.classList.remove('is-visible');
  positionHelpTooltip(link, tooltip);
  tooltip.classList.add('is-visible');
}

export function hideNavHelp() {
  activeHelpLink = null;
  if (!helpTooltip) return;
  helpTooltip.classList.remove('is-visible');
  helpTooltip.hidden = true;
}

export function bindNavHelp(sidebar) {
  if (!sidebar || helpBound) return;
  helpBound = true;

  sidebar.addEventListener('mouseover', (event) => {
    const link = navLinkFromEvent(event);
    if (!link || !sidebar.contains(link)) return;
    const related = event.relatedTarget;
    if (related instanceof Node && link.contains(related)) return;
    showHelp(link);
  });

  sidebar.addEventListener('mouseout', (event) => {
    const link = navLinkFromEvent(event);
    if (!link) return;
    const related = event.relatedTarget;
    if (related instanceof Node && link.contains(related)) return;
    if (activeHelpLink === link) hideNavHelp();
  });

  sidebar.addEventListener('focusin', (event) => {
    const link = navLinkFromEvent(event);
    if (link) showHelp(link);
  });

  sidebar.addEventListener('focusout', (event) => {
    const link = navLinkFromEvent(event);
    if (!link) return;
    const related = event.relatedTarget;
    if (related instanceof Node && link.contains(related)) return;
    if (activeHelpLink === link) hideNavHelp();
  });

  const reposition = () => {
    if (!activeHelpLink) return;
    if (!activeHelpLink.isConnected) {
      hideNavHelp();
      return;
    }
    if (helpTooltip && !helpTooltip.hidden) positionHelpTooltip(activeHelpLink, helpTooltip);
  };

  sidebar.addEventListener('scroll', reposition, { passive: true });
  window.addEventListener('resize', reposition);
}
