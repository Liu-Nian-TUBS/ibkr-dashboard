"""Manual trade entry API — allows recording trades from non-IBKR platforms."""

from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.api.response_models import STORAGE_UNAVAILABLE_OPENAPI_RESPONSE
from app.repositories.raw_repository import RawRepository
from app.services.quote_service import fetch_sina_quote, fetch_sina_history

router = APIRouter()
_raw_repository: RawRepository | object | None = None


def set_raw_repository(repository: object | None) -> None:
    global _raw_repository
    _raw_repository = repository


class ManualTradeRequest(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=20, description="Ticker symbol, e.g. AAPL, 00700.HK")
    side: str = Field(..., pattern="^(BUY|SELL)$", description="BUY or SELL")
    quantity: float = Field(..., gt=0, description="Number of shares/contracts")
    trade_price: float = Field(..., gt=0, description="Price per share")
    trade_date: str = Field(default="", description="Trade date YYYY-MM-DD; defaults to today")
    currency: str = Field(default="USD", max_length=10, description="Currency code")
    account_id: str = Field(default="manual", max_length=50, description="Platform/account label")
    commission: float = Field(default=0.0, ge=0, description="Commission paid")
    notes: str = Field(default="", max_length=500, description="Optional notes")


class ManualTradeUpdateRequest(BaseModel):
    symbol: str | None = Field(None, min_length=1, max_length=20)
    side: str | None = Field(None, pattern="^(BUY|SELL)$")
    quantity: float | None = Field(None, gt=0)
    trade_price: float | None = Field(None, gt=0)
    trade_date: str | None = Field(None)
    currency: str | None = Field(None, max_length=10)
    account_id: str | None = Field(None, max_length=50)
    commission: float | None = Field(None, ge=0)
    notes: str | None = Field(None, max_length=500)


