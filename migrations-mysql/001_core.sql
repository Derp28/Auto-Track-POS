-- Auto-Track POS core schema (MySQL 8.4 LTS local variant).
-- Money is stored as integer cents (BIGINT). Percentages are basis points (INTEGER).
-- Completed sales, payments, stock movements, and audit records are immutable by trigger
-- (see 002_immutability.sql).
--
-- PostgreSQL-to-MySQL notes:
--   * BIGSERIAL -> BIGINT AUTO_INCREMENT
--   * TIMESTAMPTZ -> DATETIME(6), stored in UTC
--   * JSONB -> JSON
--   * partial indexes -> nullable UNIQUE keys (MySQL permits multiple NULLs)
--   * lower(name) unique indexes -> default case-insensitive utf8mb4 collation
--   * regex checks use REGEXP instead of PostgreSQL's ~ operator

CREATE TABLE users (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(40) NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  role VARCHAR(16) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  password_hash VARCHAR(255) NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at DATETIME(6) NULL,
  deactivated_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  updated_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT users_role_check CHECK (role IN ('ADMIN', 'CASHIER')),
  CONSTRAINT users_username_len CHECK (CHAR_LENGTH(TRIM(username)) BETWEEN 3 AND 40),
  CONSTRAINT users_display_name_len CHECK (CHAR_LENGTH(TRIM(display_name)) BETWEEN 1 AND 80),
  UNIQUE KEY users_username_uq (username),
  KEY users_role_active_idx (role, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sessions (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  csrf_token VARCHAR(128) NOT NULL,
  user_id BIGINT NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  last_seen_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  idle_expires_at DATETIME(6) NOT NULL,
  absolute_expires_at DATETIME(6) NOT NULL,
  revoked_at DATETIME(6) NULL,
  revoked_reason VARCHAR(255) NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(512) NULL,
  UNIQUE KEY sessions_token_hash_uq (token_hash),
  KEY sessions_user_idx (user_id),
  KEY sessions_expiry_idx (idle_expires_at),
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE settings (
  id SMALLINT NOT NULL DEFAULT 1 PRIMARY KEY,
  shop_name VARCHAR(120) NOT NULL,
  address TEXT NOT NULL DEFAULT (''),
  phone VARCHAR(32) NOT NULL DEFAULT '',
  email VARCHAR(254) NOT NULL DEFAULT '',
  tin VARCHAR(32) NOT NULL DEFAULT '',
  currency CHAR(3) NOT NULL DEFAULT 'PHP',
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Manila',
  business_day_cutoff TIME NOT NULL DEFAULT '00:00:00',
  receipt_header TEXT NOT NULL DEFAULT (''),
  receipt_footer TEXT NOT NULL DEFAULT (''),
  receipt_width VARCHAR(8) NOT NULL DEFAULT '80mm',
  returns_policy TEXT NOT NULL DEFAULT (''),
  tax_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  tax_rate_bps INTEGER NOT NULL DEFAULT 0,
  tax_inclusive BOOLEAN NOT NULL DEFAULT FALSE,
  cashier_discount_limit_bps INTEGER NOT NULL DEFAULT 0,
  discount_reason_required BOOLEAN NOT NULL DEFAULT TRUE,
  max_line_quantity INTEGER NOT NULL DEFAULT 999,
  allow_negative_stock BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  updated_by BIGINT NULL,
  CONSTRAINT settings_singleton CHECK (id = 1),
  CONSTRAINT settings_shop_name_len CHECK (CHAR_LENGTH(TRIM(shop_name)) BETWEEN 1 AND 120),
  CONSTRAINT settings_currency_check CHECK (currency REGEXP '^[A-Z]{3}$'),
  CONSTRAINT settings_receipt_width_check CHECK (receipt_width IN ('58mm', '80mm')),
  CONSTRAINT settings_tax_rate_check CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  CONSTRAINT settings_cashier_discount_check CHECK (cashier_discount_limit_bps BETWEEN 0 AND 10000),
  CONSTRAINT settings_max_line_qty_check CHECK (max_line_quantity BETWEEN 1 AND 9999),
  CONSTRAINT settings_no_negative_stock CHECK (allow_negative_stock = FALSE),
  CONSTRAINT settings_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE categories (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  description TEXT NOT NULL DEFAULT (''),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT NULL,
  updated_by BIGINT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  updated_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT categories_name_len CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 80),
  UNIQUE KEY categories_name_uq (name),
  CONSTRAINT categories_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT categories_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE suppliers (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  contact_name VARCHAR(120) NOT NULL DEFAULT '',
  phone VARCHAR(32) NOT NULL DEFAULT '',
  email VARCHAR(254) NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT (''),
  notes TEXT NOT NULL DEFAULT (''),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT NULL,
  updated_by BIGINT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  updated_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT suppliers_name_len CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 120),
  UNIQUE KEY suppliers_name_uq (name),
  CONSTRAINT suppliers_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT suppliers_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE products (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sku VARCHAR(40) NOT NULL,
  barcode VARCHAR(64) NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT NOT NULL DEFAULT (''),
  category_id BIGINT NOT NULL,
  cost_cents BIGINT NOT NULL,
  price_cents BIGINT NOT NULL,
  stock_on_hand BIGINT NOT NULL DEFAULT 0,
  stock_value_cents BIGINT NOT NULL DEFAULT 0,
  reorder_level BIGINT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT NULL,
  updated_by BIGINT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  updated_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT products_sku_len CHECK (CHAR_LENGTH(TRIM(sku)) BETWEEN 1 AND 40),
  CONSTRAINT products_name_len CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 160),
  CONSTRAINT products_cost_check CHECK (cost_cents >= 0),
  CONSTRAINT products_price_check CHECK (price_cents >= 0),
  CONSTRAINT products_stock_check CHECK (stock_on_hand >= 0),
  CONSTRAINT products_stock_value_check CHECK (stock_value_cents >= 0),
  CONSTRAINT products_reorder_check CHECK (reorder_level >= 0),
  CONSTRAINT products_zero_stock_zero_value CHECK (stock_on_hand > 0 OR stock_value_cents = 0),
  UNIQUE KEY products_sku_uq (sku),
  UNIQUE KEY products_barcode_uq (barcode),
  KEY products_category_idx (category_id),
  KEY products_name_idx (name),
  KEY products_active_stock_idx (active, stock_on_hand),
  CONSTRAINT products_category_fk FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
  CONSTRAINT products_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT products_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE purchase_orders (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  number VARCHAR(64) NOT NULL,
  supplier_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  expected_at DATE NULL,
  notes TEXT NOT NULL DEFAULT (''),
  ordered_total_cents BIGINT NOT NULL DEFAULT 0,
  received_total_cents BIGINT NOT NULL DEFAULT 0,
  created_by BIGINT NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  updated_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  ordered_at DATETIME(6) NULL,
  ordered_by BIGINT NULL,
  received_at DATETIME(6) NULL,
  closed_at DATETIME(6) NULL,
  closed_by BIGINT NULL,
  close_reason TEXT NULL,
  cancelled_at DATETIME(6) NULL,
  cancelled_by BIGINT NULL,
  cancel_reason TEXT NULL,
  CONSTRAINT purchase_orders_status_check CHECK (status IN ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED')),
  CONSTRAINT purchase_orders_ordered_total_check CHECK (ordered_total_cents >= 0),
  CONSTRAINT purchase_orders_received_total_check CHECK (received_total_cents >= 0),
  CONSTRAINT purchase_orders_received_lte_ordered CHECK (received_total_cents <= ordered_total_cents),
  UNIQUE KEY purchase_orders_number_uq (number),
  KEY purchase_orders_status_idx (status, created_at DESC),
  KEY purchase_orders_supplier_idx (supplier_id),
  CONSTRAINT purchase_orders_supplier_fk FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  CONSTRAINT purchase_orders_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT purchase_orders_ordered_by_fk FOREIGN KEY (ordered_by) REFERENCES users(id),
  CONSTRAINT purchase_orders_closed_by_fk FOREIGN KEY (closed_by) REFERENCES users(id),
  CONSTRAINT purchase_orders_cancelled_by_fk FOREIGN KEY (cancelled_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE purchase_order_items (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  purchase_order_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  ordered_qty INTEGER NOT NULL,
  received_qty INTEGER NOT NULL DEFAULT 0,
  unit_cost_cents BIGINT NOT NULL,
  ordered_total_cents BIGINT NOT NULL,
  received_total_cents BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT purchase_order_items_ordered_qty_check CHECK (ordered_qty > 0),
  CONSTRAINT purchase_order_items_received_qty_check CHECK (received_qty >= 0),
  CONSTRAINT purchase_order_items_unit_cost_check CHECK (unit_cost_cents >= 0),
  CONSTRAINT purchase_order_items_ordered_total_check CHECK (ordered_total_cents >= 0),
  CONSTRAINT purchase_order_items_received_total_check CHECK (received_total_cents >= 0),
  CONSTRAINT purchase_order_items_received_lte_ordered CHECK (received_qty <= ordered_qty),
  CONSTRAINT purchase_order_items_ordered_math CHECK (ordered_total_cents = unit_cost_cents * ordered_qty),
  CONSTRAINT purchase_order_items_received_math CHECK (received_total_cents = unit_cost_cents * received_qty),
  UNIQUE KEY purchase_order_items_po_product_uq (purchase_order_id, product_id),
  CONSTRAINT purchase_order_items_po_fk FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  CONSTRAINT purchase_order_items_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE po_receipts (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  number VARCHAR(64) NOT NULL,
  purchase_order_id BIGINT NOT NULL,
  received_by BIGINT NOT NULL,
  total_cents BIGINT NOT NULL,
  note TEXT NOT NULL DEFAULT (''),
  client_request_id VARCHAR(128) NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT po_receipts_total_check CHECK (total_cents >= 0),
  UNIQUE KEY po_receipts_number_uq (number),
  UNIQUE KEY po_receipts_client_request_uq (client_request_id),
  KEY po_receipts_po_idx (purchase_order_id),
  CONSTRAINT po_receipts_po_fk FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  CONSTRAINT po_receipts_received_by_fk FOREIGN KEY (received_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE po_receipt_items (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  receipt_id BIGINT NOT NULL,
  po_item_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_cost_cents BIGINT NOT NULL,
  total_cents BIGINT NOT NULL,
  CONSTRAINT po_receipt_items_quantity_check CHECK (quantity > 0),
  CONSTRAINT po_receipt_items_unit_cost_check CHECK (unit_cost_cents >= 0),
  CONSTRAINT po_receipt_items_total_math CHECK (total_cents = unit_cost_cents * quantity),
  KEY po_receipt_items_receipt_idx (receipt_id),
  CONSTRAINT po_receipt_items_receipt_fk FOREIGN KEY (receipt_id) REFERENCES po_receipts(id) ON DELETE RESTRICT,
  CONSTRAINT po_receipt_items_po_item_fk FOREIGN KEY (po_item_id) REFERENCES purchase_order_items(id) ON DELETE RESTRICT,
  CONSTRAINT po_receipt_items_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sales (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  number VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'COMPLETED',
  cashier_id BIGINT NOT NULL,
  cashier_name VARCHAR(80) NOT NULL,
  terminal_label VARCHAR(40) NOT NULL,
  note TEXT NOT NULL DEFAULT (''),
  subtotal_cents BIGINT NOT NULL,
  discount_cents BIGINT NOT NULL,
  net_cents BIGINT NOT NULL,
  tax_cents BIGINT NOT NULL,
  total_cents BIGINT NOT NULL,
  tax_rate_bps INTEGER NOT NULL,
  tax_inclusive BOOLEAN NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'PHP',
  business_date DATE NOT NULL,
  client_request_id VARCHAR(128) NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  voided_at DATETIME(6) NULL,
  voided_by BIGINT NULL,
  void_approved_by BIGINT NULL,
  void_reason TEXT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT sales_status_check CHECK (status IN ('COMPLETED', 'VOIDED')),
  CONSTRAINT sales_terminal_label_len CHECK (CHAR_LENGTH(TRIM(terminal_label)) BETWEEN 1 AND 40),
  CONSTRAINT sales_subtotal_check CHECK (subtotal_cents >= 0),
  CONSTRAINT sales_discount_check CHECK (discount_cents >= 0),
  CONSTRAINT sales_discount_lte_subtotal CHECK (discount_cents <= subtotal_cents),
  CONSTRAINT sales_net_math CHECK (net_cents = subtotal_cents - discount_cents),
  CONSTRAINT sales_tax_check CHECK (tax_cents >= 0),
  CONSTRAINT sales_total_check CHECK (total_cents >= 0),
  CONSTRAINT sales_tax_rate_check CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  CONSTRAINT sales_total_exclusive_check CHECK (
    (tax_inclusive AND total_cents = net_cents)
    OR ((NOT tax_inclusive) AND total_cents = net_cents + tax_cents)
  ),
  CONSTRAINT sales_void_fields_check CHECK (
    (status = 'COMPLETED' AND voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR (status = 'VOIDED' AND voided_at IS NOT NULL AND voided_by IS NOT NULL AND CHAR_LENGTH(TRIM(void_reason)) > 0)
  ),
  UNIQUE KEY sales_number_uq (number),
  UNIQUE KEY sales_client_request_uq (client_request_id),
  KEY sales_business_date_idx (business_date),
  KEY sales_cashier_date_idx (cashier_id, business_date),
  KEY sales_created_idx (created_at DESC),
  CONSTRAINT sales_cashier_fk FOREIGN KEY (cashier_id) REFERENCES users(id),
  CONSTRAINT sales_voided_by_fk FOREIGN KEY (voided_by) REFERENCES users(id),
  CONSTRAINT sales_void_approved_by_fk FOREIGN KEY (void_approved_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sale_items (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sale_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  sku VARCHAR(40) NOT NULL,
  barcode VARCHAR(64) NOT NULL DEFAULT '',
  name VARCHAR(160) NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price_cents BIGINT NOT NULL,
  unit_cost_cents BIGINT NOT NULL,
  discount_bps INTEGER NOT NULL DEFAULT 0,
  discount_reason TEXT NOT NULL DEFAULT (''),
  discount_approved_by BIGINT NULL,
  note TEXT NOT NULL DEFAULT (''),
  subtotal_cents BIGINT NOT NULL,
  discount_cents BIGINT NOT NULL,
  net_cents BIGINT NOT NULL,
  tax_cents BIGINT NOT NULL,
  total_cents BIGINT NOT NULL,
  cost_value_cents BIGINT NOT NULL,
  tax_rate_bps INTEGER NOT NULL,
  tax_inclusive BOOLEAN NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT sale_items_quantity_check CHECK (quantity > 0),
  CONSTRAINT sale_items_unit_price_check CHECK (unit_price_cents >= 0),
  CONSTRAINT sale_items_unit_cost_check CHECK (unit_cost_cents >= 0),
  CONSTRAINT sale_items_discount_bps_check CHECK (discount_bps BETWEEN 0 AND 10000),
  CONSTRAINT sale_items_subtotal_check CHECK (subtotal_cents >= 0),
  CONSTRAINT sale_items_discount_check CHECK (discount_cents >= 0),
  CONSTRAINT sale_items_discount_lte_subtotal CHECK (discount_cents <= subtotal_cents),
  CONSTRAINT sale_items_net_check CHECK (net_cents >= 0),
  CONSTRAINT sale_items_tax_check CHECK (tax_cents >= 0),
  CONSTRAINT sale_items_total_check CHECK (total_cents >= 0),
  CONSTRAINT sale_items_cost_value_check CHECK (cost_value_cents >= 0),
  CONSTRAINT sale_items_tax_rate_check CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  CONSTRAINT sale_items_subtotal_math CHECK (subtotal_cents = unit_price_cents * quantity),
  CONSTRAINT sale_items_net_math CHECK (net_cents = subtotal_cents - discount_cents),
  CONSTRAINT sale_items_total_math CHECK (total_cents = net_cents + CASE WHEN tax_inclusive THEN 0 ELSE tax_cents END),
  UNIQUE KEY sale_items_sale_product_uq (sale_id, product_id),
  KEY sale_items_sale_idx (sale_id),
  KEY sale_items_product_idx (product_id),
  CONSTRAINT sale_items_sale_fk FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
  CONSTRAINT sale_items_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT sale_items_discount_approved_by_fk FOREIGN KEY (discount_approved_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sale_payments (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sale_id BIGINT NOT NULL,
  method VARCHAR(16) NOT NULL,
  amount_cents BIGINT NOT NULL,
  tendered_cents BIGINT NOT NULL,
  change_cents BIGINT NOT NULL,
  reference VARCHAR(128) NOT NULL DEFAULT '',
  created_by BIGINT NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT sale_payments_method_check CHECK (method IN ('CASH', 'CARD_EXTERNAL')),
  CONSTRAINT sale_payments_amount_check CHECK (amount_cents > 0),
  CONSTRAINT sale_payments_tendered_check CHECK (tendered_cents >= amount_cents),
  CONSTRAINT sale_payments_change_check CHECK (change_cents = tendered_cents - amount_cents),
  KEY sale_payments_sale_idx (sale_id),
  CONSTRAINT sale_payments_sale_fk FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
  CONSTRAINT sale_payments_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sale_returns (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  number VARCHAR(64) NOT NULL,
  sale_id BIGINT NOT NULL,
  reason TEXT NOT NULL,
  created_by BIGINT NOT NULL,
  approved_by BIGINT NULL,
  total_cents BIGINT NOT NULL,
  tax_cents BIGINT NOT NULL,
  cost_value_cents BIGINT NOT NULL,
  business_date DATE NOT NULL,
  client_request_id VARCHAR(128) NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT sale_returns_reason_len CHECK (CHAR_LENGTH(TRIM(reason)) > 0),
  CONSTRAINT sale_returns_total_check CHECK (total_cents >= 0),
  CONSTRAINT sale_returns_tax_check CHECK (tax_cents >= 0),
  CONSTRAINT sale_returns_cost_check CHECK (cost_value_cents >= 0),
  UNIQUE KEY sale_returns_number_uq (number),
  UNIQUE KEY sale_returns_client_request_uq (client_request_id),
  KEY sale_returns_sale_idx (sale_id),
  KEY sale_returns_date_idx (business_date),
  CONSTRAINT sale_returns_sale_fk FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
  CONSTRAINT sale_returns_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT sale_returns_approved_by_fk FOREIGN KEY (approved_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sale_return_items (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  return_id BIGINT NOT NULL,
  sale_item_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  quantity INTEGER NOT NULL,
  refund_cents BIGINT NOT NULL,
  tax_cents BIGINT NOT NULL,
  cost_value_cents BIGINT NOT NULL,
  restocked BOOLEAN NOT NULL,
  CONSTRAINT sale_return_items_quantity_check CHECK (quantity > 0),
  CONSTRAINT sale_return_items_refund_check CHECK (refund_cents >= 0),
  CONSTRAINT sale_return_items_tax_check CHECK (tax_cents >= 0),
  CONSTRAINT sale_return_items_cost_check CHECK (cost_value_cents >= 0),
  UNIQUE KEY sale_return_items_return_sale_item_uq (return_id, sale_item_id),
  KEY sale_return_items_return_idx (return_id),
  CONSTRAINT sale_return_items_return_fk FOREIGN KEY (return_id) REFERENCES sale_returns(id) ON DELETE RESTRICT,
  CONSTRAINT sale_return_items_sale_item_fk FOREIGN KEY (sale_item_id) REFERENCES sale_items(id) ON DELETE RESTRICT,
  CONSTRAINT sale_return_items_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sale_voids (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  number VARCHAR(64) NOT NULL,
  sale_id BIGINT NOT NULL,
  reason TEXT NOT NULL,
  created_by BIGINT NOT NULL,
  approved_by BIGINT NULL,
  total_cents BIGINT NOT NULL,
  business_date DATE NOT NULL,
  client_request_id VARCHAR(128) NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT sale_voids_reason_len CHECK (CHAR_LENGTH(TRIM(reason)) > 0),
  CONSTRAINT sale_voids_total_check CHECK (total_cents >= 0),
  UNIQUE KEY sale_voids_number_uq (number),
  UNIQUE KEY sale_voids_sale_uq (sale_id),
  UNIQUE KEY sale_voids_client_request_uq (client_request_id),
  CONSTRAINT sale_voids_sale_fk FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
  CONSTRAINT sale_voids_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT sale_voids_approved_by_fk FOREIGN KEY (approved_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE refunds (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sale_id BIGINT NOT NULL,
  return_id BIGINT NULL,
  void_id BIGINT NULL,
  method VARCHAR(16) NOT NULL,
  amount_cents BIGINT NOT NULL,
  reference VARCHAR(128) NOT NULL DEFAULT '',
  created_by BIGINT NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT refunds_method_check CHECK (method IN ('CASH', 'CARD_EXTERNAL')),
  CONSTRAINT refunds_amount_check CHECK (amount_cents > 0),
  CONSTRAINT refunds_one_source_check CHECK (((return_id IS NOT NULL) + (void_id IS NOT NULL)) = 1),
  KEY refunds_sale_idx (sale_id),
  CONSTRAINT refunds_sale_fk FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
  CONSTRAINT refunds_return_fk FOREIGN KEY (return_id) REFERENCES sale_returns(id) ON DELETE RESTRICT,
  CONSTRAINT refunds_void_fk FOREIGN KEY (void_id) REFERENCES sale_voids(id) ON DELETE RESTRICT,
  CONSTRAINT refunds_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE stock_movements (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT NOT NULL,
  movement_type VARCHAR(16) NOT NULL,
  quantity_delta BIGINT NOT NULL,
  stock_before BIGINT NOT NULL,
  stock_after BIGINT NOT NULL,
  value_delta_cents BIGINT NOT NULL,
  value_before_cents BIGINT NOT NULL,
  value_after_cents BIGINT NOT NULL,
  business_date DATE NOT NULL,
  reference_type VARCHAR(32) NULL,
  reference_id VARCHAR(64) NULL,
  reference_number VARCHAR(64) NULL,
  reason TEXT NOT NULL,
  actor_id BIGINT NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT stock_movements_type_check CHECK (movement_type IN ('OPENING', 'SALE', 'RECEIPT', 'ADJUSTMENT', 'RETURN', 'VOID')),
  CONSTRAINT stock_movements_quantity_check CHECK (quantity_delta <> 0),
  CONSTRAINT stock_movements_stock_before_check CHECK (stock_before >= 0),
  CONSTRAINT stock_movements_stock_after_check CHECK (stock_after >= 0),
  CONSTRAINT stock_movements_value_before_check CHECK (value_before_cents >= 0),
  CONSTRAINT stock_movements_value_after_check CHECK (value_after_cents >= 0),
  CONSTRAINT stock_movements_reason_len CHECK (CHAR_LENGTH(TRIM(reason)) > 0),
  CONSTRAINT stock_movements_stock_math CHECK (stock_after = stock_before + quantity_delta),
  CONSTRAINT stock_movements_value_math CHECK (value_after_cents = value_before_cents + value_delta_cents),
  KEY stock_movements_product_idx (product_id, created_at DESC),
  KEY stock_movements_created_idx (created_at DESC),
  CONSTRAINT stock_movements_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT stock_movements_actor_fk FOREIGN KEY (actor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_log (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_id BIGINT NULL,
  action VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64) NULL,
  details JSON NOT NULL DEFAULT (JSON_OBJECT()),
  source VARCHAR(32) NOT NULL DEFAULT 'api',
  created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  KEY audit_log_created_idx (created_at DESC),
  KEY audit_log_entity_idx (entity_type, entity_id),
  CONSTRAINT audit_log_actor_fk FOREIGN KEY (actor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE document_sequences (
  doc_type VARCHAR(32) NOT NULL,
  business_date DATE NOT NULL,
  next_value INTEGER NOT NULL,
  PRIMARY KEY (doc_type, business_date),
  CONSTRAINT document_sequences_next_value_check CHECK (next_value >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE idempotency_keys (
  client_request_id VARCHAR(128) NOT NULL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  endpoint VARCHAR(128) NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  response JSON NULL,
  created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT idempotency_keys_user_fk FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO settings (id, shop_name, currency, timezone, receipt_header, receipt_footer, returns_policy)
VALUES (1, 'Auto-Track', 'PHP', 'Asia/Manila', 'Auto-Track Auto Supply & Service', 'Thank you for your business.', 'Returns require the original receipt and are subject to inspection.');

-- Business date is the shop-local date minus the configured cutoff.
-- MySQL uses CONVERT_TZ, so the time-zone tables must be loaded for named zones
-- (see docs/INSTALL.md). If they are missing, CONVERT_TZ returns NULL and inserts
-- fail loudly rather than silently using the wrong date.
CREATE FUNCTION current_business_date()
RETURNS DATE
DETERMINISTIC
READS SQL DATA
RETURN (
  SELECT DATE(
    CONVERT_TZ(UTC_TIMESTAMP(6), '+00:00', s.timezone)
    - INTERVAL TIME_TO_SEC(s.business_day_cutoff) SECOND
  )
  FROM settings s
  WHERE s.id = 1
);
