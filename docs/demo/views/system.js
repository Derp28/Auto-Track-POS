import { badge, escapeHtml, icon, pageHeader, statCard } from '../js/ui.js';
import { formatDateTime } from '../js/money.js';
import { api } from '../js/api.js';

export async function renderSystem(ctx) {
  const { state } = ctx;
  const settings = state.store.settings;
  const status = await api.get('/api/system/status');
  const counts = status.counts;
  const uptimeMinutes = Math.round(status.app.uptimeSeconds / 60);
  return {
    html: `
      ${pageHeader({
        eyebrow: 'Administration · runtime status',
        title: 'System status',
        description: 'Runtime information for this in-browser demo. Nothing here is a real server, database, or deployment.',
        actions: badge('Browser demo running', 'success'),
      })}
      <div class="callout callout--warning">${icon('alert', 18)} <span><strong>Demo only.</strong> This page reports the sample shop held in this tab. The real application ships a PostgreSQL-backed server, backup scripts, and deployment checks; none of them are running here.</span></div>
      <section class="stat-grid stat-grid--four" aria-label="System status">
        ${statCard({ label: 'Application', value: status.app.version, hint: `Demo · ${status.app.environment}`, tone: 'success', iconName: 'system' })}
        ${statCard({ label: 'Products / sales', value: `${counts.products} / ${counts.sales}`, hint: `${counts.stock_movements} stock movements`, iconName: 'box' })}
        ${statCard({ label: 'Active sessions', value: String(counts.active_sessions), hint: `${counts.active_users} active user${counts.active_users === 1 ? '' : 's'}`, iconName: 'users' })}
        ${statCard({ label: 'Uptime', value: `${uptimeMinutes} min`, hint: `Business date ${status.shop.businessDate}`, iconName: 'clock' })}
      </section>
      <div class="system-grid">
        <section class="card">
          <div class="card__head"><div><h2>Runtime boundary</h2><p>What is running in this tab.</p></div>${badge(status.app.tls ? 'HTTPS' : 'HTTP loopback', status.app.tls ? 'success' : 'warning')}</div>
          <dl class="system-list">
            <div><dt>Page runtime</dt><dd>${badge('Static files + mock API', 'success')} <small>${escapeHtml(status.app.host)}:${status.app.port} · uptime ${uptimeMinutes} min</small></dd></div>
            <div><dt>Database</dt><dd>${badge('None', 'warning')} <small>Fixture data in memory · nothing is persisted</small></dd></div>
            <div><dt>Authentication</dt><dd>${badge('Demo sign-in', 'success')} <small>ADMIN and CASHIER role rules enforced by the mock API</small></dd></div>
            <div><dt>Inventory authority</dt><dd>${badge('In-memory ledger', 'warning')} <small>Stock value and movements live in this tab</small></dd></div>
            <div><dt>Card data</dt><dd>${badge('Not collected', 'success')} <small>External terminal reference only</small></dd></div>
            <div><dt>Backup job</dt><dd>${badge('Not applicable', 'warning')} <small>Reload the page to reset the sample shop</small></dd></div>
          </dl>
        </section>
        <section class="card">
          <div class="card__head"><div><h2>Schema versions</h2><p>Demo schema versions loaded in this tab.</p></div>${badge(`${status.database.migrations.length} loaded`, 'accent')}</div>
          <ul class="gate-list">
            ${status.database.migrations.map((migration) => `<li><span class="gate-dot gate-dot--done"></span><div><strong>${escapeHtml(migration.version)}</strong><small>${formatDateTime(migration.appliedAt)}</small></div>${badge('Loaded', 'success')}</li>`).join('')}
          </ul>
          <div class="callout callout--muted">${icon('info', 16)} <span>Demo fixtures created ${formatDateTime(status.database.startedAt)}. No database or privilege model is involved.</span></div>
        </section>
        <section class="card">
          <div class="card__head"><div><h2>Configuration snapshot</h2><p>Current shop settings from the demo fixtures.</p></div></div>
          <dl class="detail-list">
            <div><span>Shop</span><strong>${escapeHtml(settings.shopName)}</strong></div>
            <div><span>Currency / timezone</span><strong>${escapeHtml(settings.currency)} · ${escapeHtml(settings.timezone)}</strong></div>
            <div><span>Business-day cutoff</span><strong>${escapeHtml(settings.businessDayCutoff)}</strong></div>
            <div><span>Tax</span><strong>${settings.taxEnabled ? `${(settings.taxRateBps / 100).toFixed(2)}% ${settings.taxInclusive ? 'inclusive' : 'exclusive'}` : 'Disabled (0%)'}</strong></div>
            <div><span>Cashier discount limit</span><strong>${(settings.cashierDiscountLimitBps / 100).toFixed(2)}%</strong></div>
            <div><span>Terminal</span><strong>${escapeHtml(state.terminalLabel)}</strong></div>
            <div><span>Data source</span><strong>Sample fixtures in your browser</strong></div>
            <div><span>Browser time</span><strong>${formatDateTime(status.serverTime, settings.timezone)}</strong></div>
          </dl>
        </section>
        <section class="card">
          <div class="card__head"><div><h2>Operational limits</h2><p>Known gaps in the production system, not in this demo.</p></div>${badge('Review required', 'warning')}</div>
          <ul class="rule-list">
            <li>Non-loopback access requires TLS. HTTP on a non-loopback host is refused unless the test-only override is set.</li>
            <li>The production deployment keeps PostgreSQL bound to loopback and requires TLS for LAN access; neither is part of this demo.</li>
            <li>No automated backup schedule, off-site retention, or production restore drill is configured.</li>
            <li>No card payment integration is present. External terminal references are optional and manually entered.</li>
            <li>Browser printing depends on the operating system and printer configuration.</li>
            <li>No offline checkout or multi-server sync exists.</li>
          </ul>
          <div class="callout callout--danger">${icon('alert', 16)} <span>Do not treat this status page as proof of production readiness. Verify access controls, deployment, backup, and recovery separately.</span></div>
        </section>
      </div>
    `,
    focus: 'h1',
  };
}
