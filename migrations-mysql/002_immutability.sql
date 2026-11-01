-- Auto-Track POS immutability and integrity guards (MySQL 8.4 LTS local variant).
-- These are the database's second line of defense: the API also enforces the rules.
--
-- MySQL has one trigger per timing/event/table, so the PostgreSQL functions below are
-- expanded into individual triggers. SQLSTATE 45000 is used for user-raised integrity
-- errors; the API maps it to a 409/400 conflict rather than a 500.

DELIMITER $$

-- Append-only tables: no UPDATE, no DELETE. The runtime role also lacks these grants.
CREATE TRIGGER sale_items_no_update BEFORE UPDATE ON sale_items FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_items is append-only; UPDATE is not allowed'$$
CREATE TRIGGER sale_items_no_delete BEFORE DELETE ON sale_items FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_items is append-only; DELETE is not allowed'$$
CREATE TRIGGER sale_payments_no_update BEFORE UPDATE ON sale_payments FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_payments is append-only; UPDATE is not allowed'$$
CREATE TRIGGER sale_payments_no_delete BEFORE DELETE ON sale_payments FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_payments is append-only; DELETE is not allowed'$$
CREATE TRIGGER sale_returns_no_update BEFORE UPDATE ON sale_returns FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_returns is append-only; UPDATE is not allowed'$$
CREATE TRIGGER sale_returns_no_delete BEFORE DELETE ON sale_returns FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_returns is append-only; DELETE is not allowed'$$
CREATE TRIGGER sale_return_items_no_update BEFORE UPDATE ON sale_return_items FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_return_items is append-only; UPDATE is not allowed'$$
CREATE TRIGGER sale_return_items_no_delete BEFORE DELETE ON sale_return_items FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_return_items is append-only; DELETE is not allowed'$$
CREATE TRIGGER sale_voids_no_update BEFORE UPDATE ON sale_voids FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_voids is append-only; UPDATE is not allowed'$$
CREATE TRIGGER sale_voids_no_delete BEFORE DELETE ON sale_voids FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_voids is append-only; DELETE is not allowed'$$
CREATE TRIGGER refunds_no_update BEFORE UPDATE ON refunds FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'refunds is append-only; UPDATE is not allowed'$$
CREATE TRIGGER refunds_no_delete BEFORE DELETE ON refunds FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'refunds is append-only; DELETE is not allowed'$$
CREATE TRIGGER stock_movements_no_update BEFORE UPDATE ON stock_movements FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stock_movements is append-only; UPDATE is not allowed'$$
CREATE TRIGGER stock_movements_no_delete BEFORE DELETE ON stock_movements FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stock_movements is append-only; DELETE is not allowed'$$
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only; UPDATE is not allowed'$$
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only; DELETE is not allowed'$$
CREATE TRIGGER po_receipts_no_update BEFORE UPDATE ON po_receipts FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'po_receipts is append-only; UPDATE is not allowed'$$
CREATE TRIGGER po_receipts_no_delete BEFORE DELETE ON po_receipts FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'po_receipts is append-only; DELETE is not allowed'$$
CREATE TRIGGER po_receipt_items_no_update BEFORE UPDATE ON po_receipt_items FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'po_receipt_items is append-only; UPDATE is not allowed'$$
CREATE TRIGGER po_receipt_items_no_delete BEFORE DELETE ON po_receipt_items FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'po_receipt_items is append-only; DELETE is not allowed'$$

-- Completed sales cannot be deleted. A void is a new document, never an edit.
CREATE TRIGGER sales_no_delete BEFORE DELETE ON sales FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Completed sales cannot be deleted'$$

