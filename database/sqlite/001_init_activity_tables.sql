PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS activity_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_code TEXT NOT NULL UNIQUE,
  activity_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'ended')),
  start_at TEXT,
  end_at TEXT,
  daily_default_chance INTEGER NOT NULL DEFAULT 1 CHECK (daily_default_chance >= 0),
  daily_share_bonus_limit INTEGER NOT NULL DEFAULT 3 CHECK (daily_share_bonus_limit >= 0),
  share_target INTEGER NOT NULL DEFAULT 5 CHECK (share_target >= 0),
  checkin_target INTEGER NOT NULL DEFAULT 7 CHECK (checkin_target >= 0),
  grand_prize_name TEXT NOT NULL DEFAULT '985 和牛礼盒',
  rules_text TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activity_asset_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_code TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('qrcode', 'reward_image', 'product_image', 'banner', 'background', 'icon', 'other')),
  asset_url TEXT NOT NULL,
  fallback_url TEXT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  ext_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (activity_code, asset_key),
  FOREIGN KEY (activity_code) REFERENCES activity_config(activity_code)
);

CREATE TABLE IF NOT EXISTS product_recommend_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_code TEXT NOT NULL,
  product_code TEXT NOT NULL,
  product_id TEXT,
  product_name TEXT NOT NULL,
  product_desc TEXT,
  product_image_url TEXT,
  price_text TEXT,
  action_type TEXT NOT NULL DEFAULT 'mini_program_product_detail',
  action_target TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  ext_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (activity_code, product_code),
  FOREIGN KEY (activity_code) REFERENCES activity_config(activity_code)
);

CREATE TABLE IF NOT EXISTS reward_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_code TEXT NOT NULL,
  reward_code TEXT NOT NULL,
  reward_type TEXT NOT NULL CHECK (reward_type IN ('coupon', 'discount_coupon', 'product', 'grand_prize', 'other')),
  reward_name TEXT NOT NULL,
  reward_title TEXT,
  reward_desc TEXT,
  reward_amount_text TEXT,
  reward_image_url TEXT,
  button_text TEXT,
  action_type TEXT NOT NULL DEFAULT 'placeholder',
  action_target TEXT,
  is_grand_prize INTEGER NOT NULL DEFAULT 0 CHECK (is_grand_prize IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  ext_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (activity_code, reward_code),
  FOREIGN KEY (activity_code) REFERENCES activity_config(activity_code)
);

CREATE TABLE IF NOT EXISTS coupon_issue_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_code TEXT NOT NULL,
  reward_code TEXT NOT NULL,
  issue_channel TEXT NOT NULL DEFAULT 'hermes' CHECK (issue_channel IN ('hermes')),
  hermes_title TEXT NOT NULL,
  hermes_id INTEGER NOT NULL,
  ref_id INTEGER NOT NULL,
  ref_type INTEGER NOT NULL DEFAULT 1,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  face_value TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  ext_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (activity_code, reward_code, issue_channel),
  FOREIGN KEY (activity_code) REFERENCES activity_config(activity_code),
  FOREIGN KEY (activity_code, reward_code) REFERENCES reward_config(activity_code, reward_code)
);

CREATE TABLE IF NOT EXISTS draw_result_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_code TEXT NOT NULL,
  result_code TEXT NOT NULL,
  result_level TEXT,
  result_title TEXT NOT NULL,
  main_text TEXT NOT NULL,
  good_text TEXT,
  avoid_text TEXT,
  explain_title TEXT,
  explain_content TEXT,
  tags_json TEXT,
  product_code TEXT,
  reward_code TEXT,
  status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  ext_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (activity_code, result_code),
  FOREIGN KEY (activity_code) REFERENCES activity_config(activity_code),
  FOREIGN KEY (activity_code, product_code) REFERENCES product_recommend_config(activity_code, product_code),
  FOREIGN KEY (activity_code, reward_code) REFERENCES reward_config(activity_code, reward_code)
);

CREATE TABLE IF NOT EXISTS activity_user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_code TEXT NOT NULL,
  user_key TEXT NOT NULL,
  external_user_id TEXT,
  openid TEXT,
  unionid TEXT,
  nickname TEXT,
  avatar_url TEXT,
  source_channel TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (activity_code, user_key),
  FOREIGN KEY (activity_code) REFERENCES activity_config(activity_code)
);

CREATE TABLE IF NOT EXISTS activity_session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_code TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  session_token TEXT NOT NULL UNIQUE,
  source_page TEXT,
  source_channel TEXT,
  source_share_token TEXT,
  source_user_id INTEGER,
  ip_address TEXT,
  user_agent TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_code) REFERENCES activity_config(activity_code),
  FOREIGN KEY (user_id) REFERENCES activity_user(id),
  FOREIGN KEY (source_user_id) REFERENCES activity_user(id)
);

