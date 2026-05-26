import logging
from threading import Thread

from fastapi import APIRouter

from app.api.portfolio_analysis_contracts import PortfolioAnalysisResponse
from app.api.portfolio_analysis_contracts import PortfolioAnalysisSectionKey
from app.api.response_models import STORAGE_UNAVAILABLE_OPENAPI_RESPONSE
from app.repositories.raw_repository import RawRepository
from app.services.ai_narrative_service import AINarrativeService
from app.services.industry_mapping_service import IndustryMappingService
from app.services.market_data_provider import build_market_data_provider
from app.services.portfolio_analysis_service import PortfolioAnalysisService
from app.services.quote_service import QuoteService
from app.services.settings_service import SettingsService


router = APIRouter()
logger = logging.getLogger(__name__)
_settings_service: SettingsService = SettingsService()
_raw_repository: RawRepository | object | None = None
_quote_service: QuoteService | None = None
_industry_mapping_service: IndustryMappingService | None = None
_ai_narrative_service = AINarrativeService()


def set_settings_service(service: SettingsService) -> None:
    global _settings_service
    _settings_service = service


def set_raw_repository(repository: RawRepository | object | None) -> None:
    global _raw_repository
    _raw_repository = repository


def set_quote_service(service: QuoteService | None) -> None:
    global _quote_service
    _quote_service = service


def set_industry_mapping_service(service: IndustryMappingService | None) -> None:
    global _industry_mapping_service
    _industry_mapping_service = service


@router.get(
    "/api/portfolio-analysis",
    response_model=PortfolioAnalysisResponse,
    responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE,
)
def get_portfolio_analysis(
    section: PortfolioAnalysisSectionKey | None = None,
    symbol: str | None = None,
    refresh_ai: bool = False,
) -> PortfolioAnalysisResponse:
    service = _build_service()
    return service.get_analysis(section=section, symbol=symbol, refresh_ai=refresh_ai)


@router.post("/api/portfolio-analysis/narrative/refresh")
def refresh_portfolio_analysis_narrative(
    section: PortfolioAnalysisSectionKey,
    symbol: str | None = None,
) -> dict[str, object]:
    normalized_symbol = symbol.upper() if symbol else None
    service = _build_service()
    resolved_symbol = (
        None
        if section == PortfolioAnalysisSectionKey.PORTFOLIO
        else service.mark_narrative_refresh_started(section=section, symbol=normalized_symbol)
    )
    Thread(target=_refresh_narrative_task, args=(section, resolved_symbol), daemon=True).start()
    return {
        "status": "accepted",
        "section": section.value,
        "symbol": resolved_symbol,
        "message": "ai_narrative_refresh_started",
    }


def _build_service() -> PortfolioAnalysisService:
    settings = _settings_service.get()
    provider = build_market_data_provider(settings, _quote_service)
    return PortfolioAnalysisService(
        raw_repository=_raw_repository,
        settings_service=_settings_service,
        market_data_provider=provider,
        industry_mapping_service=_industry_mapping_service,
        ai_narrative_service=_ai_narrative_service,
    )


def _refresh_narrative_task(section: PortfolioAnalysisSectionKey, symbol: str | None) -> None:
    try:
        _build_service().get_analysis(section=section, symbol=symbol, refresh_ai=True)
    except Exception as exc:  # pragma: no cover - background diagnostics only
        logger.warning("portfolio_analysis_narrative_refresh_failed: %s", exc)
