from datetime import date
from datetime import datetime
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter

from app.api.currency_conversion import convert_money as _convert_money
from app.api.currency_conversion import normalize_currency_code as _normalize_currency_code
from app.api.currency_conversion import resolve_display_fx as _resolve_display_fx
from app.api.response_models import STORAGE_UNAVAILABLE_OPENAPI_RESPONSE
from app.api.time_normalization import normalize_date_to_iso
from app.api.time_normalization import normalize_datetime_to_local_iso
from app.repositories.derived_repository import DerivedRepository
from app.repositories.raw_repository import RawRepository
from app.services.industry_mapping_service import IndustryMappingService
from app.services.quote_service import QuoteService
from app.services.settings_service import SettingsService

router = APIRouter()
_raw_repository: RawRepository | object | None = None
_derived_repository: DerivedRepository | object | None = None
_settings_service: SettingsService = SettingsService()
_industry_mapping_service: IndustryMappingService | None = None
_quote_service: QuoteService | None = None
_benchmark_history_fetcher: Callable[[str, str, str], list[dict]] | None = None

_RETURN_METHODS = [
    {"key": "simple", "label": "简单加权"},
    {"key": "twr", "label": "时间加权"},
    {"key": "cash", "label": "现金加权"},
]
_RANGE_OPTIONS = [
    {"key": "1w", "label": "1周"},
    {"key": "mtd", "label": "本月至今"},
    {"key": "1m", "label": "1个月"},
    {"key": "3m", "label": "3个月"},
    {"key": "ytd", "label": "本年至今"},
    {"key": "1y", "label": "1年"},
    {"key": "all", "label": "全部"},
    {"key": "custom", "label": "自定义"},
]
_BENCHMARKS = [
    {"key": "sp500", "label": "标普500", "symbol": "^GSPC"},
    {"key": "nasdaq", "label": "纳斯达克", "symbol": "^IXIC"},
    {"key": "qqq", "label": "QQQ", "symbol": "QQQ"},
]


def _benchmark_placeholders() -> list[dict]:
    return [
        {**benchmark, "status": "pending", "points": []}
        for benchmark in _BENCHMARKS
    ]


def set_raw_repository(repository: object | None) -> None:
    global _raw_repository
    _raw_repository = repository


def set_derived_repository(repository: object | None) -> None:
    global _derived_repository
    _derived_repository = repository


def set_settings_service(service: SettingsService) -> None:
    global _settings_service
    _settings_service = service


def set_industry_mapping_service(service: IndustryMappingService | None) -> None:
    global _industry_mapping_service
    _industry_mapping_service = service


def set_quote_service(service: QuoteService | None) -> None:
    global _quote_service
    _quote_service = service


def set_benchmark_history_fetcher(
    fetcher: Callable[[str, str, str], list[dict]] | None,
) -> None:
    global _benchmark_history_fetcher
    _benchmark_history_fetcher = fetcher


def _empty_overview(sync_at: str | None) -> dict:
    timezone_name = _settings_service.get().timezone
    display_currency = _settings_service.get().base_currency
    return {
        "report_date": None,
        "report_date_iso": None,
        "valuation_as_of": None,
        "valuation_as_of_local": None,
        "valuation_date_iso": None,
        "equity": 0,
        "cash": 0,
        "market_value": 0,
        "display_currency": display_currency,
        "display_values": {"equity": 0, "cash": 0, "market_value": 0},
        "valuation_mode": "realtime" if _settings_service.get().display_realtime_prices else "snapshot",
        "daily_change": 0.0,
        "daily_return": None,
        "realized_pnl": 0.0,
        "unrealized_pnl": 0.0,
        "total_pnl": 0.0,
        "twr_daily": None,
        "twr_ytd": None,
        "mwrr_ytd": None,
        "mwrr_all_time": None,
        "ytd_simple_weighted": None,
        "dividends": 0.0,
        "interest": 0.0,
        "commissions": 0.0,
        "reconciliation_summary": None,
        "positions_count": 0,
        "top_holdings": [],
        "equity_curve": [],
        "asset_flow_events": [],
        "benchmark_series": _benchmark_placeholders(),
        "net_value_curve": {
            "rows": [],
            "cash_flow_events": [],
            "calculation_methods": _RETURN_METHODS,
            "range_options": _RANGE_OPTIONS,
            "benchmark_series": _benchmark_placeholders(),
        },
        "total_asset_trend": {
            "rows": [],
            "cash_flow_events": [],
            "range": "ytd",
            "asset_net_value": 0,
            "daily_change": 0,
        },
        "last_successful_sync_at": sync_at,
        "last_successful_sync_at_local": normalize_datetime_to_local_iso(
            sync_at,
            timezone_name=timezone_name,
        ),
    }


