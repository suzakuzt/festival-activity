import unittest
import gc
import os
import tempfile
import json
import time
import warnings
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app.ai_explain import _parse_ai_content
from backend.app.main import app
from backend.services.hermes_coupon_client import HermesCouponError


class FakeHermesCouponClient:
    def __init__(self):
        self.issued_mobiles = []
        self.issued_requests = []
        self.issue_error = None
        self.issue_responses = []

    def issue_coupon(self, mobile, issue_config=None, *, trace_id=""):
        self.issued_mobiles.append(mobile)
        self.issued_requests.append({"mobile": mobile, "issue_config": issue_config, "trace_id": trace_id})
        if self.issue_responses:
            response = self.issue_responses.pop(0)
            if isinstance(response, Exception):
                raise response
            return response
        if self.issue_error:
            raise self.issue_error
        return {
            "code": "0",
            "success": True,
            "data": {
                "id": 2605250000000031,
                "successNum": 1,
                "failNum": 0,
            },
        }


class AiExplainParsingTests(unittest.TestCase):
    def test_parse_ai_content_accepts_string_lines_and_strips_numbering(self):
        content = json.dumps(
            {
                "thinkingProcess": "\u601d\u8003\u7b7e\u9762\n\u770b\u725b\u6c14\u8865\u7ed9\n\u6536\u6210\u597d\u8fd0",
                "explainLines": "1. \u843d\u7b14\u751f\u82b1;2. \u725b\u6c14\u8865\u7ed9;\u2022 \u91d1\u699c\u9898\u540d",
                "themeText": "\u9ad8\u8003\u597d\u8fd0 x \u725b\u6c14\u8865\u7ed9",
            },
            ensure_ascii=False,
        )

        payload = _parse_ai_content(content)

        self.assertEqual(payload["thinkingProcess"], ["\u601d\u8003\u7b7e\u9762", "\u770b\u725b\u6c14\u8865\u7ed9", "\u6536\u6210\u597d\u8fd0"])
        self.assertEqual(payload["explainLines"], ["\u843d\u7b14\u751f\u82b1", "\u725b\u6c14\u8865\u7ed9", "\u91d1\u699c\u9898\u540d"])


class ApiHealthTests(unittest.TestCase):
    def test_health_endpoint_returns_database_and_activity_summary(self):
        client = TestClient(app)

        response = client.get("/api/health")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["database"]["connected"], True)
        self.assertEqual(payload["database"]["table_count"], 18)
        self.assertEqual(payload["activity"]["activity_code"], "gaokao_lucky_sign_2026")
        self.assertEqual(payload["seed_counts"]["reward_count"], 7)


class ActivityApiFlowTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "activity.sqlite3"
        self.poster_dir = Path(self.temp_dir.name) / "posters"
        self._previous_database_engine = os.environ.get("GAOKAO_H5_DB_ENGINE")
        self._previous_database_path = os.environ.get("GAOKAO_H5_DB_PATH")
        self._previous_poster_dir = os.environ.get("GAOKAO_H5_POSTER_DIR")
        self._previous_poster_max_bytes = os.environ.get("GAOKAO_H5_POSTER_MAX_BYTES")
        self._previous_admin_token = os.environ.get("GAOKAO_H5_ADMIN_TOKEN")
        self._previous_deepseek_env = {
            key: os.environ.get(key)
            for key in ("DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL", "DEEPSEEK_REASONING_EFFORT")
        }
        os.environ["GAOKAO_H5_DB_ENGINE"] = "sqlite"
        os.environ["GAOKAO_H5_DB_PATH"] = str(self.database_path)
        os.environ["GAOKAO_H5_POSTER_DIR"] = str(self.poster_dir)
        os.environ["GAOKAO_H5_ADMIN_TOKEN"] = "unit-test-admin-token"
        os.environ["DEEPSEEK_API_KEY"] = ""
        os.environ.pop("DEEPSEEK_BASE_URL", None)
        os.environ.pop("DEEPSEEK_MODEL", None)
        os.environ.pop("DEEPSEEK_REASONING_EFFORT", None)
        self.hermes_client = FakeHermesCouponClient()
        self._hermes_patch = patch("backend.app.activity_service.get_hermes_coupon_client", return_value=self.hermes_client)
        self._hermes_patch.start()
        self._initialize_database()
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.hermes_client.issue_error = None
        self.hermes_client.issue_responses = []
        self._hermes_patch.stop()
        if self._previous_database_engine is None:
            os.environ.pop("GAOKAO_H5_DB_ENGINE", None)
        else:
            os.environ["GAOKAO_H5_DB_ENGINE"] = self._previous_database_engine
        if self._previous_database_path is None:
            os.environ.pop("GAOKAO_H5_DB_PATH", None)
        else:
            os.environ["GAOKAO_H5_DB_PATH"] = self._previous_database_path
        if self._previous_poster_dir is None:
            os.environ.pop("GAOKAO_H5_POSTER_DIR", None)
        else:
            os.environ["GAOKAO_H5_POSTER_DIR"] = self._previous_poster_dir
        if self._previous_poster_max_bytes is None:
            os.environ.pop("GAOKAO_H5_POSTER_MAX_BYTES", None)
        else:
            os.environ["GAOKAO_H5_POSTER_MAX_BYTES"] = self._previous_poster_max_bytes
        if self._previous_admin_token is None:
            os.environ.pop("GAOKAO_H5_ADMIN_TOKEN", None)
        else:
            os.environ["GAOKAO_H5_ADMIN_TOKEN"] = self._previous_admin_token
        for key, value in self._previous_deepseek_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        for attempt in range(3):
            try:
                self.temp_dir.cleanup()
                break
            except PermissionError:
                if attempt == 2:
                    raise
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", ResourceWarning)
                    gc.collect()
                time.sleep(0.1)

    def _initialize_database(self):
        import sqlite3

        root_dir = Path(__file__).resolve().parents[2]
        scripts = [
            root_dir / "database" / "sqlite" / "001_init_activity_tables.sql",
            root_dir / "database" / "sqlite" / "002_seed_basic_mock_config.sql",
            root_dir / "database" / "sqlite" / "003_optimize_activity_tables.sql",
            root_dir / "database" / "sqlite" / "004_allow_duplicate_reward_claims_per_draw.sql",
            root_dir / "database" / "sqlite" / "006_add_coupon_issue_config.sql",
            root_dir / "database" / "sqlite" / "007_add_grand_prize_draw_config.sql",
            root_dir / "database" / "sqlite" / "008_add_grand_prize_lottery_suffix.sql",
            root_dir / "database" / "sqlite" / "009_add_grand_prize_draw_time.sql",
        ]
        conn = sqlite3.connect(self.database_path)
        try:
            for script in scripts:
                conn.executescript(script.read_text(encoding="utf-8"))
        finally:
            conn.close()

    def _create_session(self, user_key="user_001", share_token=None):
        payload = {"user_key": user_key, "source_page": "p1", "source_channel": "test"}
        if share_token:
            payload["share_token"] = share_token
        response = self.client.post("/api/h5/session/create", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def _draw(self, session_token):
        response = self.client.post("/api/draw/execute", json={"session_token": session_token})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def _draw_with_reward(self, session_token, reward_code):
        draw = self._draw(session_token)
        import sqlite3

        conn = sqlite3.connect(self.database_path)
        try:
            row = conn.execute("SELECT result_summary_json FROM draw_record WHERE id = ?", (draw["draw_id"],)).fetchone()
            summary = json.loads(row[0] or "{}")
            summary["reward_code"] = reward_code
            summary["rewardCode"] = reward_code
            conn.execute(
                "UPDATE draw_record SET result_summary_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (json.dumps(summary, ensure_ascii=False), draw["draw_id"]),
            )
            conn.commit()
        finally:
            conn.close()

        draw["result"]["reward_code"] = reward_code
        draw["result"]["rewardCode"] = reward_code
        return draw

    def _draw_and_claim(self, session_token, mobile):
        draw = self._draw(session_token)
        claim = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session_token,
                "draw_id": draw["draw_id"],
                "reward_code": draw["result"]["reward_code"],
                "mobile": mobile,
            },
        )
        self.assertEqual(claim.status_code, 200, claim.text)
        return draw, claim.json()

    def _valid_mobile(self, index):
        return f"138{index:08d}"

    def _admin_headers(self):
        return {"X-Admin-Token": "unit-test-admin-token"}

    def _set_draw_chance(self, user_id, chance):
        import sqlite3

        conn = sqlite3.connect(self.database_path)
        try:
            conn.execute(
                """
                UPDATE user_daily_state
                SET base_draw_chance = ?,
                    used_draw_count = 0,
                    remaining_draw_count = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE activity_code = 'gaokao_lucky_sign_2026' AND user_id = ?
                """,
                (chance, chance, user_id),
            )
            conn.commit()
        finally:
            conn.close()

    def _enable_coupon_issue_config(self, reward_code):
        import sqlite3

        conn = sqlite3.connect(self.database_path)
        try:
            conn.execute(
                """
                UPDATE coupon_issue_config
                SET status = 'enabled'
                WHERE activity_code = 'gaokao_lucky_sign_2026'
                  AND reward_code = ?
                """,
                (reward_code,),
            )
            conn.commit()
        finally:
            conn.close()

    def test_session_create_and_activity_state_return_daily_chance(self):
        session = self._create_session()

        self.assertEqual(session["activity_code"], "gaokao_lucky_sign_2026")
        self.assertEqual(session["user"]["user_key"], "user_001")
        self.assertEqual(session["daily_state"]["remaining_draw_count"], 1)

        response = self.client.get("/api/activity/state", params={"session_token": session["session_token"]})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["daily_state"]["base_draw_chance"], 1)
        self.assertEqual(payload["daily_state"]["remaining_draw_count"], 1)
        self.assertEqual(payload["progress"]["lit_days"], 0)
        self.assertEqual(payload["progress"]["shared_count"], 0)

    def test_draw_execute_consumes_chance_and_creates_one_daily_checkin(self):
        session = self._create_session()
        self._set_draw_chance(session["user"]["user_id"], 1)

        with patch("backend.app.activity_service.secrets.randbelow", return_value=0):
            draw = self._draw(session["session_token"])

        self.assertEqual(draw["success"], True)
        self.assertEqual(draw["result"]["signType"], "过儿签")
        self.assertEqual(draw["result"]["signLevel"], "上上签")
        self.assertEqual(draw["result"]["fortuneHeadline"], "过儿签")
        self.assertEqual(draw["result"]["fortuneHint"], "考试期间，\n别叫我真名，\n叫我过儿，\n最好叫我全过儿。")
        self.assertEqual(draw["result"]["mainTextColumns"], ["考试期间，", "别叫我真名，", "叫我过儿，", "最好叫我全过儿。"])
        self.assertEqual(draw["result"]["goodFor"], "")
        self.assertEqual(draw["result"]["avoid"], "")
        self.assertEqual(draw["daily_state"]["remaining_draw_count"], 0)
        self.assertEqual(draw["checkin"]["checked_in_today"], True)
        self.assertEqual(draw["checkin"]["lit_days"], 1)
        self.assertEqual(draw["result"]["result_code"], "sign_001")

        second_response = self.client.post("/api/draw/execute", json={"session_token": session["session_token"]})

        self.assertEqual(second_response.status_code, 200)
        self.assertEqual(second_response.json()["success"], False)
        self.assertEqual(second_response.json()["error_code"], "no_chance")

    def test_draw_execute_randomly_picks_from_the_sign_library(self):
        session = self._create_session()
        self._set_draw_chance(session["user"]["user_id"], 5)

        with patch("backend.app.activity_service.secrets.randbelow", side_effect=[0, 1, 2, 3, 4]):
            draws = [self._draw(session["session_token"]) for _ in range(5)]

        self.assertEqual(
            [draw["result"]["result_code"] for draw in draws],
            ["sign_001", "sign_002", "sign_003", "sign_004", "sign_005"],
        )
        self.assertEqual(
            [draw["result"]["fortuneHeadline"] for draw in draws],
            ["过儿签", "奶茶签", "早饭签", "公交签", "外卖签"],
        )
        self.assertEqual(
            [draw["result"]["fortuneHint"] for draw in draws],
            [
                "考试期间，\n别叫我真名，\n叫我过儿，\n最好叫我全过儿。",
                "今日多写一题，\n明日多加一份料。\n珍珠会沉底，\n分数会浮上来。",
                "早餐吃稳，\n心态放平。\n肚子不闹，\n脑子开机。",
                "人生像公交，\n错过一站别慌。\n下一站，\n也可能到大学。",
                "考神已接单，\n好运在配送。\n预计送达：\n开考后三分钟。",
            ],
        )

    def test_draw_randomly_assigns_coupon_and_claim_requires_that_coupon(self):
        session = self._create_session()
        self._enable_coupon_issue_config("discount_75")

        draw = self._draw_with_reward(session["session_token"], "discount_75")

        explain_response = self.client.get(
            "/api/explain/detail",
            params={"session_token": session["session_token"], "draw_id": draw["draw_id"]},
        )
        wrong_claim = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session["session_token"],
                "draw_id": draw["draw_id"],
                "reward_code": "coupon_10",
                "mobile": "13800138000",
            },
        )
        right_claim = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session["session_token"],
                "draw_id": draw["draw_id"],
                "reward_code": "discount_75",
                "mobile": "13800138000",
            },
        )

        self.assertEqual(draw["result"]["reward_code"], "discount_75")
        self.assertEqual(explain_response.status_code, 200)
        self.assertEqual(explain_response.json()["benefit"]["rewardCode"], "discount_75")
        self.assertEqual(explain_response.json()["benefit"]["reward"]["imageUrl"], "/assets/p5/element_coupon_75off_card.png")
        self.assertEqual(wrong_claim.status_code, 400)
        self.assertEqual(wrong_claim.json()["detail"], "reward does not match draw result")
        self.assertEqual(right_claim.status_code, 200)
        self.assertEqual(right_claim.json()["reward"]["reward_code"], "discount_75")

    def test_enabled_non_10_coupon_claim_saves_success(self):
        import sqlite3

        session = self._create_session()
        draw = self._draw_with_reward(session["session_token"], "coupon_30")

        explain_response = self.client.get(
            "/api/explain/detail",
            params={"session_token": session["session_token"], "draw_id": draw["draw_id"]},
        )
        claim_response = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session["session_token"],
                "draw_id": draw["draw_id"],
                "reward_code": "coupon_30",
                "mobile": "13800138000",
            },
        )

        self.assertEqual(explain_response.status_code, 200)
        self.assertEqual(explain_response.json()["benefit"]["rewardCode"], "coupon_30")
        self.assertEqual(explain_response.json()["benefit"]["reward"]["imageUrl"], "/assets/p5/element_coupon_30yuan_card.png")
        self.assertEqual(claim_response.status_code, 200)
        self.assertEqual(claim_response.json()["reward"]["reward_code"], "coupon_30")
        self.assertEqual(claim_response.json()["coupon_issue_status"], "issued")
        self.assertEqual(claim_response.json()["external_coupon_id"], "2605250000000031")
        self.assertEqual(self.hermes_client.issued_mobiles, ["13800138000"])

        issue_config = self.hermes_client.issued_requests[-1]["issue_config"]
        self.assertEqual(issue_config.reward_code, "coupon_30")
        self.assertEqual(issue_config.hermes_id, 2605260000000010)
        self.assertEqual(issue_config.ref_id, 2605260000000024)
        self.assertEqual(issue_config.face_value, "30")

        conn = sqlite3.connect(self.database_path)
        try:
            claim = conn.execute(
                """
                SELECT reward_code, claim_status, coupon_issue_status, external_coupon_id
                FROM reward_claim_record
                """
            ).fetchone()
        finally:
            conn.close()

        self.assertEqual(claim, ("coupon_30", "success", "issued", "2605250000000031"))

    def test_draw_random_pool_rotates_all_five_configured_p5_coupon_assets(self):
        session = self._create_session()
        self._set_draw_chance(session["user"]["user_id"], 5)

        draws = [self._draw(session["session_token"]) for _ in range(5)]

        self.assertEqual(
            [draw["result"]["reward_code"] for draw in draws],
            ["coupon_10", "coupon_20", "coupon_30", "discount_9", "discount_75"],
        )

    def test_legacy_draw_without_locked_coupon_gets_one_before_p5_render(self):
        import sqlite3

        session = self._create_session()
        draw = self._draw(session["session_token"])

        conn = sqlite3.connect(self.database_path)
        try:
            conn.execute(
                "UPDATE draw_record SET result_summary_json = json_remove(result_summary_json, '$.reward_code', '$.rewardCode') WHERE id = ?",
                (draw["draw_id"],),
            )
            conn.commit()
        finally:
            conn.close()

        explain_response = self.client.get(
            "/api/explain/detail",
            params={"session_token": session["session_token"], "draw_id": draw["draw_id"]},
        )

        wrong_claim = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session["session_token"],
                "draw_id": draw["draw_id"],
                "reward_code": "discount_75",
                "mobile": "13800138000",
            },
        )
        right_claim = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session["session_token"],
                "draw_id": draw["draw_id"],
                "reward_code": "coupon_10",
                "mobile": "13800138000",
            },
        )

        self.assertEqual(explain_response.status_code, 200)
        self.assertEqual(explain_response.json()["benefit"]["rewardCode"], "coupon_10")
        self.assertEqual(explain_response.json()["benefit"]["reward"]["imageUrl"], "/assets/p5/element_coupon_10yuan_card.png")
        self.assertEqual(wrong_claim.status_code, 400)
        self.assertEqual(right_claim.status_code, 200)

    def test_benefit_randomize_keeps_the_draw_coupon_before_claim(self):
        session = self._create_session()
        draw = self._draw_with_reward(session["session_token"], "coupon_20")

        randomize_response = self.client.post(
            "/api/benefit/randomize",
            json={"session_token": session["session_token"], "draw_id": draw["draw_id"]},
        )

        wrong_claim = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session["session_token"],
                "draw_id": draw["draw_id"],
                "reward_code": "coupon_10",
                "mobile": "13800138000",
            },
        )
        right_claim = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session["session_token"],
                "draw_id": draw["draw_id"],
                "reward_code": "coupon_20",
                "mobile": "13800138000",
            },
        )

        self.assertEqual(randomize_response.status_code, 200)
        self.assertEqual(randomize_response.json()["rewardCode"], "coupon_20")
        self.assertEqual(randomize_response.json()["reward"]["imageUrl"], "/assets/p5/element_coupon_20yuan_card.png")
        self.assertEqual(wrong_claim.status_code, 400)
        self.assertEqual(right_claim.status_code, 200)
        self.assertEqual(right_claim.json()["reward"]["reward_code"], "coupon_20")
        self.assertEqual(right_claim.json()["coupon_issue_status"], "issued")

        issue_config = self.hermes_client.issued_requests[-1]["issue_config"]
        self.assertEqual(issue_config.reward_code, "coupon_20")
        self.assertEqual(issue_config.hermes_id, 2605250000000014)
        self.assertEqual(issue_config.ref_id, 2605250000000028)
        self.assertEqual(issue_config.face_value, "20")

    def test_benefit_randomize_ignores_exclude_and_returns_draw_coupon(self):
        session = self._create_session()
        draw = self._draw_with_reward(session["session_token"], "discount_75")

        response = self.client.post(
            "/api/benefit/randomize",
            json={
                "session_token": session["session_token"],
                "draw_id": draw["draw_id"],
                "exclude_reward_code": "coupon_10",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["rewardCode"], "discount_75")
        self.assertEqual(response.json()["reward"]["imageUrl"], "/assets/p5/element_coupon_75off_card.png")

    def test_each_new_draw_rotates_but_existing_draw_benefit_stays_fixed(self):
        session = self._create_session()
        self._set_draw_chance(session["user"]["user_id"], 5)

        draws = [self._draw(session["session_token"]) for _ in range(5)]
        reward_codes = [draw["result"]["reward_code"] for draw in draws]

        self.assertEqual(
            reward_codes,
            ["coupon_10", "coupon_20", "coupon_30", "discount_9", "discount_75"],
        )

        first_a = self.client.post(
            "/api/benefit/randomize",
            json={"session_token": session["session_token"], "draw_id": draws[0]["draw_id"]},
        )
        first_b = self.client.post(
            "/api/benefit/randomize",
            json={"session_token": session["session_token"], "draw_id": draws[0]["draw_id"], "exclude_reward_code": "coupon_10"},
        )

        self.assertEqual(first_a.json()["rewardCode"], "coupon_10")
        self.assertEqual(first_b.json()["rewardCode"], "coupon_10")

    def test_explain_detail_returns_readable_chinese_copy(self):
        session = self._create_session()
        with patch("backend.app.activity_service.secrets.randbelow", return_value=0):
            draw = self._draw(session["session_token"])

        response = self.client.get("/api/explain/detail", params={"session_token": session["session_token"], "draw_id": draw["draw_id"]})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertGreaterEqual(len(payload["thinkingProcess"]), 3)
        self.assertEqual(payload["ai"]["provider"], "fallback")
        self.assertEqual(payload["title"], "AI解签结果")
        self.assertEqual(
            payload["explainLines"],
            [
                "此签属“礼貌玄学派”。名字可以临时改，准考证名字不能乱写。建议考前默念三遍：我会的全对，不会的也别太离谱。",
            ],
        )
        self.assertEqual(payload["product"]["productName"], "和牛 · 锦绣前程板腱")
        self.assertEqual(payload["benefit"]["claimButtonText"], "领取专属福利")

    def test_explain_detail_uses_deepseek_prompt_when_key_configured(self):
        session = self._create_session()
        draw = self._draw(session["session_token"])
        captured = {}

        class FakeDeepSeekResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                reasoning_content = "\n".join(
                    [
                        "Process\u601d\u8003\u8fc7\u7a0b1\uff1a\u5148\u770b\u7b7e\u9762\u91cc\u7684\u8fdb\u53d6\u52bf\u5934",
                        "\u601d\u8003\u8fc7\u7a0b2\uff1a\u518d\u628a\u725b\u6c14\u8865\u7ed9\u653e\u8fdb\u795d\u798f",
                        "\u601d\u8003\u8fc7\u7a0b3\uff1a\u6700\u540e\u6536\u6210\u4e09\u884c\u597d\u73a9\u7b7e\u6587",
                        "",
                        "explainLines\u7b7e\u65871\uff1a1. \u725b\u6c14\u8865\u7ed9\u5230\u4f4d",
                        "\u7b7e\u65872\uff1a- \u843d\u7b14\u50cf\u725b\u6392\u7206\u6c41",
                        "\u7b7e\u65873\uff1a\u2022 \u5206\u6570\u4e00\u8def\u5411\u4e0a\u52a0\u6cb9",
                    ]
                )
                return json.dumps({"choices": [{"message": {"content": "", "reasoning_content": reasoning_content}}]}).encode("utf-8")

        def fake_urlopen(request, timeout):
            captured["url"] = request.full_url
            captured["timeout"] = timeout
            captured["authorization"] = request.get_header("Authorization")
            captured["body"] = json.loads(request.data.decode("utf-8"))
            return FakeDeepSeekResponse()

        previous_env = {key: os.environ.get(key) for key in ("DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL")}
        os.environ["DEEPSEEK_API_KEY"] = "test-deepseek-key"
        os.environ["DEEPSEEK_BASE_URL"] = "https://api.deepseek.test"
        os.environ["DEEPSEEK_MODEL"] = "deepseek-v4-pro"
        try:
            with patch("urllib.request.urlopen", side_effect=fake_urlopen):
                response = self.client.get("/api/explain/detail", params={"session_token": session["session_token"], "draw_id": draw["draw_id"]})
        finally:
            for key, value in previous_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(captured["url"], "https://api.deepseek.test/chat/completions")
        self.assertEqual(captured["authorization"], "Bearer test-deepseek-key")
        self.assertEqual(captured["body"]["model"], "deepseek-v4-pro")
        self.assertEqual(captured["body"]["thinking"]["type"], "enabled")
        self.assertEqual(captured["body"]["response_format"]["type"], "json_object")
        self.assertIn("\u725b\u6c14\u8865\u7ed9", captured["body"]["messages"][0]["content"])
        self.assertIn("\u8bf7\u53ea\u8f93\u51fa JSON", captured["body"]["messages"][0]["content"])
        self.assertEqual(payload["ai"]["provider"], "deepseek")
        self.assertEqual(payload["ai"]["model"], "deepseek-v4-pro")
        self.assertEqual(payload["explainLines"][0], "\u725b\u6c14\u8865\u7ed9\u5230\u4f4d")
        self.assertEqual(payload["explainLines"][1], "\u843d\u7b14\u50cf\u725b\u6392\u7206\u6c41")
        self.assertEqual(payload["explainLines"][2], "\u5206\u6570\u4e00\u8def\u5411\u4e0a\u52a0\u6cb9")
        self.assertEqual(payload["thinkingProcess"][1], "\u518d\u628a\u725b\u6c14\u8865\u7ed9\u653e\u8fdb\u795d\u798f")

    def test_share_record_adds_up_to_three_extra_draw_chances(self):
        session = self._create_session()

        results = [
            self.client.post("/api/share/record", json={"session_token": session["session_token"], "share_channel": "wechat"}).json()
            for _ in range(4)
        ]

        self.assertEqual([item["reward_granted"] for item in results], [True, True, True, False])
        self.assertTrue(results[0]["share_url"].startswith("/activity/home?share_token="))
        self.assertNotIn("page=p1", results[0]["share_url"])
        self.assertEqual(results[-1]["daily_state"]["share_reward_count_today"], 3)
        self.assertEqual(results[-1]["daily_state"]["remaining_draw_count"], 4)

    def test_claimed_coupon_appears_in_reward_center_and_gift_is_last(self):
        session = self._create_session()
        draw = self._draw_with_reward(session["session_token"], "coupon_10")

        claim_response = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session["session_token"],
                "draw_id": draw["draw_id"],
                "reward_code": "coupon_10",
                "mobile": "13800138000",
            },
        )
        reward_response = self.client.get("/api/reward/center/detail", params={"session_token": session["session_token"]})

        self.assertEqual(claim_response.status_code, 200)
        self.assertEqual(claim_response.json()["reward"]["reward_code"], "coupon_10")
        self.assertEqual(claim_response.json()["receiver_mobile_masked"], "138****8000")
        self.assertTrue(claim_response.json()["claim_token"].startswith("ct_"))
        self.assertIn("claim_token=", claim_response.json()["action"]["target"])
        self.assertIn("claim_no=", claim_response.json()["action"]["target"])
        self.assertNotIn("13800138000", claim_response.json()["action"]["target"])
        self.assertEqual(reward_response.status_code, 200)
        rewards = reward_response.json()["display_rewards"]
        claimed_rewards = reward_response.json()["claimed_rewards"]
        self.assertEqual(len(claimed_rewards), 1)
        self.assertEqual(len(rewards), 6)
        self.assertEqual([reward["reward_code"] for reward in rewards], ["coupon_10", "coupon_20", "coupon_30", "discount_9", "discount_75", "gift_985"])
        self.assertEqual(rewards[0]["reward_code"], "coupon_10")
        self.assertEqual(rewards[0]["status"], "unused")
        self.assertEqual(rewards[0]["button_text"], "\u53bb\u4f7f\u7528")
        self.assertEqual(rewards[1]["reward_code"], "coupon_20")
        self.assertEqual(rewards[1]["status"], "unclaimed")
        self.assertEqual(rewards[1]["button_text"], "\u53bb\u9886\u53d6")
        self.assertEqual(rewards[-1]["reward_code"], "gift_985")
        self.assertEqual(rewards[-1]["button_text"], "未达标")
        self.assertEqual(reward_response.json()["draw_again_action"]["action"]["target"], "/activity/home")
        self.assertEqual(reward_response.json()["rules_action"]["action"]["target"], "/activity/rules")
        self.assertEqual(rewards[-1]["action"]["type"], "mini_program_product_detail")
        self.assertEqual(rewards[-1]["action"]["target"], "/pages/product/detail?id=gift_985")

    def test_same_coupon_can_be_claimed_again_for_a_new_draw(self):
        session = self._create_session()
        first_draw = self._draw_with_reward(session["session_token"], "coupon_10")

        first_claim = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session["session_token"],
                "draw_id": first_draw["draw_id"],
                "reward_code": "coupon_10",
                "mobile": "13800138000",
            },
        )

        self.client.post("/api/share/record", json={"session_token": session["session_token"], "share_channel": "wechat"})
        second_draw = self._draw_with_reward(session["session_token"], "coupon_10")
        second_explain = self.client.get(
            "/api/explain/detail",
            params={"session_token": session["session_token"], "draw_id": second_draw["draw_id"]},
        )
        second_claim = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session["session_token"],
                "draw_id": second_draw["draw_id"],
                "reward_code": "coupon_10",
                "mobile": "13900139000",
            },
        )
        reward_response = self.client.get("/api/reward/center/detail", params={"session_token": session["session_token"]})

        self.assertEqual(first_claim.status_code, 200)
        self.assertEqual(second_explain.status_code, 200)
        self.assertEqual(second_explain.json()["benefit"]["claimStatus"], "unclaimed")
        self.assertEqual(second_claim.status_code, 200)
        self.assertNotEqual(first_claim.json()["claim_no"], second_claim.json()["claim_no"])
        claimed_rewards = reward_response.json()["claimed_rewards"]
        self.assertEqual([reward["reward_code"] for reward in claimed_rewards], ["coupon_10", "coupon_10"])
        self.assertNotEqual(claimed_rewards[0]["reward_id"], claimed_rewards[1]["reward_id"])
        display_rewards = reward_response.json()["display_rewards"]
        self.assertEqual([reward["reward_code"] for reward in display_rewards], ["coupon_10", "coupon_20", "coupon_30", "discount_9", "discount_75", "gift_985"])
        self.assertEqual(sum(1 for reward in display_rewards if reward["reward_code"] == "coupon_10"), 1)
        self.assertEqual(display_rewards[0]["button_text"], "\u53bb\u4f7f\u7528")
        self.assertEqual(display_rewards[1]["button_text"], "\u53bb\u9886\u53d6")

    def test_same_mobile_can_receive_same_coupon_again_for_new_draw(self):
        session = self._create_session()
        self._set_draw_chance(session["user"]["user_id"], 2)
        first_draw = self._draw_with_reward(session["session_token"], "discount_75")
        first_claim = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session["session_token"],
                "draw_id": first_draw["draw_id"],
                "reward_code": "discount_75",
                "mobile": "13800138000",
            },
        )
        second_draw = self._draw_with_reward(session["session_token"], "discount_75")

        second_claim = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session["session_token"],
                "draw_id": second_draw["draw_id"],
                "reward_code": "discount_75",
                "mobile": "13800138000",
            },
        )

        self.assertEqual(first_claim.status_code, 200)
        self.assertEqual(second_claim.status_code, 200)
        self.assertNotEqual(first_claim.json()["claim_no"], second_claim.json()["claim_no"])
        self.assertEqual(
            [first_claim.json()["reward"]["reward_code"], second_claim.json()["reward"]["reward_code"]],
            ["discount_75", "discount_75"],
        )
        self.assertEqual(self.hermes_client.issued_mobiles, ["13800138000", "13800138000"])

    def test_reward_center_uses_latest_issued_claim_identity_for_coupon_action(self):
        session = self._create_session()
        self._set_draw_chance(session["user"]["user_id"], 2)

        first_draw = self._draw_with_reward(session["session_token"], "coupon_20")
        first_claim = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session["session_token"],
                "draw_id": first_draw["draw_id"],
                "reward_code": "coupon_20",
                "mobile": "13800138000",
            },
        ).json()
        second_draw = self._draw_with_reward(session["session_token"], "coupon_20")
        second_claim = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session["session_token"],
                "draw_id": second_draw["draw_id"],
                "reward_code": "coupon_20",
                "mobile": "13900139000",
            },
        ).json()

        reward_response = self.client.get("/api/reward/center/detail", params={"session_token": session["session_token"]})

        self.assertEqual(first_claim["reward"]["reward_code"], "coupon_20")
        self.assertEqual(second_claim["reward"]["reward_code"], "coupon_20")
        self.assertEqual(reward_response.status_code, 200)

        coupon_20 = next(
            reward
            for reward in reward_response.json()["display_rewards"]
            if reward["reward_code"] == "coupon_20"
        )
        self.assertEqual(coupon_20["reward_id"], f"coupon_20_{second_claim['claim_no']}")
        self.assertIn(f"claim_token={second_claim['claim_token']}", coupon_20["action"]["target"])
        self.assertIn(f"claim_no={second_claim['claim_no']}", coupon_20["action"]["target"])

    def test_claim_benefit_requires_valid_mobile_and_persists_claim_identity(self):
        import sqlite3

        session = self._create_session()
        draw = self._draw(session["session_token"])
        reward_code = draw["result"]["reward_code"]

        missing_mobile = self.client.post(
            "/api/benefit/claim",
            json={"session_token": session["session_token"], "draw_id": draw["draw_id"], "reward_code": reward_code},
        )
        invalid_mobile = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session["session_token"],
                "draw_id": draw["draw_id"],
                "reward_code": reward_code,
                "mobile": "12345",
            },
        )
        valid_mobile = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session["session_token"],
                "draw_id": draw["draw_id"],
                "reward_code": reward_code,
                "mobile": "13800138000",
            },
        )

        self.assertEqual(missing_mobile.status_code, 400)
        self.assertEqual(missing_mobile.json()["detail"], "mobile is required")
        self.assertEqual(invalid_mobile.status_code, 400)
        self.assertEqual(invalid_mobile.json()["detail"], "mobile format is invalid")
        self.assertEqual(valid_mobile.status_code, 200)

        payload = valid_mobile.json()
        self.assertEqual(payload["success"], True)
        self.assertEqual(payload["message"], "领取成功")
        self.assertEqual(payload["receiver_mobile_masked"], "138****8000")
        self.assertEqual(payload["coupon_issue_status"], "issued")
        self.assertEqual(payload["external_coupon_id"], "2605250000000031")
        self.assertTrue(payload["claim_token"].startswith("ct_"))
        self.assertNotIn("13800138000", payload["action"]["target"])
        self.assertEqual(self.hermes_client.issued_mobiles, ["13800138000"])

        conn = sqlite3.connect(self.database_path)
        try:
            conn.row_factory = sqlite3.Row
            record = conn.execute(
                """
                SELECT receiver_mobile, receiver_mobile_masked, claim_token, coupon_issue_status, external_coupon_id
                FROM reward_claim_record
                WHERE claim_no = ?
                """,
                (payload["claim_no"],),
            ).fetchone()
        finally:
            conn.close()

        self.assertEqual(record["receiver_mobile"], "13800138000")
        self.assertEqual(record["receiver_mobile_masked"], "138****8000")
        self.assertEqual(record["claim_token"], payload["claim_token"])
        self.assertEqual(record["coupon_issue_status"], "issued")
        self.assertEqual(record["external_coupon_id"], "2605250000000031")

        resolve_response = self.client.get(
            "/api/benefit/claim/resolve",
            params={"claim_token": payload["claim_token"]},
        )

        self.assertEqual(resolve_response.status_code, 200)
        self.assertEqual(resolve_response.json()["claim_no"], payload["claim_no"])
        self.assertEqual(resolve_response.json()["receiver_mobile_masked"], "138****8000")
        self.assertNotIn("receiver_mobile", resolve_response.json())

    def test_claim_benefit_uses_enabled_10_yuan_coupon_issue_config_for_hermes(self):
        session = self._create_session()
        draw = self._draw_with_reward(session["session_token"], "coupon_10")

        response = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session["session_token"],
                "draw_id": draw["draw_id"],
                "reward_code": "coupon_10",
                "mobile": "13800138000",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.hermes_client.issued_requests), 1)
        issue_config = self.hermes_client.issued_requests[0]["issue_config"]
        self.assertIsNotNone(issue_config)
        self.assertEqual(issue_config.reward_code, "coupon_10")
        self.assertEqual(issue_config.face_value, "10")
        self.assertEqual(issue_config.hermes_title, "一举高中·无门槛10元优惠券")

    def test_claim_benefit_uses_configured_hermes_issue_payload_for_other_coupon_tiers(self):
        expected_configs = {
            "coupon_20": {
                "hermes_title": "一举高中·无门槛20元优惠券",
                "hermes_id": 2605250000000014,
                "ref_id": 2605250000000028,
                "face_value": "20",
            },
            "coupon_30": {
                "hermes_title": "一举高中·无门槛30元优惠券",
                "hermes_id": 2605260000000010,
                "ref_id": 2605260000000024,
                "face_value": "30",
            },
            "discount_9": {
                "hermes_title": "一举高中·无门槛9折优惠券",
                "hermes_id": 2605260000000025,
                "ref_id": 2605260000000039,
                "face_value": "9",
            },
            "discount_75": {
                "hermes_title": "一举高中·7.5折优惠券",
                "hermes_id": 2605260000000040,
                "ref_id": 2605260000000055,
                "face_value": "7.5",
            },
        }

        for index, (reward_code, expected) in enumerate(expected_configs.items()):
            session = self._create_session(f"coupon_issue_{reward_code}")
            draw = self._draw_with_reward(session["session_token"], reward_code)
            response = self.client.post(
                "/api/benefit/claim",
                json={
                    "session_token": session["session_token"],
                    "draw_id": draw["draw_id"],
                    "reward_code": reward_code,
                    "mobile": f"13800138{index:03d}",
                },
            )

            self.assertEqual(response.status_code, 200, response.text)

        issued_configs = [request["issue_config"] for request in self.hermes_client.issued_requests[-4:]]

        for issue_config in issued_configs:
            expected = expected_configs[issue_config.reward_code]
            self.assertEqual(issue_config.hermes_title, expected["hermes_title"])
            self.assertEqual(issue_config.hermes_id, expected["hermes_id"])
            self.assertEqual(issue_config.ref_id, expected["ref_id"])
            self.assertEqual(issue_config.ref_type, 1)
            self.assertEqual(issue_config.start_time, "2026-05-27 00:00:00")
            self.assertEqual(issue_config.end_time, "2026-06-30 23:59:59")
            self.assertEqual(issue_config.face_value, expected["face_value"])

    def test_existing_issued_claim_returns_without_requiring_current_issue_config(self):
        import sqlite3

        session = self._create_session()
        draw = self._draw_with_reward(session["session_token"], "coupon_10")
        first_claim = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session["session_token"],
                "draw_id": draw["draw_id"],
                "reward_code": "coupon_10",
                "mobile": "13800138000",
            },
        )

        conn = sqlite3.connect(self.database_path)
        try:
            conn.execute(
                """
                UPDATE coupon_issue_config
                SET status = 'disabled'
                WHERE activity_code = 'gaokao_lucky_sign_2026' AND reward_code = 'coupon_10'
                """
            )
            conn.commit()
        finally:
            conn.close()

        second_claim = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session["session_token"],
                "draw_id": draw["draw_id"],
                "reward_code": "coupon_10",
                "mobile": "13800138000",
            },
        )

        self.assertEqual(first_claim.status_code, 200)
        self.assertEqual(second_claim.status_code, 200)
        self.assertEqual(second_claim.json()["claim_no"], first_claim.json()["claim_no"])
        self.assertEqual(self.hermes_client.issued_mobiles, ["13800138000"])

    def test_claim_benefit_does_not_save_success_when_hermes_issue_fails(self):
        import sqlite3

        self.hermes_client.issue_error = HermesCouponError("发券失败，请稍后重试")
        session = self._create_session()
        draw = self._draw(session["session_token"])

        response = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session["session_token"],
                "draw_id": draw["draw_id"],
                "reward_code": draw["result"]["reward_code"],
                "mobile": "13800138000",
            },
        )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["success"], False)
        self.assertEqual(response.json()["message"], "发券失败，请稍后重试")
        self.assertEqual(response.json()["detail"], "发券失败，请稍后重试")
        self.assertEqual(self.hermes_client.issued_mobiles, ["13800138000"])

        conn = sqlite3.connect(self.database_path)
        try:
            claim_count = conn.execute(
                """
                SELECT COUNT(*)
                FROM reward_claim_record
                WHERE claim_status = 'success' OR coupon_issue_status = 'issued'
                """
            ).fetchone()[0]
            failed_record = conn.execute(
                """
                SELECT receiver_mobile_masked, claim_status, coupon_issue_status, coupon_issue_error
                FROM reward_claim_record
                """
            ).fetchone()
        finally:
            conn.close()

        self.assertEqual(claim_count, 0)
        self.assertIsNotNone(failed_record)
        self.assertEqual(failed_record[0], "138****8000")
        self.assertEqual(failed_record[1], "failed")
        self.assertEqual(failed_record[2], "failed")
        self.assertEqual(failed_record[3], "发券失败，请稍后重试")

    def test_claim_benefit_returns_registration_error_code_when_hermes_requires_mobile_registration(self):
        self.hermes_client.issue_error = HermesCouponError(
            "\u8bf7\u5148\u53bb\u5c0f\u7a0b\u5e8f\u6ce8\u518c\u624b\u673a\u53f7",
            error_code="mini_program_mobile_registration_required",
        )
        session = self._create_session()
        draw = self._draw(session["session_token"])

        response = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session["session_token"],
                "draw_id": draw["draw_id"],
                "reward_code": draw["result"]["reward_code"],
                "mobile": "13222323232",
            },
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error_code"], "mini_program_mobile_registration_required")
        self.assertEqual(response.json()["detail"], "\u8bf7\u5148\u53bb\u5c0f\u7a0b\u5e8f\u6ce8\u518c\u624b\u673a\u53f7")

    def test_claim_benefit_allows_retry_after_mobile_registration_failure(self):
        import sqlite3

        self.hermes_client.issue_responses = [
            HermesCouponError(
                "\u8bf7\u5148\u53bb\u5c0f\u7a0b\u5e8f\u6ce8\u518c\u624b\u673a\u53f7",
                error_code="mini_program_mobile_registration_required",
            ),
            {
                "code": "0",
                "success": True,
                "data": {
                    "id": 2605290000000060,
                    "successNum": 1,
                    "failNum": 0,
                },
            },
        ]
        session = self._create_session()
        draw = self._draw(session["session_token"])
        claim_payload = {
            "session_token": session["session_token"],
            "draw_id": draw["draw_id"],
            "reward_code": draw["result"]["reward_code"],
            "mobile": "13222323232",
        }

        first_response = self.client.post("/api/benefit/claim", json=claim_payload)

        self.assertEqual(first_response.status_code, 409)
        self.assertEqual(first_response.json()["error_code"], "mini_program_mobile_registration_required")

        conn = sqlite3.connect(self.database_path)
        try:
            first_record = conn.execute(
                """
                SELECT claim_no, claim_status, coupon_issue_status, coupon_issue_error
                FROM reward_claim_record
                WHERE draw_id = ? AND reward_code = ?
                """,
                (draw["draw_id"], draw["result"]["reward_code"]),
            ).fetchone()
        finally:
            conn.close()

        self.assertIsNotNone(first_record)
        self.assertEqual(first_record[1], "failed")
        self.assertEqual(first_record[2], "failed")
        self.assertEqual(first_record[3], "\u8bf7\u5148\u53bb\u5c0f\u7a0b\u5e8f\u6ce8\u518c\u624b\u673a\u53f7")

        second_response = self.client.post("/api/benefit/claim", json=claim_payload)

        self.assertEqual(second_response.status_code, 200, second_response.text)
        self.assertEqual(second_response.json()["claimStatus"], "claimed")
        self.assertEqual(second_response.json()["coupon_issue_status"], "issued")
        self.assertEqual(second_response.json()["external_coupon_id"], "2605290000000060")
        self.assertEqual(second_response.json()["claim_no"], first_record[0])
        self.assertEqual(self.hermes_client.issued_mobiles, ["13222323232", "13222323232"])

        conn = sqlite3.connect(self.database_path)
        try:
            claim_count = conn.execute(
                """
                SELECT COUNT(*)
                FROM reward_claim_record
                WHERE draw_id = ? AND reward_code = ?
                """,
                (draw["draw_id"], draw["result"]["reward_code"]),
            ).fetchone()[0]
            final_record = conn.execute(
                """
                SELECT claim_no, claim_status, coupon_issue_status, coupon_issue_error, external_coupon_id
                FROM reward_claim_record
                WHERE draw_id = ? AND reward_code = ?
                """,
                (draw["draw_id"], draw["result"]["reward_code"]),
            ).fetchone()
        finally:
            conn.close()

        self.assertEqual(claim_count, 1)
        self.assertEqual(final_record[0], first_record[0])
        self.assertEqual(final_record[1], "success")
        self.assertEqual(final_record[2], "issued")
        self.assertIsNone(final_record[3])
        self.assertEqual(final_record[4], "2605290000000060")

    def test_claim_benefit_refunds_draw_chance_once_when_mobile_registration_is_required(self):
        import sqlite3

        self.hermes_client.issue_error = HermesCouponError(
            "\u8bf7\u5148\u53bb\u5c0f\u7a0b\u5e8f\u6ce8\u518c\u624b\u673a\u53f7",
            error_code="mini_program_mobile_registration_required",
        )
        session = self._create_session()
        self._set_draw_chance(session["user"]["user_id"], 1)
        draw = self._draw(session["session_token"])
        claim_payload = {
            "session_token": session["session_token"],
            "draw_id": draw["draw_id"],
            "reward_code": draw["result"]["reward_code"],
            "mobile": "13222323232",
        }

        first_response = self.client.post("/api/benefit/claim", json=claim_payload)
        second_response = self.client.post("/api/benefit/claim", json=claim_payload)

        self.assertEqual(draw["daily_state"]["remaining_draw_count"], 0)
        self.assertEqual(first_response.status_code, 409)
        self.assertEqual(first_response.json()["error_code"], "mini_program_mobile_registration_required")
        self.assertEqual(first_response.json()["daily_state"]["remaining_draw_count"], 1)
        self.assertEqual(first_response.json()["daily_state"]["used_draw_count"], 0)
        self.assertEqual(second_response.status_code, 409)
        self.assertEqual(second_response.json()["error_code"], "mini_program_mobile_registration_required")
        self.assertEqual(second_response.json()["daily_state"]["remaining_draw_count"], 1)
        self.assertEqual(second_response.json()["daily_state"]["used_draw_count"], 0)

        conn = sqlite3.connect(self.database_path)
        try:
            daily_state = conn.execute(
                """
                SELECT used_draw_count, remaining_draw_count
                FROM user_daily_state
                WHERE activity_code = 'gaokao_lucky_sign_2026' AND user_id = ?
                """,
                (session["user"]["user_id"],),
            ).fetchone()
            rollback_logs = conn.execute(
                """
                SELECT COUNT(*)
                FROM draw_chance_log
                WHERE activity_code = 'gaokao_lucky_sign_2026'
                  AND user_id = ?
                  AND change_type = 'rollback'
                  AND source_type = 'draw_record'
                  AND source_id = ?
                """,
                (session["user"]["user_id"], str(draw["draw_id"])),
            ).fetchone()[0]
        finally:
            conn.close()

        self.assertEqual(daily_state[0], 0)
        self.assertEqual(daily_state[1], 1)
        self.assertEqual(rollback_logs, 1)

    def test_claim_benefit_does_not_issue_again_when_existing_claim_is_pending(self):
        import sqlite3

        session = self._create_session()
        draw = self._draw_with_reward(session["session_token"], "coupon_10")

        conn = sqlite3.connect(self.database_path)
        try:
            conn.execute(
                """
                INSERT INTO reward_claim_record (
                  activity_code, user_id, session_id, draw_id, reward_code, claim_no, claim_status,
                  claim_channel, reward_snapshot_json, action_type, action_target, receiver_mobile,
                  receiver_mobile_masked, claim_token, coupon_issue_status, coupon_issue_error,
                  external_coupon_id, biz_date
                )
                VALUES (
                  'gaokao_lucky_sign_2026', ?, ?, ?, 'coupon_10', 'CLPENDING001', 'pending',
                  'h5', '{}', 'mini_program_page', '/pages/my-coupon/index', ?,
                  ?, 'ct_pending_claim', 'pending', NULL, NULL, ?
                )
                """,
                (
                    session["user"]["user_id"],
                    session["session"]["session_id"],
                    draw["draw_id"],
                    "13800138000",
                    "138****8000",
                    "2026-05-26",
                ),
            )
            conn.commit()
        finally:
            conn.close()

        response = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session["session_token"],
                "draw_id": draw["draw_id"],
                "reward_code": "coupon_10",
                "mobile": "13800138000",
            },
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"], "领取处理中，请稍后查看")
        self.assertEqual(self.hermes_client.issued_mobiles, [])

    def test_claim_benefit_returns_p5_coupon_image_for_draw_reward(self):
        session = self._create_session()
        self._enable_coupon_issue_config("discount_75")
        draw = self._draw_with_reward(session["session_token"], "discount_75")
        explain_response = self.client.get(
            "/api/explain/detail",
            params={"session_token": session["session_token"], "draw_id": draw["draw_id"]},
        )
        claim_response = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": session["session_token"],
                "draw_id": draw["draw_id"],
                "reward_code": "discount_75",
                "mobile": "13800138000",
            },
        )

        self.assertEqual(explain_response.status_code, 200)
        self.assertEqual(explain_response.json()["benefit"]["rewardCode"], "discount_75")
        self.assertEqual(explain_response.json()["benefit"]["reward"]["imageUrl"], "/assets/p5/element_coupon_75off_card.png")
        self.assertEqual(claim_response.status_code, 200)
        self.assertEqual(claim_response.json()["reward"]["reward_code"], "discount_75")
        self.assertEqual(claim_response.json()["reward"]["imageUrl"], "/assets/p5/element_coupon_75off_card.png")

    def test_claim_benefit_rejects_rewards_not_bound_to_draw_result(self):
        session = self._create_session()
        draw = self._draw(session["session_token"])

        for reward_code in ("coupon_50", "gift_985"):
            response = self.client.post(
                "/api/benefit/claim",
                json={
                    "session_token": session["session_token"],
                    "draw_id": draw["draw_id"],
                    "reward_code": reward_code,
                    "mobile": "13800138000",
                },
            )

            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["detail"], "reward does not match draw result")

        reward_response = self.client.get("/api/reward/center/detail", params={"session_token": session["session_token"]})

        self.assertEqual(reward_response.status_code, 200)
        self.assertEqual(reward_response.json()["claimed_rewards"], [])

    def test_friend_draw_through_share_increases_assist_count_and_unlocks_gift(self):
        owner = self._create_session("owner")
        share = self.client.post("/api/share/record", json={"session_token": owner["session_token"], "share_channel": "wechat"}).json()

        for index in range(5):
            friend = self._create_session(f"friend_{index}", share["share_token"])
            self._draw_and_claim(friend["session_token"], self._valid_mobile(index))

        response = self.client.get("/api/grand-prize/qualification/detail", params={"session_token": owner["session_token"]})
        reward_response = self.client.get("/api/reward/center/detail", params={"session_token": owner["session_token"]})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["shared_count"], 5)
        self.assertEqual(payload["qualify_status"], "qualified")
        self.assertEqual(payload["button_text"], "去查看")
        self.assertEqual(payload["action"]["type"], "mini_program_product_detail")
        self.assertEqual(payload["action"]["target"], "/pages/product/detail?id=gift_985")
        self.assertTrue(payload["lottery_no"].startswith("GP"))
        self.assertEqual(payload["qualification"]["lottery_no"], payload["lottery_no"])
        self.assertEqual(payload["lottery_status"]["draw_time_desc"], "2026-06-18 10:00")
        self.assertEqual(reward_response.status_code, 200)
        self.assertEqual(reward_response.json()["display_rewards"][-1]["button_text"], "去查看")
        self.assertEqual(reward_response.json()["display_rewards"][-1]["action"]["type"], "mini_program_product_detail")
        self.assertEqual(reward_response.json()["display_rewards"][-1]["action"]["target"], "/pages/product/detail?id=gift_985")

    def test_share_assist_counts_only_after_successful_mobile_claim(self):
        import sqlite3

        owner = self._create_session("pending_owner")
        share = self.client.post("/api/share/record", json={"session_token": owner["session_token"], "share_channel": "wechat"}).json()
        friend = self._create_session("pending_friend", share["share_token"])

        draw = self._draw(friend["session_token"])
        before = self.client.get("/api/grand-prize/qualification/detail", params={"session_token": owner["session_token"]}).json()

        conn = sqlite3.connect(self.database_path)
        try:
            pending_assist = conn.execute(
                """
                SELECT assist_status
                FROM share_assist_record
                WHERE draw_id = ?
                """,
                (draw["draw_id"],),
            ).fetchone()
        finally:
            conn.close()

        self.assertEqual(before["shared_count"], 0)
        self.assertIsNotNone(pending_assist)
        self.assertEqual(pending_assist[0], "pending")

        claim_response = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": friend["session_token"],
                "draw_id": draw["draw_id"],
                "reward_code": draw["result"]["reward_code"],
                "mobile": "13800138000",
            },
        )
        after = self.client.get("/api/grand-prize/qualification/detail", params={"session_token": owner["session_token"]}).json()

        self.assertEqual(claim_response.status_code, 200, claim_response.text)
        self.assertEqual(after["shared_count"], 1)

    def test_duplicate_friend_assist_from_new_share_token_does_not_break_draw_or_count_twice(self):
        owner = self._create_session("duplicate_owner")
        first_share = self.client.post("/api/share/record", json={"session_token": owner["session_token"], "share_channel": "wechat"}).json()
        friend = self._create_session("duplicate_friend", first_share["share_token"])
        self._set_draw_chance(friend["user"]["user_id"], 2)

        first_draw, _ = self._draw_and_claim(friend["session_token"], "13800138000")

        second_share = self.client.post("/api/share/record", json={"session_token": owner["session_token"], "share_channel": "wechat"}).json()
        duplicate_friend = self._create_session("duplicate_friend", second_share["share_token"])
        duplicate_response = self.client.post("/api/draw/execute", json={"session_token": duplicate_friend["session_token"]})
        duplicate_claim = self.client.post(
            "/api/benefit/claim",
            json={
                "session_token": duplicate_friend["session_token"],
                "draw_id": duplicate_response.json()["draw_id"],
                "reward_code": duplicate_response.json()["result"]["reward_code"],
                "mobile": "13800138000",
            },
        )
        qualification_response = self.client.get("/api/grand-prize/qualification/detail", params={"session_token": owner["session_token"]})

        self.assertTrue(first_draw["success"])
        self.assertEqual(duplicate_response.status_code, 200, duplicate_response.text)
        self.assertTrue(duplicate_response.json()["success"])
        self.assertEqual(duplicate_claim.status_code, 200, duplicate_claim.text)
        self.assertEqual(qualification_response.json()["shared_count"], 1)

    def test_same_mobile_can_assist_same_sharer_only_once_across_h5_users(self):
        owner = self._create_session("same_mobile_owner")

        first_share = self.client.post("/api/share/record", json={"session_token": owner["session_token"], "share_channel": "wechat"}).json()
        first_friend = self._create_session("same_mobile_friend_a", first_share["share_token"])
        self._draw_and_claim(first_friend["session_token"], "13800138000")

        second_share = self.client.post("/api/share/record", json={"session_token": owner["session_token"], "share_channel": "wechat"}).json()
        second_friend = self._create_session("same_mobile_friend_b", second_share["share_token"])
        _, second_claim = self._draw_and_claim(second_friend["session_token"], "13800138000")
        qualification_response = self.client.get("/api/grand-prize/qualification/detail", params={"session_token": owner["session_token"]})

        self.assertEqual(second_claim["coupon_issue_status"], "issued")
        self.assertEqual(qualification_response.json()["shared_count"], 1)

    def test_grand_prize_lottery_number_is_generated_after_qualification_with_random_suffix(self):
        owner = self._create_session("random_lottery_owner")
        share = self.client.post("/api/share/record", json={"session_token": owner["session_token"], "share_channel": "wechat"}).json()

        before = self.client.get("/api/grand-prize/qualification/detail", params={"session_token": owner["session_token"]}).json()

        self.assertEqual(before["qualify_status"], "not_qualified")
        self.assertEqual(before["lottery_no"], "")

        with patch("backend.app.activity_service.secrets.randbelow", side_effect=[0, 0, 0, 0, 0, 554321]):
            for index in range(5):
                friend = self._create_session(f"random_lottery_friend_{index}", share["share_token"])
                self._draw_and_claim(friend["session_token"], self._valid_mobile(index))

        after = self.client.get("/api/grand-prize/qualification/detail", params={"session_token": owner["session_token"]}).json()
        suffix = after["lottery_no"][-6:]

        self.assertEqual(after["qualify_status"], "qualified")
        self.assertRegex(after["lottery_no"], r"^GP\d{14}$")
        self.assertEqual(suffix, "654321")
        self.assertNotEqual(suffix, f"{owner['user']['user_id']:06d}")
        self.assertNotEqual(suffix[:4], "0000")

    def test_grand_prize_draw_result_is_bound_to_current_users_lottery_number(self):
        winner = self._create_session("grand_prize_winner")
        loser = self._create_session("grand_prize_loser")

        for owner, prefix in ((winner, "winner_friend"), (loser, "loser_friend")):
            share = self.client.post("/api/share/record", json={"session_token": owner["session_token"], "share_channel": "wechat"}).json()
            for index in range(5):
                friend = self._create_session(f"{prefix}_{index}", share["share_token"])
                self._draw_and_claim(friend["session_token"], self._valid_mobile(index))

        winner_before = self.client.get("/api/grand-prize/qualification/detail", params={"session_token": winner["session_token"]}).json()
        loser_before = self.client.get("/api/grand-prize/qualification/detail", params={"session_token": loser["session_token"]}).json()
        winner_lottery_no = winner_before["lottery_no"]
        loser_lottery_no = loser_before["lottery_no"]

        self.assertNotEqual(winner_lottery_no, loser_lottery_no)

        import sqlite3

        conn = sqlite3.connect(self.database_path)
        try:
            conn.execute(
                "UPDATE grand_prize_qualification SET lottery_status = 'won' WHERE lottery_no = ?",
                (winner_lottery_no,),
            )
            conn.execute(
                "UPDATE grand_prize_qualification SET lottery_status = 'not_won' WHERE lottery_no = ?",
                (loser_lottery_no,),
            )
            conn.commit()
        finally:
            conn.close()

        winner_response = self.client.get("/api/grand-prize/qualification/detail", params={"session_token": winner["session_token"]})
        loser_response = self.client.get("/api/grand-prize/qualification/detail", params={"session_token": loser["session_token"]})

        self.assertEqual(winner_response.status_code, 200)
        self.assertEqual(loser_response.status_code, 200)

        winner_payload = winner_response.json()
        loser_payload = loser_response.json()

        self.assertEqual(winner_payload["lottery_status"]["status"], "won")
        self.assertEqual(winner_payload["lottery_status"]["status_text"], "已开奖")
        self.assertTrue(winner_payload["lottery_status"]["is_drawn"])
        self.assertTrue(winner_payload["lottery_status"]["is_winner"])
        self.assertIn(winner_lottery_no, winner_payload["lottery_status"]["publicity_desc"])
        self.assertIn("中奖", winner_payload["lottery_status"]["publicity_desc"])

        self.assertEqual(loser_payload["lottery_status"]["status"], "not_won")
        self.assertEqual(loser_payload["lottery_status"]["status_text"], "已开奖")
        self.assertTrue(loser_payload["lottery_status"]["is_drawn"])
        self.assertFalse(loser_payload["lottery_status"]["is_winner"])
        self.assertIn(loser_lottery_no, loser_payload["lottery_status"]["publicity_desc"])
        self.assertIn("未中奖", loser_payload["lottery_status"]["publicity_desc"])
        self.assertNotIn(winner_lottery_no, loser_payload["lottery_status"]["publicity_desc"])

    def test_admin_grand_prize_draw_config_publishes_winner_by_lottery_number(self):
        winner = self._create_session("configured_grand_prize_winner")
        loser = self._create_session("configured_grand_prize_loser")

        for owner, prefix in ((winner, "configured_winner_friend"), (loser, "configured_loser_friend")):
            share = self.client.post("/api/share/record", json={"session_token": owner["session_token"], "share_channel": "wechat"}).json()
            for index in range(5):
                friend = self._create_session(f"{prefix}_{index}", share["share_token"])
                self._draw_and_claim(friend["session_token"], self._valid_mobile(index))

        winner_before = self.client.get("/api/grand-prize/qualification/detail", params={"session_token": winner["session_token"]}).json()
        loser_before = self.client.get("/api/grand-prize/qualification/detail", params={"session_token": loser["session_token"]}).json()
        winner_lottery_no = winner_before["lottery_no"]
        loser_lottery_no = loser_before["lottery_no"]

        config_response = self.client.post(
            "/api/admin/grand-prize/draw-config",
            headers=self._admin_headers(),
            json={
                "draw_enabled": True,
                "winning_lottery_nos": [winner_lottery_no],
                "configured_by": "unit_test",
            },
        )

        self.assertEqual(config_response.status_code, 200, config_response.text)
        config_payload = config_response.json()
        self.assertTrue(config_payload["draw_enabled"])
        self.assertEqual(config_payload["winning_lottery_nos"], [winner_lottery_no])
        self.assertEqual(config_payload["qualified_count"], 2)
        self.assertEqual(config_payload["winner_count"], 1)
        self.assertEqual(config_payload["not_winner_count"], 1)
        self.assertEqual(config_payload["unknown_lottery_nos"], [])

        winner_after = self.client.get("/api/grand-prize/qualification/detail", params={"session_token": winner["session_token"]}).json()
        loser_after = self.client.get("/api/grand-prize/qualification/detail", params={"session_token": loser["session_token"]}).json()

        self.assertEqual(winner_after["lottery_status"]["status"], "won")
        self.assertTrue(winner_after["lottery_status"]["is_drawn"])
        self.assertTrue(winner_after["lottery_status"]["is_winner"])
        self.assertIn(winner_lottery_no, winner_after["lottery_status"]["publicity_desc"])

        self.assertEqual(loser_after["lottery_status"]["status"], "not_won")
        self.assertTrue(loser_after["lottery_status"]["is_drawn"])
        self.assertFalse(loser_after["lottery_status"]["is_winner"])
        self.assertIn(loser_lottery_no, loser_after["lottery_status"]["publicity_desc"])
        self.assertNotIn(winner_lottery_no, loser_after["lottery_status"]["publicity_desc"])

    def test_admin_grand_prize_draw_config_requires_admin_token(self):
        get_response = self.client.get("/api/admin/grand-prize/draw-config")
        bad_get_response = self.client.get(
            "/api/admin/grand-prize/draw-config",
            headers={"X-Admin-Token": "wrong-token"},
        )
        post_response = self.client.post(
            "/api/admin/grand-prize/draw-config",
            json={"draw_enabled": True, "winning_lottery_nos": ["GP20260527697416"]},
        )
        bearer_response = self.client.get(
            "/api/admin/grand-prize/draw-config",
            headers={"Authorization": "Bearer unit-test-admin-token"},
        )

        self.assertEqual(get_response.status_code, 401)
        self.assertEqual(bad_get_response.status_code, 401)
        self.assertEqual(post_response.status_code, 401)
        self.assertEqual(bearer_response.status_code, 200)

    def test_admin_grand_prize_draw_config_can_hide_results_until_enabled(self):
        owner = self._create_session("configured_grand_prize_pending")
        share = self.client.post("/api/share/record", json={"session_token": owner["session_token"], "share_channel": "wechat"}).json()
        for index in range(5):
            friend = self._create_session(f"configured_pending_friend_{index}", share["share_token"])
            self._draw_and_claim(friend["session_token"], self._valid_mobile(index))

        before = self.client.get("/api/grand-prize/qualification/detail", params={"session_token": owner["session_token"]}).json()
        lottery_no = before["lottery_no"]
        self.assertEqual(before["lottery_status"]["status"], "pending")

        response = self.client.post(
            "/api/admin/grand-prize/draw-config",
            headers=self._admin_headers(),
            json={
                "draw_enabled": False,
                "winning_lottery_nos": [lottery_no],
                "configured_by": "unit_test",
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertFalse(payload["draw_enabled"])
        self.assertEqual(payload["winning_lottery_nos"], [lottery_no])

        after = self.client.get("/api/grand-prize/qualification/detail", params={"session_token": owner["session_token"]}).json()

        self.assertEqual(after["lottery_status"]["status"], "pending")
        self.assertFalse(after["lottery_status"]["is_drawn"])
        self.assertFalse(after["lottery_status"]["is_winner"])

    def test_admin_grand_prize_draw_config_sets_draw_time_for_detail(self):
        owner = self._create_session("configured_grand_prize_draw_time")
        share = self.client.post("/api/share/record", json={"session_token": owner["session_token"], "share_channel": "wechat"}).json()
        for index in range(5):
            friend = self._create_session(f"configured_draw_time_friend_{index}", share["share_token"])
            self._draw_and_claim(friend["session_token"], self._valid_mobile(index))

        lottery_no = self.client.get(
            "/api/grand-prize/qualification/detail",
            params={"session_token": owner["session_token"]},
        ).json()["lottery_no"]

        response = self.client.post(
            "/api/admin/grand-prize/draw-config",
            headers=self._admin_headers(),
            json={
                "draw_enabled": False,
                "winning_lottery_nos": [lottery_no],
                "draw_time": "2026-06-18 10:00",
                "configured_by": "unit_test",
            },
        )
        detail = self.client.get("/api/grand-prize/qualification/detail", params={"session_token": owner["session_token"]})
        config = self.client.get("/api/admin/grand-prize/draw-config", headers=self._admin_headers())

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["draw_time"], "2026-06-18 10:00")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["lottery_status"]["draw_time_desc"], "2026-06-18 10:00")
        self.assertEqual(config.status_code, 200)
        self.assertEqual(config.json()["draw_time"], "2026-06-18 10:00")

    def test_grand_prize_draw_config_auto_publishes_after_draw_time(self):
        winner = self._create_session("scheduled_grand_prize_winner")
        loser = self._create_session("scheduled_grand_prize_loser")

        for owner, prefix in ((winner, "scheduled_winner_friend"), (loser, "scheduled_loser_friend")):
            share = self.client.post("/api/share/record", json={"session_token": owner["session_token"], "share_channel": "wechat"}).json()
            for index in range(5):
                friend = self._create_session(f"{prefix}_{index}", share["share_token"])
                self._draw_and_claim(friend["session_token"], self._valid_mobile(index))

        winner_before = self.client.get("/api/grand-prize/qualification/detail", params={"session_token": winner["session_token"]}).json()
        loser_before = self.client.get("/api/grand-prize/qualification/detail", params={"session_token": loser["session_token"]}).json()
        winner_lottery_no = winner_before["lottery_no"]
        loser_lottery_no = loser_before["lottery_no"]

        response = self.client.post(
            "/api/admin/grand-prize/draw-config",
            headers=self._admin_headers(),
            json={
                "draw_enabled": False,
                "draw_time": "2020-01-01 10:00",
                "winning_lottery_nos": [winner_lottery_no],
                "configured_by": "unit_test",
            },
        )
        winner_after = self.client.get("/api/grand-prize/qualification/detail", params={"session_token": winner["session_token"]}).json()

        import sqlite3

        conn = sqlite3.connect(self.database_path)
        try:
            winner_db_status = conn.execute(
                "SELECT lottery_status FROM grand_prize_qualification WHERE lottery_no = ?",
                (winner_lottery_no,),
            ).fetchone()[0]
            loser_db_status = conn.execute(
                "SELECT lottery_status FROM grand_prize_qualification WHERE lottery_no = ?",
                (loser_lottery_no,),
            ).fetchone()[0]
        finally:
            conn.close()

        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()["draw_enabled"])
        self.assertEqual(winner_after["lottery_status"]["status"], "won")
        self.assertTrue(winner_after["lottery_status"]["is_drawn"])
        self.assertTrue(winner_after["lottery_status"]["is_winner"])
        self.assertEqual(winner_db_status, "won")
        self.assertEqual(loser_db_status, "not_won")

    def test_grand_prize_detail_backfills_blank_lottery_no_for_existing_qualification(self):
        owner = self._create_session("owner_blank_lottery")
        share = self.client.post("/api/share/record", json={"session_token": owner["session_token"], "share_channel": "wechat"}).json()

        for index in range(5):
            friend = self._create_session(f"blank_lottery_friend_{index}", share["share_token"])
            self._draw_and_claim(friend["session_token"], self._valid_mobile(index))

        import sqlite3

        conn = sqlite3.connect(self.database_path)
        try:
            conn.execute(
                """
                UPDATE grand_prize_qualification
                SET lottery_no = ''
                WHERE activity_code = 'gaokao_lucky_sign_2026' AND user_id = ?
                """,
                (owner["user"]["user_id"],),
            )
            conn.commit()
        finally:
            conn.close()

        response = self.client.get("/api/grand-prize/qualification/detail", params={"session_token": owner["session_token"]})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["qualify_status"], "qualified")
        self.assertTrue(payload["lottery_no"].startswith("GP"))
        self.assertEqual(payload["qualification"]["lottery_no"], payload["lottery_no"])

    def test_grand_prize_detail_reissues_predictable_legacy_lottery_number(self):
        owner = self._create_session("owner_predictable_lottery")
        share = self.client.post("/api/share/record", json={"session_token": owner["session_token"], "share_channel": "wechat"}).json()

        for index in range(5):
            friend = self._create_session(f"predictable_lottery_friend_{index}", share["share_token"])
            self._draw_and_claim(friend["session_token"], self._valid_mobile(index))

        legacy_lottery_no = f"GP20260526{owner['user']['user_id']:06d}"

        import sqlite3

        conn = sqlite3.connect(self.database_path)
        try:
            conn.execute(
                """
                UPDATE grand_prize_qualification
                SET lottery_no = ?,
                    lottery_suffix = ?
                WHERE activity_code = 'gaokao_lucky_sign_2026' AND user_id = ?
                """,
                (legacy_lottery_no, f"{owner['user']['user_id']:06d}", owner["user"]["user_id"]),
            )
            conn.commit()
        finally:
            conn.close()

        with patch("backend.app.activity_service.secrets.randbelow", return_value=234567):
            response = self.client.get("/api/grand-prize/qualification/detail", params={"session_token": owner["session_token"]})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertNotEqual(payload["lottery_no"], legacy_lottery_no)
        self.assertEqual(payload["lottery_no"][-6:], "334567")
        self.assertNotEqual(payload["lottery_no"][-6:], f"{owner['user']['user_id']:06d}")

    def test_rules_explain_and_tracking_endpoints_return_flow_data(self):
        session = self._create_session()
        with patch("backend.app.activity_service.secrets.randbelow", return_value=0):
            draw = self._draw(session["session_token"])

        explain_response = self.client.get(
            "/api/explain/detail",
            params={"session_token": session["session_token"], "draw_id": draw["draw_id"]},
        )
        rules_response = self.client.get("/api/activity/rules/detail")
        tracking_response = self.client.post(
            "/api/tracking/event",
            json={"session_token": session["session_token"], "page_code": "p2", "event_name": "view_result"},
        )

        self.assertEqual(explain_response.status_code, 200)
        self.assertEqual(explain_response.json()["result"]["result_code"], "sign_001")
        self.assertEqual(rules_response.status_code, 200)
        self.assertGreaterEqual(len(rules_response.json()["rules"]), 7)
        self.assertEqual(tracking_response.status_code, 200)
        self.assertEqual(tracking_response.json()["success"], True)

    def test_tracking_endpoint_accepts_iso_client_time(self):
        import sqlite3

        session = self._create_session()

        response = self.client.post(
            "/api/tracking/event",
            json={
                "session_token": session["session_token"],
                "page_code": "p1",
                "event_name": "activity_home_view",
                "client_time": "2026-05-26T14:55:55.020Z",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["success"], True)

        conn = sqlite3.connect(self.database_path)
        try:
            row = conn.execute("SELECT client_time FROM tracking_event ORDER BY id DESC LIMIT 1").fetchone()
        finally:
            conn.close()

        self.assertEqual(row[0], "2026-05-26 14:55:55")

    def test_poster_save_persists_png_and_returns_readable_image_url(self):
        session = self._create_session()
        image_data_url = (
            "data:image/png;base64,"
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
        )

        response = self.client.post(
            "/api/poster/save",
            json={
                "session_token": session["session_token"],
                "page_code": "p2",
                "poster_type": "result_share",
                "image_data_url": image_data_url,
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["success"], True)
        self.assertEqual(payload["saved"], True)
        self.assertTrue(payload["poster_id"].startswith("poster_"))
        self.assertGreater(payload["byte_size"], 0)
        self.assertTrue((self.poster_dir / f"{payload['poster_id']}.png").exists())

        image_response = self.client.get(payload["poster_url"])
        self.assertEqual(image_response.status_code, 200)
        self.assertEqual(image_response.headers["content-type"], "image/png")

    def test_poster_save_rejects_images_over_configured_size_limit(self):
        os.environ["GAOKAO_H5_POSTER_MAX_BYTES"] = "16"
        session = self._create_session()
        image_data_url = (
            "data:image/png;base64,"
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
        )

        response = self.client.post(
            "/api/poster/save",
            json={
                "session_token": session["session_token"],
                "page_code": "home",
                "poster_type": "home_share",
                "image_data_url": image_data_url,
            },
        )

        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["detail"], "poster image is too large")


if __name__ == "__main__":
    unittest.main()
