from collections.abc import Callable

from fastapi import APIRouter
from fastapi import HTTPException
from pydantic import BaseModel

from app.api.response_models import STORAGE_UNAVAILABLE_OPENAPI_RESPONSE
from app.services.flex_client import FlexStatementClient
from app.repositories.raw_repository import RawRepository
from app.services.quote_service import QuoteService
from app.services.quote_service import fetch_finnhub_quote
from app.services.settings_service import SettingsService

router = APIRouter()
settings_service = SettingsService()
raw_repository: RawRepository | object | None = None
quote_service: QuoteService | None = None
daily_sync_runner: Callable[[str, str], dict[str, str]] | None = None
pull_frequency_update_handler: Callable[[int], None] | None = None


class SettingsUpdateRequest(BaseModel):
    base_currency: str | None = None
    timezone: str | None = None
    finnhub_api_key: str | None = None
    flex_token: str | None = None
    flex_query_id: str | None = None
    pull_frequency_minutes: int | None = None
    display_realtime_prices: bool | None = None


class RevealApiKeyRequest(BaseModel):
    confirm: bool


class FinnhubConnectionTestRequest(BaseModel):
    api_key: str | None = None
    symbol: str | None = None


def set_settings_service(service: SettingsService) -> None:
    global settings_service
    settings_service = service


def set_raw_repository(repository: object | None) -> None:
    global raw_repository
    raw_repository = repository


def set_quote_service(service: QuoteService | None) -> None:
    global quote_service
    quote_service = service


def set_daily_sync_runner(runner: Callable[[str, str], dict[str, str]]) -> None:
    global daily_sync_runner
    daily_sync_runner = runner


def set_pull_frequency_update_handler(handler: Callable[[int], None]) -> None:
    global pull_frequency_update_handler
    pull_frequency_update_handler = handler


def _default_daily_sync_runner(token: str, query_id: str) -> dict[str, str]:
    flex_client = FlexStatementClient()
    statement_xml = flex_client.fetch_statement_xml(token=token, query_id=query_id)
    return {"status": "synced", "statement_size": str(len(statement_xml))}


