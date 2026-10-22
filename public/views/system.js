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
        description: 'Live server, database, and migration information. This screen does not verify backup or recovery readiness.',
        actions: badge('Shop server connected', 'success'),
      })}
      <div class="callout callout--warning">${icon('alert', 18)} <span><strong>Verify operations before production use.</strong> Backups are available through <code>scripts/backup.mjs</code>, but no backup schedule, off-site copy, restore drill, firewall review, or production deployment has been verified from this screen.</span></div>
      <section class="stat-grid stat-grid--four" aria-label="System status">
        ${statCard({ label: 'Application', value: status.app.version, hint: `Node ${status.app.node} · ${status.app.environment}`, tone: 'success', iconName: 'system' })}
        ${statCard({ label: 'Products / sales', value: `${counts.products} / ${counts.sales}`, hint: `${counts.stock_movements} stock movements`, iconName: 'box' })}
        ${statCard({ label: 'Active sessions', value: String(counts.active_sessions), hint: `${counts.active_users} active user${counts.active_users === 1 ? '' : 's'}`, iconName: 'users' })}
        ${statCard({ label: 'Uptime', value: `${uptimeMinutes} min`, hint: `Business date ${status.shop.businessDate}`, iconName: 'clock' })}
      </section>
      <div class="system-grid">
        <section class="card">
          <div class="card__head"><div><h2>Runtime boundary</h2><p>What is running for this shop server.</p></div>${badge(status.app.tls ? 'HTTPS' : 'HTTP loopback', status.app.tls ? 'success' : 'warning')}</div>
          <dl class="system-list">
            <div><dt>Web server</dt><dd>${badge('Express API + static UI', 'success')} <small>${escapeHtml(status.app.host)}:${status.app.port} · uptime ${uptimeMinutes} min</small></dd></div>
            <div><dt>PostgreSQL</dt><dd>${badge('Connected', 'success')} <small>${escapeHtml(status.database.name)} · server ${escapeHtml(status.database.version)}</small></dd></div>
            <div><dt>Authentication</dt><dd>${badge('Session authentication', 'success')} <small>ADMIN and CASHIER roles enforced by the API</small></dd></div>
            <div><dt>Inventory authority</dt><dd>${badge('PostgreSQL', 'success')} <small>Stock value and movement ledger are server-side</small></dd></div>
            <div><dt>Card data</dt><dd>${badge('Not collected', 'success')} <small>External terminal reference only</small></dd></div>
            <div><dt>Backup job</dt><dd>${badge('Not scheduled', 'warning')} <small>Manual scripts and restore steps require operator verification</small></dd></div>
          </dl>
        </section>
        <section class="card">
          <div class="card__head"><div><h2>Schema migrations</h2><p>Applied migrations in this database.</p></div>${badge(`${status.database.migrations.length} applied`, 'accent')}</div>
          <ul class="gate-list">
            ${status.database.migrations.map((migration) => `<li><span class="gate-dot gate-dot--done"></span><div><strong>${escapeHtml(migration.version)}</strong><small>${formatDateTime(migration.appliedAt)}</small></div>${badge('Applied', 'success')}</li>`).join('')}
          </ul>
          <div class="callout callout--muted">${icon('info', 16)} <span>Database started ${formatDateTime(status.database.startedAt)}. The runtime role is restricted by the least-privilege migration.</span></div>
        </section>
        <section class="card">
          <div class="card__head"><div><h2>Configuration snapshot</h2><p>Current shop settings from PostgreSQL.</p></div></div>
          <dl class="detail-list">
            <div><span>Shop</span><strong>${escapeHtml(settings.shopName)}</strong></div>
            <div><span>Currency / timezone</span><strong>${escapeHtml(settings.currency)} · ${escapeHtml(settings.timezone)}</strong></div>
            <div><span>Business-day cutoff</span><strong>${escapeHtml(settings.businessDayCutoff)}</strong></div>
            <div><span>Tax</span><strong>${settings.taxEnabled ? `${(settings.taxRateBps / 100).toFixed(2)}% ${settings.taxInclusive ? 'inclusive' : 'exclusive'}` : 'Disabled (0%)'}</strong></div>
            <div><span>Cashier discount limit</span><strong>${(settings.cashierDiscountLimitBps / 100).toFixed(2)}%</strong></div>
            <div><span>Terminal</span><strong>${escapeHtml(state.terminalLabel)}</strong></div>
            <div><span>Data source</span><strong>PostgreSQL via Express API</strong></div>
            <div><span>Server time</span><strong>${formatDateTime(status.serverTime, settings.timezone)}</strong></div>
          </dl>
        </section>
        <section class="card">
          <div class="card__head"><div><h2>Operational limits</h2><p>Known gaps that require action before production.</p></div>${badge('Review required', 'warning')}</div>
          <ul class="rule-list">
            <li>Non-loopback access requires TLS. HTTP on a non-loopback host is refused unless the test-only override is set.</li>
            <li>PostgreSQL should remain bound to loopback. This screen cannot inspect firewall or network rules.</li>
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
