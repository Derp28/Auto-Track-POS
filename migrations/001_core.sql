-- Auto-Track POS core schema.
-- Money is stored as integer cents (BIGINT). Percentages are basis points (INTEGER).
-- Completed sales, payments, stock movements, and audit records are immutable by trigger
-- (see 002_immutability.sql).

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'CASHIER')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  password_hash TEXT NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (length(btrim(username)) BETWEEN 3 AND 40),
  CHECK (length(btrim(display_name)) BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX users_username_lower_uq ON users (lower(username));
CREATE INDEX users_role_active_idx ON users (role, active);

CREATE TABLE sessions (
  id BIGSERIAL PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idle_expires_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (idle_expires_at);

CREATE TABLE settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  shop_name TEXT NOT NULL CHECK (length(btrim(shop_name)) BETWEEN 1 AND 120),
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  tin TEXT NOT NULL DEFAULT '',
  currency CHAR(3) NOT NULL DEFAULT 'PHP' CHECK (currency ~ '^[A-Z]{3}$'),
  timezone TEXT NOT NULL DEFAULT 'Asia/Manila',
  business_day_cutoff TIME NOT NULL DEFAULT '00:00',
  receipt_header TEXT NOT NULL DEFAULT '',
  receipt_footer TEXT NOT NULL DEFAULT '',
  receipt_width TEXT NOT NULL DEFAULT '80mm' CHECK (receipt_width IN ('58mm', '80mm')),
  returns_policy TEXT NOT NULL DEFAULT '',
  tax_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  tax_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  tax_inclusive BOOLEAN NOT NULL DEFAULT FALSE,
  cashier_discount_limit_bps INTEGER NOT NULL DEFAULT 0 CHECK (cashier_discount_limit_bps BETWEEN 0 AND 10000),
  discount_reason_required BOOLEAN NOT NULL DEFAULT TRUE,
  max_line_quantity INTEGER NOT NULL DEFAULT 999 CHECK (max_line_quantity BETWEEN 1 AND 9999),
  allow_negative_stock BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by BIGINT REFERENCES users(id),
  CONSTRAINT settings_no_negative_stock CHECK (allow_negative_stock = FALSE)
);

CREATE TABLE categories (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  description TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT REFERENCES users(id),
  updated_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_name_lower_uq ON categories (lower(name));

CREATE TABLE suppliers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  contact_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT REFERENCES users(id),
  updated_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX suppliers_name_lower_uq ON suppliers (lower(name));

CREATE TABLE products (
  id BIGSERIAL PRIMARY KEY,
  sku TEXT NOT NULL CHECK (length(btrim(sku)) BETWEEN 1 AND 40),
  barcode TEXT,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '',
  category_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  cost_cents BIGINT NOT NULL CHECK (cost_cents >= 0),
  price_cents BIGINT NOT NULL CHECK (price_cents >= 0),
  stock_on_hand BIGINT NOT NULL DEFAULT 0 CHECK (stock_on_hand >= 0),
  stock_value_cents BIGINT NOT NULL DEFAULT 0 CHECK (stock_value_cents >= 0),
  reorder_level BIGINT NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT REFERENCES users(id),
  updated_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT products_zero_stock_zero_value CHECK (stock_on_hand > 0 OR stock_value_cents = 0)
);
CREATE UNIQUE INDEX products_sku_lower_uq ON products (lower(sku));
CREATE UNIQUE INDEX products_barcode_lower_uq ON products (lower(barcode)) WHERE barcode IS NOT NULL;
CREATE INDEX products_category_idx ON products (category_id);
CREATE INDEX products_name_lower_idx ON products (lower(name));
CREATE INDEX products_active_stock_idx ON products (active, stock_on_hand);

CREATE TABLE purchase_orders (
  id BIGSERIAL PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED')),
  expected_at DATE,
  notes TEXT NOT NULL DEFAULT '',
  ordered_total_cents BIGINT NOT NULL DEFAULT 0 CHECK (ordered_total_cents >= 0),
  received_total_cents BIGINT NOT NULL DEFAULT 0 CHECK (received_total_cents >= 0),
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ordered_at TIMESTAMPTZ,
  ordered_by BIGINT REFERENCES users(id),
  received_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  closed_by BIGINT REFERENCES users(id),
  close_reason TEXT,
  cancelled_at TIMESTAMPTZ,
  cancelled_by BIGINT REFERENCES users(id),
  cancel_reason TEXT,
  CHECK (received_total_cents <= ordered_total_cents)
);
CREATE INDEX purchase_orders_status_idx ON purchase_orders (status, created_at DESC);
CREATE INDEX purchase_orders_supplier_idx ON purchase_orders (supplier_id);

CREATE TABLE purchase_order_items (
  id BIGSERIAL PRIMARY KEY,
  purchase_order_id BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  ordered_qty INTEGER NOT NULL CHECK (ordered_qty > 0),
  received_qty INTEGER NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  unit_cost_cents BIGINT NOT NULL CHECK (unit_cost_cents >= 0),
  ordered_total_cents BIGINT NOT NULL CHECK (ordered_total_cents >= 0),
  received_total_cents BIGINT NOT NULL DEFAULT 0 CHECK (received_total_cents >= 0),
  UNIQUE (purchase_order_id, product_id),
  CHECK (received_qty <= ordered_qty),
  CHECK (ordered_total_cents = unit_cost_cents * ordered_qty),
  CHECK (received_total_cents = unit_cost_cents * received_qty)
);

CREATE TABLE po_receipts (
  id BIGSERIAL PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  purchase_order_id BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  received_by BIGINT NOT NULL REFERENCES users(id),
  total_cents BIGINT NOT NULL CHECK (total_cents >= 0),
  note TEXT NOT NULL DEFAULT '',
  client_request_id TEXT NOT NULL UNIQUE,
  payload_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX po_receipts_po_idx ON po_receipts (purchase_order_id);

CREATE TABLE po_receipt_items (
  id BIGSERIAL PRIMARY KEY,
  receipt_id BIGINT NOT NULL REFERENCES po_receipts(id) ON DELETE RESTRICT,
  po_item_id BIGINT NOT NULL REFERENCES purchase_order_items(id) ON DELETE RESTRICT,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost_cents BIGINT NOT NULL CHECK (unit_cost_cents >= 0),
  total_cents BIGINT NOT NULL CHECK (total_cents = unit_cost_cents * quantity)
);
CREATE INDEX po_receipt_items_receipt_idx ON po_receipt_items (receipt_id);

CREATE TABLE sales (
  id BIGSERIAL PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'VOIDED')),
  cashier_id BIGINT NOT NULL REFERENCES users(id),
  cashier_name TEXT NOT NULL,
  terminal_label TEXT NOT NULL CHECK (length(btrim(terminal_label)) BETWEEN 1 AND 40),
  note TEXT NOT NULL DEFAULT '',
  subtotal_cents BIGINT NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents BIGINT NOT NULL CHECK (discount_cents >= 0),
  net_cents BIGINT NOT NULL CHECK (net_cents >= 0),
  tax_cents BIGINT NOT NULL CHECK (tax_cents >= 0),
  total_cents BIGINT NOT NULL CHECK (total_cents >= 0),
  tax_rate_bps INTEGER NOT NULL CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  tax_inclusive BOOLEAN NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'PHP',
  business_date DATE NOT NULL,
  client_request_id TEXT NOT NULL UNIQUE,
  payload_hash CHAR(64) NOT NULL,
  voided_at TIMESTAMPTZ,
  voided_by BIGINT REFERENCES users(id),
  void_approved_by BIGINT REFERENCES users(id),
  void_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sales_net_check CHECK (net_cents = subtotal_cents - discount_cents),
  CONSTRAINT sales_discount_check CHECK (discount_cents <= subtotal_cents),
  CONSTRAINT sales_total_exclusive_check CHECK (
    (tax_inclusive AND total_cents = net_cents)
    OR ((NOT tax_inclusive) AND total_cents = net_cents + tax_cents)
  ),
  CONSTRAINT sales_void_fields_check CHECK (
    (status = 'COMPLETED' AND voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR (status = 'VOIDED' AND voided_at IS NOT NULL AND voided_by IS NOT NULL AND length(btrim(void_reason)) > 0)
  )
);
CREATE INDEX sales_business_date_idx ON sales (business_date);
CREATE INDEX sales_cashier_date_idx ON sales (cashier_id, business_date);
CREATE INDEX sales_created_idx ON sales (created_at DESC);

CREATE TABLE sale_items (
  id BIGSERIAL PRIMARY KEY,
  sale_id BIGINT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  sku TEXT NOT NULL,
  barcode TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents >= 0),
  unit_cost_cents BIGINT NOT NULL CHECK (unit_cost_cents >= 0),
  discount_bps INTEGER NOT NULL DEFAULT 0 CHECK (discount_bps BETWEEN 0 AND 10000),
  discount_reason TEXT NOT NULL DEFAULT '',
  discount_approved_by BIGINT REFERENCES users(id),
  note TEXT NOT NULL DEFAULT '',
  subtotal_cents BIGINT NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents BIGINT NOT NULL CHECK (discount_cents >= 0),
  net_cents BIGINT NOT NULL CHECK (net_cents >= 0),
  tax_cents BIGINT NOT NULL CHECK (tax_cents >= 0),
  total_cents BIGINT NOT NULL CHECK (total_cents >= 0),
  cost_value_cents BIGINT NOT NULL CHECK (cost_value_cents >= 0),
  tax_rate_bps INTEGER NOT NULL CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  tax_inclusive BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sale_id, product_id),
  CHECK (subtotal_cents = unit_price_cents * quantity),
  CHECK (discount_cents <= subtotal_cents),
  CHECK (net_cents = subtotal_cents - discount_cents),
  CHECK (total_cents = net_cents + CASE WHEN tax_inclusive THEN 0 ELSE tax_cents END)
);
CREATE INDEX sale_items_sale_idx ON sale_items (sale_id);
CREATE INDEX sale_items_product_idx ON sale_items (product_id);

