-- Remarks per agent group (Analytics → Categorize Group panel)
ALTER TABLE gi_agent_group
  ADD COLUMN REMARKS VARCHAR(255) NULL DEFAULT NULL
  AFTER GROUP_NAME;