-- Sales may only move from COMPLETED to VOIDED with complete void metadata.
CREATE TRIGGER sales_guard_update BEFORE UPDATE ON sales FOR EACH ROW
BEGIN
  IF OLD.status = 'VOIDED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A voided sale is final';
  END IF;
  IF NOT (NEW.number <=> OLD.number)
     OR NOT (NEW.cashier_id <=> OLD.cashier_id)
     OR NOT (NEW.cashier_name <=> OLD.cashier_name)
     OR NOT (NEW.terminal_label <=> OLD.terminal_label)
     OR NOT (NEW.note <=> OLD.note)
     OR NOT (NEW.subtotal_cents <=> OLD.subtotal_cents)
     OR NOT (NEW.discount_cents <=> OLD.discount_cents)
     OR NOT (NEW.net_cents <=> OLD.net_cents)
     OR NOT (NEW.tax_cents <=> OLD.tax_cents)
     OR NOT (NEW.total_cents <=> OLD.total_cents)
     OR NOT (NEW.tax_rate_bps <=> OLD.tax_rate_bps)
     OR NOT (NEW.tax_inclusive <=> OLD.tax_inclusive)
     OR NOT (NEW.business_date <=> OLD.business_date)
     OR NOT (NEW.client_request_id <=> OLD.client_request_id)
     OR NOT (NEW.payload_hash <=> OLD.payload_hash)
     OR NOT (NEW.created_at <=> OLD.created_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Sale financial and identity fields are immutable';
  END IF;
  IF NEW.status = 'VOIDED' AND (NEW.voided_at IS NULL OR NEW.voided_by IS NULL
     OR NEW.void_reason IS NULL OR CHAR_LENGTH(TRIM(NEW.void_reason)) = 0) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Void metadata is required';
  END IF;
END$$

-- Purchase-order lines may not be added after ordering, deleted after DRAFT, or changed
-- after ordering except for the received quantity. Closed orders are fully immutable.
CREATE TRIGGER purchase_order_items_guard_insert BEFORE INSERT ON purchase_order_items FOR EACH ROW
BEGIN
  DECLARE po_status VARCHAR(32);
  SET po_status = (SELECT status FROM purchase_orders WHERE id = NEW.purchase_order_id);
  IF po_status IN ('RECEIVED', 'CLOSED', 'CANCELLED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchase order lines are immutable after the order is closed';
  END IF;
  IF po_status IS NOT NULL AND po_status <> 'DRAFT' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Lines cannot be added after ordering';
  END IF;
END$$

CREATE TRIGGER purchase_order_items_guard_update BEFORE UPDATE ON purchase_order_items FOR EACH ROW
BEGIN
  DECLARE po_status VARCHAR(32);
  SET po_status = (SELECT status FROM purchase_orders WHERE id = COALESCE(NEW.purchase_order_id, OLD.purchase_order_id));
  IF po_status IS NOT NULL THEN
    IF po_status IN ('RECEIVED', 'CLOSED', 'CANCELLED') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchase order lines are immutable after the order is closed';
    END IF;
    IF po_status IN ('ORDERED', 'PARTIALLY_RECEIVED') THEN
      IF NOT (NEW.product_id <=> OLD.product_id)
         OR NOT (NEW.ordered_qty <=> OLD.ordered_qty)
         OR NOT (NEW.unit_cost_cents <=> OLD.unit_cost_cents)
         OR NOT (NEW.ordered_total_cents <=> OLD.ordered_total_cents) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ordered quantities and costs cannot change; receive or short-close instead';
      END IF;
    END IF;
  END IF;
END$$

CREATE TRIGGER purchase_order_items_guard_delete BEFORE DELETE ON purchase_order_items FOR EACH ROW
BEGIN
  DECLARE po_status VARCHAR(32);
  SET po_status = (SELECT status FROM purchase_orders WHERE id = OLD.purchase_order_id);
  IF po_status IS NOT NULL THEN
    IF po_status IN ('RECEIVED', 'CLOSED', 'CANCELLED') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchase order lines are immutable after the order is closed';
    END IF;
    IF po_status <> 'DRAFT' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ordered purchase lines cannot be deleted';
    END IF;
  END IF;
END$$

-- Purchase orders are retained for audit; cancel instead.
CREATE TRIGGER purchase_orders_no_delete BEFORE DELETE ON purchase_orders FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchase orders are retained for audit; cancel instead'$$

-- Users are retained for audit; deactivate instead.
CREATE TRIGGER users_no_delete BEFORE DELETE ON users FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Users are retained for audit; deactivate instead'$$

-- Purchase-order identity is immutable, and a closed order cannot change status.
CREATE TRIGGER purchase_orders_guard_update BEFORE UPDATE ON purchase_orders FOR EACH ROW
BEGIN
  IF NOT (NEW.number <=> OLD.number)
     OR NOT (NEW.created_by <=> OLD.created_by)
     OR NOT (NEW.created_at <=> OLD.created_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchase order identity is immutable';
  END IF;
  IF OLD.status IN ('RECEIVED', 'CLOSED', 'CANCELLED')
     AND NOT (NEW.status <=> OLD.status) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Closed purchase orders cannot change status';
  END IF;
END$$

DELIMITER ;
