from dataclasses import asdict

from fastapi import APIRouter

from app.api.response_models import STORAGE_UNAVAILABLE_OPENAPI_RESPONSE
from app.services.quote_service import QuoteService

router = APIRouter()
_quote_service: QuoteService | None = None


def set_quote_service(service: QuoteService | None) -> None:
    global _quote_service
    _quote_service = service


@router.get("/api/quotes/{symbol}", responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE)
def get_quote(symbol: str) -> dict:
    normalized_symbol = symbol.upper()
    if _quote_service is None:
        return {
            "symbol": normalized_symbol,
            "price": None,
            "source": "unavailable",
            "is_realtime": False,
            "request": {"symbol": normalized_symbol},
        }
    result = _quote_service.get_latest_quote(normalized_symbol)
    return {**asdict(result), "request": {"symbol": normalized_symbol}}
