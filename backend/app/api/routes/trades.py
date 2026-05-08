from fastapi import APIRouter
from fastapi import HTTPException

from app.api.currency_conversion import normalize_currency_code
from app.api.response_models import STORAGE_UNAVAILABLE_OPENAPI_RESPONSE
from app.api.time_normalization import normalize_date_to_iso
from app.api.time_normalization import normalize_month_bucket
from app.repositories.raw_repository import RawRepository
from app.services.settings_service import SettingsService

router = APIRouter()
_raw_repository: RawRepository | object | None = None
_settings_service: SettingsService = SettingsService()


def set_raw_repository(repository: object | None) -> None:
    global _raw_repository
    _raw_repository = repository


def set_settings_service(service: SettingsService) -> None:
    global _settings_service
    _settings_service = service


@router.get("/api/trades", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def list_trades(
    symbol: str | None = None,
    side: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    normalized_side = side.upper() if side else None
    normalized_symbol = symbol.upper() if symbol else None
    if normalized_side is not None and normalized_side not in {"BUY", "SELL"}:
        raise HTTPException(status_code=400, detail="invalid_side")
    start_date_iso = normalize_date_to_iso(start_date) if start_date else None
    end_date_iso = normalize_date_to_iso(end_date) if end_date else None
    if start_date_iso is not None and end_date_iso is not None and start_date_iso > end_date_iso:
        raise HTTPException(status_code=400, detail="invalid_date_range")
    normalized_page = max(page, 1)
    normalized_page_size = max(min(page_size, 100), 1)
    if _raw_repository is None:
        display_currency = _resolve_trade_display_currency([])
        return {
            "filters": {
                "symbol": normalized_symbol,
                "side": normalized_side,
                "start_date": start_date,
                "end_date": end_date,
                "page": normalized_page,
                "page_size": normalized_page_size,
            },
            "items": [],
            "total": 0,
            "display_currency": display_currency,
            "summary": {
                "trade_count": 0,
                "buy_count": 0,
                "sell_count": 0,
                "notional_abs_sum": 0.0,
                "notional_net_sum": 0.0,
                "commission_sum": 0.0,
                "commission_abs_sum": 0.0,
                "realized_pnl_sum": 0.0,
                "notional_by_currency": {},
                "has_mixed_currencies": False,
                "currency_count": 0,
            },
            "monthly_stats": [],
        }
    filters: dict[str, str] = {}
    if normalized_symbol:
        filters["symbol"] = normalized_symbol
    if normalized_side:
        filters["side"] = normalized_side
    scoped_account_id = _resolve_default_account_id()
    if scoped_account_id:
        filters["account_id"] = scoped_account_id
    candidates = _raw_repository.es.search(
        index="ibkr_trade_records_v1",
        size=2000,
        term_filters=filters or None,
    )
    all_filtered = []
    for item in candidates:
        trade_date_iso = normalize_date_to_iso(item.get("trade_date"))
        if start_date_iso and trade_date_iso and trade_date_iso < start_date_iso:
            continue
        if end_date_iso and trade_date_iso and trade_date_iso > end_date_iso:
            continue
        enriched = _enrich_trade_item(item)
        enriched["trade_date_iso"] = trade_date_iso
        all_filtered.append(enriched)
    all_filtered.sort(
        key=lambda item: (
            str(item.get("trade_date_iso", "") or ""),
            str(item.get("trade_id", item.get("transaction_id", "")) or ""),
        ),
        reverse=True,
    )
    offset = (normalized_page - 1) * normalized_page_size
    normalized_items = all_filtered[offset : offset + normalized_page_size]
    summary = _build_trades_summary(all_filtered)
    display_currency = _resolve_trade_display_currency(all_filtered)
    monthly_stats = _build_monthly_trade_stats(
        all_filtered,
        timezone_name=_settings_service.get().timezone,
    )
    return {
        "filters": {
            "symbol": normalized_symbol,
            "side": normalized_side,
            "start_date": start_date,
            "end_date": end_date,
            "page": normalized_page,
            "page_size": normalized_page_size,
        },
        "items": normalized_items,
        "total": len(all_filtered),
        "display_currency": display_currency,
        "summary": summary,
        "monthly_stats": monthly_stats,
    }


def _build_trades_summary(trades: list[dict]) -> dict:
    buy_count = 0
    sell_count = 0
    notional_abs_sum = 0.0
    notional_net_sum = 0.0
    commission_sum = 0.0
    commission_abs_sum = 0.0
    realized_pnl_sum = 0.0
    notional_by_currency: dict[str, dict[str, float | int]] = {}
    for trade in trades:
        side = str(trade.get("side", "")).upper()
        notional = float(trade.get("notional_abs", trade.get("notional", 0)) or 0)
        signed = float(trade.get("notional_signed", 0) or 0)
        currency = str(trade.get("notional_currency", trade.get("currency", "")) or "UNKNOWN")
        commission = float(trade.get("ib_commission", 0) or 0)
        realized_pnl = float(trade.get("fifo_pnl_realized", 0) or 0)
        if side == "BUY":
            buy_count += 1
        elif side == "SELL":
            sell_count += 1
        notional_abs_sum += abs(notional)
        notional_net_sum += signed
        commission_sum += commission
        commission_abs_sum += abs(commission)
        realized_pnl_sum += realized_pnl
        if currency not in notional_by_currency:
            notional_by_currency[currency] = {
                "notional_abs_sum": 0.0,
                "notional_net_sum": 0.0,
                "commission_sum": 0.0,
                "commission_abs_sum": 0.0,
                "realized_pnl_sum": 0.0,
                "count": 0,
            }
        notional_by_currency[currency]["notional_abs_sum"] = float(notional_by_currency[currency]["notional_abs_sum"]) + abs(notional)
        notional_by_currency[currency]["notional_net_sum"] = float(notional_by_currency[currency]["notional_net_sum"]) + signed
        notional_by_currency[currency]["commission_sum"] = float(notional_by_currency[currency]["commission_sum"]) + commission
        notional_by_currency[currency]["commission_abs_sum"] = float(notional_by_currency[currency]["commission_abs_sum"]) + abs(commission)
        notional_by_currency[currency]["realized_pnl_sum"] = float(notional_by_currency[currency]["realized_pnl_sum"]) + realized_pnl
        notional_by_currency[currency]["count"] = int(notional_by_currency[currency]["count"]) + 1
    has_mixed_currencies = len(notional_by_currency) > 1
    return {
        "trade_count": len(trades),
        "buy_count": buy_count,
        "sell_count": sell_count,
        "notional_abs_sum": notional_abs_sum,
        "notional_net_sum": notional_net_sum,
        "commission_sum": commission_sum,
        "commission_abs_sum": commission_abs_sum,
        "realized_pnl_sum": realized_pnl_sum,
        "notional_by_currency": notional_by_currency,
        "has_mixed_currencies": has_mixed_currencies,
        "currency_count": len(notional_by_currency),
    }


def _build_monthly_trade_stats(trades: list[dict], *, timezone_name: str) -> list[dict]:
    grouped: dict[str, dict[str, float | int]] = {}
    for trade in trades:
        month = normalize_month_bucket(trade.get("trade_date"), timezone_name=timezone_name)
        if not month:
            continue
        qty = float(trade.get("quantity", 0) or 0)
        price = float(trade.get("trade_price", 0) or 0)
        notional = abs(qty * price)
        if month not in grouped:
            grouped[month] = {"month": month, "trade_count": 0, "notional_abs_sum": 0.0}
        grouped[month]["trade_count"] = int(grouped[month]["trade_count"]) + 1
        grouped[month]["notional_abs_sum"] = float(grouped[month]["notional_abs_sum"]) + notional
    rows = list(grouped.values())
    rows.sort(key=lambda row: str(row["month"]), reverse=True)
    return rows[:12]


def _enrich_trade_item(item: dict) -> dict:
    enriched = dict(item)
    quantity = float(item.get("quantity", 0) or 0)
    price = float(item.get("trade_price", 0) or 0)
    side = str(item.get("side", "") or "").upper()
    notional_abs = abs(quantity * price)
    if side == "BUY":
        notional_signed = -notional_abs
    elif side == "SELL":
        notional_signed = notional_abs
    else:
        notional_signed = quantity * price
    currency = str(item.get("currency", "") or "UNKNOWN")
    enriched["notional_abs"] = notional_abs
    enriched["notional_signed"] = notional_signed
    enriched["notional_currency"] = currency
    return enriched


def _resolve_trade_display_currency(trades: list[dict]) -> str:
    account_currency = _resolve_account_base_currency()
    currencies = {
        normalize_currency_code(trade.get("notional_currency", trade.get("currency")), "")
        for trade in trades
    }
    currencies.discard("")
    if len(currencies) == 1 and account_currency == "USD":
        return next(iter(currencies))
    return account_currency


def _resolve_account_base_currency() -> str:
    if _raw_repository is not None:
        try:
            latest = _raw_repository.get_latest_account_snapshot()
        except Exception:
            latest = None
        code = normalize_currency_code((latest or {}).get("base_currency"), "")
        if code:
            return code
    return "USD"


def _resolve_default_account_id() -> str | None:
    if _raw_repository is None:
        return None
    try:
        latest = _raw_repository.get_latest_account_snapshot()
    except Exception:
        return None
    account_id = str((latest or {}).get("account_id", "") or "")
    return account_id or None