@router.get("/api/settings", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def get_settings() -> dict[str, str | int | bool | None]:
    settings = settings_service.get()
    return {
        "base_currency": settings.base_currency,
        "timezone": settings.timezone,
        "finnhub_api_key": _mask_secret(settings.finnhub_api_key),
        "flex_token": _mask_secret(settings.flex_token),
        "flex_query_id": settings.flex_query_id,
        "pull_frequency_minutes": settings.pull_frequency_minutes,
        "display_realtime_prices": settings.display_realtime_prices,
        "last_successful_sync_at": settings.last_successful_sync_at,
        "last_successful_sync_date": settings.last_successful_sync_date,
    }


@router.put("/api/settings", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def update_settings(payload: SettingsUpdateRequest) -> dict[str, str | int | bool | None]:
    if payload.pull_frequency_minutes is not None and payload.pull_frequency_minutes <= 0:
        raise HTTPException(
            status_code=400,
            detail="pull_frequency_minutes must be greater than 0",
        )
    settings = settings_service.update(
        base_currency=payload.base_currency,
        timezone=payload.timezone,
        finnhub_api_key=payload.finnhub_api_key,
        flex_token=payload.flex_token,
        flex_query_id=payload.flex_query_id,
        pull_frequency_minutes=payload.pull_frequency_minutes,
        display_realtime_prices=payload.display_realtime_prices,
    )
    if (
        payload.pull_frequency_minutes is not None
        and pull_frequency_update_handler is not None
    ):
        pull_frequency_update_handler(settings.pull_frequency_minutes)
    return {
        "base_currency": settings.base_currency,
        "timezone": settings.timezone,
        "finnhub_api_key": _mask_secret(settings.finnhub_api_key),
        "flex_token": _mask_secret(settings.flex_token),
        "flex_query_id": settings.flex_query_id,
        "pull_frequency_minutes": settings.pull_frequency_minutes,
        "display_realtime_prices": settings.display_realtime_prices,
        "last_successful_sync_at": settings.last_successful_sync_at,
        "last_successful_sync_date": settings.last_successful_sync_date,
    }


@router.post("/api/settings/reveal-finnhub-key", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def reveal_finnhub_api_key(payload: RevealApiKeyRequest) -> dict[str, str]:
    if payload.confirm is not True:
        return {"finnhub_api_key": ""}
    settings = settings_service.get()
    return {"finnhub_api_key": settings.finnhub_api_key}


@router.post("/api/settings/reveal-flex-token", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def reveal_flex_token(payload: RevealApiKeyRequest) -> dict[str, str]:
    if payload.confirm is not True:
        return {"flex_token": ""}
    settings = settings_service.get()
    return {"flex_token": settings.flex_token}


@router.post("/api/settings/daily-sync/run", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def run_daily_sync() -> dict[str, object]:
    settings = settings_service.get()
    if not settings.flex_token or not settings.flex_query_id:
        raise HTTPException(
            status_code=400,
            detail="flex_token and flex_query_id must be configured before daily sync",
        )
    runner = daily_sync_runner or _default_daily_sync_runner
    try:
        result = runner(settings.flex_token, settings.flex_query_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"daily_sync_failed: {exc}") from exc
    return {
        "status": "accepted",
        "result": result,
        "request": {
            "flex_query_id": settings.flex_query_id,
        },
        "links": {
            "settings_url": "/api/settings",
        },
    }


@router.post(
    "/api/settings/data-sources/finnhub/test",
    responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE,
)
def test_finnhub_connection(payload: FinnhubConnectionTestRequest) -> dict[str, object]:
    symbol = (payload.symbol or "AAPL").upper()
    api_key = payload.api_key if payload.api_key is not None else settings_service.get().finnhub_api_key
    if not api_key:
        return {"ok": False, "symbol": symbol, "message": "missing_api_key"}
    price = fetch_finnhub_quote(symbol=symbol, api_key=api_key)
    if price is None:
        return {
            "ok": False,
            "symbol": symbol,
            "message": "finnhub_unreachable_or_invalid_key",
        }
    return {"ok": True, "symbol": symbol, "price": price, "message": "connected"}


@router.post(
    "/api/settings/data-sources/ibkr/test",
    responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE,
)
def test_ibkr_connection() -> dict[str, object]:
    settings = settings_service.get()
    if not settings.flex_token or not settings.flex_query_id:
        return {"ok": False, "message": "missing_flex_credentials"}
    try:
        flex_client = FlexStatementClient()
        reference_code = flex_client.request_reference_code(
            token=settings.flex_token,
            query_id=settings.flex_query_id,
        )
        return {"ok": True, "reference_code": reference_code, "message": "connected"}
    except Exception as exc:
        return {"ok": False, "message": str(exc)}


@router.post(
    "/api/settings/data-sources/quotes/refresh",
    responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE,
)
def refresh_quotes_now() -> dict[str, object]:
    if raw_repository is None or quote_service is None:
        raise HTTPException(status_code=503, detail="quote refresh service unavailable")
    latest = raw_repository.get_latest_account_snapshot()
    if latest is None:
        return {"status": "no_data", "symbols": [], "result": {"total": 0, "refreshed": 0, "failed": 0}}
    account_id = str(latest.get("account_id", "") or "")
    report_date = str(latest.get("report_date", "") or "")
    positions = raw_repository.es.search(
        index="ibkr_position_snapshots_v1",
        size=10000,
        term_filters={"account_id": account_id, "report_date": report_date} if account_id and report_date else None,
    )
    symbols = sorted(
        {
            str(row.get("symbol", "") or "")
            for row in positions
            if str(row.get("symbol", "") or "")
        }
    )
    result = quote_service.refresh_quotes(symbols)
    return {"status": "ok", "symbols": symbols, "result": result}


def _mask_secret(secret: str) -> str:
    if not secret:
        return ""
    if len(secret) <= 4:
        return "*" * len(secret)
    visible = 2
    middle = len(secret) - (visible * 2)
    return f"{secret[:visible]}{'*' * middle}{secret[-visible:]}"