def _to_float(value: object) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _compute_ytd_cashflow_metrics(
    *,
    raw_repository: RawRepository,
    account_id: str,
    report_date: str,
    display_currency: str,
) -> tuple[float | None, float | None, float | None]:
    if not account_id or not report_date:
        return (None, None, None)
    year = str(report_date)[:4]
    if not year:
        return (None, None, None)

    rows = raw_repository.es.search(
        index="ibkr_stmt_funds_lines_v1",
        size=10000,
        term_filters={"account_id": account_id} if account_id else None,
    )
    if not rows:
        return (None, None, None)

    # StatementOfFundsLine activity codes in Flex.
    dividend_codes = {"DIV", "PIL", "FRTAX"}
    interest_codes = {"CINT", "DINT"}
    commission_codes = {"COMM", "COMMISSION", "COMMISSIONS"}
    dividends = 0.0
    interest = 0.0
    commissions = 0.0
    matched = False

    for row in rows:
        row_date = str(row.get("report_date", "") or "")
        if not row_date.startswith(year):
            continue
        row_currency = str(row.get("currency", "") or "")
        if display_currency and row_currency and row_currency != display_currency:
            continue
        code = str(row.get("activity_code", "") or "").upper()
        amount = _to_float(row.get("amount"))
        if code in dividend_codes:
            dividends += amount
            matched = True
        if code in interest_codes:
            interest += amount
            matched = True
        if code in commission_codes:
            commissions += amount
            matched = True

    if not matched:
        return (None, None, None)
    return (round(dividends, 2), round(interest, 2), round(commissions, 2))


def _compute_ytd_commissions_from_trades(
    *,
    raw_repository: RawRepository,
    account_id: str,
    report_date: str,
    display_currency: str,
) -> float | None:
    if not account_id or not report_date:
        return None
    year = str(report_date)[:4]
    if not year:
        return None
    trades = raw_repository.es.search(
        index="ibkr_trade_records_v1",
        size=10000,
        term_filters={"account_id": account_id},
    )
    if not trades:
        return None
    total = 0.0
    matched = False
    for row in trades:
        trade_date = _normalize_trade_date(row.get("trade_date", row.get("report_date", "")))
        if not trade_date or not trade_date.startswith(year) or trade_date > str(report_date):
            continue
        trade_currency = str(row.get("currency", "") or "")
        if display_currency and trade_currency and trade_currency != display_currency:
            continue
        total += abs(_to_float(row.get("ib_commission")))
        matched = True
    if not matched:
        return None
    return round(total, 2)


def _normalize_trade_date(value: object) -> str:
    raw = str(value or "")
    if not raw:
        return ""
    return raw[:8]


def _compute_realized_pnl_until_report_date(
    *,
    raw_repository: RawRepository,
    account_id: str,
    report_date: str,
    display_currency: str,
) -> float | None:
    if not account_id or not report_date:
        return None
    # Priority 1: daily realized from ChangeInNAV parsed into account snapshots.
    snapshots = raw_repository.es.search(
        index="ibkr_account_snapshots_v1",
        size=2000,
        term_filters={"account_id": account_id},
    )
    realized_total = 0.0
    has_realized_source = False
    for row in snapshots:
        row_date = str(row.get("report_date", "") or "")
        if not row_date or row_date > str(report_date):
            continue
        if "realized_pnl_daily" in row:
            realized_total += _to_float(row.get("realized_pnl_daily"))
            has_realized_source = True
        elif "realized_pnl" in row:
            realized_total += _to_float(row.get("realized_pnl"))
            has_realized_source = True
    if has_realized_source and abs(realized_total) > 1e-9:
        return round(realized_total, 2)

    # Priority 2 fallback: aggregate trade-level FIFO realized.
    trades = raw_repository.es.search(
        index="ibkr_trade_records_v1",
        size=10000,
        term_filters={"account_id": account_id},
    )
    trade_realized = 0.0
    has_trade_realized = False
    for row in trades:
        trade_date = _normalize_trade_date(row.get("trade_date", row.get("report_date", "")))
        if not trade_date or trade_date > str(report_date):
            continue
        trade_currency = str(row.get("currency", "") or "")
        if display_currency and trade_currency and trade_currency != display_currency:
            continue
        if "fifo_pnl_realized" in row:
            trade_realized += _to_float(row.get("fifo_pnl_realized"))
            has_trade_realized = True
    if has_trade_realized:
        return round(trade_realized, 2)
    return None


