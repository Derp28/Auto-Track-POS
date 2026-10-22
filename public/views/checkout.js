import {
  amountInputValue,
  badge,
  debounce,
  emptyState,
  escapeHtml,
  icon,
  money,
  pageHeader,
} from '../js/ui.js';
import { formatPercentFromBps } from '../js/money.js';
import { confirmDialog, showDialog } from '../components/dialog.js';
import { openPaymentDialog } from '../components/payment-dialog.js';
import { toast } from '../components/toast.js';
import { navigate } from '../js/router.js';

let searchQuery = '';
let saleNote = '';

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function resultHtml(product, cartLine) {
  const out = product.stockOnHand <= 0;
  const inCart = cartLine?.quantity || 0;
  return `
    <button class="product-result ${out ? 'is-out' : ''}" type="button" data-add-product="${escapeHtml(product.id)}" ${out ? 'disabled' : ''}>
      <span class="product-result__mark" aria-hidden="true">${escapeHtml(initials(product.name))}</span>
      <span class="product-result__copy">
        <strong>${escapeHtml(product.name)}</strong>
        <small>${escapeHtml(product.sku)}${product.barcode ? ` · ${escapeHtml(product.barcode)}` : ''}</small>
        <span class="product-result__meta">${escapeHtml(product.categoryName)}${inCart ? ` · ${inCart} in cart` : ''}</span>
      </span>
      <span class="product-result__side">
        <strong>${money(product.priceCents)}</strong>
        ${out ? badge('Out of stock', 'danger') : product.stockOnHand <= product.reorderLevel ? badge(`${product.stockOnHand} left`, 'warning') : badge(`${product.stockOnHand} in stock`, 'muted')}
      </span>
      <span class="product-result__add" aria-hidden="true">${out ? icon('alert', 18) : icon('plus', 18)}</span>
    </button>
  `;
}

function renderSearchResults(container, state) {
  const resultsBox = container.querySelector('#product-results');
  const meta = container.querySelector('#search-meta');
  if (!resultsBox) return;
  const query = searchQuery.trim();
  const results = state.store.searchProducts(query, { limit: 18 });
  meta.textContent = query
    ? `${results.length} active product${results.length === 1 ? '' : 's'} matching “${query}”`
    : 'Popular products · search by name, SKU, or barcode';
  if (!results.length) {
    resultsBox.innerHTML = emptyState({
      iconName: 'search',
      title: 'No matching products',
      message: 'Try a different name, SKU, or barcode. Archived products are hidden from checkout.',
    });
    return;
  }
  resultsBox.innerHTML = results
    .map((product) => {
      const cartLine = state.cart.find((line) => line.productId === product.id);
      return resultHtml(product, cartLine);
    })
    .join('');
}

