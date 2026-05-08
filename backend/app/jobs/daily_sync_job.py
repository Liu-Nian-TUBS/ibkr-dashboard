from collections.abc import Callable
from datetime import date
from datetime import timedelta


def build_auto_backfill_plan(
    *,
    last_successful_sync_date: date | None,
    today: date,
    max_missed_days: int = 7,
) -> list[date]:
    if last_successful_sync_date is None:
        return []
    if max_missed_days <= 0:
        return []

    first_missing = last_successful_sync_date + timedelta(days=1)
    last_missing = today - timedelta(days=1)
    if first_missing > last_missing:
        return []

    planned: list[date] = []
    current = first_missing
    while current <= last_missing and len(planned) < max_missed_days:
        planned.append(current)
        current += timedelta(days=1)
    return planned


def run_daily_sync_with_retry(
    fetcher: Callable[[], dict[str, str]],
    *,
    max_attempts: int = 3,
    base_delay_seconds: float = 1.0,
    sleeper: Callable[[float], object] | None = None,
) -> dict[str, str]:
    if max_attempts <= 0:
        raise ValueError("max_attempts must be greater than 0")
    if base_delay_seconds < 0:
        raise ValueError("base_delay_seconds must be non-negative")

    sleep_fn = sleeper or (lambda _: None)
    last_error: Exception | None = None
    for attempt in range(max_attempts):
        try:
            return fetcher()
        except Exception as exc:  # pragma: no cover - retry path asserted in tests
            last_error = exc
            should_retry = attempt < max_attempts - 1
            if should_retry:
                delay = base_delay_seconds * (2**attempt)
                sleep_fn(delay)
    if last_error is not None:
        raise last_error
    raise RuntimeError("daily sync failed without exception")


def run_daily_sync() -> dict[str, str]:
    return {"status": "scheduled"}