def _compute_mwrr_modified_dietz(
    snapshots: list[dict],
    cashflow_by_date: dict[str, float],
    *,
    start_date: str,
    end_date: str,
) -> float | None:
    ordered = sorted(
        [row for row in snapshots if str(row.get("report_date", "") or "") <= end_date],
        key=lambda row: str(row.get("report_date", "") or ""),
    )
    if len(ordered) < 2:
        return None
    begin_candidates = [row for row in ordered if str(row.get("report_date", "") or "") < start_date]
    begin_row = begin_candidates[-1] if begin_candidates else next(
        (row for row in ordered if str(row.get("report_date", "") or "") >= start_date),
        None,
    )
    end_row = ordered[-1]
    if begin_row is None:
        return None
    begin_iso = normalize_date_to_iso(begin_row.get("report_date"))
    end_iso = normalize_date_to_iso(end_row.get("report_date"))
    if not begin_iso or not end_iso:
        return None
    begin_day = date.fromisoformat(begin_iso)
    end_day = date.fromisoformat(end_iso)
    total_days = (end_day - begin_day).days
    if total_days <= 0:
        return None
    v_begin = _to_float(begin_row.get("total_equity"))
    v_end = _to_float(end_row.get("total_equity"))
    if abs(v_begin) < 1e-12:
        return None
    cash_flow_sum = 0.0
    weighted_cash_flow_sum = 0.0
    for flow_date, flow in cashflow_by_date.items():
        if flow_date < start_date or flow_date > end_date:
            continue
        if abs(flow) < 1e-12:
            continue
        flow_iso = normalize_date_to_iso(flow_date)
        if not flow_iso:
            continue
        flow_day = date.fromisoformat(flow_iso)
        elapsed_days = max((flow_day - begin_day).days, 0)
        weight = max((total_days - elapsed_days) / total_days, 0.0)
        cash_flow_sum += flow
        weighted_cash_flow_sum += flow * weight
    denominator = v_begin + weighted_cash_flow_sum
    if abs(denominator) < 1e-12:
        return None
    return (v_end - v_begin - cash_flow_sum) / denominator


def _compute_twr_from_snapshot_rows(
    snapshots: list[dict],
    cashflow_by_date: dict[str, float],
    *,
    start_date: str,
    end_date: str,
) -> float | None:
    ordered_rows = sorted(
        [
            row
            for row in snapshots
            if str(row.get("report_date", "") or "") >= start_date
            and str(row.get("report_date", "") or "") <= end_date
        ],
        key=lambda row: str(row.get("report_date", "") or ""),
    )
    if len(ordered_rows) < 2:
        return None
    growth = 1.0
    periods = 0
    for idx in range(1, len(ordered_rows)):
        prev_row = ordered_rows[idx - 1]
        row = ordered_rows[idx]
        v_begin = _to_float(prev_row.get("total_equity"))
        v_end = _to_float(row.get("total_equity"))
        if abs(v_begin) < 1e-12:
            continue
        report_date = str(row.get("report_date", "") or "")
        net_cash_inflow = _to_float(cashflow_by_date.get(report_date, 0.0))
        daily_twr = (v_end - v_begin - net_cash_inflow) / v_begin
        # Ignore malformed outliers that are not plausible daily returns.
        if abs(daily_twr) >= 0.5:
            continue
        growth *= 1.0 + daily_twr
        periods += 1
    if periods == 0:
        return None
    return growth - 1.0


def _compute_ytd_simple_weighted_return(
    snapshots: list[dict],
    cashflow_by_date: dict[str, float],
    *,
    report_date: str,
) -> float | None:
    if not snapshots or not report_date:
        return None
    current_year = str(report_date)[:4]
    year_start = f"{current_year}0101"
    ordered = sorted(
        [row for row in snapshots if str(row.get("report_date", "") or "") <= str(report_date)],
        key=lambda row: str(row.get("report_date", "") or ""),
    )
    if not ordered:
        return None
    begin_row = next(
        (row for row in ordered if str(row.get("report_date", "") or "") >= year_start),
        None,
    )
    end_row = ordered[-1]
    if begin_row is None:
        return None
    begin_equity = _to_float(begin_row.get("total_equity"))
    current_equity = _to_float(end_row.get("total_equity"))
    net_inflow = sum(
        _to_float(amount)
        for day, amount in cashflow_by_date.items()
        if str(day) >= year_start and str(day) <= str(report_date)
    )
    denominator = begin_equity + net_inflow
    if abs(denominator) < 1e-12:
        return None
    return (current_equity - begin_equity - net_inflow) / denominator


