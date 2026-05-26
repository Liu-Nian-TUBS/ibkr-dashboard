from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.api.currency_conversion import normalize_currency_code
from app.api.response_models import STORAGE_UNAVAILABLE_OPENAPI_RESPONSE
from app.api.time_normalization import normalize_date_to_iso
from app.repositories.derived_repository import DerivedRepository
from app.repositories.raw_repository import RawRepository
from app.services.analytics_service import simple_return
from app.services.settings_service import SettingsService
from app.services.trade_aggregation import build_monthly_trade_stats as _aggregate_monthly_trade_stats
from app.utils.dates import compact_date as _compact_date
from app.utils.numbers import optional_float as _optional_float
from app.utils.numbers import to_float as _to_float

router = APIRouter()
_derived_store: dict[str, dict] = {}
_derived_repository: DerivedRepository | object | None = None
_raw_repository: RawRepository | object | None = None
_settings_service: SettingsService = SettingsService()


class PerformanceComputeRequest(BaseModel):
    account_id: str
    date: str
    range: str
    mode: str
    base_currency: str
    v_begin: float
    v_end: float
    net_cash_inflow: float


def set_derived_repository(repository: object | None) -> None:
    global _derived_repository
    _derived_repository = repository


def set_raw_repository(repository: object | None) -> None:
    global _raw_repository
    _raw_repository = repository


def set_settings_service(service: SettingsService) -> None:
    global _settings_service
    _settings_service = service


