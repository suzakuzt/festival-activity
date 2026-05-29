import base64
import json
import logging
import os
import textwrap
from dataclasses import dataclass
from typing import Any
from urllib import error, request
from urllib.parse import urljoin

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import padding

from backend.app.local_env import load_local_env


LOGGER = logging.getLogger(__name__)
MOBILE_REGISTRATION_ERROR_CODE = "mini_program_mobile_registration_required"
MOBILE_REGISTRATION_ERROR_MESSAGE = "\u8bf7\u5148\u53bb\u5c0f\u7a0b\u5e8f\u6ce8\u518c\u624b\u673a\u53f7"


class HermesCouponError(Exception):
    """Raised when portal login or coupon issuing fails."""

    def __init__(self, message: str, *, error_code: str | None = None):
        self.error_code = error_code
        super().__init__(message)


@dataclass(frozen=True)
class HermesCouponConfig:
    base_url: str
    username: str
    password: str
    hermes_title: str
    hermes_id: int
    ref_id: int
    ref_type: int
    start_time: str
    end_time: str
    face_value: str
    timeout_seconds: float = 10.0

    @classmethod
    def from_env(cls) -> "HermesCouponConfig":
        load_local_env()
        required_values = {
            "base_url": os.environ.get("PORTAL_BASE_URL"),
            "username": os.environ.get("PORTAL_USERNAME"),
            "password": os.environ.get("PORTAL_PASSWORD"),
        }
        missing = [key for key, value in required_values.items() if value in (None, "")]
        if missing:
            LOGGER.error("Hermes portal config missing keys=%s", ",".join(missing))
            raise HermesCouponError(f"Hermes portal config missing: {', '.join(missing)}")

        values = {
            **required_values,
            "hermes_title": os.environ.get("HERMES_COUPON_TITLE"),
            "hermes_id": os.environ.get("HERMES_ID"),
            "ref_id": os.environ.get("HERMES_REF_ID"),
            "ref_type": os.environ.get("HERMES_REF_TYPE"),
            "start_time": os.environ.get("HERMES_START_TIME"),
            "end_time": os.environ.get("HERMES_END_TIME"),
            "face_value": os.environ.get("HERMES_FACE_VALUE"),
        }

        try:
            hermes_id = int(str(values["hermes_id"] or 0))
            ref_id = int(str(values["ref_id"] or 0))
            ref_type = int(str(values["ref_type"] or 1))
        except ValueError as exc:
            raise HermesCouponError("Hermes coupon numeric config is invalid") from exc

        return cls(
            base_url=str(values["base_url"]),
            username=str(values["username"]),
            password=str(values["password"]),
            hermes_title=str(values["hermes_title"] or ""),
            hermes_id=hermes_id,
            ref_id=ref_id,
            ref_type=ref_type,
            start_time=str(values["start_time"] or ""),
            end_time=str(values["end_time"] or ""),
            face_value=str(values["face_value"] or ""),
        )


@dataclass(frozen=True)
class HermesCouponIssueConfig:
    hermes_title: str
    hermes_id: int
    ref_id: int
    ref_type: int
    start_time: str
    end_time: str
    face_value: str
    reward_code: str | None = None
    config_id: int | None = None


@dataclass(frozen=True)
class HermesEncryption:
    public_key: str
    version: str