def _build_cashflow_map_from_funds_lines(
    *,
    raw_repository: RawRepository,
    account_id: str,
    report_date: str,
    display_currency: str,
) -> dict[str, float]:
    if not account_id or not report_date:
        return {}
    rows = raw_repository.es.search(
        index="ibkr_stmt_funds_lines_v1",
        size=10000,
        term_filters={"account_id": account_id},
    )
    if not rows:
        return {}
    result: dict[str, float] = {}
    for row in rows:
        row_date = str(row.get("report_date", "") or "")
        if not row_date or row_date > str(report_date):
            continue
        code = str(row.get("activity_code", "") or "").upper()
        if code not in {"DEP", "WITH"}:
            continue
        row_currency = str(row.get("currency", "") or "")
        if display_currency and row_currency and row_currency != display_currency:
            continue
        amount = _to_float(row.get("amount"))
        result[row_date] = result.get(row_date, 0.0) + amount
    snapshot_flows = _build_cashflow_map_from_account_snapshots(
        raw_repository=raw_repository,
        account_id=account_id,
        report_date=report_date,
    )
    for row_date, amount in snapshot_flows.items():
        if row_date not in result:
            result[row_date] = amount
    return result


def _build_cashflow_map_from_account_snapshots(
    *,
    raw_repository: RawRepository,
    account_id: str,
    report_date: str,
) -> dict[str, float]:
    if not account_id or not report_date:
        return {}
    rows = raw_repository.es.search(
        index="ibkr_account_snapshots_v1",
        size=10000,
        term_filters={"account_id": account_id},
    )
    result: dict[str, float] = {}
    for row in rows:
        row_date = str(row.get("report_date", "") or "")
        if not row_date or row_date > str(report_date):
            continue
        amount = _to_float(row.get("net_cash_inflow_daily"))
        if abs(amount) < 1e-9:
            continue
        result[row_date] = result.get(row_date, 0.0) + amount
    return result


def _cashflow_events_from_map(cashflow_by_date: dict[str, float]) -> list[dict]:
    events: list[dict] = []
    for row_date, amount in sorted(cashflow_by_date.items()):
        if abs(amount) < 1e-9:
            continue
        events.append(
            {
                "report_date": row_date,
                "report_date_iso": normalize_date_to_iso(row_date),
                "amount": round(amount, 2),
                "flow_type": "inflow" if amount >= 0 else "outflow",
                "label": "入金" if amount >= 0 else "出金",
            }
        )
    return events


def _build_benchmark_series(*, start_date_iso: str | None, end_date_iso: str | None) -> list[dict]:
    if not start_date_iso or not end_date_iso or _benchmark_history_fetcher is None:
        return _benchmark_placeholders()

    def load_benchmark(benchmark: dict) -> dict:
        points: list[dict] = []
        try:
            points = _benchmark_history_fetcher(
                str(benchmark["symbol"]),
                start_date_iso,
                end_date_iso,
            )
        except Exception:
            points = []
        source = str(points[0].get("source", "")) if points else None
        return {
            **benchmark,
            "status": "ready" if len(points) > 1 else "unavailable",
            "source": source,
            "points": [
                {
                    "date": point.get("date"),
                    "value": point.get("value"),
                }
                for point in points
                if point.get("date") and point.get("value") is not None
            ],
        }

    with ThreadPoolExecutor(max_workers=len(_BENCHMARKS)) as executor:
        return list(executor.map(load_benchmark, _BENCHMARKS))


