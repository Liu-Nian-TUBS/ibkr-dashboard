from fastapi import APIRouter
from fastapi import HTTPException

from app.api.response_models import STORAGE_UNAVAILABLE_OPENAPI_RESPONSE
from app.api.time_normalization import normalize_date_to_iso
from app.api.time_normalization import normalize_month_bucket
from app.repositories.raw_repository import RawRepository
from app.services.account_currency import resolve_activity_display_currency
from app.services.settings_service import SettingsService
from app.utils.numbers import to_float as _to_float

router = APIRouter()
_raw_repository: RawRepository | object | None = None
_settings_service: SettingsService = SettingsService()


def set_raw_repository(repository: object | None) -> None:
    global _raw_repository
    _raw_repository = repository


def set_settings_service(service: SettingsService) -> None:
    global _settings_service
    _settings_service = service


@router.get("/api/cash-flows", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def list_cash_flows(
    page: int = 1,
    page_size: int = 20,
    currency: str | None = None,
    flow_type: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    normalized_currency = currency.upper() if currency else None
    normalized_flow_type = flow_type.lower() if flow_type else None
    if normalized_flow_type is not None and normalized_flow_type not in {"inflow", "outflow"}:
        raise HTTPException(status_code=400, detail="invalid_flow_type")
    start_date_iso = normalize_date_to_iso(start_date) if start_date else None
    end_date_iso = normalize_date_to_iso(end_date) if end_date else None
    if start_date_iso is not None and end_date_iso is not None and start_date_iso > end_date_iso:
        raise HTTPException(status_code=400, detail="invalid_date_range")
    normalized_page = max(page, 1)
    normalized_page_size = max(min(page_size, 100), 1)
    if _raw_repository is None:
        display_currency = resolve_activity_display_currency(_raw_repository, [], selected_currency=normalized_currency)
        return {
            "filters": {
                "currency": normalized_currency,
                "flow_type": normalized_flow_type,
                "start_date": start_date,
                "end_date": end_date,
                "page": normalized_page,
                "page_size": normalized_page_size,
            },
            "items": [],
            "display_currency": display_currency,
            "summary": {
                "flow_count": 0,
                "absolute_sum": 0.0,
                "net_amount": 0.0,
                "inflow_amount": 0.0,
                "outflow_amount": 0.0,
                "inflow_count": 0,
                "outflow_count": 0,
                "by_currency": {},
            },
            "monthly_stats": [],
            "total": 0,
        }

    all_items = _load_cash_transaction_flows(_raw_repository)
    if not all_items:
        all_items = _load_statement_funds_flows(_raw_repository)

    filtered_items: list[dict] = []
    for item in all_items:
        item_currency = str(item.get("currency", "") or "UNKNOWN")
        item_date = str(item.get("date_time") or item.get("report_date", ""))
        item_date_iso = normalize_date_to_iso(item_date)
        amount = float(item.get("amount", 0) or 0)
        item_flow_type = "inflow" if amount >= 0 else "outflow"
        if normalized_currency and item_currency != normalized_currency:
            continue
        if normalized_flow_type and item_flow_type != normalized_flow_type:
            continue
        if start_date_iso and item_date_iso and item_date_iso < start_date_iso:
            continue
        if end_date_iso and item_date_iso and item_date_iso > end_date_iso:
            continue
        enriched = dict(item)
        enriched["flow_type"] = item_flow_type
        enriched["report_date_iso"] = item_date_iso
        settlement_date = (
            item.get("settlement_date")
            or item.get("settle_date")
            or item.get("settlementDate")
            or item.get("settleDate")
            or item.get("report_date")
        )
        enriched["settlement_date_iso"] = normalize_date_to_iso(settlement_date)
        filtered_items.append(enriched)

    filtered_items.sort(
        key=lambda item: (
            str(item.get("report_date_iso", "") or ""),
            str(item.get("transaction_id", item.get("document_id", "")) or ""),
        ),
        reverse=True,
    )

    start = (normalized_page - 1) * normalized_page_size
    end = start + normalized_page_size
    items = filtered_items[start:end]

    amounts = [float(item.get("amount", 0) or 0) for item in filtered_items]
    absolute_sum = sum(abs(amount) for amount in amounts)
    net_amount = sum(amounts)
    inflow_amount = sum(amount for amount in amounts if amount >= 0)
    outflow_amount = sum(amount for amount in amounts if amount < 0)
    inflow_count = sum(1 for amount in amounts if amount >= 0)
    outflow_count = sum(1 for amount in amounts if amount < 0)
    by_currency: dict[str, dict[str, float | int]] = {}
    monthly_stats: dict[str, dict[str, float | int]] = {}
    for item in filtered_items:
        item_currency = str(item.get("currency", "") or "UNKNOWN")
        amount = float(item.get("amount", 0) or 0)
        report_date = str(item.get("report_date", ""))
        month = (
            normalize_month_bucket(
                report_date,
                timezone_name=_settings_service.get().timezone,
            )
            or "unknown"
        )
        if item_currency not in by_currency:
            by_currency[item_currency] = {
                "absolute_sum": 0.0,
                "net_amount": 0.0,
                "inflow_amount": 0.0,
                "outflow_amount": 0.0,
                "count": 0,
            }
        by_currency[item_currency]["absolute_sum"] = float(by_currency[item_currency]["absolute_sum"]) + abs(amount)
        by_currency[item_currency]["net_amount"] = float(by_currency[item_currency]["net_amount"]) + amount
        if amount >= 0:
            by_currency[item_currency]["inflow_amount"] = float(by_currency[item_currency]["inflow_amount"]) + amount
        else:
            by_currency[item_currency]["outflow_amount"] = float(by_currency[item_currency]["outflow_amount"]) + amount
        by_currency[item_currency]["count"] = int(by_currency[item_currency]["count"]) + 1
        if month not in monthly_stats:
            monthly_stats[month] = {
                "month": month,
                "count": 0,
                "absolute_sum": 0.0,
                "net_amount": 0.0,
            }
        monthly_stats[month]["count"] = int(monthly_stats[month]["count"]) + 1
        monthly_stats[month]["absolute_sum"] = float(monthly_stats[month]["absolute_sum"]) + abs(amount)
        monthly_stats[month]["net_amount"] = float(monthly_stats[month]["net_amount"]) + amount
    monthly_rows = list(monthly_stats.values())
    monthly_rows.sort(key=lambda row: str(row["month"]), reverse=True)
    display_currency = resolve_activity_display_currency(
        _raw_repository,
        filtered_items,
        selected_currency=normalized_currency,
    )
    return {
        "filters": {
            "currency": normalized_currency,
            "flow_type": normalized_flow_type,
            "start_date": start_date,
            "end_date": end_date,
            "page": normalized_page,
            "page_size": normalized_page_size,
        },
        "items": items,
        "display_currency": display_currency,
        "summary": {
            "flow_count": len(filtered_items),
            "absolute_sum": absolute_sum,
            "net_amount": net_amount,
            "inflow_amount": inflow_amount,
            "outflow_amount": outflow_amount,
            "inflow_count": inflow_count,
            "outflow_count": outflow_count,
            "by_currency": by_currency,
            "has_mixed_currencies": len(by_currency) > 1,
            "currency_count": len(by_currency),
        },
        "monthly_stats": monthly_rows[:12],
        "total": len(filtered_items),
    }


def _load_cash_transaction_flows(raw_repository: RawRepository | object) -> list[dict]:
    rows = raw_repository.es.search(
        index="ibkr_cash_transactions_v1",
        size=10000,
        sort_field="report_date",
        descending=True,
    )
    items: list[dict] = []
    for row in rows:
        transaction_type = str(row.get("transaction_type") or row.get("type") or "").upper()
        if transaction_type != "DEPOSITS/WITHDRAWALS":
            continue
        level = str(row.get("level_of_detail", "") or "").upper()
        if level and level != "DETAIL":
            continue
        currency = str(row.get("currency", "") or "")
        report_date = str(row.get("report_date") or row.get("date_time") or "")
        if not currency or not report_date:
            continue
        amount = _to_float(row.get("amount"))
        enriched = dict(row)
        enriched["source"] = "cash_transaction"
        enriched["currency"] = currency
        enriched["amount"] = amount
        enriched["activity_code"] = "DEP" if amount >= 0 else "WITH"
        enriched["activity_description"] = str(row.get("description", "") or "Deposits/Withdrawals")
        enriched["report_date"] = report_date
        enriched["date_time"] = str(row.get("date_time") or report_date)
        enriched["settle_date"] = str(row.get("settle_date") or row.get("settleDate") or report_date)
        items.append(enriched)
    return items

def _load_statement_funds_flows(raw_repository: RawRepository | object) -> list[dict]:
    rows = raw_repository.es.search(
        index="ibkr_stmt_funds_lines_v1",
        size=10000,
        sort_field="report_date",
        descending=True,
    )
    cashflow_codes = {"DEP", "WITH"}
    items: list[dict] = []
    for row in rows:
        code = str(row.get("activity_code", "") or "").upper()
        if code not in cashflow_codes:
            continue
        level = str(row.get("level_of_detail", "") or "").upper()
        if level == "BASECURRENCY":
            continue
        enriched = dict(row)
        enriched["source"] = "statement_funds"
        enriched["date_time"] = str(row.get("date") or row.get("report_date") or "")
        enriched["settle_date"] = str(row.get("settle_date") or row.get("settleDate") or row.get("report_date") or "")
        items.append(enriched)
    return items