function cartLineHtml(entry, settings) {
  const { product, line } = entry;
  const maxed = entry.quantity >= product.stockOnHand || entry.quantity >= settings.maxLineQuantity;
  const discountLabel = entry.discountBps > 0
    ? `<span class="line-discount">${icon('minus', 12)} ${formatPercentFromBps(entry.discountBps)} off${entry.discountReason ? ` · ${escapeHtml(entry.discountReason)}` : ''}</span>`
    : '';
  return `
    <article class="cart-line" data-cart-line="${escapeHtml(product.id)}">
      <div class="cart-line__top">
        <span class="product-mark" aria-hidden="true">${escapeHtml(initials(product.name))}</span>
        <div class="cart-line__title">
          <strong>${escapeHtml(product.name)}</strong>
          <small>${escapeHtml(product.sku)} · ${money(product.priceCents, settings.currency)} each</small>
          ${discountLabel}
          ${entry.note ? `<span class="line-note">${icon('edit', 12)} ${escapeHtml(entry.note)}</span>` : ''}
        </div>
        <button class="icon-button icon-button--small" type="button" data-cart-action="remove" data-product-id="${escapeHtml(product.id)}" aria-label="Remove ${escapeHtml(product.name)} from cart">${icon('x', 16)}</button>
      </div>
      <div class="cart-line__bottom">
        <div class="qty-control" aria-label="Quantity for ${escapeHtml(product.name)}">
          <button class="qty-button" type="button" data-cart-action="decrease" data-product-id="${escapeHtml(product.id)}" aria-label="Decrease quantity" ${entry.quantity <= 1 ? 'disabled' : ''}>${icon('minus', 14)}</button>
          <input class="qty-input" type="number" min="1" max="${product.stockOnHand}" step="1" value="${entry.quantity}" data-cart-qty="${escapeHtml(product.id)}" aria-label="Quantity for ${escapeHtml(product.name)}">
          <button class="qty-button" type="button" data-cart-action="increase" data-product-id="${escapeHtml(product.id)}" aria-label="Increase quantity" ${maxed ? 'disabled' : ''}>${icon('plus', 14)}</button>
        </div>
        <div class="cart-line__actions">
          <button class="line-action" type="button" data-cart-action="discount" data-product-id="${escapeHtml(product.id)}">${icon('minus', 13)} Discount</button>
          <button class="line-action" type="button" data-cart-action="note" data-product-id="${escapeHtml(product.id)}">${icon('edit', 13)} Note</button>
        </div>
        <strong class="cart-line__total">${money(line.totalCents, settings.currency)}</strong>
      </div>
    </article>
  `;
}

function summaryHtml(state) {
  const totals = state.cartTotals();
  const settings = state.store.settings;
  const empty = !state.hasCart();
  return `
    <div class="totals-block">
      <div class="total-row"><span>Subtotal</span><span>${money(totals.subtotalCents, settings.currency)}</span></div>
      <div class="total-row ${totals.discountCents ? 'total-row--discount' : ''}"><span>Line discounts</span><span>${totals.discountCents ? `−${money(totals.discountCents, settings.currency)}` : money(0, settings.currency)}</span></div>
      <div class="total-row"><span>Tax ${settings.taxEnabled ? `<small>${formatPercentFromBps(settings.taxRateBps)} ${settings.taxInclusive ? 'incl.' : 'excl.'}</small>` : '<small>disabled</small>'}</span><span>${money(totals.taxCents, settings.currency)}</span></div>
      <div class="total-row total-row--grand"><span>Total due</span><span>${money(totals.totalCents, settings.currency)}</span></div>
    </div>
    <button class="btn btn--accent btn--block btn--lg" type="button" data-pay-button ${empty ? 'disabled' : ''}>
      ${icon('cash', 18)} ${empty ? 'Take payment' : `Take payment · ${money(totals.totalCents, settings.currency)}`}
    </button>
    <p class="info-disclaimer">${icon('lock', 14)} Cash or external card terminal only. No card data is stored.</p>
  `;
}

function renderCart(container, state, focusProductId = null) {
  const lines = state.cartDetails();
  const settings = state.store.settings;
  const cartBox = container.querySelector('#cart-lines');
  const countBadge = container.querySelector('#cart-count-badge');
  const countCopy = container.querySelector('#cart-count-copy');
  const clearButton = container.querySelector('#clear-cart');
  if (!cartBox) return;
  const cartQty = state.cartQuantity();
  const qtyLabel = `${cartQty} item${cartQty === 1 ? '' : 's'}`;
  countBadge.textContent = qtyLabel;
  countBadge.className = `badge ${state.hasCart() ? 'badge--accent' : 'badge--muted'}`;
  if (countCopy) countCopy.textContent = `${qtyLabel} in the cart`;
  clearButton.disabled = !state.hasCart();
  if (!lines.length) {
    cartBox.innerHTML = emptyState({
      iconName: 'cart',
      title: 'The cart is empty',
      message: 'Scan a barcode or search the catalog to start a sale.',
    });
  } else {
    cartBox.innerHTML = lines.map((entry) => cartLineHtml(entry, settings)).join('');
  }
  container.querySelector('#cart-summary').innerHTML = summaryHtml(state);
  if (focusProductId) {
    const input = cartBox.querySelector(`[data-cart-qty="${CSS.escape(focusProductId)}"]`);
    input?.focus();
    input?.select();
  }
}