CREATE TABLE IF NOT EXISTS draw_record (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_code TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  session_id INTEGER,
  draw_no TEXT NOT NULL UNIQUE,
  result_code TEXT NOT NULL,
  biz_date TEXT NOT NULL,
  chance_cost INTEGER NOT NULL DEFAULT 1 CHECK (chance_cost > 0),
  draw_status TEXT NOT NULL DEFAULT 'success' CHECK (draw_status IN ('success', 'failed', 'cancelled')),
  source_share_token TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (activity_code, user_id, idempotency_key),
  FOREIGN KEY (activity_code) REFERENCES activity_config(activity_code),
  FOREIGN KEY (user_id) REFERENCES activity_user(id),
  FOREIGN KEY (session_id) REFERENCES activity_session(id),
  FOREIGN KEY (activity_code, result_code) REFERENCES draw_result_config(activity_code, result_code)
);

CREATE TABLE IF NOT EXISTS draw_chance_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_code TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  log_no TEXT NOT NULL UNIQUE,
  biz_date TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('daily_default', 'share_bonus', 'draw_consume', 'admin_adjust', 'rollback')),
  chance_delta INTEGER NOT NULL CHECK (chance_delta <> 0),
  chance_before INTEGER NOT NULL DEFAULT 0 CHECK (chance_before >= 0),
  chance_after INTEGER NOT NULL DEFAULT 0 CHECK (chance_after >= 0),
  source_type TEXT,
  source_id TEXT,
  idempotency_key TEXT,
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (activity_code, user_id, idempotency_key),
  FOREIGN KEY (activity_code) REFERENCES activity_config(activity_code),
  FOREIGN KEY (user_id) REFERENCES activity_user(id)
);

CREATE TABLE IF NOT EXISTS checkin_record (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_code TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  draw_id INTEGER NOT NULL,
  biz_date TEXT NOT NULL,
  lit_day_no INTEGER CHECK (lit_day_no IS NULL OR lit_day_no > 0),
  status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'invalid')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (activity_code, user_id, biz_date),
  FOREIGN KEY (activity_code) REFERENCES activity_config(activity_code),
  FOREIGN KEY (user_id) REFERENCES activity_user(id),
  FOREIGN KEY (draw_id) REFERENCES draw_record(id)
);

CREATE TABLE IF NOT EXISTS share_record (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_code TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  session_id INTEGER,
  share_token TEXT NOT NULL UNIQUE,
  biz_date TEXT NOT NULL,
  share_channel TEXT,
  share_status TEXT NOT NULL DEFAULT 'created' CHECK (share_status IN ('created', 'completed', 'cancelled')),
  reward_granted INTEGER NOT NULL DEFAULT 0 CHECK (reward_granted IN (0, 1)),
  reward_chance_delta INTEGER NOT NULL DEFAULT 0 CHECK (reward_chance_delta >= 0),
  idempotency_key TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (activity_code, user_id, idempotency_key),
  FOREIGN KEY (activity_code) REFERENCES activity_config(activity_code),
  FOREIGN KEY (user_id) REFERENCES activity_user(id),
  FOREIGN KEY (session_id) REFERENCES activity_session(id)
);

CREATE TABLE IF NOT EXISTS share_assist_record (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_code TEXT NOT NULL,
  share_record_id INTEGER NOT NULL,
  share_token TEXT NOT NULL,
  sharer_user_id INTEGER NOT NULL,
  assister_user_id INTEGER NOT NULL,
  assister_session_id INTEGER,
  draw_id INTEGER NOT NULL,
  biz_date TEXT NOT NULL,
  assist_status TEXT NOT NULL DEFAULT 'pending' CHECK (assist_status IN ('pending', 'completed', 'invalid')),
  invalid_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (activity_code, share_token, assister_user_id),
  UNIQUE (activity_code, sharer_user_id, assister_user_id),
  FOREIGN KEY (activity_code) REFERENCES activity_config(activity_code),
  FOREIGN KEY (share_record_id) REFERENCES share_record(id),
  FOREIGN KEY (sharer_user_id) REFERENCES activity_user(id),
  FOREIGN KEY (assister_user_id) REFERENCES activity_user(id),
  FOREIGN KEY (assister_session_id) REFERENCES activity_session(id),
  FOREIGN KEY (draw_id) REFERENCES draw_record(id)
);

