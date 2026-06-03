-- Money exchange swap: link credit (exchange currency) and return reversal ledger rows.
-- Run once on your MySQL database.

ALTER TABLE `multipurpose_ledger_exchange`
  ADD COLUMN `CREDIT_LEDGER_ID` INT NULL DEFAULT NULL COMMENT 'junket_funds_ledger in-currency credit (deposit) row' AFTER `LEDGER_ID`,
  ADD COLUMN `RETURN_IN_LEDGER_ID` INT NULL DEFAULT NULL COMMENT 'return: credit in currency back' AFTER `SOURCE_DEPOSIT_ID`,
  ADD COLUMN `RETURN_EX_LEDGER_ID` INT NULL DEFAULT NULL COMMENT 'return: debit exchange currency out' AFTER `RETURN_IN_LEDGER_ID`,
  ADD KEY `idx_mple_credit_ledger_id` (`CREDIT_LEDGER_ID`);
