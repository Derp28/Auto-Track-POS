-- Dashboard insights: administrator-only sales target, comparison mode, and
-- operating-expense ledger. Inventory purchases remain a separate source of
-- outflows, derived from received purchase-order receipts.

ALTER TABLE settings
  ADD COLUMN monthly_sales_target_cents BIGINT NOT NULL DEFAULT 0 AFTER allow_negative_stock,
  ADD COLUMN sales_comparison_mode VARCHAR(8) NOT NULL DEFAULT 'monthly' AFTER monthly_sales_target_cents;

ALTER TABLE settings
  ADD CONSTRAINT settings_monthly_target_check CHECK (monthly_sales_target_cents >= 0),
  ADD CONSTRAINT settings_comparison_mode_check CHECK (sales_comparison_mode IN ('monthly', 'yearly'));

-- New receipts record the shop business date. Existing receipts stay NULL because
-- po_receipts is append-only and cannot be backfilled; reports fall back to the
-- UTC created date for those historical rows.
ALTER TABLE po_receipts
  ADD COLUMN business_date DATE NULL AFTER total_cents;

CREATE INDEX po_receipts_business_date_idx ON po_receipts (business_date, id);

CREATE TABLE expenses (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  expense_date DATE NOT NULL,
  category VARCHAR(60) NOT NULL,
  description VARCHAR(200) NOT NULL,
  amount_cents BIGINT NOT NULL,
  paid_via VARCHAR(20) NOT NULL DEFAULT 'CASH',
  created_by BIGINT NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  updated_by BIGINT NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  deleted_by BIGINT NULL,
  deleted_at DATETIME(6) NULL,
  CONSTRAINT expenses_amount_check CHECK (amount_cents > 0),
  CONSTRAINT expenses_category_len CHECK (CHAR_LENGTH(TRIM(category)) BETWEEN 1 AND 60),
  CONSTRAINT expenses_description_len CHECK (CHAR_LENGTH(TRIM(description)) BETWEEN 1 AND 200),
  CONSTRAINT expenses_paid_via_check CHECK (paid_via IN ('CASH', 'CARD_EXTERNAL', 'BANK_TRANSFER', 'OTHER')),
  KEY expenses_date_idx (expense_date, id),
  KEY expenses_active_date_idx (deleted_at, expense_date),
  CONSTRAINT expenses_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT expenses_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id),
  CONSTRAINT expenses_deleted_by_fk FOREIGN KEY (deleted_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- The runtime role may insert and soft-delete (UPDATE) expenses, never hard-delete them.
SET @db = DATABASE();
SET @s = CONCAT('GRANT INSERT, UPDATE ON `', @db, '`.expenses TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