class UrlLibHermesTransport:
    def request_json(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        json_body: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        request_headers = dict(headers or {})
        body = None
        if json_body is not None:
            body = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
            request_headers.setdefault("Content-Type", "application/json;charset=UTF-8")
            request_headers.setdefault("Accept", "application/json, text/plain, */*")

        req = request.Request(url, data=body, headers=request_headers, method=method.upper())
        try:
            with request.urlopen(req, timeout=timeout) as response:
                return self._read_json_response(response.status, response.read())
        except error.HTTPError as exc:
            payload = self._read_json_response(exc.code, exc.read())
            payload["_http_status"] = exc.code
            LOGGER.warning(
                "Hermes portal HTTP error method=%s url=%s http_status=%s code=%s message=%s",
                method.upper(),
                url,
                exc.code,
                payload.get("code"),
                payload.get("message") or payload.get("msg"),
            )
            return payload
        except error.URLError as exc:
            LOGGER.exception("Hermes portal request failed method=%s url=%s reason=%s", method.upper(), url, exc)
            raise HermesCouponError("Hermes portal request failed") from exc

    @staticmethod
    def _read_json_response(status_code: int, raw_body: bytes) -> dict[str, Any]:
        if status_code >= 500:
            raise HermesCouponError(f"Hermes portal HTTP {status_code}")
        try:
            text = raw_body.decode("utf-8")
            payload = json.loads(text or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise HermesCouponError("Hermes portal returned non-JSON response") from exc
        if not isinstance(payload, dict):
            raise HermesCouponError("Hermes portal returned invalid JSON response")
        payload["_http_status"] = status_code
        return payload


class HermesCouponClient:
    def __init__(
        self,
        config: HermesCouponConfig | None = None,
        transport: UrlLibHermesTransport | None = None,
    ):
        self.config = config or HermesCouponConfig.from_env()
        self.transport = transport or UrlLibHermesTransport()
        self._token: str | None = None
        self._encryption: HermesEncryption | None = None

    def get_encryption(self, *, force: bool = False) -> HermesEncryption:
        if self._encryption and not force:
            return self._encryption

        payload = self.transport.request_json(
            "GET",
            self._url("/ouser-web/admin/getEncryption"),
            timeout=self.config.timeout_seconds,
        )
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        public_key = data.get("publicKey") or payload.get("publicKey")
        version = data.get("version") or payload.get("version") or ""
        if not public_key:
            LOGGER.warning(
                "Hermes get_encryption failed base_url=%s code=%s message=%s",
                self.config.base_url,
                payload.get("code"),
                payload.get("message") or payload.get("msg"),
            )
            raise HermesCouponError("Hermes encryption public key missing")

        self._encryption = HermesEncryption(public_key=str(public_key), version=str(version))
        LOGGER.info("Hermes get_encryption success base_url=%s version=%s", self.config.base_url, version)
        return self._encryption

    def rsa_encrypt(self, text: str) -> str:
        encryption = self.get_encryption()
        public_key = self._load_public_key(encryption.public_key)
        cipher = public_key.encrypt(text.encode("utf-8"), padding.PKCS1v15())
        return f"{encryption.version}{base64.b64encode(cipher).decode('ascii')}"

    def login(self, force: bool = False) -> str:
        if self._token and not force:
            return self._token

        if force:
            self._token = None
            self._encryption = None

        LOGGER.info("Hermes login request base_url=%s username=%s force=%s", self.config.base_url, mask_account(self.config.username), force)
        payload = self.transport.request_json(
            "POST",
            self._url("/ouser-web/mobileLogin/backendLogin.do"),
            headers={"Content-Type": "application/json;charset=UTF-8"},
            json_body={
                "username": self.rsa_encrypt(self.config.username),
                "password": self.rsa_encrypt(self.config.password),
                "type": 1,
            },
            timeout=self.config.timeout_seconds,
        )
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        token = payload.get("ut") or data.get("ut")
        if not token:
            LOGGER.warning(
                "Hermes login failed base_url=%s username=%s code=%s message=%s http_status=%s",
                self.config.base_url,
                mask_account(self.config.username),
                payload.get("code"),
                payload.get("message") or payload.get("msg"),
                payload.get("_http_status"),
            )
            raise HermesCouponError("Hermes portal login failed")

        self._token = str(token)
        LOGGER.info("Hermes login success base_url=%s username=%s", self.config.base_url, mask_account(self.config.username))
        return self._token

    def get_token(self) -> str:
        return self.login()

    def manual_import(
        self,
        mobiles: list[str],
        issue_config: HermesCouponIssueConfig | None = None,
        *,
        trace_id: str = "",
    ) -> dict[str, Any]:
        return self._manual_import_with_token(mobiles, self.get_token(), self._resolve_issue_config(issue_config), trace_id=trace_id)

    def issue_coupon(self, mobile: str, issue_config: HermesCouponIssueConfig | None = None, *, trace_id: str = "") -> dict[str, Any]:
        resolved_issue_config = self._resolve_issue_config(issue_config)
        payload = self.manual_import([mobile], resolved_issue_config, trace_id=trace_id)
        if self._is_token_invalid(payload):
            LOGGER.warning(
                "Hermes token invalid, retry login trace_id=%s reward_code=%s mobile=%s code=%s message=%s",
                trace_id,
                resolved_issue_config.reward_code,
                mask_mobile(mobile),
                payload.get("code"),
                payload.get("message") or payload.get("msg"),
            )
            self.login(force=True)
            payload = self.manual_import([mobile], resolved_issue_config, trace_id=trace_id)

        self._ensure_issue_success(payload, mobile, resolved_issue_config, trace_id=trace_id)
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        LOGGER.info(
            "Hermes coupon issued trace_id=%s task_id=%s reward_code=%s mobile=%s hermes_id=%s ref_id=%s ref_type=%s successNum=%s failNum=%s",
            trace_id,
            data.get("id"),
            resolved_issue_config.reward_code,
            mask_mobile(mobile),
            resolved_issue_config.hermes_id,
            resolved_issue_config.ref_id,
            resolved_issue_config.ref_type,
            data.get("successNum"),
            data.get("failNum"),
        )
        return payload

    def _manual_import_with_token(
        self,
        mobiles: list[str],
        token: str,
        issue_config: HermesCouponIssueConfig,
        *,
        trace_id: str = "",
    ) -> dict[str, Any]:
        url = self._url("/api/hermes-web/generateCodeTask/manualImport")
        request_body = {
            "hermesTitle": issue_config.hermes_title,
            "hermesId": issue_config.hermes_id,
            "refId": issue_config.ref_id,
            "refType": issue_config.ref_type,
            "startTime": issue_config.start_time,
            "endTime": issue_config.end_time,
            "mobiles": mobiles,
            "faceValue": issue_config.face_value,
        }
        LOGGER.info(
            "Hermes manualImport request trace_id=%s url=%s reward_code=%s config_id=%s hermes_id=%s ref_id=%s ref_type=%s start_time=%s end_time=%s face_value=%s mobiles=%s token_set=%s",
            trace_id,
            url,
            issue_config.reward_code,
            issue_config.config_id,
            issue_config.hermes_id,
            issue_config.ref_id,
            issue_config.ref_type,
            issue_config.start_time,
            issue_config.end_time,
            issue_config.face_value,
            ",".join(mask_mobile(mobile) for mobile in mobiles),
            bool(token),
        )
        payload = self.transport.request_json(
            "POST",
            url,
            headers={
                "X-Token": token,
                "Content-Type": "application/json;charset=UTF-8",
            },
            json_body=request_body,
            timeout=self.config.timeout_seconds,
        )
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        LOGGER.info(
            "Hermes manualImport response trace_id=%s reward_code=%s task_id=%s code=%s success=%s message=%s successNum=%s failNum=%s http_status=%s",
            trace_id,
            issue_config.reward_code,
            data.get("id"),
            payload.get("code"),
            payload.get("success"),
            payload.get("message") or payload.get("msg"),
            data.get("successNum"),
            data.get("failNum"),
            payload.get("_http_status"),
        )
        return payload

    def _resolve_issue_config(self, issue_config: HermesCouponIssueConfig | None = None) -> HermesCouponIssueConfig:
        if issue_config:
            return issue_config
        if not self.config.hermes_title or self.config.hermes_id <= 0 or self.config.ref_id <= 0 or not self.config.start_time or not self.config.end_time or not self.config.face_value:
            raise HermesCouponError("Hermes coupon issue config missing")
        return HermesCouponIssueConfig(
            hermes_title=self.config.hermes_title,
            hermes_id=self.config.hermes_id,
            ref_id=self.config.ref_id,
            ref_type=self.config.ref_type,
            start_time=self.config.start_time,
            end_time=self.config.end_time,
            face_value=self.config.face_value,
        )

    def _ensure_issue_success(self, payload: dict[str, Any], mobile: str, issue_config: HermesCouponIssueConfig, *, trace_id: str = "") -> None:
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        success_num = int(data.get("successNum") or 0)
        fail_num = int(data.get("failNum") or 0)
        status = int(data.get("status") or payload.get("status") or 0)
        if str(payload.get("code")) == "0" and payload.get("success") is True and success_num == 1 and fail_num == 0:
            return

        if status == 3 and fail_num > 0:
            LOGGER.warning(
                "Hermes coupon issue requires mini-program mobile registration trace_id=%s mobile=%s reward_code=%s task_id=%s hermes_id=%s ref_id=%s ref_type=%s code=%s success=%s message=%s status=%s successNum=%s failNum=%s http_status=%s",
                trace_id,
                mask_mobile(mobile),
                issue_config.reward_code,
                data.get("id"),
                issue_config.hermes_id,
                issue_config.ref_id,
                issue_config.ref_type,
                payload.get("code"),
                payload.get("success"),
                payload.get("message"),
                status,
                success_num,
                fail_num,
                payload.get("_http_status"),
            )
            raise HermesCouponError(
                MOBILE_REGISTRATION_ERROR_MESSAGE,
                error_code=MOBILE_REGISTRATION_ERROR_CODE,
            )

        LOGGER.warning(
            "Hermes coupon issue failed trace_id=%s mobile=%s reward_code=%s task_id=%s hermes_id=%s ref_id=%s ref_type=%s code=%s success=%s message=%s successNum=%s failNum=%s http_status=%s",
            trace_id,
            mask_mobile(mobile),
            issue_config.reward_code,
            data.get("id"),
            issue_config.hermes_id,
            issue_config.ref_id,
            issue_config.ref_type,
            payload.get("code"),
            payload.get("success"),
            payload.get("message"),
            success_num,
            fail_num,
            payload.get("_http_status"),
        )
        raise HermesCouponError("发券失败，请稍后重试")

    @staticmethod
    def _is_token_invalid(payload: dict[str, Any]) -> bool:
        http_status = int(payload.get("_http_status") or 0)
        message = str(payload.get("message") or payload.get("msg") or "")
        code = str(payload.get("code") or "")
        if http_status in (401, 403):
            return True
        if code in {"401", "403", "1001", "10001", "40101"}:
            return True
        return any(keyword in message for keyword in ("未登录", "登录失效", "token失效", "无权限", "权限"))

    @staticmethod
    def _load_public_key(public_key_text: str):
        raw = public_key_text.strip()
        if "BEGIN PUBLIC KEY" in raw:
            return serialization.load_pem_public_key(raw.encode("utf-8"))

        compact = "".join(raw.split())
        try:
            return serialization.load_der_public_key(base64.b64decode(compact))
        except ValueError:
            wrapped = "\n".join(textwrap.wrap(compact, 64))
            pem = f"-----BEGIN PUBLIC KEY-----\n{wrapped}\n-----END PUBLIC KEY-----\n"
            return serialization.load_pem_public_key(pem.encode("ascii"))

    def _url(self, path: str) -> str:
        return urljoin(self.config.base_url.rstrip("/") + "/", path.lstrip("/"))


def mask_mobile(mobile: str) -> str:
    if len(mobile) < 7:
        return "****"
    return f"{mobile[:3]}****{mobile[-4:]}"


def mask_account(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 4:
        return "****"
    return f"{value[:2]}****{value[-2:]}"
