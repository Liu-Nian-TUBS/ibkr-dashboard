from app.core.config import load_settings
from app.repositories.derived_repository import DerivedRepository
from app.repositories.es_client import ElasticsearchLike
from app.repositories.http_es_client import HttpElasticsearchClient
from app.repositories.in_memory_es import InMemoryElasticsearchClient
from app.repositories.raw_repository import RawRepository
from app.repositories.settings_repository import SettingsRepository
from app.services.mcp_tools import ReadOnlyMCPTools
from app.services.quote_service import QuoteService
from app.services.quote_service import fetch_finnhub_quote
from app.services.quote_service import fetch_longbridge_quote
from app.services.quote_service import fetch_yahoo_quote
from app.services.settings_service import SettingsService


MCP_REQUIRED_INDEXES = [
    "ibkr_account_snapshots_v1",
    "ibkr_position_snapshots_v1",
    "ibkr_trade_records_v1",
    "ibkr_cash_transactions_v1",
    "ibkr_stmt_funds_lines_v1",
    "ibkr_fx_rates_v1",
    "portfolio_returns_v1",
    "reconciliation_results_v1",
    "app_settings_v1",
    "symbol_industry_overrides_v1",
    "portfolio_ai_analysis_cache_v1",
]


def build_mcp_tools() -> ReadOnlyMCPTools:
    settings = load_settings()
    es_client = _build_es_client(settings)
    _initialize_storage(es_client)
    raw_repository = RawRepository(es_client=es_client)
    derived_repository = DerivedRepository(es_client=es_client)
    settings_service = SettingsService(repository=SettingsRepository(es_client=es_client))
    quote_service = _build_quote_service(raw_repository, settings_service)
    return ReadOnlyMCPTools(
        raw_repository=raw_repository,
        derived_repository=derived_repository,
        settings_service=settings_service,
        quote_service=quote_service,
    )


def _build_es_client(settings: object) -> ElasticsearchLike:
    if getattr(settings, "es_backend", "") == "http":
        return HttpElasticsearchClient(
            base_url=getattr(settings, "es_base_url"),
            timeout_seconds=getattr(settings, "es_timeout_seconds"),
            api_key=getattr(settings, "es_api_key", "") or None,
            username=getattr(settings, "es_username", "") or None,
            password=getattr(settings, "es_password", "") or None,
            headers=getattr(settings, "es_extra_headers", None) or None,
        )
    return InMemoryElasticsearchClient()


def _initialize_storage(es_client: ElasticsearchLike) -> None:
    es_client.ping()
    for index in MCP_REQUIRED_INDEXES:
        es_client.ensure_index(index)


def _build_quote_service(
    raw_repository: RawRepository,
    settings_service: SettingsService,
) -> QuoteService:
    def secondary(symbol: str) -> float | None:
        api_key = settings_service.get().finnhub_api_key
        return fetch_finnhub_quote(symbol, api_key=api_key) or fetch_yahoo_quote(symbol)

    def snapshot(symbol: str) -> float:
        positions = raw_repository.list_positions(symbol=symbol, page=1, page_size=1)
        if positions:
            return float(positions[0].get("mark_price_snapshot", 0) or 0)
        return 0.0

    return QuoteService(
        primary_fetcher=fetch_longbridge_quote,
        secondary_fetcher=secondary,
        snapshot_fetcher=snapshot,
    )
