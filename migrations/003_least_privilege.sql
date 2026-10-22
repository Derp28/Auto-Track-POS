-- Least-privilege grants for the runtime application role.
-- The migrator/owner role owns the schema; the application role may only do
-- what the API actually needs. Run this after every migration that adds tables
-- (the loop below covers all current and future tables in this schema).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autotrack_app') THEN
    RAISE NOTICE 'autotrack_app role not present; skipping least-privilege grants';
    RETURN;
  END IF;

  -- The API never deletes business records. Draft purchase lines are the only
  -- rows it is allowed to remove (editing a draft order).
  EXECUTE 'REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM autotrack_app';
  EXECUTE 'GRANT DELETE ON purchase_order_items TO autotrack_app';

  -- Append-only records may be inserted and read, never changed.
  EXECUTE 'REVOKE UPDATE ON audit_log, stock_movements, sale_items, sale_payments,
    sale_returns, sale_return_items, sale_voids, refunds, po_receipts, po_receipt_items
    FROM autotrack_app';

  -- The migration ledger is read-only to the runtime.
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM autotrack_app';

  -- Serial columns need sequence usage for INSERT.
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO autotrack_app';
END
$$;
