from datetime import datetime

from dataclasses import dataclass, field, fields
from typing import Protocol


@dataclass(slots=True)
class AppSettings:
    base_currency: str = "USD"
    timezone: str = "America/New_York"
    finnhub_api_key: str = ""
    flex_token: str = ""
    flex_query_id: str = ""
    pull_frequency_minutes: int = 60
    display_realtime_prices: bool = False
    ai_provider: str = "openai"
    ai_model: str = ""
    openai_api_key: str = ""
    minimax_api_key: str = ""
    minimax_base_url: str = "https://api.minimaxi.com/v1"
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    futu_connection_mode: str = "disabled"
    futu_opend_host: str = "127.0.0.1"
    futu_opend_port: int = 11111
    telegram_bot_token: str = ""
    telegram_allowlisted_chat_ids: list[str] = field(default_factory=list)
    telegram_reports_enabled: bool = False
    telegram_daily_report_time: str = "08:30"
    mcp_server_enabled: bool = False
    report_cache_enabled: bool = True
    report_cache_ttl_minutes: int = 60
    last_successful_sync_at: str | None = None
    last_successful_sync_date: str | None = None


class SettingsRepositoryLike(Protocol):
    def get_settings(self) -> dict | None: ...
    def upsert_settings(self, doc: dict) -> None: ...


