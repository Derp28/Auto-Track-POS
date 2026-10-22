-- Auto-Track POS immutability and integrity guards.
-- These are the database's second line of defense: the API also enforces the rules.

CREATE FUNCTION forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END
$$;

CREATE TRIGGER sale_items_append_only BEFORE UPDATE OR DELETE ON sale_items
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER sale_payments_append_only BEFORE UPDATE OR DELETE ON sale_payments
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER sale_returns_append_only BEFORE UPDATE OR DELETE ON sale_returns
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER sale_return_items_append_only BEFORE UPDATE OR DELETE ON sale_return_items
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER sale_voids_append_only BEFORE UPDATE OR DELETE ON sale_voids
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER refunds_append_only BEFORE UPDATE OR DELETE ON refunds
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER po_receipts_append_only BEFORE UPDATE OR DELETE ON po_receipts
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER po_receipt_items_append_only BEFORE UPDATE OR DELETE ON po_receipt_items
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE FUNCTION guard_sale_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Completed sales cannot be deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status = 'VOIDED' THEN
    RAISE EXCEPTION 'A voided sale is final' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.number IS DISTINCT FROM OLD.number
     OR NEW.cashier_id IS DISTINCT FROM OLD.cashier_id
     OR NEW.cashier_name IS DISTINCT FROM OLD.cashier_name
     OR NEW.terminal_label IS DISTINCT FROM OLD.terminal_label
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.subtotal_cents IS DISTINCT FROM OLD.subtotal_cents
     OR NEW.discount_cents IS DISTINCT FROM OLD.discount_cents
     OR NEW.net_cents IS DISTINCT FROM OLD.net_cents
     OR NEW.tax_cents IS DISTINCT FROM OLD.tax_cents
     OR NEW.total_cents IS DISTINCT FROM OLD.total_cents
     OR NEW.tax_rate_bps IS DISTINCT FROM OLD.tax_rate_bps
     OR NEW.tax_inclusive IS DISTINCT FROM OLD.tax_inclusive
     OR NEW.business_date IS DISTINCT FROM OLD.business_date
     OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id
     OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Sale financial and identity fields are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status = 'VOIDED' AND (NEW.voided_at IS NULL OR NEW.voided_by IS NULL
     OR NEW.void_reason IS NULL OR length(btrim(NEW.void_reason)) = 0) THEN
    RAISE EXCEPTION 'Void metadata is required' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER sales_guard BEFORE UPDATE OR DELETE ON sales
  FOR EACH ROW EXECUTE FUNCTION guard_sale_update();

CREATE FUNCTION guard_po_item_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  po_status TEXT;
BEGIN
  SELECT status INTO po_status FROM purchase_orders
   WHERE id = COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);
  IF po_status IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF po_status IN ('RECEIVED', 'CLOSED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Purchase order lines are immutable after the order is closed'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' AND po_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Ordered purchase lines cannot be deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'INSERT' AND po_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Lines cannot be added after ordering' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND po_status IN ('ORDERED', 'PARTIALLY_RECEIVED') THEN
    IF NEW.product_id IS DISTINCT FROM OLD.product_id
       OR NEW.ordered_qty IS DISTINCT FROM OLD.ordered_qty
       OR NEW.unit_cost_cents IS DISTINCT FROM OLD.unit_cost_cents
       OR NEW.ordered_total_cents IS DISTINCT FROM OLD.ordered_total_cents THEN
      RAISE EXCEPTION 'Ordered quantities and costs cannot change; receive or short-close instead'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;

CREATE TRIGGER purchase_order_items_guard BEFORE INSERT OR UPDATE OR DELETE ON purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION guard_po_item_write();

CREATE FUNCTION guard_purchase_order_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Purchase orders are retained for audit; cancel instead'
    USING ERRCODE = 'integrity_constraint_violation';
END
$$;
CREATE TRIGGER purchase_orders_no_delete BEFORE DELETE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION guard_purchase_order_delete();

CREATE FUNCTION guard_user_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Users are retained for audit; deactivate instead'
    USING ERRCODE = 'integrity_constraint_violation';
END
$$;
CREATE TRIGGER users_no_delete BEFORE DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION guard_user_delete();

CREATE FUNCTION guard_purchase_order_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.number IS DISTINCT FROM OLD.number OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Purchase order identity is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status IN ('RECEIVED', 'CLOSED', 'CANCELLED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Closed purchase orders cannot change status' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER purchase_orders_guard BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION guard_purchase_order_update();
