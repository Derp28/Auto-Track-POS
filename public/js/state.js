/**
 * Application state. Business data is hydrated from the Express API; the cart
 * and terminal label stay in memory for this browser session.
 */
import { calculateLine, calculateTotals } from './money.js';
import { ValidationError } from './validation-error.js';
import { can } from './permissions.js';

export function createAppState(store) {
  const state = {
    store,
    currentUser: null,
    setupRequired: false,
    setupEnabled: false,
    bootError: '',
    terminalLabel: store.meta.defaultTerminal || 'Counter 1',
    cart: [],
    lastRoute: '/dashboard',

    can(action) {
      return can(this.currentUser, action);
    },

    activeUsers() {
      return this.store.users.filter((user) => user.active);
    },

    hydrate(user) {
      this.currentUser = user ? (this.store.users.find((candidate) => candidate.id === user.id) || user) : null;
      this.cart = this.cart.filter((line) => this.store.products.some((product) => product.id === line.productId));
      return this.currentUser;
    },

    setSetupStatus(status) {
      this.setupRequired = Boolean(status.setupRequired);
      this.setupEnabled = Boolean(status.setupEnabled);
    },

    signOut() {
      this.currentUser = null;
      this.cart = [];
    },

    setTerminalLabel(label) {
      const next = String(label || '').trim();
      if (!next) throw new ValidationError('Terminal label is required.', 'TERMINAL_LABEL');
      if (next.length > 40) throw new ValidationError('Terminal label must be 40 characters or fewer.', 'TERMINAL_LABEL');
      this.terminalLabel = next;
      return next;
    },

    product(productId) {
      return this.store.products.find((product) => product.id === productId) || null;
    },

    addProduct(productId, quantity = 1) {
      const product = this.product(productId);
      if (!product) throw new ValidationError('Product not found.', 'NOT_FOUND');
      if (!product.active) throw new ValidationError('This product is archived.', 'PRODUCT_INACTIVE');
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new ValidationError('Quantity must be a whole number above zero.', 'INVALID_QUANTITY');
      }
      const existing = this.cart.find((line) => line.productId === productId);
      const nextQuantity = (existing?.quantity || 0) + quantity;
      if (nextQuantity > product.stockOnHand) {
        throw new ValidationError(
          product.stockOnHand === 0
            ? `${product.name} is out of stock.`
            : `Only ${product.stockOnHand} of ${product.name} are in stock.`,
          'INSUFFICIENT_STOCK',
        );
      }
      if (nextQuantity > this.store.settings.maxLineQuantity) {
        throw new ValidationError(
          `Maximum quantity per line is ${this.store.settings.maxLineQuantity}.`,
          'MAX_QUANTITY',
        );
      }
      if (existing) {
        existing.quantity = nextQuantity;
        return existing;
      }
      const line = {
        productId,
        quantity,
        discountBps: 0,
        discountReason: '',
        note: '',
      };
      this.cart.push(line);
      return line;
    },

    setQuantity(productId, quantity) {
      const line = this.cart.find((candidate) => candidate.productId === productId);
      if (!line) throw new ValidationError('Cart line not found.', 'NOT_FOUND');
      const product = this.product(productId);
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new ValidationError('Quantity must be a whole number above zero.', 'INVALID_QUANTITY');
      }
      if (quantity > product.stockOnHand) {
        throw new ValidationError(`Only ${product.stockOnHand} of ${product.name} are in stock.`, 'INSUFFICIENT_STOCK');
      }
      if (quantity > this.store.settings.maxLineQuantity) {
        throw new ValidationError(
          `Maximum quantity per line is ${this.store.settings.maxLineQuantity}.`,
          'MAX_QUANTITY',
        );
      }
      line.quantity = quantity;
      return line;
    },

    removeLine(productId) {
      this.cart = this.cart.filter((line) => line.productId !== productId);
    },

    clearCart() {
      this.cart = [];
    },

    setLineDiscount(productId, discountBps, reason = '', { approval = null } = {}) {
      const line = this.cart.find((candidate) => candidate.productId === productId);
      if (!line) throw new ValidationError('Cart line not found.', 'NOT_FOUND');
      if (!Number.isInteger(discountBps) || discountBps < 0 || discountBps > 10000) {
        throw new ValidationError('Discount must be between 0% and 100%.', 'INVALID_DISCOUNT');
      }
      if (
        this.currentUser?.role === 'CASHIER' &&
        discountBps > this.store.settings.cashierDiscountLimitBps &&
        !approval?.username
      ) {
        throw new ValidationError(
          `Cashier discount limit is ${this.store.settings.cashierDiscountLimitBps / 100}%. Administrator approval is required.`,
          'DISCOUNT_LIMIT',
        );
      }
      if (
        discountBps > 0 &&
        this.store.settings.discountReasonRequired &&
        !String(reason || '').trim()
      ) {
        throw new ValidationError('A reason is required for a line discount.', 'DISCOUNT_REASON_REQUIRED');
      }
      line.discountBps = discountBps;
      line.discountReason = String(reason || '').trim();
      line.discountApproval = approval;
      return line;
    },

    setLineNote(productId, note) {
      const line = this.cart.find((candidate) => candidate.productId === productId);
      if (!line) throw new ValidationError('Cart line not found.', 'NOT_FOUND');
      line.note = String(note || '').slice(0, 120);
      return line;
    },

    cartDetails() {
      return this.cart.map((line) => {
        const product = this.product(line.productId);
        if (!product) return null;
        const calculated = calculateLine({
          unitPriceCents: product.priceCents,
          quantity: line.quantity,
          discountBps: line.discountBps,
          taxRateBps: this.store.settings.taxEnabled ? this.store.settings.taxRateBps : 0,
          taxInclusive: this.store.settings.taxInclusive,
        });
        return {
          ...line,
          product,
          line: calculated,
          categoryName:
            this.store.categories.find((category) => category.id === product.categoryId)?.name || 'Uncategorized',
        };
      }).filter(Boolean);
    },

    cartTotals() {
      return calculateTotals(
        this.cartDetails().map((entry) => ({
          unitPriceCents: entry.product.priceCents,
          quantity: entry.quantity,
          discountBps: entry.discountBps,
        })),
        this.store.settings,
      );
    },

    cartQuantity() {
      return this.cart.reduce((total, line) => total + line.quantity, 0);
    },

    hasCart() {
      return this.cart.length > 0;
    },
  };

  return state;
}
