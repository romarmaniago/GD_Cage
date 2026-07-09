-- Dedicated credit transaction log (source of truth going forward).
-- account_ledger remains temporarily mirrored for existing reports.
-- NOTE: Auto-created/renamed on app startup via utils/ensureCreditSchema.js.
-- CREDIT_ACTION values: Transfer | Buy-in | Cash-in | Cash-out

CREATE TABLE IF NOT EXISTS `credit_transaction` (
  `IDNo` INT NOT NULL AUTO_INCREMENT,
  `ACCOUNT_ID` INT NOT NULL,
  `GUEST_ID` INT NULL DEFAULT NULL,
  `CREDIT_ACTION` VARCHAR(32) NOT NULL COMMENT 'Transfer | Buy-in | Cash-in | Cash-out | Chips Return',
  `CREDIT_SOURCE` VARCHAR(16) NULL DEFAULT NULL COMMENT 'CREDIT | BUYIN',
  `DIRECTION` VARCHAR(16) NOT NULL COMMENT 'issue | return',
  `AMOUNT` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `BALANCE_AFTER` DECIMAL(18,2) NULL DEFAULT NULL,
  `LEDGER_ID` INT NULL DEFAULT NULL COMMENT 'linked account_ledger.IDNo when mirrored',
  `GAME_ID` INT NULL DEFAULT NULL,
  `PROGRAM_DATE` DATE NULL DEFAULT NULL COMMENT 'date only, no time',
  `GUARANTOR` VARCHAR(255) NULL DEFAULT NULL,
  `REMARKS` VARCHAR(500) NULL DEFAULT NULL,
  `ACTIVE` TINYINT(1) NOT NULL DEFAULT 1,
  `ENCODED_BY` INT NULL DEFAULT NULL,
  `ENCODED_DT` DATETIME NOT NULL,
  `EDITED_BY` INT NULL DEFAULT NULL,
  `EDITED_DT` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`IDNo`),
  KEY `idx_credit_txn_account_dt` (`ACCOUNT_ID`, `ENCODED_DT`),
  KEY `idx_credit_txn_guest` (`GUEST_ID`),
  KEY `idx_credit_txn_action` (`CREDIT_ACTION`),
  KEY `idx_credit_txn_source` (`CREDIT_SOURCE`),
  UNIQUE KEY `uk_credit_txn_ledger` (`LEDGER_ID`),
  KEY `idx_credit_txn_program_date` (`PROGRAM_DATE`),
  KEY `idx_credit_txn_active` (`ACTIVE`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
