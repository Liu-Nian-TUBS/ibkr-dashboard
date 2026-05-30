"""Manual trade entry API — allows recording trades from non-IBKR platforms."""

from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.api.response_models import STORAGE_UNAVAILABLE_OPENAPI_RESPONSE
from app.repositories.raw_repository import RawRepository

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
    _raw_repository.es.update(index="ibkr_trade_records_v1", id=trade_id, doc=doc, doc_as_upsert=True)
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
    return {"status": "updated", "trade_id": trade_id, "record": doc}


@router.delete("/api/manual-trades/{trade_id}", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def delete_manual_trade(trade_id: str) -> dict:
    """Delete a manually-entered trade. Only manual trades can be deleted."""
    if _raw_repository is None:
        raise HTTPException(status_code=503, detail="storage_unavailable")
    if not trade_id.startswith("manual:"):
        raise HTTPException(status_code=403, detail="only manual trades can be deleted")

    try:
        _raw_repository.es.get(index="ibkr_trade_records_v1", id=trade_id)
    except (KeyError, RuntimeError):
        raise HTTPException(status_code=404, detail="trade not found")

    _raw_repository.es.delete(index="ibkr_trade_records_v1", id=trade_id)
    return {"status": "deleted", "trade_id": trade_id}