function openDiscountDialog(state, productId, onChange) {
  const detail = state.cartDetails().find((entry) => entry.productId === productId);
  if (!detail) return;
  const settings = state.store.settings;
  const isCashier = state.currentUser.role === 'CASHIER';
  let control;
  control = showDialog({
    title: 'Line discount',
    description: `Apply a percentage discount to ${detail.product.name}.`,
    body: `
      <div class="dialog-copy">
        <div class="line-preview">
          <span class="product-mark" aria-hidden="true">${escapeHtml(initials(detail.product.name))}</span>
          <div><strong>${escapeHtml(detail.product.name)}</strong><small>${money(detail.product.priceCents, settings.currency)} × ${detail.quantity}</small></div>
          <strong>${money(detail.line.subtotalCents, settings.currency)}</strong>
        </div>
        <div class="field">
          <label for="discount-percent">Discount percent</label>
          <div class="input-suffix"><input id="discount-percent" name="discountPercent" type="number" min="0" max="100" step="0.01" value="${(detail.discountBps / 100).toFixed(2)}" inputmode="decimal"><span>%</span></div>
          <small class="field-hint">Line-percentage discounts only. Order-level fixed discounts are deferred.</small>
        </div>
        <div class="quick-chips" aria-label="Quick discount amounts">
          ${[0, 5, 10, 20].map((value) => `<button class="tender-chip" type="button" data-discount-quick="${value}">${value}%</button>`).join('')}
        </div>
        <div class="field">
          <label for="discount-reason">Discount reason ${settings.discountReasonRequired ? '<span class="required">*</span>' : '<span class="optional">(optional)</span>'}</label>
          <textarea id="discount-reason" name="discountReason" rows="3" maxlength="180" placeholder="Example: goodwill adjustment for a repeat customer">${escapeHtml(detail.discountReason || '')}</textarea>
        </div>
        <div class="callout callout--muted">Cashier limit: <strong>${formatPercentFromBps(settings.cashierDiscountLimitBps)}</strong>. Above that limit, an administrator must approve the discount at checkout.</div>
        <div data-override-wrap hidden>
          <div class="callout callout--warning">${icon('lock', 15)} <span>This discount is above the cashier limit. Enter an administrator's credentials. The server verifies them when the sale is completed.</span></div>
          <div class="field">
            <label for="discount-admin-username">Administrator username</label>
            <input id="discount-admin-username" autocomplete="username" autocapitalize="none" spellcheck="false">
          </div>
          <div class="field">
            <label for="discount-admin-password">Administrator password</label>
            <input id="discount-admin-password" type="password" autocomplete="current-password">
          </div>
        </div>
        <div data-discount-error></div>
      </div>
    `,
    footer: `
      <button class="btn btn--secondary" type="button" data-discount-cancel>Cancel</button>
      <button class="btn btn--primary" type="button" data-discount-save>Apply discount</button>
    `,
    initialFocus: '#discount-percent',
  });
  const dialog = control.dialog;
  const percentInput = dialog.querySelector('#discount-percent');
  const reasonInput = dialog.querySelector('#discount-reason');
  const overrideWrap = dialog.querySelector('[data-override-wrap]');
  const overrideUsername = dialog.querySelector('#discount-admin-username');
  const overridePassword = dialog.querySelector('#discount-admin-password');
  const errorSlot = dialog.querySelector('[data-discount-error]');

  function updateOverrideVisibility() {
    const percent = Number(percentInput.value);
    const needs = isCashier && Number.isFinite(percent) && Math.round(percent * 100) > settings.cashierDiscountLimitBps;
    overrideWrap.hidden = !needs;
  }

  percentInput.addEventListener('input', updateOverrideVisibility);
  dialog.querySelectorAll('[data-discount-quick]').forEach((button) => {
    button.addEventListener('click', () => {
      percentInput.value = Number(button.dataset.discountQuick).toFixed(2);
      updateOverrideVisibility();
      percentInput.focus();
    });
  });
  dialog.querySelector('[data-discount-cancel]').addEventListener('click', () => control.close());
  dialog.querySelector('[data-discount-save]').addEventListener('click', () => {
    const percent = Number(percentInput.value);
    const bps = Math.round(percent * 100);
    const reason = reasonInput.value.trim();
    errorSlot.innerHTML = '';
    if (!Number.isFinite(percent) || percent < 0 || percent > 100 || !Number.isInteger(bps)) {
      errorSlot.innerHTML = `<span class="field-error" role="alert">${icon('alert', 14)} Enter a discount from 0% to 100%.</span>`;
      percentInput.focus();
      return;
    }
    if (bps > 0 && settings.discountReasonRequired && !reason) {
      errorSlot.innerHTML = `<span class="field-error" role="alert">${icon('alert', 14)} A reason is required for a discount.</span>`;
      reasonInput.focus();
      return;
    }
    const needsApproval = isCashier && bps > settings.cashierDiscountLimitBps;
    let approval = null;
    if (needsApproval) {
      overrideWrap.hidden = false;
      if (!overrideUsername.value.trim() || !overridePassword.value) {
        errorSlot.innerHTML = `<span class="field-error" role="alert">${icon('alert', 14)} Enter an administrator username and password for this discount.</span>`;
        (overrideUsername.value.trim() ? overridePassword : overrideUsername).focus();
        return;
      }
      approval = { username: overrideUsername.value.trim(), password: overridePassword.value };
    }
    try {
      state.setLineDiscount(productId, bps, reason, { approval });
      control.close();
      onChange();
      toast(
        bps ? `Discount set to ${formatPercentFromBps(bps)}.` : 'Discount removed.',
        { tone: 'success', title: 'Cart updated' },
      );
    } catch (error) {
      errorSlot.innerHTML = `<span class="field-error" role="alert">${icon('alert', 14)} ${escapeHtml(error.message)}</span>`;
    }
  });
  updateOverrideVisibility();
}

