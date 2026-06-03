-- Per-agent enable/disable for Telegram notifications (guest agent TELEGRAM_ID)
ALTER TABLE agent
  ADD COLUMN TELEGRAM_ENABLED TINYINT(1) NOT NULL DEFAULT 1
  AFTER TELEGRAM_ID;
