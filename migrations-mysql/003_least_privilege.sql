-- Least-privilege grants for the runtime application role (MySQL 8.4 local variant).
-- The migrator owns the schema. The app can read everything, but may only write the
-- tables the API actually mutates; append-only records can be inserted, never changed.
--
-- The database name is resolved at runtime so the same migration is safe for
-- autotrack_local and autotrack_test_mysql.

SET @db = DATABASE();

SET @s = CONCAT('REVOKE ALL PRIVILEGES ON `', @db, '`.* FROM ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = CONCAT('GRANT SELECT ON `', @db, '`.* TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = CONCAT('GRANT EXECUTE ON `', @db, '`.* TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Mutable business tables. Table-specific grants only: DB-wide UPDATE would
-- re-open the append-only tables.
SET @s = CONCAT('GRANT INSERT, UPDATE ON `', @db, '`.users TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @s = CONCAT('GRANT INSERT, UPDATE ON `', @db, '`.sessions TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @s = CONCAT('GRANT UPDATE ON `', @db, '`.settings TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @s = CONCAT('GRANT INSERT, UPDATE ON `', @db, '`.categories TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @s = CONCAT('GRANT INSERT, UPDATE ON `', @db, '`.suppliers TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @s = CONCAT('GRANT INSERT, UPDATE ON `', @db, '`.products TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @s = CONCAT('GRANT INSERT, UPDATE ON `', @db, '`.purchase_orders TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @s = CONCAT('GRANT INSERT, UPDATE, DELETE ON `', @db, '`.purchase_order_items TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @s = CONCAT('GRANT INSERT, UPDATE ON `', @db, '`.sales TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @s = CONCAT('GRANT INSERT, UPDATE ON `', @db, '`.document_sequences TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @s = CONCAT('GRANT INSERT, UPDATE ON `', @db, '`.idempotency_keys TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Append-only tables: insert and read, never update or delete.
SET @s = CONCAT('GRANT INSERT ON `', @db, '`.sale_items TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @s = CONCAT('GRANT INSERT ON `', @db, '`.sale_payments TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @s = CONCAT('GRANT INSERT ON `', @db, '`.sale_returns TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @s = CONCAT('GRANT INSERT ON `', @db, '`.sale_return_items TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @s = CONCAT('GRANT INSERT ON `', @db, '`.sale_voids TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @s = CONCAT('GRANT INSERT ON `', @db, '`.refunds TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @s = CONCAT('GRANT INSERT ON `', @db, '`.stock_movements TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @s = CONCAT('GRANT INSERT ON `', @db, '`.audit_log TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @s = CONCAT('GRANT INSERT ON `', @db, '`.po_receipts TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @s = CONCAT('GRANT INSERT ON `', @db, '`.po_receipt_items TO ''autotrack_app''@''localhost''');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
