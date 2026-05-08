from datetime import datetime

from dataclasses import dataclass
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
                self._settings = AppSettings(**saved)

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
                "last_successful_sync_at": self._settings.last_successful_sync_at,
                "last_successful_sync_date": self._settings.last_successful_sync_date,
            }
        )