CREATE TABLE IF NOT EXISTS reward_claim_record (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_code TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  session_id INTEGER,
  draw_id INTEGER,
  reward_code TEXT NOT NULL,
  claim_no TEXT NOT NULL UNIQUE,
  claim_status TEXT NOT NULL DEFAULT 'success' CHECK (claim_status IN ('success', 'pending', 'failed', 'cancelled')),
  claim_channel TEXT,
  reward_snapshot_json TEXT,
  action_type TEXT,
  action_target TEXT,
  idempotency_key TEXT,
  receiver_mobile TEXT,
  receiver_mobile_masked TEXT,
  claim_token TEXT,
  coupon_issue_status TEXT NOT NULL DEFAULT 'pending' CHECK (coupon_issue_status IN ('pending', 'issued', 'failed', 'skipped')),
  coupon_issue_error TEXT,
  external_member_id TEXT,
  biz_date TEXT NOT NULL,
  claimed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (activity_code, user_id, draw_id, reward_code),
  UNIQUE (activity_code, user_id, idempotency_key),
  UNIQUE (activity_code, claim_token),
  FOREIGN KEY (activity_code) REFERENCES activity_config(activity_code),
  FOREIGN KEY (user_id) REFERENCES activity_user(id),
  FOREIGN KEY (session_id) REFERENCES activity_session(id),
  FOREIGN KEY (draw_id) REFERENCES draw_record(id),
  FOREIGN KEY (activity_code, reward_code) REFERENCES reward_config(activity_code, reward_code)
);

CREATE TABLE IF NOT EXISTS grand_prize_qualification (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_code TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  qualify_status TEXT NOT NULL DEFAULT 'not_qualified' CHECK (qualify_status IN ('not_qualified', 'qualified', 'used', 'expired')),
  qualify_type TEXT NOT NULL DEFAULT 'none' CHECK (qualify_type IN ('none', 'share', 'checkin', 'both')),
  shared_count INTEGER NOT NULL DEFAULT 0 CHECK (shared_count >= 0),
  lit_days INTEGER NOT NULL DEFAULT 0 CHECK (lit_days >= 0),
  lottery_no TEXT UNIQUE,
  lottery_status TEXT NOT NULL DEFAULT 'pending' CHECK (lottery_status IN ('pending', 'waiting_draw', 'drawn', 'won', 'not_won')),
  qrcode_id TEXT,
  qrcode_url TEXT,
  qualified_at TEXT,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (activity_code, user_id),
  FOREIGN KEY (activity_code) REFERENCES activity_config(activity_code),
  FOREIGN KEY (user_id) REFERENCES activity_user(id)
);

CREATE TABLE IF NOT EXISTS grand_prize_draw_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_code TEXT NOT NULL UNIQUE,
  draw_enabled INTEGER NOT NULL DEFAULT 0 CHECK (draw_enabled IN (0, 1)),
  winning_lottery_nos TEXT NOT NULL DEFAULT '[]',
  configured_by TEXT,
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_code) REFERENCES activity_config(activity_code)
);

CREATE TABLE IF NOT EXISTS tracking_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_code TEXT,
  user_id INTEGER,
  session_token TEXT,
  page_code TEXT,
  event_name TEXT NOT NULL,
  event_payload TEXT,
  client_time TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_code) REFERENCES activity_config(activity_code),
  FOREIGN KEY (user_id) REFERENCES activity_user(id)
);

CREATE INDEX IF NOT EXISTS idx_activity_asset_status
  ON activity_asset_config(activity_code, asset_type, status, sort_order);

CREATE INDEX IF NOT EXISTS idx_product_recommend_status
  ON product_recommend_config(activity_code, status, sort_order);

CREATE INDEX IF NOT EXISTS idx_reward_config_status
  ON reward_config(activity_code, reward_type, status, sort_order);

CREATE INDEX IF NOT EXISTS idx_coupon_issue_status
  ON coupon_issue_config(activity_code, status, sort_order);

CREATE INDEX IF NOT EXISTS idx_draw_result_status
  ON draw_result_config(activity_code, status, sort_order);

CREATE INDEX IF NOT EXISTS idx_activity_user_external
  ON activity_user(activity_code, external_user_id, openid, unionid);

CREATE INDEX IF NOT EXISTS idx_activity_session_user
  ON activity_session(activity_code, user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_draw_record_user_date
  ON draw_record(activity_code, user_id, biz_date, created_at);

CREATE INDEX IF NOT EXISTS idx_draw_chance_user_date
  ON draw_chance_log(activity_code, user_id, biz_date, change_type, created_at);

CREATE INDEX IF NOT EXISTS idx_share_record_user_date
  ON share_record(activity_code, user_id, biz_date, created_at);

CREATE INDEX IF NOT EXISTS idx_share_assist_sharer
  ON share_assist_record(activity_code, sharer_user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_reward_claim_user
  ON reward_claim_record(activity_code, user_id, claim_status, created_at);

CREATE INDEX IF NOT EXISTS idx_reward_claim_mobile
  ON reward_claim_record(activity_code, receiver_mobile);

CREATE INDEX IF NOT EXISTS idx_reward_claim_coupon_issue
  ON reward_claim_record(activity_code, coupon_issue_status, created_at);

CREATE INDEX IF NOT EXISTS idx_grand_prize_status
  ON grand_prize_qualification(activity_code, qualify_status, lottery_status);

CREATE INDEX IF NOT EXISTS idx_tracking_event_name
  ON tracking_event(activity_code, event_name, created_at);
