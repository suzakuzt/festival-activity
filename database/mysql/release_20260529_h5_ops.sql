-- Gaokao H5 MySQL release script for 2026-05-29.
-- Run from the project root with the target database already selected, for example:
-- mysql --default-character-set=utf8mb4 -h <host> -P 3306 -u <user> -p <database> < database/mysql/release_20260529_h5_ops.sql
--
-- This script does not drop or truncate business data.
-- It creates missing tables, upserts activity seed data, refreshes the latest sign library,
-- and ensures draw_chance_log supports rollback plus pending share assists.

SET NAMES utf8mb4;
SET SESSION sql_mode = CONCAT_WS(',', NULLIF(@@sql_mode, ''), 'NO_BACKSLASH_ESCAPES');

SELECT DATABASE() AS target_database, @@version AS mysql_version;

SOURCE database/mysql/001_init_activity_tables.sql;

DELIMITER $$

DROP PROCEDURE IF EXISTS patch_h5_draw_chance_log_rollback $$
DROP PROCEDURE IF EXISTS patch_h5_share_assist_pending $$

CREATE PROCEDURE patch_h5_draw_chance_log_rollback()
BEGIN
  DECLARE v_table_exists INT DEFAULT 0;
  DECLARE v_drop_clause TEXT DEFAULT NULL;

  SELECT COUNT(*)
    INTO v_table_exists
    FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'draw_chance_log';

  IF v_table_exists > 0 THEN
    SELECT GROUP_CONCAT(CONCAT('DROP CHECK `', tc.CONSTRAINT_NAME, '`') SEPARATOR ', ')
      INTO v_drop_clause
      FROM information_schema.TABLE_CONSTRAINTS tc
      JOIN information_schema.CHECK_CONSTRAINTS cc
        ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
       AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
     WHERE tc.CONSTRAINT_SCHEMA = DATABASE()
       AND tc.TABLE_NAME = 'draw_chance_log'
       AND tc.CONSTRAINT_TYPE = 'CHECK'
       AND LOWER(cc.CHECK_CLAUSE) LIKE '%change_type%';

    IF v_drop_clause IS NOT NULL AND LENGTH(v_drop_clause) > 0 THEN
      SET @h5_drop_change_type_check_sql = CONCAT('ALTER TABLE `draw_chance_log` ', v_drop_clause);
      PREPARE h5_drop_change_type_check_stmt FROM @h5_drop_change_type_check_sql;
      EXECUTE h5_drop_change_type_check_stmt;
      DEALLOCATE PREPARE h5_drop_change_type_check_stmt;
    END IF;

    SET @h5_add_change_type_check_sql = 'ALTER TABLE `draw_chance_log` ADD CONSTRAINT `chk_draw_chance_log_change_type` CHECK (`change_type` IN (''daily_default'', ''share_bonus'', ''draw_consume'', ''admin_adjust'', ''rollback''))';
    PREPARE h5_add_change_type_check_stmt FROM @h5_add_change_type_check_sql;
    EXECUTE h5_add_change_type_check_stmt;
    DEALLOCATE PREPARE h5_add_change_type_check_stmt;
  END IF;
END $$

CALL patch_h5_draw_chance_log_rollback() $$

DROP PROCEDURE IF EXISTS patch_h5_draw_chance_log_rollback $$

CREATE PROCEDURE patch_h5_share_assist_pending()
BEGIN
  DECLARE v_table_exists INT DEFAULT 0;
  DECLARE v_drop_clause TEXT DEFAULT NULL;

  SELECT COUNT(*)
    INTO v_table_exists
    FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'share_assist_record';

  IF v_table_exists > 0 THEN
    SELECT GROUP_CONCAT(CONCAT('DROP CHECK `', tc.CONSTRAINT_NAME, '`') SEPARATOR ', ')
      INTO v_drop_clause
      FROM information_schema.TABLE_CONSTRAINTS tc
      JOIN information_schema.CHECK_CONSTRAINTS cc
        ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
       AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
     WHERE tc.CONSTRAINT_SCHEMA = DATABASE()
       AND tc.TABLE_NAME = 'share_assist_record'
       AND tc.CONSTRAINT_TYPE = 'CHECK'
       AND LOWER(cc.CHECK_CLAUSE) LIKE '%assist_status%';

    IF v_drop_clause IS NOT NULL AND LENGTH(v_drop_clause) > 0 THEN
      SET @h5_drop_assist_status_check_sql = CONCAT('ALTER TABLE `share_assist_record` ', v_drop_clause);
      PREPARE h5_drop_assist_status_check_stmt FROM @h5_drop_assist_status_check_sql;
      EXECUTE h5_drop_assist_status_check_stmt;
      DEALLOCATE PREPARE h5_drop_assist_status_check_stmt;
    END IF;

    ALTER TABLE `share_assist_record`
      MODIFY COLUMN `assist_status` VARCHAR(16) NOT NULL DEFAULT 'pending';

    SET @h5_add_assist_status_check_sql = 'ALTER TABLE `share_assist_record` ADD CONSTRAINT `chk_share_assist_record_assist_status` CHECK (`assist_status` IN (''pending'', ''completed'', ''invalid''))';
    PREPARE h5_add_assist_status_check_stmt FROM @h5_add_assist_status_check_sql;
    EXECUTE h5_add_assist_status_check_stmt;
    DEALLOCATE PREPARE h5_add_assist_status_check_stmt;
  END IF;
END $$

CALL patch_h5_share_assist_pending() $$

DROP PROCEDURE IF EXISTS patch_h5_share_assist_pending $$

DELIMITER ;

SOURCE database/mysql/002_seed_basic_mock_config.sql;

SELECT 'release_20260529_h5_ops_done' AS release_status, NOW() AS finished_at;
