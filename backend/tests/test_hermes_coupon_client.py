import base64
import os
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from backend.services.hermes_coupon_client import (
    HermesCouponClient,
    HermesCouponConfig,
    HermesCouponError,
    HermesCouponIssueConfig,
)


class FakeHermesTransport:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def request_json(self, method, url, *, headers=None, json_body=None, timeout=None):
        self.calls.append(
            {
                "method": method,
                "url": url,
                "headers": headers or {},
                "json_body": json_body,
                "timeout": timeout,
            }
        )
        if not self.responses:
            raise AssertionError(f"Unexpected request: {method} {url}")
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def _build_config():
    return HermesCouponConfig(
        base_url="https://portal.kpcc-tech.com",
        username="portal_user",
        password="portal_password",
        hermes_title="一举高中·无门槛10元优惠券",
        hermes_id=2605150000000112,
        ref_id=2605150000000126,
        ref_type=1,
        start_time="2026-05-15 11:00:00",
        end_time="2026-06-30 23:59:59",
        face_value="10",
    )


def _build_public_key_pair():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("ascii")
    return private_key, public_pem


def _build_issue_config():
    return HermesCouponIssueConfig(
        reward_code="coupon_20",
        hermes_title="一举高中·无门槛20元优惠券",
        hermes_id=2605150000000212,
        ref_id=2605150000000226,
        ref_type=1,
        start_time="2026-05-15 11:00:00",
        end_time="2026-06-30 23:59:59",
        face_value="20",
    )