@router.post("/api/manual-trades", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def create_manual_trade(payload: ManualTradeRequest) -> dict:
    """Create a manually-entered trade record."""
    if _raw_repository is None:
        raise HTTPException(status_code=503, detail="storage_unavailable")

    trade_date = payload.trade_date or date.today().isoformat()
    try:
        date.fromisoformat(trade_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid trade_date format, use YYYY-MM-DD")

    trade_id = f"manual:{uuid.uuid4().hex[:16]}"
    doc = {
        "trade_id": trade_id,
        "account_id": payload.account_id or "manual",
        "symbol": payload.symbol.upper(),
        "side": payload.side.upper(),
        "quantity": payload.quantity,
        "trade_price": payload.trade_price,
        "trade_date": trade_date,
        "currency": payload.currency.upper(),
        "ib_commission": payload.commission,
        "fifo_pnl_realized": 0.0,
        "notes": payload.notes,
        "source": "manual",
    }
    # Calculate realized PnL for SELL trades
    if doc["side"] == "SELL":
        prior_trades = _raw_repository.es.search(
            index="ibkr_trade_records_v1",
            size=10000,
            term_filters={"symbol": doc["symbol"], "source": "manual", "account_id": doc["account_id"]},
        )
        prior_trades.sort(key=lambda t: t.get("trade_date", ""))
        net_qty = 0.0
        total_cost = 0.0
        for t in prior_trades:
            if t.get("trade_date", "") > trade_date:
                break
            s = str(t.get("side", "")).upper()
            q = float(t.get("quantity", 0) or 0)
            p = float(t.get("trade_price", 0) or 0)
            if s == "BUY":
                total_cost += q * p
                net_qty += q
            elif s == "SELL":
                if net_qty > 0:
                    total_cost -= q * (total_cost / net_qty)
                net_qty -= q
        if net_qty > 0:
            avg_cost = total_cost / net_qty
            doc["fifo_pnl_realized"] = round((doc["trade_price"] - avg_cost) * doc["quantity"], 2)
    _raw_repository.es.update(index="ibkr_trade_records_v1", id=trade_id, doc=doc, doc_as_upsert=True)
    _sync_manual_position_snapshot(doc["symbol"], doc["account_id"])
    # Trigger history backfill if needed
    try:
        _backfill_manual_history(doc["symbol"], doc["account_id"])
    except Exception:
        pass
    return {"status": "created", "trade_id": trade_id, "record": doc}


@router.get("/api/manual-trades", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def list_manual_trades(
    symbol: str | None = None,
    account_id: str | None = None,
    page: int = 1,
    page_size: int = 50,
) -> dict:
    """List manually-entered trades only."""
    if _raw_repository is None:
        raise HTTPException(status_code=503, detail="storage_unavailable")

    # Fetch all manual trades (source=manual)
    filters: dict[str, str] = {"source": "manual"}
    if symbol:
        filters["symbol"] = symbol.upper()
    if account_id:
        filters["account_id"] = account_id

    results = _raw_repository.es.search(
        index="ibkr_trade_records_v1",
        size=2000,
        term_filters=filters,
    )
    results.sort(key=lambda x: x.get("trade_date", ""), reverse=True)
    offset = max(page - 1, 0) * page_size
    items = results[offset: offset + page_size]
    return {"items": items, "total": len(results), "page": page, "page_size": page_size}


@router.put("/api/manual-trades/{trade_id}", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def update_manual_trade(trade_id: str, payload: ManualTradeUpdateRequest) -> dict:
    """Update a manually-entered trade. Only manual trades can be edited."""
    if _raw_repository is None:
        raise HTTPException(status_code=503, detail="storage_unavailable")
    if not trade_id.startswith("manual:"):
        raise HTTPException(status_code=403, detail="only manual trades can be edited")

    try:
        result = _raw_repository.es.get(index="ibkr_trade_records_v1", id=trade_id)
        existing = result.get("_source", result) if isinstance(result, dict) else {}
    except (KeyError, RuntimeError):
        raise HTTPException(status_code=404, detail="trade not found")

    updates = payload.model_dump(exclude_none=True)
    if "symbol" in updates:
        updates["symbol"] = updates["symbol"].upper()
    if "side" in updates:
        updates["side"] = updates["side"].upper()
    if "currency" in updates:
        updates["currency"] = updates["currency"].upper()
    if "commission" in updates:
        updates["ib_commission"] = updates.pop("commission")
    if "trade_date" in updates:
        try:
            date.fromisoformat(updates["trade_date"])
        except ValueError:
            raise HTTPException(status_code=400, detail="invalid trade_date format")

    doc = {**existing, **updates}
    _raw_repository.es.update(index="ibkr_trade_records_v1", id=trade_id, doc=doc, doc_as_upsert=True)
    _sync_manual_position_snapshot(doc["symbol"], doc.get("account_id", "manual"))
    # If symbol changed, also update old symbol
    old_symbol = str(existing.get("symbol", "")).upper()
    if old_symbol and old_symbol != doc["symbol"]:
        _sync_manual_position_snapshot(old_symbol, existing.get("account_id", "manual"))
    return {"status": "updated", "trade_id": trade_id, "record": doc}


@router.delete("/api/manual-trades/{trade_id}", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def delete_manual_trade(trade_id: str) -> dict:
    """Delete a manually-entered trade. Only manual trades can be deleted."""
    if _raw_repository is None:
        raise HTTPException(status_code=503, detail="storage_unavailable")
    if not trade_id.startswith("manual:"):
        raise HTTPException(status_code=403, detail="only manual trades can be deleted")

    # Retrieve symbol before deletion
    trade_doc = _raw_repository.es.get(index="ibkr_trade_records_v1", id=trade_id)
    symbol = str(trade_doc.get("symbol", "")).upper()
    account_id = str(trade_doc.get("account_id", "manual"))
    _raw_repository.es.delete(index="ibkr_trade_records_v1", id=trade_id)
    if symbol:
        _sync_manual_position_snapshot(symbol, account_id)
    return {"status": "deleted", "trade_id": trade_id}


def _sync_manual_position_snapshot(symbol: str, account_id: str = "manual") -> None:
    """Recalculate net position from all manual trades for a symbol and upsert position snapshot."""
    if _raw_repository is None or not symbol:
        return
    trades = _raw_repository.es.search(
        index="ibkr_trade_records_v1",
        size=10000,
        term_filters={"symbol": symbol.upper(), "source": "manual", "account_id": account_id},
    )
    trades.sort(key=lambda t: t.get("trade_date", ""))
    net_quantity = 0.0
    total_cost = 0.0
    latest_date = ""
    for t in trades:
        side = str(t.get("side", t.get("buy_sell", ""))).upper()
        qty = float(t.get("quantity", 0) or 0)
        price = float(t.get("trade_price", 0) or 0)
        td = str(t.get("trade_date", "") or "")
        if side == "BUY":
            total_cost += qty * price
            net_quantity += qty
        elif side == "SELL":
            if net_quantity > 0:
                avg = total_cost / net_quantity
                total_cost -= qty * avg
            net_quantity -= qty
        if td > latest_date:
            latest_date = td

    today_str = date.today().strftime("%Y%m%d")
    snapshot_id = f"manual_{account_id}_{symbol.upper()}_{today_str}_SUMMARY"
    report_date = today_str

    if net_quantity <= 0:
        # No position left — remove snapshot (both old and new format IDs)
        for sid in [snapshot_id, f"manual_{account_id}_{symbol.upper()}_SUMMARY"]:
            try:
                _raw_repository.es.delete(index="ibkr_position_snapshots_v1", id=sid)
            except Exception:
                pass
        return

    avg_cost = total_cost / net_quantity if net_quantity else 0.0
    # Try to get realtime price
    realtime_price = fetch_sina_quote(symbol.upper())
    mark_price = realtime_price if realtime_price and realtime_price > 0 else avg_cost
    market_value = round(net_quantity * mark_price, 2)
    unrealized_pnl = round(market_value - total_cost, 2)
    doc = {
        "account_id": account_id,
        "symbol": symbol.upper(),
        "quantity": round(net_quantity, 6),
        "cost_basis_money": round(total_cost, 2),
        "cost_basis_price": round(avg_cost, 6),
        "average_cost_price": round(avg_cost, 6),
        "mark_price_snapshot": round(mark_price, 6),
        "market_value_snapshot": market_value,
        "unrealized_pnl_snapshot": unrealized_pnl,
        "report_date": report_date,
        "level_of_detail": "SUMMARY",
        "asset_category": "STK",
        "source": "manual",
    }
    _raw_repository.es.update(index="ibkr_position_snapshots_v1", id=snapshot_id, doc=doc, doc_as_upsert=True)


def _backfill_manual_history(symbol: str, account_id: str = "manual") -> dict:
    """Backfill historical daily snapshots for a manual position using Sina K-line data."""
    if _raw_repository is None or not symbol:
        return {"status": "skipped", "reason": "no repository or symbol"}

    symbol = symbol.upper()
    trades = _raw_repository.es.search(
        index="ibkr_trade_records_v1",
        size=10000,
        term_filters={"symbol": symbol, "source": "manual", "account_id": account_id},
    )
    if not trades:
        return {"status": "skipped", "reason": "no trades"}

    # Find earliest trade date
    trade_dates = [t.get("trade_date", "") for t in trades if t.get("trade_date")]
    if not trade_dates:
        return {"status": "skipped", "reason": "no trade dates"}
    earliest = min(trade_dates)
    today_str = date.today().isoformat()

    # Fetch history
    history = fetch_sina_history(symbol, start_date=earliest, end_date=today_str)
    if not history:
        return {"status": "skipped", "reason": "no history data"}

    # Sort trades by date for incremental calculation
    trades.sort(key=lambda t: t.get("trade_date", ""))

    # Build price map
    price_map = {h["date"]: h["value"] for h in history if "date" in h and "value" in h}

    created = 0
    skipped = 0
    for hist_date_str, close_price in price_map.items():
        # Skip weekends already handled by Sina (only returns trading days)
        date_tag = hist_date_str.replace("-", "")
        snap_id = f"manual_{account_id}_{symbol}_{date_tag}_SUMMARY"

        # Check if exists
        try:
            existing = _raw_repository.es.get(index="ibkr_position_snapshots_v1", id=snap_id)
            if existing:
                skipped += 1
                continue
        except Exception:
            pass

        # Calculate position as of this date
        net_quantity = 0.0
        total_cost = 0.0
        for t in trades:
            td = t.get("trade_date", "")
            if td > hist_date_str:
                break
            side = str(t.get("side", "")).upper()
            qty = float(t.get("quantity", 0) or 0)
            price = float(t.get("trade_price", 0) or 0)
            if side == "BUY":
                total_cost += qty * price
                net_quantity += qty
            elif side == "SELL":
                if net_quantity > 0:
                    avg = total_cost / net_quantity
                    total_cost -= qty * avg
                net_quantity -= qty

        if net_quantity <= 0:
            continue

        avg_cost = total_cost / net_quantity if net_quantity else 0.0
        market_value = round(net_quantity * close_price, 2)
        unrealized_pnl = round(market_value - total_cost, 2)

        doc = {
            "account_id": account_id,
            "symbol": symbol,
            "quantity": round(net_quantity, 6),
            "cost_basis_money": round(total_cost, 2),
            "cost_basis_price": round(avg_cost, 6),
            "average_cost_price": round(avg_cost, 6),
            "mark_price_snapshot": round(close_price, 6),
            "market_value_snapshot": market_value,
            "unrealized_pnl_snapshot": unrealized_pnl,
            "report_date": date_tag,
            "level_of_detail": "SUMMARY",
            "asset_category": "STK",
            "source": "manual",
        }
        _raw_repository.es.update(index="ibkr_position_snapshots_v1", id=snap_id, doc=doc, doc_as_upsert=True)
        created += 1

    return {"status": "done", "symbol": symbol, "created": created, "skipped": skipped}


@router.post("/api/manual-trades/backfill-history", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def backfill_all_manual_history() -> dict:
    """Trigger historical snapshot backfill for all manual positions."""
    if _raw_repository is None:
        raise HTTPException(status_code=503, detail="storage_unavailable")

    # Find all distinct manual symbols
    trades = _raw_repository.es.search(
        index="ibkr_trade_records_v1",
        size=10000,
        term_filters={"source": "manual"},
    )
    # Group by (symbol, account_id)
    pairs = set()
    for t in trades:
        sym = str(t.get("symbol", "")).upper()
        acc = str(t.get("account_id", "manual"))
        if sym:
            pairs.add((sym, acc))

    results = []
    for sym, acc in pairs:
        try:
            r = _backfill_manual_history(sym, acc)
            results.append(r)
        except Exception as e:
            results.append({"symbol": sym, "status": "error", "error": str(e)})

    return {"status": "done", "results": results}