function openNoteDialog(state, productId, onChange) {
  const detail = state.cartDetails().find((entry) => entry.productId === productId);
  if (!detail) return;
  let control;
  control = showDialog({
    title: 'Line note',
    description: 'Add a short note to this cart line.',
    body: `
      <div class="field">
        <label for="line-note">Note for ${escapeHtml(detail.product.name)}</label>
        <textarea id="line-note" rows="3" maxlength="120" placeholder="Example: customer will pick up the core tomorrow">${escapeHtml(detail.note || '')}</textarea>
        <small class="field-hint">The note is saved with the sale when you complete checkout.</small>
      </div>
    `,
    footer: `
      <button class="btn btn--secondary" type="button" data-note-cancel>Cancel</button>
      <button class="btn btn--primary" type="button" data-note-save>Save note</button>
    `,
    initialFocus: '#line-note',
  });
  control.dialog.querySelector('[data-note-cancel]').addEventListener('click', () => control.close());
  control.dialog.querySelector('[data-note-save]').addEventListener('click', () => {
    const note = control.dialog.querySelector('#line-note').value.trim();
    state.setLineNote(productId, note);
    control.close();
    onChange();
    toast('Line note updated.', { tone: 'success', title: 'Cart updated' });
  });
}

export function renderCheckout(ctx) {
  const { state } = ctx;
  const settings = state.store.settings;
  const cartCount = state.cartQuantity();
  return {
    html: `
      ${pageHeader({
        eyebrow: 'Counter sale · live terminal',
        title: 'Checkout',
        description: 'Search the catalog, edit the cart, and complete an atomic sale.',
        actions: `
          ${badge(`Terminal: ${state.terminalLabel}`, 'muted')}
          ${badge('Live stock', 'accent')}
        `,
      })}
      <div class="checkout-grid">
        <section class="checkout-panel checkout-panel--search" aria-labelledby="checkout-search-title">
          <div class="checkout-panel__head">
            <div>
              <h2 id="checkout-search-title">Find a part</h2>
              <p>Scan a barcode or search by name, SKU, or category.</p>
            </div>
            <span class="badge badge--muted">${state.store.products.filter((product) => product.active).length} active</span>
          </div>
          <div class="search-field">
            <span class="search-field__icon">${icon('search', 19)}</span>
            <input id="product-search" name="productSearch" type="search" placeholder="Scan barcode or search products…" autocomplete="off" value="${escapeHtml(searchQuery)}" aria-controls="product-results" aria-describedby="search-meta">
            <kbd>Enter</kbd>
          </div>
          <p class="search-meta" id="search-meta" aria-live="polite"></p>
          <div class="product-results" id="product-results" role="list"></div>
          <div class="checkout-panel__foot">
            ${icon('info', 15)} <span>Exact barcode/SKU matches add instantly. Out-of-stock items cannot be added.</span>
          </div>
        </section>

        <section class="checkout-panel checkout-panel--cart" aria-labelledby="checkout-cart-title">
          <div class="checkout-panel__head">
            <div>
              <h2 id="checkout-cart-title">Current sale</h2>
              <p id="cart-count-copy">${cartCount} item${cartCount === 1 ? '' : 's'} in the cart</p>
            </div>
            <div class="checkout-panel__head-actions">
              <span class="badge badge--accent" id="cart-count-badge">${cartCount} item${cartCount === 1 ? '' : 's'}</span>
              <button class="text-button text-button--danger" id="clear-cart" type="button" ${state.hasCart() ? '' : 'disabled'}>${icon('trash', 14)} Clear</button>
            </div>
          </div>
          <div class="cart-lines" id="cart-lines"></div>
        </section>

        <aside class="checkout-panel checkout-panel--summary" aria-labelledby="checkout-summary-title">
          <div class="checkout-panel__head">
            <div>
              <h2 id="checkout-summary-title">Payment</h2>
              <p>Totals calculated from the current catalog and settings.</p>
            </div>
            ${badge(state.currentUser.role === 'ADMIN' ? 'Admin' : 'Cashier', state.currentUser.role === 'ADMIN' ? 'accent' : 'warning')}
          </div>
          <div class="summary-scope">
            <span>${icon('store', 16)} ${escapeHtml(settings.shopName)}</span>
            <small>${escapeHtml(settings.address)}</small>
          </div>
          <div id="cart-summary"></div>
          <div class="sale-note">
            <label for="sale-note-input">Sale note <span class="optional">(optional)</span></label>
            <input id="sale-note-input" maxlength="140" placeholder="Example: customer will return for installation" value="${escapeHtml(saleNote)}">
          </div>
          <div class="summary-foot">
            <span class="status-dot status-dot--amber"></span>
            <span>Stock is checked and deducted when the sale is saved.</span>
          </div>
        </aside>
      </div>
    `,
    after(container) {
      const searchInput = container.querySelector('#product-search');
      const resultsBox = container.querySelector('#product-results');
      const cartBox = container.querySelector('#cart-lines');
      const noteInput = container.querySelector('#sale-note-input');
      const clearButton = container.querySelector('#clear-cart');

      const refresh = (focusProductId = null) => {
        renderSearchResults(container, state);
        renderCart(container, state, focusProductId);
      };
      const showError = (error) => toast(error.message || 'The action could not be completed.', { tone: 'danger', title: 'Check the cart' });

      const runSearch = debounce(() => {
        searchQuery = searchInput.value;
        renderSearchResults(container, state);
      }, 120);
      searchInput.addEventListener('input', runSearch);
      searchInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const query = searchInput.value.trim();
        if (!query) return;
        const exact = state.store.findExactProduct(query);
        if (exact) {
          try {
            state.addProduct(exact.id);
            searchInput.value = '';
            searchQuery = '';
            refresh();
            toast(`${exact.name} added to the cart.`, { tone: 'success', title: 'Item added' });
          } catch (error) {
            showError(error);
          }
          return;
        }
        const matches = state.store.searchProducts(query, { limit: 5 });
        if (matches.length === 1) {
          try {
            state.addProduct(matches[0].id);
            searchInput.value = '';
            searchQuery = '';
            refresh();
            toast(`${matches[0].name} added to the cart.`, { tone: 'success', title: 'Item added' });
          } catch (error) {
            showError(error);
          }
        } else if (!matches.length) {
          toast('No active product matches that scan or search.', { tone: 'warning', title: 'No match' });
        } else {
          toast('Several products match. Choose a result to add it.', { tone: 'info', title: 'Choose a product' });
        }
      });

      resultsBox.addEventListener('click', (event) => {
        const button = event.target.closest('[data-add-product]');
        if (!button) return;
        try {
          const product = state.product(button.dataset.addProduct);
          state.addProduct(button.dataset.addProduct);
          refresh();
          searchInput.focus();
          toast(`${product.name} added to the cart.`, { tone: 'success', title: 'Item added' });
        } catch (error) {
          showError(error);
        }
      });

      const changeQuantity = (productId, quantity) => {
        try {
          state.setQuantity(productId, quantity);
          renderCart(container, state, productId);
          renderSearchResults(container, state);
        } catch (error) {
          showError(error);
          renderCart(container, state, productId);
        }
      };

      cartBox.addEventListener('click', (event) => {
        const action = event.target.closest('[data-cart-action]');
        if (!action) return;
        const productId = action.dataset.productId;
        const detail = state.cartDetails().find((entry) => entry.productId === productId);
        if (!detail) return;
        if (action.dataset.cartAction === 'increase') {
          changeQuantity(productId, detail.quantity + 1);
        } else if (action.dataset.cartAction === 'decrease') {
          changeQuantity(productId, detail.quantity - 1);
        } else if (action.dataset.cartAction === 'remove') {
          state.removeLine(productId);
          refresh();
          toast(`${detail.product.name} removed from the cart.`, { tone: 'info', title: 'Cart updated' });
        } else if (action.dataset.cartAction === 'discount') {
          openDiscountDialog(state, productId, () => refresh());
        } else if (action.dataset.cartAction === 'note') {
          openNoteDialog(state, productId, () => refresh());
        }
      });

      cartBox.addEventListener('change', (event) => {
        const input = event.target.closest('[data-cart-qty]');
        if (!input) return;
        const productId = input.dataset.cartQty;
        const quantity = Number(input.value);
        if (!Number.isInteger(quantity) || quantity < 1) {
          toast('Quantity must be a whole number above zero.', { tone: 'danger', title: 'Invalid quantity' });
          renderCart(container, state, productId);
          return;
        }
        changeQuantity(productId, quantity);
      });
      cartBox.addEventListener('keydown', (event) => {
        const input = event.target.closest('[data-cart-qty]');
        if (!input) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          input.blur();
        }
      });

      clearButton.addEventListener('click', async () => {
        if (!state.hasCart()) return;
        const confirmed = await confirmDialog({
          title: 'Clear the current sale?',
          message: 'This removes every line from the current cart.',
          confirmText: 'Clear cart',
          tone: 'danger',
          details: 'The cart only exists in this browser session. Completed sales stay saved.',
        });
        if (!confirmed) return;
        state.clearCart();
        refresh();
        toast('Cart cleared. No sale was created.', { tone: 'info', title: 'Cart cleared' });
      });

      noteInput.addEventListener('input', () => {
        saleNote = noteInput.value;
      });

      container.querySelector('#cart-summary').addEventListener('click', (event) => {
        if (!event.target.closest('[data-pay-button]')) return;
        if (!state.hasCart()) return;
        openPaymentDialog({
          state,
          saleNote,
          onComplete: (sale) => {
            saleNote = '';
            searchQuery = '';
            toast(`Sale ${sale.number} saved. Opening the receipt.`, {
              tone: 'success',
              title: 'Sale complete',
            });
            navigate(`/receipt/${sale.id}`);
          },
        });
      });

      refresh();
    },
    focus: '#product-search',
  };
}
