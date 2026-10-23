import { escapeHtml, icon } from '../js/ui.js';
import { can, roleLabel } from '../js/permissions.js';

const GROUPS = [
  {
    label: 'Operate',
    items: [
      { path: '/dashboard', label: 'Dashboard', iconName: 'dashboard', action: 'viewDashboard' },
      { path: '/checkout', label: 'Checkout', iconName: 'cart', action: 'viewCheckout', shortcut: 'F2' },
      { path: '/sales', label: 'Sales', iconName: 'receipt', action: 'viewSales' },
    ],
  },
  {
    label: 'Stock',
    items: [
      { path: '/catalog', label: 'Catalog', iconName: 'box', action: 'viewCatalog' },
      { path: '/inventory', label: 'Inventory', iconName: 'layers', action: 'viewInventory' },
      { path: '/purchasing', label: 'Purchasing', iconName: 'truck', action: 'viewPurchasing' },
    ],
  },
  {
    label: 'Insights',
    items: [{ path: '/reports', label: 'Reports', iconName: 'chart', action: 'viewReports' }],
  },
  {
    label: 'Admin',
    items: [
      { path: '/users', label: 'Users & roles', iconName: 'users', action: 'viewUsers' },
      { path: '/settings', label: 'Settings', iconName: 'settings', action: 'viewSettings' },
      { path: '/system', label: 'System status', iconName: 'system', action: 'viewSystem' },
    ],
  },
];

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
              .map(
                (item) => `
                  <a class="nav-link ${isActive(item.path, routePath) ? 'is-active' : ''}" href="#${item.path}" data-nav ${isActive(item.path, routePath) ? 'aria-current="page"' : ''}>
                    <span class="nav-link__icon">${icon(item.iconName, 18)}</span>
                    <span>${escapeHtml(item.label)}</span>
                    ${item.path === '/inventory' && lowStockCount ? `<span class="nav-link__count" aria-label="${lowStockCount} low-stock products">${lowStockCount}</span>` : ''}
                    ${item.shortcut ? `<kbd>${escapeHtml(item.shortcut)}</kbd>` : ''}
                  </a>
                `,
              )
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
      <p class="sidebar__stage"><span class="status-dot status-dot--amber"></span> Interactive demo</p>
    </div>
  `;
}
