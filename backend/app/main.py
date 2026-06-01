import hmac
import logging
import os
import uuid
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .activity_service import (
    DEFAULT_ACTIVITY_CODE,
    ApiError,
    claim_benefit,
    create_session,
    execute_draw,
    get_activity_state,
    get_claim_result,
    get_explain_detail,
    get_grand_prize_draw_config,
    get_grand_prize_detail,
    get_reward_center,
    get_rules_detail,
    record_share,
    record_tracking_event,
    randomize_benefit,
    resolve_claim_by_token,
    save_grand_prize_draw_config,
)
from .health import build_health_status
from .local_env import load_local_env
from .poster_service import resolve_poster_path, save_poster


def _configure_logging() -> None:
    load_local_env()
    level_name = os.environ.get("GAOKAO_H5_LOG_LEVEL", "INFO").strip().upper() or "INFO"
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=logging.WARNING,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    for logger_name in ("backend", "backend.app", "backend.services"):
        logging.getLogger(logger_name).setLevel(level)


_configure_logging()
LOGGER = logging.getLogger(__name__)


app = FastAPI(
    title="Gaokao H5 Activity API",
    version="0.1.0",
    description="Temporary backend API for the Gaokao H5 activity.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SessionCreateRequest(BaseModel):
    activity_code: str = DEFAULT_ACTIVITY_CODE
    user_key: str | None = None
    external_user_id: str | None = None
    openid: str | None = None
    unionid: str | None = None
    nickname: str | None = None
    avatar_url: str | None = None
    source_page: str | None = None
    source_channel: str | None = None
    share_token: str | None = None


class DrawExecuteRequest(BaseModel):
    session_token: str
    source: str | None = None


class BenefitClaimRequest(BaseModel):
    session_token: str
    draw_id: int | None = None
    reward_code: str | None = None
    mobile: str | None = None
    claim_channel: str | None = None


class BenefitRandomizeRequest(BaseModel):
    session_token: str
    draw_id: int | None = None
    exclude_reward_code: str | None = None


class ShareRecordRequest(BaseModel):
    session_token: str
    share_channel: str | None = None


class TrackingEventRequest(BaseModel):
    session_token: str | None = None
    activity_code: str | None = None
    page_code: str | None = None
    event_name: str
    event_payload: dict[str, Any] = Field(default_factory=dict)
    client_time: str | None = None


class PosterSaveRequest(BaseModel):
    session_token: str | None = None
    activity_code: str | None = None
    page_code: str | None = None
    poster_type: str | None = None
    draw_id: int | None = None
    result_code: str | None = None
    sign_text: dict[str, Any] = Field(default_factory=dict)
    image_data_url: str = Field(..., min_length=32)


class GrandPrizeDrawConfigRequest(BaseModel):
    activity_code: str = DEFAULT_ACTIVITY_CODE
    draw_enabled: bool = False
    draw_time: str | None = None
    winning_lottery_nos: list[str] = Field(default_factory=list)
    configured_by: str | None = None
    remark: str | None = None


def _handle_api_error(error: ApiError):
    raise HTTPException(status_code=error.status_code, detail=error.message) from error


def _mask_mobile(value: str | None) -> str:
    if not value:
        return ""
    if len(value) < 7:
        return "****"
    return f"{value[:3]}****{value[-4:]}"


def _mask_token(value: str | None) -> str:
    if not value:
        return ""
    if len(value) <= 12:
        return "****"
    return f"{value[:8]}...{value[-4:]}"


def _extract_bearer_token(value: str | None) -> str:
    if not value:
        return ""
    scheme, _, token = value.strip().partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return ""
    return token.strip()


def require_admin_token(
    authorization: str | None = Header(default=None),
    x_admin_token: str | None = Header(default=None),
) -> None:
    load_local_env()
    expected = os.environ.get("GAOKAO_H5_ADMIN_TOKEN", "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="admin token is not configured")

    supplied = (x_admin_token or "").strip() or _extract_bearer_token(authorization)
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="invalid admin token")


@app.get("/api/health")
def health_check():
    return build_health_status()


@app.post("/api/h5/session/create")
def h5_session_create(request: SessionCreateRequest):
    try:
        return create_session(request.model_dump())
    except ApiError as error:
        _handle_api_error(error)


@app.get("/api/activity/state")
def activity_state(session_token: str = Query(...)):
    try:
        return get_activity_state(session_token)
    except ApiError as error:
        _handle_api_error(error)


@app.post("/api/draw/execute")
def draw_execute(request: DrawExecuteRequest):
    try:
        return execute_draw(request.model_dump())
    except ApiError as error:
        _handle_api_error(error)


@app.get("/api/draw/result/detail")
def draw_result_detail(session_token: str = Query(...), draw_id: int | None = None, result_code: str | None = None):
    try:
        return get_explain_detail(session_token, draw_id, result_code)
    except ApiError as error:
        _handle_api_error(error)


@app.get("/api/explain/detail")
def explain_detail(session_token: str = Query(...), draw_id: int | None = None, result_code: str | None = None):
    try:
        return get_explain_detail(session_token, draw_id, result_code)
    except ApiError as error:
        _handle_api_error(error)


@app.post("/api/benefit/claim")
def benefit_claim(request: BenefitClaimRequest):
    trace_id = uuid.uuid4().hex[:12]
    payload = request.model_dump()
    payload["_trace_id"] = trace_id
    LOGGER.info(
        "Benefit claim request trace_id=%s session_token=%s draw_id=%s reward_code=%s mobile=%s channel=%s",
        trace_id,
        _mask_token(request.session_token),
        request.draw_id,
        request.reward_code,
        _mask_mobile(request.mobile),
        request.claim_channel,
    )
    try:
        result = claim_benefit(payload)
        LOGGER.info(
            "Benefit claim success trace_id=%s claim_no=%s reward_code=%s coupon_issue_status=%s external_coupon_id=%s",
            trace_id,
            result.get("claim_no") or result.get("claimNo"),
            result.get("reward", {}).get("reward_code") if isinstance(result.get("reward"), dict) else request.reward_code,
            result.get("coupon_issue_status") or result.get("couponIssueStatus"),
            result.get("external_coupon_id") or result.get("externalCouponId"),
        )
        return result
    except ApiError as error:
        LOGGER.warning(
            "Benefit claim failed trace_id=%s status_code=%s message=%s session_token=%s draw_id=%s reward_code=%s mobile=%s",
            trace_id,
            error.status_code,
            error.message,
            _mask_token(request.session_token),
            request.draw_id,
            request.reward_code,
            _mask_mobile(request.mobile),
        )
        if error.status_code >= 500 or getattr(error, "error_code", None) or getattr(error, "extra", None):
            content = {"success": False, "message": error.message, "detail": error.message}
            if getattr(error, "error_code", None):
                content["error_code"] = error.error_code
            if getattr(error, "extra", None):
                content.update(error.extra)
            return JSONResponse(
                status_code=error.status_code,
                content=content,
            )
        _handle_api_error(error)


@app.post("/api/benefit/randomize")
def benefit_randomize(request: BenefitRandomizeRequest):
    try:
        return randomize_benefit(request.model_dump())
    except ApiError as error:
        _handle_api_error(error)


@app.get("/api/benefit/claim/result")
def benefit_claim_result(session_token: str = Query(...), claim_no: str = Query(...)):
    try:
        return get_claim_result(session_token, claim_no)
    except ApiError as error:
        _handle_api_error(error)


@app.get("/api/benefit/claim/resolve")
def benefit_claim_resolve(claim_token: str = Query(...)):
    try:
        return resolve_claim_by_token(claim_token)
    except ApiError as error:
        _handle_api_error(error)


@app.post("/api/share/record")
def share_record(request: ShareRecordRequest):
    try:
        return record_share(request.model_dump())
    except ApiError as error:
        _handle_api_error(error)


@app.get("/api/reward/center/detail")
def reward_center_detail(session_token: str = Query(...)):
    try:
        return get_reward_center(session_token)
    except ApiError as error:
        _handle_api_error(error)


@app.get("/api/grand-prize/qualification/detail")
def grand_prize_qualification_detail(session_token: str = Query(...)):
    try:
        return get_grand_prize_detail(session_token)
    except ApiError as error:
        _handle_api_error(error)


@app.get("/api/admin/grand-prize/draw-config", dependencies=[Depends(require_admin_token)])
def admin_grand_prize_draw_config(activity_code: str = Query(DEFAULT_ACTIVITY_CODE)):
    try:
        return get_grand_prize_draw_config(activity_code)
    except ApiError as error:
        _handle_api_error(error)


@app.post("/api/admin/grand-prize/draw-config", dependencies=[Depends(require_admin_token)])
def admin_grand_prize_draw_config_save(request: GrandPrizeDrawConfigRequest):
    try:
        return save_grand_prize_draw_config(request.model_dump())
    except ApiError as error:
        _handle_api_error(error)


@app.get("/api/activity/rules/detail")
def activity_rules_detail(activity_code: str = Query(DEFAULT_ACTIVITY_CODE)):
    try:
        return get_rules_detail(activity_code)
    except ApiError as error:
        _handle_api_error(error)


@app.post("/api/tracking/event")
def tracking_event(request: TrackingEventRequest):
    try:
        return record_tracking_event(request.model_dump())
    except ApiError as error:
        _handle_api_error(error)


@app.post("/api/poster/save")
def poster_save(request: PosterSaveRequest):
    try:
        return save_poster(request.model_dump())
    except ApiError as error:
        _handle_api_error(error)


@app.get("/api/poster/image/{poster_id}")
def poster_image(poster_id: str):
    poster_path = resolve_poster_path(poster_id)
    if poster_path is None:
        raise HTTPException(status_code=404, detail="poster not found")

    return FileResponse(poster_path, media_type="image/png")
