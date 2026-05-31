-- Gaokao H5 MySQL release verification for 2026-05-29.
-- Run after database/mysql/release_20260529_h5_ops.sql against the same database.

SET NAMES utf8mb4;
SET SESSION sql_mode = CONCAT_WS(',', NULLIF(@@sql_mode, ''), 'NO_BACKSLASH_ESCAPES');

SELECT DATABASE() AS target_database, @@version AS mysql_version;

SELECT
  'activity_config' AS check_item,
  activity_code,
  status,
  daily_default_chance,
  daily_share_bonus_limit,
  share_target,
  checkin_target
FROM activity_config
WHERE activity_code = 'gaokao_lucky_sign_2026';

SELECT
  'enabled_sign_count_should_be_20' AS check_item,
  COUNT(*) AS enabled_sign_count
FROM draw_result_config
WHERE activity_code = 'gaokao_lucky_sign_2026'
  AND result_code REGEXP '^sign_[0-9]{3}$'
  AND status = 'enabled';

SELECT
  result_code,
  result_title,
  reward_code,
  sort_order,
  status
FROM draw_result_config
WHERE activity_code = 'gaokao_lucky_sign_2026'
  AND result_code REGEXP '^sign_[0-9]{3}$'
  AND status = 'enabled'
ORDER BY result_code;

SELECT
  asset_key,
  asset_type,
  asset_url,
  status,
  sort_order
FROM activity_asset_config
WHERE activity_code = 'gaokao_lucky_sign_2026'
  AND asset_key IN ('p7_wechat_group_qrcode', 'p8_wechat_qrcode')
ORDER BY sort_order;

SELECT
  reward_code,
  issue_channel,
  hermes_id,
  ref_id,
  ref_type,
  start_time,
  end_time,
  face_value,
  status
FROM coupon_issue_config
WHERE activity_code = 'gaokao_lucky_sign_2026'
ORDER BY sort_order;

SELECT
  'draw_chance_log_change_type_check' AS check_item,
  tc.CONSTRAINT_NAME,
  cc.CHECK_CLAUSE
FROM information_schema.TABLE_CONSTRAINTS tc
JOIN information_schema.CHECK_CONSTRAINTS cc
  ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
 AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
WHERE tc.CONSTRAINT_SCHEMA = DATABASE()
  AND tc.TABLE_NAME = 'draw_chance_log'
  AND tc.CONSTRAINT_TYPE = 'CHECK'
  AND LOWER(cc.CHECK_CLAUSE) LIKE '%change_type%';

SELECT
  'rollback_log_history' AS check_item,
  COUNT(*) AS rollback_log_count
FROM draw_chance_log
WHERE activity_code = 'gaokao_lucky_sign_2026'
  AND change_type = 'rollback';
