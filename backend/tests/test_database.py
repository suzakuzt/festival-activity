import json
import os
import sqlite3
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.database import (
    build_mysql_config,
    connect,
    connection,
    default_database_path,
    fetch_one,
    get_database_engine,
    is_mysql_connection,
    last_insert_id,
    table_names,
    translate_sql_placeholders,
)
from backend.app.activity_service import (
    _activity_user_upsert_sql,
    _grand_prize_draw_config_upsert_sql,
    _grand_prize_qualification_upsert_sql,
)
from backend.app.health import build_health_status
from backend.app.repositories import ActivityRepository


class FakeMysqlConnection:
    db_engine = "mysql"


class DatabaseConnectionTests(unittest.TestCase):
    def test_default_database_path_points_to_local_sqlite_file(self):
        db_path = default_database_path()

        self.assertEqual(db_path.name, "gaokao_h5_dev.sqlite3")
        self.assertTrue(db_path.exists())

    def test_connect_enables_foreign_keys_and_row_access_by_name(self):
        with connection() as conn:
            foreign_keys = conn.execute("PRAGMA foreign_keys").fetchone()[0]
            row = conn.execute("SELECT 1 AS ok").fetchone()

        self.assertEqual(foreign_keys, 1)
        self.assertEqual(row["ok"], 1)

    def test_table_names_returns_stable_activity_schema(self):
        with connection() as conn:
            names = table_names(conn)

        self.assertIn("activity_config", names)
        self.assertIn("user_daily_state", names)
        self.assertIn("draw_record", names)
        self.assertIn("coupon_issue_config", names)
        self.assertIn("grand_prize_draw_config", names)
        self.assertEqual(len(names), 18)

    def test_fetch_one_returns_dictionary_or_none(self):
        with connection() as conn:
            row = fetch_one(conn, "SELECT activity_code FROM activity_config WHERE activity_code = ?", ("gaokao_lucky_sign_2026",))
            missing = fetch_one(conn, "SELECT activity_code FROM activity_config WHERE activity_code = ?", ("missing",))

        self.assertEqual(row, {"activity_code": "gaokao_lucky_sign_2026"})
        self.assertIsNone(missing)

    def test_database_engine_defaults_to_sqlite_and_allows_mysql(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(get_database_engine(), "sqlite")

        with patch.dict(os.environ, {"GAOKAO_H5_DB_ENGINE": "MySQL"}):
            self.assertEqual(get_database_engine(), "mysql")

    def test_translate_sql_placeholders_preserves_quoted_question_marks(self):
        sql = "SELECT '?' AS literal, id FROM t WHERE a = ? AND b = '?' AND c = ?"

        translated = translate_sql_placeholders(sql)

        self.assertEqual(translated, "SELECT '?' AS literal, id FROM t WHERE a = %s AND b = '?' AND c = %s")

    def test_build_mysql_config_reads_environment_without_using_sqlite_path(self):
        with patch.dict(
            os.environ,
            {
                "GAOKAO_H5_MYSQL_HOST": "10.3.0.4",
                "GAOKAO_H5_MYSQL_PORT": "3306",
                "GAOKAO_H5_MYSQL_DATABASE": "app_333d63781c34389e",
                "GAOKAO_H5_MYSQL_USER": "appuser",
                "GAOKAO_H5_MYSQL_PASSWORD": "secret-password",
            },
        ):
            config = build_mysql_config()

        self.assertEqual(config["host"], "10.3.0.4")
        self.assertEqual(config["port"], 3306)
        self.assertEqual(config["database"], "app_333d63781c34389e")
        self.assertEqual(config["user"], "appuser")
        self.assertEqual(config["password"], "secret-password")

    def test_last_insert_id_uses_db_api_cursor_lastrowid(self):
        with connection() as conn:
            cursor = conn.execute(
                "INSERT INTO tracking_event (activity_code, page_code, event_name, event_payload) VALUES (?, ?, ?, ?)",
                ("gaokao_lucky_sign_2026", "test", "adapter_test", "{}"),
            )
            inserted_id = last_insert_id(conn, cursor)
            conn.rollback()

        self.assertGreater(inserted_id, 0)
        self.assertFalse(is_mysql_connection(conn))

    def test_activity_user_upsert_sql_switches_to_mysql_syntax(self):
        mysql_sql = _activity_user_upsert_sql(FakeMysqlConnection())

        self.assertIn("ON DUPLICATE KEY UPDATE", mysql_sql)
        self.assertIn("VALUES(external_user_id)", mysql_sql)
        self.assertNotIn("ON CONFLICT", mysql_sql)
        self.assertNotIn("excluded.", mysql_sql)

    def test_grand_prize_draw_config_upsert_sql_switches_to_mysql_syntax(self):
        mysql_sql = _grand_prize_draw_config_upsert_sql(FakeMysqlConnection())

        self.assertIn("ON DUPLICATE KEY UPDATE", mysql_sql)
        self.assertIn("VALUES(winning_lottery_nos)", mysql_sql)
        self.assertNotIn("ON CONFLICT", mysql_sql)
        self.assertNotIn("excluded.", mysql_sql)

    def test_grand_prize_qualification_upsert_sql_switches_to_mysql_syntax(self):
        mysql_sql = _grand_prize_qualification_upsert_sql(FakeMysqlConnection())

        self.assertIn("ON DUPLICATE KEY UPDATE", mysql_sql)
        self.assertIn("VALUES(qualification_snapshot_json)", mysql_sql)
        self.assertNotIn("ON CONFLICT", mysql_sql)
        self.assertNotIn("excluded.", mysql_sql)


class ActivityRepositoryTests(unittest.TestCase):
    def test_get_activity_state_config_reads_seeded_basic_rules(self):
        with connection() as conn:
            repo = ActivityRepository(conn)
            config = repo.get_activity_state_config("gaokao_lucky_sign_2026")

        self.assertEqual(config["activity_code"], "gaokao_lucky_sign_2026")
        self.assertEqual(config["daily_default_chance"], 1)
        self.assertEqual(config["daily_share_bonus_limit"], 3)
        self.assertEqual(config["share_target"], 5)
        self.assertEqual(config["checkin_target"], 7)

    def test_get_basic_config_counts_reads_seeded_mock_configuration(self):
        with connection() as conn:
            repo = ActivityRepository(conn)
            counts = repo.get_basic_config_counts("gaokao_lucky_sign_2026")

        self.assertEqual(
            counts,
            {
                "asset_count": 8,
                "product_count": 4,
                "reward_count": 7,
                "draw_result_count": 20,
            },
        )

    def test_draw_result_config_reads_seeded_exam_sign_library_without_side_copy(self):
        expected_titles = [
            "过儿签",
            "奶茶签",
            "早饭签",
            "公交签",
            "外卖签",
            "充电签",
            "导航签",
            "电梯签",
            "洗衣签",
            "冰箱签",
            "煮面签",
            "雨伞签",
            "超市签",
            "闹钟签",
            "行李签",
            "锅盖签",
            "筷子签",
            "地铁签",
            "被窝签",
            "金榜签",
        ]

        with connection() as conn:
            rows = conn.execute(
                """
                SELECT result_code, result_title, main_text, good_text, avoid_text, explain_content, ext_json
                FROM draw_result_config
                WHERE activity_code = ? AND status = 'enabled'
                ORDER BY sort_order ASC, id ASC
                """,
                ("gaokao_lucky_sign_2026",),
            ).fetchall()

        self.assertEqual([row["result_code"] for row in rows], [f"sign_{index:03d}" for index in range(1, 21)])
        self.assertEqual([row["result_title"] for row in rows], expected_titles)
        self.assertEqual(rows[0]["main_text"], "考试期间，\\n别叫我真名，\\n叫我过儿，\\n最好叫我全过儿。")
        self.assertEqual(rows[-1]["main_text"], "笔尖一落，\\n少年上桌。\\n今日开卷，\\n明日上岸。")
        self.assertTrue(all(row["good_text"] == "" for row in rows))
        self.assertTrue(all(row["avoid_text"] == "" for row in rows))
        self.assertIn("此签属“礼貌玄学派”", rows[0]["explain_content"])
        first_ext = json.loads(rows[0]["ext_json"])
        self.assertEqual(first_ext["sign_type"], "过儿签")
        self.assertEqual(first_ext["main_text_columns"], ["考试期间，", "别叫我真名，", "叫我过儿，", "最好叫我全过儿。"])
        self.assertEqual(first_ext["fortune_headline"], "过儿签")
        self.assertEqual(first_ext["fortune_hint"], "考试期间，\n别叫我真名，\n叫我过儿，\n最好叫我全过儿。")
        self.assertIn("准考证名字不能乱写", first_ext["explain_text"])
        last_ext = json.loads(rows[-1]["ext_json"])
        self.assertEqual(last_ext["sign_type"], "金榜签")
        self.assertEqual(last_ext["main_text_columns"], ["笔尖一落，", "少年上桌。", "今日开卷，", "明日上岸。"])
        self.assertIn("愿你该会的都想起", last_ext["explain_text"])


class HealthStatusTests(unittest.TestCase):
    def test_build_health_status_returns_database_and_seed_summary(self):
        status = build_health_status("gaokao_lucky_sign_2026")

        self.assertEqual(status["database"]["connected"], True)
        self.assertEqual(status["database"]["table_count"], 18)
        self.assertEqual(status["activity"]["activity_code"], "gaokao_lucky_sign_2026")
        self.assertEqual(status["activity"]["daily_default_chance"], 1)
        self.assertEqual(status["seed_counts"]["reward_count"], 7)

    def test_build_health_status_uses_mysql_engine_connection_without_sqlite_path(self):
        calls = []

        class DummyConnectionContext:
            def __enter__(self):
                return object()

            def __exit__(self, exc_type, exc, tb):
                return False

        def fake_connection(*args):
            calls.append(args)
            return DummyConnectionContext()

        class FakeRepository:
            def __init__(self, conn):
                self.conn = conn

            def get_activity_state_config(self, activity_code):
                return {"activity_code": activity_code}

            def get_basic_config_counts(self, activity_code):
                return {"reward_count": 7}

        with (
            patch("backend.app.health.get_database_engine", return_value="mysql"),
            patch("backend.app.health.build_mysql_config", return_value={"host": "10.3.0.4", "database": "app_db", "user": "appuser", "password": "secret"}),
            patch("backend.app.health.connection", side_effect=fake_connection),
            patch("backend.app.health.table_names", return_value=["activity_config"]),
            patch("backend.app.health.ActivityRepository", FakeRepository),
        ):
            status = build_health_status("gaokao_lucky_sign_2026")

        self.assertEqual(calls, [()])
        self.assertEqual(status["database"]["engine"], "mysql")
        self.assertEqual(status["database"]["host"], "10.3.0.4")
        self.assertEqual(status["database"]["database"], "app_db")
        self.assertNotIn("password", status["database"])


if __name__ == "__main__":
    unittest.main()