@router.get("/api/performance", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def get_performance(
    account_id: str | None = None,
    symbol: str | None = None,
    range: str | None = None,
    mode: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 100,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    normalized_start_date = _compact_date(start_date) or None
    normalized_end_date = _compact_date(end_date) or None
    if normalized_start_date is not None and normalized_end_date is not None and normalized_start_date > normalized_end_date:
        raise HTTPException(status_code=400, detail="invalid_date_range")
    normalized_limit = max(min(limit, 200), 1)
    normalized_page = max(page, 1)
    normalized_page_size = max(min(page_size, 100), 1)
    if _derived_repository is None:
        records = list(_derived_store.values())
    else:
        records = _derived_repository.list_portfolio_returns(size=normalized_limit)
    filtered = []
    for record in records:
        record_date = _compact_date(record.get("date"))
        if account_id and record.get("account_id") != account_id:
            continue
        if range and record.get("range") != range:
            continue
        if mode and record.get("mode") != mode:
            continue
        if normalized_start_date and record_date < normalized_start_date:
            continue
        if normalized_end_date and record_date > normalized_end_date:
            continue
        filtered.append(record)
    monthly = _build_monthly(filtered)
    leaderboard = _build_leaderboard(filtered)
    display_currency = _resolve_display_currency(filtered, account_id=account_id)
    valuation_mode = mode if mode in {"snapshot", "realtime"} else "mixed"
    display_calendar = [_with_display_currency(item, display_currency) for item in filtered]
    display_monthly = [{**item, "display_currency": display_currency} for item in monthly]
    display_leaderboard = [{**item, "display_currency": display_currency} for item in leaderboard]
    realized_details = _build_realized_details(
        account_id=account_id,
        symbol=symbol,
        start_date=normalized_start_date,
        end_date=normalized_end_date,
        page=normalized_page,
        page_size=normalized_page_size,
    )
    contribution_realized_details = _build_realized_details(
        account_id=account_id,
        symbol=symbol,
        start_date=None,
        end_date=None,
        page=1,
        page_size=10000,
    )
    pnl_leaderboard = _build_pnl_leaderboard(
        contribution_realized_details.get("all_items", []),
        _build_unrealized_items(account_id=account_id, symbol=symbol),
        trade_win_rate=contribution_realized_details.get("summary", {}).get("trade_win_rate"),
    )
    pnl_calendar = _build_pnl_calendar(
        account_id=account_id,
        start_date=normalized_start_date,
        end_date=normalized_end_date,
    )
    monthly_trade_stats = _build_monthly_trade_stats(
        account_id=account_id,
        start_date=normalized_start_date,
        end_date=normalized_end_date,
    )
    daily_trade_stats = _build_daily_trade_stats(
        account_id=account_id,
        start_date=normalized_start_date,
        end_date=normalized_end_date,
    )
    return {
        "filters": {
            "account_id": account_id,
            "symbol": symbol,
            "range": range,
            "mode": mode,
            "start_date": normalized_start_date,
            "end_date": normalized_end_date,
            "limit": normalized_limit,
            "page": normalized_page,
            "page_size": normalized_page_size,
        },
        "display_currency": display_currency,
        "valuation_mode": valuation_mode,
        "calendar": display_calendar,
        "monthly": display_monthly,
        "leaderboard": display_leaderboard,
        "pnl_calendar": pnl_calendar,
        "monthly_trade_stats": monthly_trade_stats,
        "daily_trade_stats": daily_trade_stats,
        "pnl_leaderboard": pnl_leaderboard,
        "realized_details": realized_details,
        "total": len(filtered),
    }


def _build_monthly(records: list[dict]) -> list[dict]:
    grouped: dict[str, list[float]] = {}
    for record in records:
        simple = record.get("simple_return")
        date = str(record.get("date", ""))
        if simple is None or len(date) < 6:
            continue
        month = date[:6]
        grouped.setdefault(month, []).append(float(simple))
    monthly = []
    for month, values in grouped.items():
        monthly.append(
            {
                "month": month,
                "avg_simple_return": sum(values) / len(values),
                "days": len(values),
            }
        )
    monthly.sort(key=lambda item: item["month"], reverse=True)
    return monthly[:12]


def _build_leaderboard(records: list[dict]) -> list[dict]:
    rows = [
        record
        for record in records
        if record.get("simple_return") is not None and record.get("account_id")
    ]
    rows.sort(key=lambda item: float(item.get("simple_return", 0)), reverse=True)
    return [
        {
            "account_id": item.get("account_id"),
            "date": item.get("date"),
            "simple_return": item.get("simple_return"),
        }
        for item in rows[:10]
    ]


def _with_display_currency(item: dict, fallback: str) -> dict:
    return {
        **item,
        "display_currency": normalize_currency_code(item.get("base_currency"), fallback),
    }


def _resolve_display_currency(records: list[dict], *, account_id: str | None) -> str:
    for record in records:
        code = normalize_currency_code(record.get("base_currency"), "")
        if code:
            return code
    if _raw_repository is not None:
        try:
            latest = _raw_repository.get_latest_account_snapshot()
        except Exception:
            latest = None
        latest_account_id = str((latest or {}).get("account_id", "") or "")
        if latest and (not account_id or latest_account_id == account_id):
            code = normalize_currency_code(latest.get("base_currency"), "")
            if code:
                return code
        try:
            rows = _raw_repository.es.search(
                index="ibkr_account_snapshots_v1",
                size=1,
                sort_field="report_date",
                descending=True,
                term_filters={"account_id": account_id} if account_id else None,
            )
        except Exception:
            rows = []
        for row in rows:
            code = normalize_currency_code(row.get("base_currency"), "")
            if code:
                return code
    return "USD"


def _build_realized_details(
    *,
    account_id: str | None,
    symbol: str | None,
    start_date: str | None,
    end_date: str | None,
    page: int,
    page_size: int,
) -> dict:
    if _raw_repository is None:
        return {
            "filters": {
                "account_id": account_id,
                "symbol": symbol,
                "start_date": start_date,
                "end_date": end_date,
                "page": page,
                "page_size": page_size,
            },
            "summary": {
                "realized_pnl_sum": 0.0,
                "commission_sum": 0.0,
                "trade_count": 0,
                "winning_symbols": 0,
                "losing_symbols": 0,
                "winning_trades": 0,
                "losing_trades": 0,
                "trade_win_rate": None,
            },
            "items": [],
            "total": 0,
        }

    term_filters: dict[str, str] = {}
    if account_id:
        term_filters["account_id"] = account_id
    if symbol:
        term_filters["symbol"] = symbol
    rows = _raw_repository.es.search(
        index="ibkr_trade_records_v1",
        size=10000,
        term_filters=term_filters or None,
    )

    grouped: dict[str, dict[str, float | int | str]] = {}
    realized_total = 0.0
    commission_total = 0.0
    trade_count = 0
    winning_trades = 0
    losing_trades = 0
    for row in rows:
        trade_date = _compact_date(row.get("trade_date"))
        if start_date and trade_date and trade_date < start_date:
            continue
        if end_date and trade_date and trade_date > end_date:
            continue
        sym = str(row.get("symbol", "") or "")
        if not sym:
            continue
        realized = float(row.get("fifo_pnl_realized", 0) or 0)
        commission = float(row.get("ib_commission", 0) or 0)
        bucket = grouped.setdefault(
            sym,
            {
                "symbol": sym,
                "realized_pnl": 0.0,
                "commission": 0.0,
                "trade_count": 0,
                "first_trade_date": trade_date,
                "last_trade_date": trade_date,
            },
        )
        bucket["realized_pnl"] = float(bucket["realized_pnl"]) + realized
        bucket["commission"] = float(bucket["commission"]) + commission
        bucket["trade_count"] = int(bucket["trade_count"]) + 1
        first_date = str(bucket["first_trade_date"] or "")
        last_date = str(bucket["last_trade_date"] or "")
        if trade_date and (not first_date or trade_date < first_date):
            bucket["first_trade_date"] = trade_date
        if trade_date and (not last_date or trade_date > last_date):
            bucket["last_trade_date"] = trade_date
        realized_total += realized
        commission_total += commission
        trade_count += 1
        if realized > 0:
            winning_trades += 1
        elif realized < 0:
            losing_trades += 1

    items = list(grouped.values())
    items.sort(key=lambda item: abs(float(item.get("realized_pnl", 0) or 0)), reverse=True)
    winning_symbols = sum(1 for item in items if float(item.get("realized_pnl", 0) or 0) > 0)
    losing_symbols = sum(1 for item in items if float(item.get("realized_pnl", 0) or 0) < 0)
    trade_denominator = winning_trades + losing_trades
    trade_win_rate = (winning_trades / trade_denominator) if trade_denominator > 0 else None
    offset = (page - 1) * page_size
    paged = items[offset : offset + page_size]
    return {
        "filters": {
            "account_id": account_id,
            "symbol": symbol,
            "start_date": start_date,
            "end_date": end_date,
            "page": page,
            "page_size": page_size,
        },
        "summary": {
            "realized_pnl_sum": round(realized_total, 6),
            "commission_sum": round(commission_total, 6),
            "trade_count": trade_count,
            "winning_symbols": winning_symbols,
            "losing_symbols": losing_symbols,
            "winning_trades": winning_trades,
            "losing_trades": losing_trades,
            "trade_win_rate": trade_win_rate,
        },
        "items": paged,
        "total": len(items),
        "all_items": items,
    }


def _build_unrealized_items(*, account_id: str | None, symbol: str | None) -> list[dict]:
    if _raw_repository is None:
        return []

    latest = _raw_repository.get_latest_account_snapshot()
    latest_account_id = str((latest or {}).get("account_id", "") or "")
    report_date = _compact_date((latest or {}).get("report_date"))
    scoped_account = account_id or latest_account_id or None
    term_filters: dict[str, str] = {}
    if scoped_account:
        term_filters["account_id"] = scoped_account
    if report_date:
        term_filters["report_date"] = report_date
    rows = _raw_repository.es.search(
        index="ibkr_position_snapshots_v1",
        size=10000,
        term_filters=term_filters or None,
    )
    if not rows:
        fallback_filters = {"account_id": scoped_account} if scoped_account else None
        candidates = _raw_repository.es.search(
            index="ibkr_position_snapshots_v1",
            size=10000,
            term_filters=fallback_filters,
        )
        latest_dates = sorted({_compact_date(row.get("report_date")) for row in candidates if _compact_date(row.get("report_date"))})
        latest_date = latest_dates[-1] if latest_dates else ""
        rows = [row for row in candidates if not latest_date or _compact_date(row.get("report_date")) == latest_date]

    summary_rows = [
        dict(row)
        for row in rows
        if str(row.get("level_of_detail", "") or "").upper() == "SUMMARY"
    ]
    selected_rows = summary_rows or rows
    grouped: dict[str, dict] = {}
    for row in selected_rows:
        sym = str(row.get("symbol", "") or "").upper()
        if not sym:
            continue
        if symbol and sym != symbol.upper():
            continue
        bucket = grouped.setdefault(
            sym,
            {
                "symbol": sym,
                "unrealized_pnl": 0.0,
                "quantity": 0.0,
                "market_value": 0.0,
            },
        )
        bucket["unrealized_pnl"] = float(bucket["unrealized_pnl"]) + _to_float(
            row.get("unrealized_pnl_snapshot", row.get("fifo_pnl_unrealized"))
        )
        bucket["quantity"] = float(bucket["quantity"]) + _to_float(row.get("quantity", row.get("position")))
        bucket["market_value"] = float(bucket["market_value"]) + _to_float(
            row.get("market_value_snapshot", row.get("position_value"))
        )
    return list(grouped.values())


def _build_pnl_leaderboard(
    realized_items: list[dict],
    unrealized_items: list[dict] | None = None,
    *,
    trade_win_rate: object | None = None,
) -> dict:
    unrealized_items = unrealized_items or []
    if not realized_items and not unrealized_items:
        return {
            "top_profit": [],
            "top_loss": [],
            "summary": {
                "win_rate": None,
                "trade_win_rate": None,
                "contribution_win_rate": None,
                "winning_symbols": 0,
                "losing_symbols": 0,
                "flat_symbols": 0,
                "total_symbols": 0,
                "total_realized": 0.0,
                "total_unrealized": 0.0,
                "total_profit": 0.0,
                "total_loss": 0.0,
                "net_pnl": 0.0,
            },
        }

    combined: dict[str, dict] = {}
    for item in realized_items:
        sym = str(item.get("symbol", "") or "").upper()
        if not sym:
            continue
        row = combined.setdefault(
            sym,
            {
                "symbol": sym,
                "realized_pnl": 0.0,
                "unrealized_pnl": 0.0,
                "total_pnl": 0.0,
                "commission": 0.0,
                "trade_count": 0,
                "quantity": 0.0,
                "market_value": 0.0,
            },
        )
        row["realized_pnl"] = float(row["realized_pnl"]) + _to_float(item.get("realized_pnl"))
        row["commission"] = float(row["commission"]) + _to_float(item.get("commission"))
        row["trade_count"] = int(row["trade_count"]) + int(item.get("trade_count", 0) or 0)

    for item in unrealized_items:
        sym = str(item.get("symbol", "") or "").upper()
        if not sym:
            continue
        row = combined.setdefault(
            sym,
            {
                "symbol": sym,
                "realized_pnl": 0.0,
                "unrealized_pnl": 0.0,
                "total_pnl": 0.0,
                "commission": 0.0,
                "trade_count": 0,
                "quantity": 0.0,
                "market_value": 0.0,
            },
        )
        row["unrealized_pnl"] = float(row["unrealized_pnl"]) + _to_float(item.get("unrealized_pnl"))
        row["quantity"] = float(row["quantity"]) + _to_float(item.get("quantity"))
        row["market_value"] = float(row["market_value"]) + _to_float(item.get("market_value"))

    rows = []
    for row in combined.values():
        row["realized_pnl"] = round(float(row["realized_pnl"]), 6)
        row["unrealized_pnl"] = round(float(row["unrealized_pnl"]), 6)
        row["total_pnl"] = round(float(row["realized_pnl"]) + float(row["unrealized_pnl"]), 6)
        row["commission"] = round(float(row["commission"]), 6)
        row["quantity"] = round(float(row["quantity"]), 6)
        row["market_value"] = round(float(row["market_value"]), 6)
        rows.append(row)

    rows.sort(key=lambda row: row["total_pnl"], reverse=True)
    top_profit = [row for row in rows if row["total_pnl"] > 0][:10]
    top_loss = sorted([row for row in rows if row["total_pnl"] < 0], key=lambda row: row["total_pnl"])[:10]
    winning = sum(1 for row in rows if row["total_pnl"] > 0)
    losing = sum(1 for row in rows if row["total_pnl"] < 0)
    flat = len(rows) - winning - losing
    denominator = winning + losing
    contribution_win_rate = (winning / denominator) if denominator > 0 else None
    parsed_trade_win_rate = _optional_float(trade_win_rate)
    return {
        "top_profit": top_profit,
        "top_loss": top_loss,
        "summary": {
            "win_rate": parsed_trade_win_rate if parsed_trade_win_rate is not None else contribution_win_rate,
            "trade_win_rate": parsed_trade_win_rate,
            "contribution_win_rate": contribution_win_rate,
            "winning_symbols": winning,
            "losing_symbols": losing,
            "flat_symbols": flat,
            "total_symbols": len(rows),
            "total_realized": round(sum(row["realized_pnl"] for row in rows), 6),
            "total_unrealized": round(sum(row["unrealized_pnl"] for row in rows), 6),
            "total_profit": round(sum(row["total_pnl"] for row in rows if row["total_pnl"] > 0), 6),
            "total_loss": round(sum(row["total_pnl"] for row in rows if row["total_pnl"] < 0), 6),
            "net_pnl": round(sum(row["total_pnl"] for row in rows), 6),
        },
    }


def _build_pnl_calendar(
    *,
    account_id: str | None,
    start_date: str | None,
    end_date: str | None,
) -> dict:
    if _raw_repository is None:
        return {"daily": [], "monthly": []}
    term_filters: dict[str, str] = {}
    if account_id:
        term_filters["account_id"] = account_id
    trades = _raw_repository.es.search(
        index="ibkr_trade_records_v1",
        size=10000,
        term_filters=term_filters or None,
    )
    realized_daily_map: dict[str, float] = {}
    for trade in trades:
        trade_date = _compact_date(trade.get("trade_date"))
        if not trade_date:
            continue
        if start_date and trade_date < start_date:
            continue
        if end_date and trade_date > end_date:
            continue
        realized = float(trade.get("fifo_pnl_realized", 0) or 0)
        realized_daily_map[trade_date] = realized_daily_map.get(trade_date, 0.0) + realized

    position_rows = _raw_repository.es.search(
        index="ibkr_position_snapshots_v1",
        size=10000,
        term_filters=term_filters or None,
    )
    positions_by_date: dict[str, list[dict]] = {}
    for position in position_rows:
        report_date = _compact_date(position.get("report_date"))
        if not report_date:
            continue
        if end_date and report_date > end_date:
            continue
        positions_by_date.setdefault(report_date, []).append(position)

    unrealized_total_by_date: dict[str, float] = {}
    for report_date, rows in positions_by_date.items():
        summary_rows = [
            row
            for row in rows
            if str(row.get("level_of_detail", "") or "").upper() == "SUMMARY"
        ]
        selected_rows = summary_rows or rows
        unrealized_total_by_date[report_date] = sum(
            _to_float(row.get("unrealized_pnl_snapshot", row.get("fifo_pnl_unrealized")))
            for row in selected_rows
        )

    unrealized_daily_map: dict[str, float] = {}
    previous_unrealized: float | None = None
    for report_date in sorted(unrealized_total_by_date):
        current_unrealized = unrealized_total_by_date[report_date]
        delta = 0.0 if previous_unrealized is None else current_unrealized - previous_unrealized
        previous_unrealized = current_unrealized
        if start_date and report_date < start_date:
            continue
        unrealized_daily_map[report_date] = delta

    daily_dates = sorted(set(realized_daily_map) | set(unrealized_daily_map))
    daily = [
        {
            "date": key,
            "date_iso": normalize_date_to_iso(key),
            "realized_pnl": round(realized_daily_map.get(key, 0.0), 6),
            "unrealized_pnl": round(unrealized_daily_map.get(key, 0.0), 6),
            "total_pnl": round(realized_daily_map.get(key, 0.0) + unrealized_daily_map.get(key, 0.0), 6),
        }
        for key in daily_dates
    ]
    realized_monthly_map: dict[str, float] = {}
    for date, realized in realized_daily_map.items():
        month = date[:6]
        realized_monthly_map[month] = realized_monthly_map.get(month, 0.0) + realized

    unrealized_monthly_map: dict[str, float] = {}
    for date, unrealized in unrealized_daily_map.items():
        month = date[:6]
        unrealized_monthly_map[month] = unrealized_monthly_map.get(month, 0.0) + unrealized

    monthly_keys = sorted(set(realized_monthly_map) | set(unrealized_monthly_map))
    monthly = [
        {
            "month": month,
            "realized_pnl": round(realized_monthly_map.get(month, 0.0), 6),
            "unrealized_pnl": round(unrealized_monthly_map.get(month, 0.0), 6),
            "total_pnl": round(
                realized_monthly_map.get(month, 0.0) + unrealized_monthly_map.get(month, 0.0),
                6,
            ),
        }
        for month in monthly_keys
    ]
    return {"daily": daily, "monthly": monthly}


def _build_monthly_trade_stats(
    *,
    account_id: str | None,
    start_date: str | None,
    end_date: str | None,
) -> list[dict]:
    if _raw_repository is None:
        return []
    term_filters: dict[str, str] = {}
    if account_id:
        term_filters["account_id"] = account_id
    trades = _raw_repository.es.search(
        index="ibkr_trade_records_v1",
        size=10000,
        term_filters=term_filters or None,
    )
    filtered: list[dict] = []
    for trade in trades:
        trade_date = _compact_date(trade.get("trade_date"))
        if not trade_date:
            continue
        if start_date and trade_date < start_date:
            continue
        if end_date and trade_date > end_date:
            continue
        filtered.append(trade)
    return _aggregate_monthly_trade_stats(
        filtered,
        month_for_trade=lambda trade: _compact_date(trade.get("trade_date"))[:6] or None,
        value_key="trade_notional_abs",
        chronological=True,
    )


def _build_daily_trade_stats(
    *,
    account_id: str | None,
    start_date: str | None,
    end_date: str | None,
) -> list[dict]:
    if _raw_repository is None:
        return []
    term_filters: dict[str, str] = {}
    if account_id:
        term_filters["account_id"] = account_id
    trades = _raw_repository.es.search(
        index="ibkr_trade_records_v1",
        size=10000,
        term_filters=term_filters or None,
    )
    daily: dict[str, dict] = {}
    for trade in trades:
        trade_date = _compact_date(trade.get("trade_date"))
        if not trade_date:
            continue
        if start_date and trade_date < start_date:
            continue
        if end_date and trade_date > end_date:
            continue
        qty = float(trade.get("quantity", 0) or 0)
        price = float(trade.get("trade_price", 0) or 0)
        notional_abs = abs(qty * price)
        bucket = daily.setdefault(
            trade_date,
            {"date": trade_date, "trade_count": 0, "trade_notional_abs": 0.0},
        )
        bucket["trade_count"] = int(bucket["trade_count"]) + 1
        bucket["trade_notional_abs"] = float(bucket["trade_notional_abs"]) + notional_abs
    rows = list(daily.values())
    rows.sort(key=lambda row: str(row["date"]))
    return rows


@router.post(
    "/api/performance/compute",
    responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE,
)
def compute_performance(payload: PerformanceComputeRequest) -> dict:
    doc_id = (
        f"{payload.account_id}_{payload.date}_{payload.range}_{payload.mode}_{payload.base_currency}"
    )
    result = {
        "account_id": payload.account_id,
        "date": payload.date,
        "range": payload.range,
        "mode": payload.mode,
        "base_currency": payload.base_currency,
        "simple_return": simple_return(
            v_begin=payload.v_begin,
            v_end=payload.v_end,
            net_cash_inflow=payload.net_cash_inflow,
        ),
        "v_begin": payload.v_begin,
        "v_end": payload.v_end,
        "net_cash_inflow": payload.net_cash_inflow,
    }
    _derived_store[doc_id] = result
    if _derived_repository is not None:
        _derived_repository.upsert_portfolio_return(doc_id=doc_id, doc=result)
    return {
        "document_id": doc_id,
        **result,
        "request": {
            "account_id": payload.account_id,
            "date": payload.date,
            "range": payload.range,
            "mode": payload.mode,
            "base_currency": payload.base_currency,
        },
        "links": {
            "document_url": f"/api/performance/{doc_id}",
            "list_url": "/api/performance",
        },
    }


@router.get(
    "/api/performance/{doc_id}",
    responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE,
)
def get_performance_by_document_id(doc_id: str) -> dict:
    if _derived_repository is not None:
        saved = _derived_repository.get_portfolio_return(doc_id)
        if saved is None:
            raise HTTPException(status_code=404, detail="performance result not found")
        return {
            "document_id": doc_id,
            **saved,
            "request": {"document_id": doc_id},
            "links": {"list_url": "/api/performance"},
            "meta": {"source": "derived"},
        }
    if doc_id in _derived_store:
        return {
            "document_id": doc_id,
            **_derived_store[doc_id],
            "request": {"document_id": doc_id},
            "links": {"list_url": "/api/performance"},
            "meta": {"source": "memory"},
        }
    raise HTTPException(status_code=404, detail="performance result not found")
