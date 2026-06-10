-- Manual membership card number on guest (8–10 digits, not auto-increment)
ALTER TABLE guest
  ADD COLUMN MEMBERSHIP_NO VARCHAR(10) NULL DEFAULT NULL AFTER NAME;

CREATE UNIQUE INDEX idx_guest_membership_no ON guest (MEMBERSHIP_NO);