@router.get("/api/overview/benchmarks", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def get_overview_benchmarks(start_date: str | None = None, end_date: str | None = None) -> dict:
    start_date_iso = normalize_date_to_iso(start_date) if start_date else None
    end_date_iso = normalize_date_to_iso(end_date) if end_date else None
    benchmark_series = _build_benchmark_series(
        start_date_iso=start_date_iso,
        end_date_iso=end_date_iso,
    )
    return {
        "start_date_iso": start_date_iso,
        "end_date_iso": end_date_iso,
        "benchmark_series": benchmark_series,
        "items": benchmark_series,
    }


@router.get("/api/overview", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def get_overview() -> dict:
    latest_sync_at = _settings_service.get().last_successful_sync_at
    timezone_name = _settings_service.get().timezone
    display_currency = _settings_service.get().base_currency
    if _raw_repository is None:
        return _empty_overview(latest_sync_at)

    latest = _raw_repository.get_latest_account_snapshot()
    if latest is None:
        return _empty_overview(latest_sync_at)

    equity = float(latest.get("total_equity", 0) or 0)
    cash = float(latest.get("cash", 0) or 0)
    market_value = float(latest.get("stock_market_value", 0) or 0)
    use_realtime = _settings_service.get().display_realtime_prices
    report_date = latest.get("report_date", "")
    account_id = latest.get("account_id", "")
    account_base_currency = _normalize_currency_code(latest.get("base_currency"), "USD")

    daily_change = 0.0
    daily_return = None
    previous_equity = None

    snapshots = _raw_repository.es.search(
        index="ibkr_account_snapshots_v1",
        size=2,
        sort_field="report_date",
        descending=True,
        term_filters={"account_id": account_id} if account_id else None,
    )
    if len(snapshots) >= 2:
        previous_equity = float(snapshots[1].get("total_equity", 0) or 0)
        daily_change = equity - previous_equity

    if _derived_repository is not None and account_id and report_date:
        doc_id = f"{account_id}_{report_date}_daily"
        perf = _derived_repository.get_portfolio_return(doc_id)
        if perf is not None:
            daily_return = perf.get("simple_return")
    reconciliation_summary = None
    if _derived_repository is not None:
        latest_recon = _derived_repository.get_latest_reconciliation_result()
        if latest_recon is not None:
            reconciliation_summary = {
                "status": latest_recon.get("status"),
                "diff": latest_recon.get("diff"),
                "report_date": latest_recon.get("report_date"),
                "report_date_iso": normalize_date_to_iso(latest_recon.get("report_date")),
                "report_date_local": normalize_date_to_iso(latest_recon.get("report_date")),
            }

    positions: list[dict] = []
    if account_id and report_date:
        # Query target report date first to avoid partial results from size-capped scans.
        positions = _raw_repository.es.search(
            index="ibkr_position_snapshots_v1",
            size=10000,
            term_filters={"account_id": account_id, "report_date": str(report_date)},
        )
    if not positions:
        positions = _raw_repository.es.search(
            index="ibkr_position_snapshots_v1",
            size=10000,
            term_filters={"account_id": account_id} if account_id else None,
        )
        if report_date:
            report_date_positions = [p for p in positions if str(p.get("report_date", "")) == str(report_date)]
            if report_date_positions:
                positions = report_date_positions
            else:
                # Fallback to nearest historical holdings date when current snapshot misses positions.
                older_dates = sorted(
                    {
                        str(p.get("report_date", ""))
                        for p in positions
                        if p.get("report_date") and str(p.get("report_date", "")) <= str(report_date)
                    }
                )
                if older_dates:
                    fallback_date = older_dates[-1]
                    positions = [p for p in positions if str(p.get("report_date", "")) == fallback_date]
    latest_positions = [p for p in positions if p.get("level_of_detail") == "SUMMARY"]
    if not latest_positions:
        # Some reports only contain LOT records. Aggregate them by symbol as SUMMARY fallback.
        lot_positions = [
            p
            for p in positions
            if p.get("level_of_detail") == "LOT" or not p.get("level_of_detail")
        ]
        aggregated: dict[str, dict] = {}
        for p in lot_positions:
            symbol = str(p.get("symbol", "") or "")
            if not symbol:
                continue
            bucket = aggregated.setdefault(
                symbol,
                {
                    "symbol": symbol,
                    "quantity": 0.0,
                    "market_value_snapshot": 0.0,
                    "unrealized_pnl_snapshot": 0.0,
                },
            )
            bucket["quantity"] += float(p.get("quantity", p.get("position", 0)) or 0)
            bucket["market_value_snapshot"] += float(
                p.get("market_value_snapshot", p.get("position_value", 0)) or 0
            )
            bucket["unrealized_pnl_snapshot"] += float(
                p.get("unrealized_pnl_snapshot", p.get("fifo_pnl_unrealized", 0)) or 0
            )
        latest_positions = list(aggregated.values())
    positions_count = len(latest_positions)
    snapshot_positions_market_value = round(
        sum(float(p.get("market_value_snapshot", p.get("position_value", 0)) or 0) for p in latest_positions),
        2,
    )
    market_value = snapshot_positions_market_value
    unrealized_pnl = round(
        sum(float(p.get("unrealized_pnl_snapshot", p.get("fifo_pnl_unrealized", 0)) or 0) for p in latest_positions),
        2,
    )
    realized_pnl = float(latest.get("realized_pnl", 0) or 0)
    total_pnl = round(realized_pnl + unrealized_pnl, 2)

    enriched_positions: list[dict] = []
    quote_cache: dict[str, tuple[float, bool, str, str | None]] = {}
    any_realtime_quote = False
    quote_as_of_values: list[str] = []
    for position in latest_positions:
        symbol = str(position.get("symbol", "") or "")
        quantity = float(position.get("quantity", position.get("position", 0)) or 0)
        snapshot_value = float(
            position.get("market_value_snapshot", position.get("position_value", 0)) or 0
        )
        avg_cost = float(position.get("average_cost_price", position.get("cost_basis_price", 0)) or 0)
        if _quote_service is not None and symbol:
            cached = quote_cache.get(symbol)
            if cached is None:
                quote = (
                    _quote_service.get_latest_quote(symbol)
                    if use_realtime
                    else _quote_service.get_snapshot_quote(symbol)
                )
                cached = (quote.price, quote.is_realtime, quote.source, quote.as_of)
                quote_cache[symbol] = cached
            price, is_realtime, quote_source, quote_as_of = cached
            any_realtime_quote = any_realtime_quote or is_realtime
            if is_realtime and quote_as_of:
                quote_as_of_values.append(quote_as_of)
            value = round(price * quantity, 2)
        else:
            value = snapshot_value
            is_realtime = False
            quote_source = "snapshot"
            quote_as_of = None
        if avg_cost > 0 and quantity:
            position_unrealized = round(value - (avg_cost * quantity), 2)
        else:
            position_unrealized = float(
                position.get("unrealized_pnl_snapshot", position.get("fifo_pnl_unrealized", 0)) or 0
            )
        enriched_positions.append(
            {
                "symbol": symbol,
                "market_value": value,
                "unrealized_pnl": position_unrealized,
                "is_realtime": is_realtime,
                "quote_source": quote_source,
                "quote_as_of": quote_as_of,
                "quote_as_of_local": normalize_datetime_to_local_iso(
                    quote_as_of,
                    timezone_name=timezone_name,
                ),
                "industry": (
                    _industry_mapping_service.get(symbol)
                    if _industry_mapping_service is not None
                    else "Unknown"
                )
                or "Unknown",
            }
        )
    if enriched_positions:
        if use_realtime:
            market_value = round(sum(float(item.get("market_value", 0) or 0) for item in enriched_positions), 2)
            unrealized_pnl = round(sum(float(item.get("unrealized_pnl", 0) or 0) for item in enriched_positions), 2)
            equity = round(cash + market_value, 2)
            total_pnl = round(realized_pnl + unrealized_pnl, 2)
            if previous_equity is not None:
                daily_change = equity - previous_equity
                if abs(previous_equity) > 1e-12:
                    daily_return = daily_change / previous_equity
    enriched_positions.sort(
        key=lambda p: abs(float(p.get("market_value", 0) or 0)),
        reverse=True,
    )
    top_holdings = enriched_positions[:5]
    curve_source = _raw_repository.es.search(
        index="ibkr_account_snapshots_v1",
        size=2000,
        sort_field="report_date",
        descending=False,
        term_filters={"account_id": account_id} if account_id else None,
    )
    equity_curve = [
        {
            "report_date": row.get("report_date"),
            "report_date_iso": normalize_date_to_iso(row.get("report_date")),
            "equity": float(row.get("total_equity", 0) or 0),
            "cash": float(row.get("cash", 0) or 0),
            "market_value": float(row.get("stock_market_value", 0) or 0),
        }
        for row in curve_source
        if row.get("report_date")
    ]
    for row in equity_curve:
        if str(row.get("report_date", "") or "") == str(report_date):
            row["equity"] = equity
            row["cash"] = cash
            row["market_value"] = market_value

    twr_ytd = None
    mwrr_ytd = None
    mwrr_all_time = None
    ytd_simple_weighted = None
    if _derived_repository is not None and account_id:
        returns = _derived_repository.list_portfolio_returns(size=2000)
        daily_returns = [
            r
            for r in returns
            if r.get("account_id") == account_id
            and r.get("range") == "daily"
            and r.get("date")
            and r.get("simple_return") is not None
        ]
        if daily_returns:
            daily_returns.sort(key=lambda r: str(r.get("date", "")))
            current_year = str(report_date)[:4]
            ytd = [r for r in daily_returns if str(r.get("date", "")).startswith(current_year)]
            if ytd:
                twr_val = 1.0
                for row in ytd:
                    twr_val *= 1 + float(row.get("simple_return", 0) or 0)
                twr_ytd = twr_val - 1
    snapshots_for_mwrr = _raw_repository.es.search(
        index="ibkr_account_snapshots_v1",
        size=2000,
        sort_field="report_date",
        descending=False,
        term_filters={"account_id": account_id} if account_id else None,
    )
    all_snapshots_sorted = sorted(
        snapshots_for_mwrr,
        key=lambda row: str(row.get("report_date", "") or ""),
    )
    if all_snapshots_sorted:
        cashflow_by_date = _build_cashflow_map_from_funds_lines(
            raw_repository=_raw_repository,
            account_id=account_id,
            report_date=str(report_date),
            display_currency=account_base_currency,
        )
        current_year = str(report_date)[:4]
        year_start = f"{current_year}0101"
        twr_ytd = _compute_twr_from_snapshot_rows(
            all_snapshots_sorted,
            cashflow_by_date,
            start_date=year_start,
            end_date=str(report_date),
        )
        twr_all_time = _compute_twr_from_snapshot_rows(
            all_snapshots_sorted,
            cashflow_by_date,
            start_date=str(all_snapshots_sorted[0].get("report_date", "")),
            end_date=str(report_date),
        )
        mwrr_ytd = _compute_mwrr_modified_dietz(
            all_snapshots_sorted,
            cashflow_by_date,
            start_date=year_start,
            end_date=str(report_date),
        )
        mwrr_all_time = _compute_mwrr_modified_dietz(
            all_snapshots_sorted,
            cashflow_by_date,
            start_date=str(all_snapshots_sorted[0].get("report_date", "")),
            end_date=str(report_date),
        )
        # Guard unstable MWRR values and fall back to TWR-based value.
        if mwrr_ytd is not None and (mwrr_ytd < -1.0 or mwrr_ytd > 10.0):
            mwrr_ytd = twr_ytd
        if mwrr_all_time is not None and (mwrr_all_time < -1.0 or mwrr_all_time > 10.0):
            mwrr_all_time = twr_all_time
        ytd_simple_weighted = _compute_ytd_simple_weighted_return(
            all_snapshots_sorted,
            cashflow_by_date,
            report_date=str(report_date),
        )

    ytd_dividends, ytd_interest, ytd_commissions = _compute_ytd_cashflow_metrics(
        raw_repository=_raw_repository,
        account_id=account_id,
        report_date=str(report_date),
        display_currency=account_base_currency,
    )
    realized_pnl_until_report_date = _compute_realized_pnl_until_report_date(
        raw_repository=_raw_repository,
        account_id=account_id,
        report_date=str(report_date),
        display_currency=account_base_currency,
    )
    if realized_pnl_until_report_date is not None:
        realized_pnl = realized_pnl_until_report_date
        total_pnl = round(realized_pnl + unrealized_pnl, 2)
    if ytd_commissions is None or abs(ytd_commissions) < 1e-9:
        fallback_commissions = _compute_ytd_commissions_from_trades(
            raw_repository=_raw_repository,
            account_id=account_id,
            report_date=str(report_date),
            display_currency=account_base_currency,
        )
        if fallback_commissions is not None:
            ytd_commissions = fallback_commissions

    dividends = (
        ytd_dividends
        if ytd_dividends is not None
        else float(latest.get("dividends", 0) or 0)
    )
    interest = (
        ytd_interest
        if ytd_interest is not None
        else float(latest.get("interest", 0) or 0)
    )
    commissions = (
        ytd_commissions
        if ytd_commissions is not None
        else float(latest.get("commissions", 0) or 0)
    )
    source_values = {
        "equity": equity,
        "cash": cash,
        "market_value": market_value,
        "daily_change": daily_change,
        "realized_pnl": realized_pnl,
        "unrealized_pnl": unrealized_pnl,
        "total_pnl": total_pnl,
        "dividends": dividends,
        "interest": interest,
        "commissions": commissions,
    }
    currency_conversion = _resolve_display_fx(
        raw_repository=_raw_repository,
        source_currency=account_base_currency,
        display_currency=display_currency,
        report_date=str(report_date),
    )
    fx_rate = _to_float(currency_conversion.get("rate")) or 1.0
    display_top_holdings = [
        {
            **item,
            "market_value": _convert_money(item.get("market_value"), fx_rate),
            "unrealized_pnl": _convert_money(item.get("unrealized_pnl"), fx_rate),
        }
        for item in top_holdings
    ]
    display_equity_curve = [
        {
            **row,
            "equity": _convert_money(row.get("equity"), fx_rate),
            "cash": _convert_money(row.get("cash"), fx_rate),
            "market_value": _convert_money(row.get("market_value"), fx_rate),
        }
        for row in equity_curve
    ]
    cashflow_by_date_for_curves = (
        cashflow_by_date
        if "cashflow_by_date" in locals()
        else _build_cashflow_map_from_funds_lines(
            raw_repository=_raw_repository,
            account_id=account_id,
            report_date=str(report_date),
            display_currency=account_base_currency,
        )
    )
    asset_flow_events = _cashflow_events_from_map(cashflow_by_date_for_curves)
    display_asset_flow_events = [
        {
            **event,
            "amount": _convert_money(event.get("amount"), fx_rate),
        }
        for event in asset_flow_events
    ]
    report_date_iso = normalize_date_to_iso(report_date)
    ytd_start_iso = f"{str(report_date_iso)[:4]}-01-01" if report_date_iso else None
    display_total_asset_rows = [
        row
        for row in display_equity_curve
        if not ytd_start_iso
        or not row.get("report_date_iso")
        or str(row.get("report_date_iso")) >= ytd_start_iso
    ]
    if not display_total_asset_rows:
        display_total_asset_rows = display_equity_curve
    display_ytd_flow_events = [
        event
        for event in display_asset_flow_events
        if not ytd_start_iso
        or not event.get("report_date_iso")
        or str(event.get("report_date_iso")) >= ytd_start_iso
    ]
    benchmark_series = _benchmark_placeholders()
    if reconciliation_summary is not None and reconciliation_summary.get("diff") is not None:
        reconciliation_summary = {
            **reconciliation_summary,
            "diff": _convert_money(reconciliation_summary.get("diff"), fx_rate),
        }
    valuation_mode = "realtime" if any_realtime_quote else "snapshot"
    valuation_as_of = max(quote_as_of_values) if quote_as_of_values else None
    valuation_as_of_local = normalize_datetime_to_local_iso(
        valuation_as_of,
        timezone_name=timezone_name,
    )
    valuation_date_iso = (
        datetime.fromisoformat(valuation_as_of_local).date().isoformat()
        if valuation_as_of_local
        else normalize_date_to_iso(report_date)
    )

    return {
        "report_date": report_date,
        "report_date_iso": report_date_iso,
        "valuation_as_of": valuation_as_of,
        "valuation_as_of_local": valuation_as_of_local,
        "valuation_date_iso": valuation_date_iso,
        "equity": _convert_money(equity, fx_rate),
        "cash": _convert_money(cash, fx_rate),
        "market_value": _convert_money(market_value, fx_rate),
        "account_base_currency": account_base_currency,
        "display_currency": display_currency,
        "currency_conversion": {
            **currency_conversion,
            "rate": round(fx_rate, 8),
        },
        "source_values": source_values,
        "display_values": {
            "equity": _convert_money(latest.get("total_equity", 0), fx_rate),
            "cash": _convert_money(cash, fx_rate),
            "market_value": _convert_money(snapshot_positions_market_value, fx_rate),
        },
        "valuation_mode": valuation_mode,
        "daily_change": _convert_money(daily_change, fx_rate),
        "daily_return": daily_return,
        "realized_pnl": _convert_money(realized_pnl, fx_rate),
        "unrealized_pnl": _convert_money(unrealized_pnl, fx_rate),
        "total_pnl": _convert_money(total_pnl, fx_rate),
        "twr_daily": daily_return,
        "twr_ytd": twr_ytd,
        "mwrr_ytd": mwrr_ytd,
        "mwrr_all_time": mwrr_all_time,
        "ytd_simple_weighted": ytd_simple_weighted,
        "dividends": _convert_money(dividends, fx_rate),
        "interest": _convert_money(interest, fx_rate),
        "commissions": _convert_money(commissions, fx_rate),
        "reconciliation_summary": reconciliation_summary,
        "positions_count": positions_count,
        "top_holdings": display_top_holdings,
        "equity_curve": display_equity_curve,
        "asset_flow_events": display_asset_flow_events,
        "benchmark_series": benchmark_series,
        "net_value_curve": {
            "rows": display_equity_curve,
            "cash_flow_events": display_asset_flow_events,
            "calculation_methods": _RETURN_METHODS,
            "range_options": _RANGE_OPTIONS,
            "benchmark_series": benchmark_series,
        },
        "total_asset_trend": {
            "rows": display_total_asset_rows,
            "cash_flow_events": display_ytd_flow_events,
            "range": "ytd",
            "asset_net_value": _convert_money(equity, fx_rate),
            "daily_change": _convert_money(daily_change, fx_rate),
        },
        "last_successful_sync_at": latest_sync_at,
        "last_successful_sync_at_local": normalize_datetime_to_local_iso(
            latest_sync_at,
            timezone_name=timezone_name,
        ),
    }
