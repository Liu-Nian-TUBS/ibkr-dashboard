from pydantic import BaseModel
from fastapi import APIRouter

from app.api.response_models import STORAGE_UNAVAILABLE_OPENAPI_RESPONSE
from app.services.market_data_provider import FutuOpenDReadOnlyProvider
from app.services.market_data_provider import LongbridgeReadOnlyProvider
from app.services.market_data_provider import QuoteFallbackMarketDataProvider
from app.services.portfolio_analysis_service import PortfolioAnalysisService
from app.services.quote_service import QuoteService
from app.services.settings_service import SettingsService
from app.services.telegram_service import TelegramCommandService


router = APIRouter()
_settings_service: SettingsService = SettingsService()
_raw_repository: object | None = None
_quote_service: QuoteService | None = None


class TelegramDryRunRequest(BaseModel):
    chat_id: str
    text: str


def set_settings_service(service: SettingsService) -> None:
    global _settings_service
    _settings_service = service


def set_raw_repository(repository: object | None) -> None:
    global _raw_repository
    _raw_repository = repository


def set_quote_service(service: QuoteService | None) -> None:
    global _quote_service
    _quote_service = service


@router.post("/api/telegram/commands/dry-run", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def dry_run_telegram_command(payload: TelegramDryRunRequest) -> dict[str, object]:
    service = _telegram_command_service()
    return service.handle_command(chat_id=payload.chat_id, text=payload.text)


@router.post("/api/telegram/reports/dry-run", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def dry_run_telegram_report() -> dict[str, object]:
    settings = _settings_service.get()
    service = _telegram_command_service()
    message, status = service.build_daily_report_message()
    return {
        "ok": bool(settings.telegram_reports_enabled and settings.telegram_allowlisted_chat_ids),
        "status": status,
        "message": message,
        "would_send_to": len(settings.telegram_allowlisted_chat_ids),
        "schedule": settings.telegram_daily_report_time if settings.telegram_reports_enabled else None,
    }


def _telegram_command_service() -> TelegramCommandService:
    settings = _settings_service.get()
    if settings.futu_connection_mode == "local_opend":
        provider = FutuOpenDReadOnlyProvider(host=settings.futu_opend_host, port=settings.futu_opend_port)
    elif settings.futu_connection_mode == "longbridge":
        provider = LongbridgeReadOnlyProvider()
    else:
        provider = QuoteFallbackMarketDataProvider(_quote_service)
    analysis_service = PortfolioAnalysisService(
        raw_repository=_raw_repository,
        settings_service=_settings_service,
        market_data_provider=provider,
    )
    return TelegramCommandService(
        settings_service=_settings_service,
        analysis_service=analysis_service,
        raw_repository=_raw_repository,
        market_data_provider=provider,
    )
