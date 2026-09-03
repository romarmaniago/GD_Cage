-- Link account_ledger rows to the game_services record that created them
-- (F&B / Hotel service deposits). Lets delete/edit target the exact ledger
-- row instead of guessing by amount + "latest".
-- NOTE: Auto-applied on app startup via utils/ensureAccountLedgerServiceIdSchema.js.

ALTER TABLE `account_ledger`
  ADD COLUMN `SERVICE_ID` INT NULL DEFAULT NULL
    COMMENT 'game_services.IDNo for service-originated ledger rows',
  ADD KEY `idx_account_ledger_service_id` (`SERVICE_ID`);
