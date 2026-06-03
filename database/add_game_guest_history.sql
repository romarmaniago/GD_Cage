-- Audit log when a game's guest is assigned or changed (Assign guest modal).
-- Run once on your MySQL database.

CREATE TABLE IF NOT EXISTS `game_guest_history` (
  `IDNo` INT NOT NULL AUTO_INCREMENT,
  `GAME_ID` INT NOT NULL,
  `PREV_GUEST_ID` INT NULL DEFAULT NULL,
  `NEW_GUEST_ID` INT NULL DEFAULT NULL,
  `ENCODED_BY` INT NULL DEFAULT NULL,
  `ENCODED_DT` DATETIME NOT NULL,
  PRIMARY KEY (`IDNo`),
  KEY `idx_ggh_game_dt` (`GAME_ID`, `ENCODED_DT`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
