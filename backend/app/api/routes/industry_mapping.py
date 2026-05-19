from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.api.response_models import STORAGE_UNAVAILABLE_OPENAPI_RESPONSE
from app.services.industry_mapping_service import IndustryMappingService

router = APIRouter()
_service: IndustryMappingService | None = None


def set_mapping_service(service: IndustryMappingService | None) -> None:
    global _service
    _service = service


class IndustryMappingPayload(BaseModel):
    industry: str


@router.put("/api/industry-mappings/{symbol}", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def upsert_mapping(symbol: str, payload: IndustryMappingPayload) -> dict:
    if _service is None:
        raise HTTPException(status_code=503, detail="service unavailable")
    result = _service.set(symbol, payload.industry)
    return {
        **result,
        "request": {"symbol": symbol.upper(), "industry": payload.industry},
    }


@router.get("/api/industry-mappings/summary", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def get_industry_summary() -> dict:
    if _service is None:
        raise HTTPException(status_code=503, detail="service unavailable")
    summary = _service.get_industry_summary()
    return {**summary, "filters": {}}


@router.get("/api/industry-mappings/{symbol}", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def get_mapping(symbol: str) -> dict:
    if _service is None:
        raise HTTPException(status_code=503, detail="service unavailable")
    industry = _service.get_override(symbol)
    if industry is None:
        raise HTTPException(status_code=404, detail="mapping not found")
    return {
        "symbol": symbol.upper(),
        "industry": industry,
        "request": {"symbol": symbol.upper()},
    }


@router.delete("/api/industry-mappings/{symbol}", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def delete_mapping(symbol: str) -> dict:
    if _service is None:
        raise HTTPException(status_code=503, detail="service unavailable")
    deleted = _service.delete(symbol)
    if not deleted:
        raise HTTPException(status_code=404, detail="mapping not found")
    normalized_symbol = symbol.upper()
    return {
        "symbol": normalized_symbol,
        "deleted": True,
        "request": {"symbol": normalized_symbol},
    }


@router.get("/api/industry-mappings", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def list_mappings(
    industry: str | None = None,
    symbol_prefix: str | None = None,
) -> dict:
    if _service is None:
        raise HTTPException(status_code=503, detail="service unavailable")
    items = _service.list_all()
    filtered: list[dict[str, str]] = []
    normalized_prefix = symbol_prefix.upper() if symbol_prefix else None
    for item in items:
        if industry and item["industry"] != industry:
            continue
        if normalized_prefix and not item["symbol"].startswith(normalized_prefix):
            continue
        filtered.append(item)
    return {
        "filters": {"industry": industry, "symbol_prefix": symbol_prefix},
        "items": filtered,
        "total": len(filtered),
    }