class SettingsService:
    def __init__(self, repository: SettingsRepositoryLike | None = None) -> None:
        self._repository = repository
        self._settings = AppSettings()
        if self._repository is not None:
            saved = self._repository.get_settings()
            if saved is not None:
                self._settings = _coerce_settings(saved)

    def get(self) -> AppSettings:
        return self._settings

    def update(
        self,
        *,
        base_currency: str | None = None,
        timezone: str | None = None,
        finnhub_api_key: str | None = None,
        flex_token: str | None = None,
        flex_query_id: str | None = None,
        pull_frequency_minutes: int | None = None,
        display_realtime_prices: bool | None = None,
        ai_provider: str | None = None,
        ai_model: str | None = None,
        openai_api_key: str | None = None,
        minimax_api_key: str | None = None,
        minimax_base_url: str | None = None,
        deepseek_api_key: str | None = None,
        deepseek_base_url: str | None = None,
        futu_connection_mode: str | None = None,
        futu_opend_host: str | None = None,
        futu_opend_port: int | None = None,
        telegram_bot_token: str | None = None,
        telegram_allowlisted_chat_ids: list[str] | None = None,
        telegram_reports_enabled: bool | None = None,
        telegram_daily_report_time: str | None = None,
        mcp_server_enabled: bool | None = None,
        report_cache_enabled: bool | None = None,
        report_cache_ttl_minutes: int | None = None,
        last_successful_sync_at: str | None = None,
        last_successful_sync_date: str | None = None,
    ) -> AppSettings:
        if base_currency is not None:
            self._settings.base_currency = base_currency
        if timezone is not None:
            self._settings.timezone = timezone
        if finnhub_api_key is not None:
            self._settings.finnhub_api_key = finnhub_api_key
        if flex_token is not None:
            self._settings.flex_token = flex_token
        if flex_query_id is not None:
            self._settings.flex_query_id = flex_query_id
        if pull_frequency_minutes is not None:
            self._settings.pull_frequency_minutes = pull_frequency_minutes
        if display_realtime_prices is not None:
            self._settings.display_realtime_prices = display_realtime_prices
        if ai_provider is not None:
            self._settings.ai_provider = ai_provider
        if ai_model is not None:
            self._settings.ai_model = ai_model
        if openai_api_key is not None:
            self._settings.openai_api_key = openai_api_key
        if minimax_api_key is not None:
            self._settings.minimax_api_key = minimax_api_key
        if minimax_base_url is not None:
            self._settings.minimax_base_url = minimax_base_url
        if deepseek_api_key is not None:
            self._settings.deepseek_api_key = deepseek_api_key
        if deepseek_base_url is not None:
            self._settings.deepseek_base_url = deepseek_base_url
        if futu_connection_mode is not None:
            self._settings.futu_connection_mode = futu_connection_mode
        if futu_opend_host is not None:
            self._settings.futu_opend_host = futu_opend_host
        if futu_opend_port is not None:
            self._settings.futu_opend_port = futu_opend_port
        if telegram_bot_token is not None:
            self._settings.telegram_bot_token = telegram_bot_token
        if telegram_allowlisted_chat_ids is not None:
            self._settings.telegram_allowlisted_chat_ids = list(telegram_allowlisted_chat_ids)
        if telegram_reports_enabled is not None:
            self._settings.telegram_reports_enabled = telegram_reports_enabled
        if telegram_daily_report_time is not None:
            self._settings.telegram_daily_report_time = telegram_daily_report_time
        if mcp_server_enabled is not None:
            self._settings.mcp_server_enabled = mcp_server_enabled
        if report_cache_enabled is not None:
            self._settings.report_cache_enabled = report_cache_enabled
        if report_cache_ttl_minutes is not None:
            self._settings.report_cache_ttl_minutes = report_cache_ttl_minutes
        if last_successful_sync_at is not None:
            self._settings.last_successful_sync_at = last_successful_sync_at
        if last_successful_sync_date is not None:
            self._settings.last_successful_sync_date = last_successful_sync_date
        self._persist()
        return self._settings

    def mark_sync_success(self, synced_at: str) -> AppSettings:
        synced_date = datetime.fromisoformat(synced_at).date().isoformat()
        self._settings.last_successful_sync_at = synced_at
        self._settings.last_successful_sync_date = synced_date
        self._persist()
        return self._settings

    def _persist(self) -> None:
        if self._repository is None:
            return
        self._repository.upsert_settings(
            {
                "base_currency": self._settings.base_currency,
                "timezone": self._settings.timezone,
                "finnhub_api_key": self._settings.finnhub_api_key,
                "flex_token": self._settings.flex_token,
                "flex_query_id": self._settings.flex_query_id,
                "pull_frequency_minutes": self._settings.pull_frequency_minutes,
                "display_realtime_prices": self._settings.display_realtime_prices,
                "ai_provider": self._settings.ai_provider,
                "ai_model": self._settings.ai_model,
                "openai_api_key": self._settings.openai_api_key,
                "minimax_api_key": self._settings.minimax_api_key,
                "minimax_base_url": self._settings.minimax_base_url,
                "deepseek_api_key": self._settings.deepseek_api_key,
                "deepseek_base_url": self._settings.deepseek_base_url,
                "futu_connection_mode": self._settings.futu_connection_mode,
                "futu_opend_host": self._settings.futu_opend_host,
                "futu_opend_port": self._settings.futu_opend_port,
                "telegram_bot_token": self._settings.telegram_bot_token,
                "telegram_allowlisted_chat_ids": list(self._settings.telegram_allowlisted_chat_ids),
                "telegram_reports_enabled": self._settings.telegram_reports_enabled,
                "telegram_daily_report_time": self._settings.telegram_daily_report_time,
                "mcp_server_enabled": self._settings.mcp_server_enabled,
                "report_cache_enabled": self._settings.report_cache_enabled,
                "report_cache_ttl_minutes": self._settings.report_cache_ttl_minutes,
                "last_successful_sync_at": self._settings.last_successful_sync_at,
                "last_successful_sync_date": self._settings.last_successful_sync_date,
            }
        )


def _coerce_settings(saved: dict) -> AppSettings:
    known_fields = {field.name for field in fields(AppSettings)}
    doc = {key: value for key, value in saved.items() if key in known_fields}
    chat_ids = doc.get("telegram_allowlisted_chat_ids")
    if chat_ids is None:
        doc["telegram_allowlisted_chat_ids"] = []
    elif isinstance(chat_ids, list):
        doc["telegram_allowlisted_chat_ids"] = [str(value) for value in chat_ids]
    else:
        doc["telegram_allowlisted_chat_ids"] = [str(chat_ids)]
    return AppSettings(**doc)
