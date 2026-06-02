import hashlib
import os
import secrets
import time
from urllib.parse import urldefrag, urlparse

import httpx

from .activity_service import ApiError
from .local_env import load_local_env


WECHAT_TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token"
WECHAT_TICKET_URL = "https://api.weixin.qq.com/cgi-bin/ticket/getticket"
WECHAT_SHARE_JS_API_LIST = ["updateAppMessageShareData", "updateTimelineShareData"]
_CACHE_TTL_SKEW_SECONDS = 120
_ACCESS_TOKEN_CACHE: dict[str, object] = {"value": "", "expires_at": 0.0}
_JSAPI_TICKET_CACHE: dict[str, object] = {"value": "", "expires_at": 0.0}


def _now() -> float:
    return time.time()


def _get_wechat_config() -> tuple[str, str]:
    load_local_env()
    app_id = os.environ.get("GAOKAO_H5_WECHAT_APP_ID", "").strip()
    app_secret = os.environ.get("GAOKAO_H5_WECHAT_APP_SECRET", "").strip()
    if not app_id or not app_secret:
        raise ApiError(503, "wechat official account config is not configured")
    return app_id, app_secret


def _normalize_signature_url(url: str) -> str:
    normalized = urldefrag(str(url or "").strip()).url
    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ApiError(400, "invalid signature url")
    return normalized


def _expires_at(payload: dict[str, object]) -> float:
    return _now() + max(0, int(payload.get("expires_in") or 7200) - _CACHE_TTL_SKEW_SECONDS)


def _get_access_token(app_id: str, app_secret: str) -> str:
    if _ACCESS_TOKEN_CACHE["value"] and float(_ACCESS_TOKEN_CACHE["expires_at"]) > _now():
        return str(_ACCESS_TOKEN_CACHE["value"])

    response = httpx.get(
        WECHAT_TOKEN_URL,
        params={"grant_type": "client_credential", "appid": app_id, "secret": app_secret},
        timeout=5.0,
    )
    response.raise_for_status()
    payload = response.json()
    access_token = payload.get("access_token")
    if not access_token:
        raise ApiError(502, payload.get("errmsg") or "wechat access token request failed")

    _ACCESS_TOKEN_CACHE.update({"value": str(access_token), "expires_at": _expires_at(payload)})
    return str(access_token)


def _get_jsapi_ticket(access_token: str) -> str:
    if _JSAPI_TICKET_CACHE["value"] and float(_JSAPI_TICKET_CACHE["expires_at"]) > _now():
        return str(_JSAPI_TICKET_CACHE["value"])

    response = httpx.get(
        WECHAT_TICKET_URL,
        params={"access_token": access_token, "type": "jsapi"},
        timeout=5.0,
    )
    response.raise_for_status()
    payload = response.json()
    ticket = payload.get("ticket")
    if not ticket:
        raise ApiError(502, payload.get("errmsg") or "wechat jsapi ticket request failed")

    _JSAPI_TICKET_CACHE.update({"value": str(ticket), "expires_at": _expires_at(payload)})
    return str(ticket)


def build_wechat_jssdk_signature(url: str) -> dict[str, object]:
    app_id, app_secret = _get_wechat_config()
    signature_url = _normalize_signature_url(url)
    access_token = _get_access_token(app_id, app_secret)
    ticket = _get_jsapi_ticket(access_token)
    timestamp = int(_now())
    nonce_str = secrets.token_hex(8)
    raw = f"jsapi_ticket={ticket}&noncestr={nonce_str}&timestamp={timestamp}&url={signature_url}"
    signature = hashlib.sha1(raw.encode("utf-8")).hexdigest()

    return {
        "appId": app_id,
        "timestamp": timestamp,
        "nonceStr": nonce_str,
        "signature": signature,
        "url": signature_url,
        "jsApiList": WECHAT_SHARE_JS_API_LIST,
    }