class HermesCouponClientTests(unittest.TestCase):
    def test_config_from_env_loads_backend_env_before_reading_values(self):
        keys = [
            "PORTAL_BASE_URL",
            "PORTAL_USERNAME",
            "PORTAL_PASSWORD",
            "HERMES_COUPON_TITLE",
            "HERMES_ID",
            "HERMES_REF_ID",
            "HERMES_REF_TYPE",
            "HERMES_START_TIME",
            "HERMES_END_TIME",
            "HERMES_FACE_VALUE",
        ]
        previous = {key: os.environ.get(key) for key in keys}
        for key in keys:
            os.environ.pop(key, None)

        def load_env_stub():
            os.environ.update(
                {
                    "PORTAL_BASE_URL": "https://portal.kpcc-tech.com",
                    "PORTAL_USERNAME": "portal_user",
                    "PORTAL_PASSWORD": "portal_password",
                    "HERMES_COUPON_TITLE": "一举高中·无门槛10元优惠券",
                    "HERMES_ID": "2605150000000112",
                    "HERMES_REF_ID": "2605150000000126",
                    "HERMES_REF_TYPE": "1",
                    "HERMES_START_TIME": "2026-05-15 11:00:00",
                    "HERMES_END_TIME": "2026-06-30 23:59:59",
                    "HERMES_FACE_VALUE": "10",
                }
            )

        try:
            with patch("backend.services.hermes_coupon_client.load_local_env", side_effect=load_env_stub) as load_env:
                config = HermesCouponConfig.from_env()
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

        load_env.assert_called_once()
        self.assertEqual(config.username, "portal_user")
        self.assertEqual(config.password, "portal_password")
        self.assertEqual(config.hermes_id, 2605150000000112)

    def test_config_from_env_allows_portal_only_when_issue_config_comes_from_database(self):
        keys = [
            "PORTAL_BASE_URL",
            "PORTAL_USERNAME",
            "PORTAL_PASSWORD",
            "HERMES_COUPON_TITLE",
            "HERMES_ID",
            "HERMES_REF_ID",
            "HERMES_REF_TYPE",
            "HERMES_START_TIME",
            "HERMES_END_TIME",
            "HERMES_FACE_VALUE",
        ]
        previous = {key: os.environ.get(key) for key in keys}
        for key in keys:
            os.environ.pop(key, None)

        def load_env_stub():
            os.environ.update(
                {
                    "PORTAL_BASE_URL": "https://portal.kpcc-tech.com",
                    "PORTAL_USERNAME": "portal_user",
                    "PORTAL_PASSWORD": "portal_password",
                }
            )

        try:
            with patch("backend.services.hermes_coupon_client.load_local_env", side_effect=load_env_stub):
                config = HermesCouponConfig.from_env()
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

        self.assertEqual(config.username, "portal_user")
        self.assertEqual(config.password, "portal_password")
        self.assertEqual(config.hermes_id, 0)
        self.assertEqual(config.face_value, "")

    def test_login_encrypts_credentials_with_public_key_version_and_caches_token(self):
        private_key, public_key = _build_public_key_pair()
        transport = FakeHermesTransport(
            [
                {"code": "0", "success": True, "data": {"publicKey": public_key, "version": "v1:"}},
                {"code": "0", "success": True, "ut": "ut_token_1"},
            ]
        )
        client = HermesCouponClient(config=_build_config(), transport=transport)

        token = client.get_token()
        second_token = client.get_token()

        self.assertEqual(token, "ut_token_1")
        self.assertEqual(second_token, "ut_token_1")
        self.assertEqual(len(transport.calls), 2)
        login_body = transport.calls[1]["json_body"]
        self.assertEqual(login_body["type"], 1)
        self.assertNotEqual(login_body["username"], "portal_user")
        self.assertNotEqual(login_body["password"], "portal_password")
        self.assertTrue(login_body["username"].startswith("v1:"))
        encrypted_username = base64.b64decode(login_body["username"].removeprefix("v1:"))
        decrypted_username = private_key.decrypt(encrypted_username, padding.PKCS1v15()).decode("utf-8")
        self.assertEqual(decrypted_username, "portal_user")

    def test_issue_coupon_sends_manual_import_payload_with_cached_token(self):
        _, public_key = _build_public_key_pair()
        transport = FakeHermesTransport(
            [
                {"code": "0", "success": True, "data": {"publicKey": public_key, "version": "v1:"}},
                {"code": "0", "success": True, "ut": "ut_token_1"},
                {
                    "code": "0",
                    "success": True,
                    "message": "成功",
                    "data": {"id": 2605250000000031, "successNum": 1, "failNum": 0},
                },
            ]
        )
        client = HermesCouponClient(config=_build_config(), transport=transport)

        result = client.issue_coupon("13040695156")

        self.assertEqual(result["data"]["id"], 2605250000000031)
        manual_call = transport.calls[-1]
        self.assertEqual(manual_call["method"], "POST")
        self.assertEqual(manual_call["headers"]["X-Token"], "ut_token_1")
        self.assertNotIn("Cookie", manual_call["headers"])
        self.assertEqual(
            manual_call["url"],
            "https://portal.kpcc-tech.com/api/hermes-web/generateCodeTask/manualImport",
        )
        self.assertEqual(
            manual_call["json_body"],
            {
                "hermesTitle": "一举高中·无门槛10元优惠券",
                "hermesId": 2605150000000112,
                "refId": 2605150000000126,
                "refType": 1,
                "startTime": "2026-05-15 11:00:00",
                "endTime": "2026-06-30 23:59:59",
                "mobiles": ["13040695156"],
                "faceValue": "10",
            },
        )

    def test_issue_coupon_uses_per_reward_issue_config_payload(self):
        _, public_key = _build_public_key_pair()
        transport = FakeHermesTransport(
            [
                {"code": "0", "success": True, "data": {"publicKey": public_key, "version": "v1:"}},
                {"code": "0", "success": True, "ut": "ut_token_1"},
                {
                    "code": "0",
                    "success": True,
                    "message": "成功",
                    "data": {"id": 2605250000000032, "successNum": 1, "failNum": 0},
                },
            ]
        )
        client = HermesCouponClient(config=_build_config(), transport=transport)

        result = client.issue_coupon("13040695156", _build_issue_config())

        self.assertEqual(result["data"]["id"], 2605250000000032)
        manual_call = transport.calls[-1]
        self.assertEqual(
            manual_call["json_body"],
            {
                "hermesTitle": "一举高中·无门槛20元优惠券",
                "hermesId": 2605150000000212,
                "refId": 2605150000000226,
                "refType": 1,
                "startTime": "2026-05-15 11:00:00",
                "endTime": "2026-06-30 23:59:59",
                "mobiles": ["13040695156"],
                "faceValue": "20",
            },
        )

    def test_issue_coupon_relogs_once_when_token_is_invalid(self):
        _, public_key = _build_public_key_pair()
        transport = FakeHermesTransport(
            [
                {"code": "0", "success": True, "data": {"publicKey": public_key, "version": "v1:"}},
                {"code": "0", "success": True, "ut": "expired_token"},
                {"code": "401", "success": False, "message": "未登录或token失效"},
                {"code": "0", "success": True, "data": {"publicKey": public_key, "version": "v1:"}},
                {"code": "0", "success": True, "ut": "fresh_token"},
                {"code": "0", "success": True, "data": {"id": 2605250000000031, "successNum": 1, "failNum": 0}},
            ]
        )
        client = HermesCouponClient(config=_build_config(), transport=transport)

        result = client.issue_coupon("13040695156")

        self.assertEqual(result["data"]["id"], 2605250000000031)
        manual_calls = [call for call in transport.calls if call["url"].endswith("/manualImport")]
        self.assertEqual([call["headers"]["X-Token"] for call in manual_calls], ["expired_token", "fresh_token"])

    def test_issue_coupon_rejects_partial_success_response(self):
        _, public_key = _build_public_key_pair()
        transport = FakeHermesTransport(
            [
                {"code": "0", "success": True, "data": {"publicKey": public_key, "version": "v1:"}},
                {"code": "0", "success": True, "ut": "ut_token_1"},
                {"code": "0", "success": True, "message": "成功", "data": {"id": 2605250000000031, "successNum": 0, "failNum": 1}},
            ]
        )
        client = HermesCouponClient(config=_build_config(), transport=transport)

        with self.assertRaisesRegex(HermesCouponError, "发券失败"):
            client.issue_coupon("13040695156")


    def test_issue_coupon_marks_status_3_failures_as_mobile_registration_required(self):
        _, public_key = _build_public_key_pair()
        transport = FakeHermesTransport(
            [
                {"code": "0", "success": True, "data": {"publicKey": public_key, "version": "v1:"}},
                {"code": "0", "success": True, "ut": "ut_token_1"},
                {
                    "code": "0",
                    "success": True,
                    "message": "\u6210\u529f",
                    "data": {"id": 2605290000000056, "status": 3, "successNum": 0, "failNum": 1},
                },
            ]
        )
        client = HermesCouponClient(config=_build_config(), transport=transport)

        with self.assertRaisesRegex(HermesCouponError, "\u6ce8\u518c\u624b\u673a\u53f7") as context:
            client.issue_coupon("13222323232", _build_issue_config())

        self.assertEqual(context.exception.error_code, "mini_program_mobile_registration_required")

    def test_issue_coupon_logs_manual_import_request_and_failure_context(self):
        _, public_key = _build_public_key_pair()
        transport = FakeHermesTransport(
            [
                {"code": "0", "success": True, "data": {"publicKey": public_key, "version": "v1:"}},
                {"code": "0", "success": True, "ut": "ut_token_1"},
                {
                    "code": "0",
                    "success": True,
                    "message": "鎴愬姛",
                    "data": {"id": 2605250000000031, "successNum": 0, "failNum": 1},
                },
            ]
        )
        client = HermesCouponClient(config=_build_config(), transport=transport)

        with self.assertLogs("backend.services.hermes_coupon_client", level="INFO") as logs:
            with self.assertRaises(HermesCouponError):
                client.issue_coupon("13040695156", _build_issue_config(), trace_id="trace123")

        output = "\n".join(logs.output)
        self.assertIn("Hermes manualImport request", output)
        self.assertIn("Hermes manualImport response", output)
        self.assertIn("Hermes coupon issue failed", output)
        self.assertIn("trace_id=trace123", output)
        self.assertIn("reward_code=coupon_20", output)
        self.assertIn("hermes_id=2605150000000212", output)
        self.assertIn("ref_id=2605150000000226", output)
        self.assertIn("task_id=2605250000000031", output)
        self.assertIn("mobile=130****5156", output)


if __name__ == "__main__":
    unittest.main()