CREATE TABLE sale_payments (
  id BIGSERIAL PRIMARY KEY,
  sale_id BIGINT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  method TEXT NOT NULL CHECK (method IN ('CASH', 'CARD_EXTERNAL')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  tendered_cents BIGINT NOT NULL CHECK (tendered_cents >= amount_cents),
  change_cents BIGINT NOT NULL CHECK (change_cents = tendered_cents - amount_cents),
  reference TEXT NOT NULL DEFAULT '',
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sale_payments_sale_idx ON sale_payments (sale_id);

CREATE TABLE sale_returns (
  id BIGSERIAL PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  sale_id BIGINT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by BIGINT NOT NULL REFERENCES users(id),
  approved_by BIGINT REFERENCES users(id),
  total_cents BIGINT NOT NULL CHECK (total_cents >= 0),
  tax_cents BIGINT NOT NULL CHECK (tax_cents >= 0),
  cost_value_cents BIGINT NOT NULL CHECK (cost_value_cents >= 0),
  business_date DATE NOT NULL,
  client_request_id TEXT NOT NULL UNIQUE,
  payload_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sale_returns_sale_idx ON sale_returns (sale_id);
CREATE INDEX sale_returns_date_idx ON sale_returns (business_date);

CREATE TABLE sale_return_items (
  id BIGSERIAL PRIMARY KEY,
  return_id BIGINT NOT NULL REFERENCES sale_returns(id) ON DELETE RESTRICT,
  sale_item_id BIGINT NOT NULL REFERENCES sale_items(id) ON DELETE RESTRICT,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  refund_cents BIGINT NOT NULL CHECK (refund_cents >= 0),
  tax_cents BIGINT NOT NULL CHECK (tax_cents >= 0),
  cost_value_cents BIGINT NOT NULL CHECK (cost_value_cents >= 0),
  restocked BOOLEAN NOT NULL,
  UNIQUE (return_id, sale_item_id)
);
CREATE INDEX sale_return_items_return_idx ON sale_return_items (return_id);

CREATE TABLE sale_voids (
  id BIGSERIAL PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  sale_id BIGINT NOT NULL UNIQUE REFERENCES sales(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by BIGINT NOT NULL REFERENCES users(id),
  approved_by BIGINT REFERENCES users(id),
  total_cents BIGINT NOT NULL CHECK (total_cents >= 0),
  business_date DATE NOT NULL,
  client_request_id TEXT NOT NULL UNIQUE,
  payload_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE refunds (
  id BIGSERIAL PRIMARY KEY,
  sale_id BIGINT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  return_id BIGINT REFERENCES sale_returns(id) ON DELETE RESTRICT,
  void_id BIGINT REFERENCES sale_voids(id) ON DELETE RESTRICT,
  method TEXT NOT NULL CHECK (method IN ('CASH', 'CARD_EXTERNAL')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  reference TEXT NOT NULL DEFAULT '',
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (((return_id IS NOT NULL)::int + (void_id IS NOT NULL)::int) = 1)
);
CREATE INDEX refunds_sale_idx ON refunds (sale_id);

CREATE TABLE stock_movements (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL
    CHECK (movement_type IN ('OPENING', 'SALE', 'RECEIPT', 'ADJUSTMENT', 'RETURN', 'VOID')),
  quantity_delta BIGINT NOT NULL CHECK (quantity_delta <> 0),
  stock_before BIGINT NOT NULL CHECK (stock_before >= 0),
  stock_after BIGINT NOT NULL CHECK (stock_after >= 0),
  value_delta_cents BIGINT NOT NULL,
  value_before_cents BIGINT NOT NULL CHECK (value_before_cents >= 0),
  value_after_cents BIGINT NOT NULL CHECK (value_after_cents >= 0),
  business_date DATE NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  reference_number TEXT,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  actor_id BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (stock_after = stock_before + quantity_delta),
  CHECK (value_after_cents = value_before_cents + value_delta_cents)
);
CREATE INDEX stock_movements_product_idx ON stock_movements (product_id, created_at DESC);
CREATE INDEX stock_movements_created_idx ON stock_movements (created_at DESC);

CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id BIGINT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'api',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);

CREATE TABLE document_sequences (
  doc_type TEXT NOT NULL,
  business_date DATE NOT NULL,
  next_value INTEGER NOT NULL CHECK (next_value >= 1),
  PRIMARY KEY (doc_type, business_date)
);

CREATE TABLE idempotency_keys (
  client_request_id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (id, shop_name, currency, timezone, receipt_header, receipt_footer, returns_policy)
VALUES (1, 'Auto-Track', 'PHP', 'Asia/Manila', 'Auto-Track Auto Supply & Service', 'Thank you for your business.', 'Returns require the original receipt and are subject to inspection.');

-- Business date is the shop-local date minus the configured cutoff.
CREATE FUNCTION current_business_date() RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT ((now() AT TIME ZONE s.timezone) - s.business_day_cutoff)::date
  FROM settings s WHERE s.id = 1
$$;
