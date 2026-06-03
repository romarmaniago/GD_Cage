-- Multipurpose Ledger — funds OUTSIDE house cash balance (separate pool).
-- Table name `junket_funds_ledger` is kept for existing databases.
-- Does NOT post to cash_transaction or affect dashboard house balance.
-- TRANS_TYPE: 1=Deposit, 2=Withdrawal, 3=Transfer to account, 4=Money Exchange
-- Run once on your MySQL database.

CREATE TABLE IF NOT EXISTS `junket_funds_ledger` (
  `IDNo` INT NOT NULL AUTO_INCREMENT,
  `TRANS_TYPE` TINYINT NOT NULL COMMENT '1=Deposit, 2=Withdrawal, 3=Transfer, 4=Money Exchange',
  `AMOUNT` DECIMAL(18, 2) NOT NULL,
  `CURRENCY_ID` INT NULL DEFAULT NULL COMMENT 'currency_master.ID',
  `REMARKS` TEXT NULL DEFAULT NULL,
  `IN_CHARGE` VARCHAR(150) NULL DEFAULT NULL COMMENT 'Person in charge',
  `ACCOUNT_ID` INT NULL DEFAULT NULL COMMENT 'account.IDNo for Transfer to account',
  `ACCOUNT_LEDGER_ID` INT NULL DEFAULT NULL COMMENT 'account_ledger.IDNo for transfer',
  `ENCODED_BY` INT NULL DEFAULT NULL,
  `ENCODED_DT` DATETIME NULL DEFAULT NULL,
  `EDITED_BY` INT NULL DEFAULT NULL,
  `EDITED_DT` DATETIME NULL DEFAULT NULL,
  `ACTIVE` TINYINT NOT NULL DEFAULT 1,
  PRIMARY KEY (`IDNo`),
  KEY `idx_jfl_active_dt` (`ACTIVE`, `ENCODED_DT`),
  KEY `idx_jfl_account_id` (`ACCOUNT_ID`),
  KEY `idx_jfl_account_ledger_id` (`ACCOUNT_LEDGER_ID`),
  KEY `idx_jfl_currency_id` (`CURRENCY_ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
