import { money, icon } from '../js/ui.js';
import { uuid } from '../js/api.js';
import { reasonDialog } from './dialog.js';
import { toast } from './toast.js';

export async function openVoidDialog({ state, sale, approval = null, onDone }) {
  const clientRequestId = uuid();
  const reason = await reasonDialog({
    title: `Void ${sale.number}?`,
    message: 'A void keeps the original sale for review and restocks every line. The action is limited to the current business day.',
    label: 'Void reason',
    confirmText: 'Void sale',
    tone: 'danger',
    details: `
      <div class="detail-list detail-list--compact">
        <div><span>Original total</span><strong>${money(sale.totalCents, sale.currency)}</strong></div>
        <div><span>Lines to restock</span><strong>${sale.items.reduce((total, line) => total + line.quantity, 0)}</strong></div>
        <div><span>Approval</span><strong>${approval ? `Administrator ${icon('lock', 13)}` : 'Administrator account'}</strong></div>
      </div>
      <p class="callout callout--warning">${icon('alert', 15)} This is saved immediately and cannot be undone. The original sale remains in history.</p>
    `,
  });
  if (!reason) return false;
  try {
    await state.store.voidSale(sale.id, {
      reason,
      approval,
      clientRequestId,
    });
    toast(`Sale ${sale.number} was voided and stock was restored.`, {
      tone: 'success',
      title: 'Sale voided',
    });
    onDone?.();
    return true;
  } catch (error) {
    toast(error.message || 'The sale could not be voided.', { tone: 'danger', title: 'Void blocked' });
    return false;
  }
}
