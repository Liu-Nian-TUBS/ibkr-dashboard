from dataclasses import asdict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.api.response_models import STORAGE_UNAVAILABLE_OPENAPI_RESPONSE
from app.repositories.derived_repository import DerivedRepository
from app.services.auto_reconciliation_service import AutoReconciliationService
from app.services.reconciliation_service import ReconciliationResult, ReconciliationService

router = APIRouter()
service = ReconciliationService()
latest_result: ReconciliationResult | None = None
_derived_repository: DerivedRepository | object | None = None
_auto_reconciliation_service: AutoReconciliationService | object | None = None


class ReconciliationRunRequest(BaseModel):
    left: dict
    right: dict


class AutoReconciliationRequest(BaseModel):
    account_id: str
    report_date: str


def set_derived_repository(repository: object | None) -> None:
    global _derived_repository
    _derived_repository = repository


def set_auto_reconciliation_service(service: object | None) -> None:
    global _auto_reconciliation_service
    _auto_reconciliation_service = service


@router.post(
    "/api/reconciliation/run",
    responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE,
)
def run_reconciliation(payload: ReconciliationRunRequest) -> dict:
    global latest_result
    latest_result = service.compare(payload.left, payload.right)
    result = asdict(latest_result)
    if _derived_repository is not None:
        _derived_repository.upsert_reconciliation_result(doc_id="latest", doc=result)
    return {
        **result,
        "meta": {
            "left_fields": sorted(payload.left.keys()),
            "right_fields": sorted(payload.right.keys()),
        },
    }


@router.post(
    "/api/reconciliation/auto",
    responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE,
)
def run_auto_reconciliation(payload: AutoReconciliationRequest) -> dict:
    if _auto_reconciliation_service is None:
        raise HTTPException(status_code=503, detail="auto reconciliation unavailable")
    result = _auto_reconciliation_service.reconcile_date(
        account_id=payload.account_id,
        report_date=payload.report_date,
    )
    if result.get("status") == "skipped":
        raise HTTPException(status_code=404, detail="reconciliation snapshot not found")
    return {
        **result,
        "request": {
            "account_id": payload.account_id,
            "report_date": payload.report_date,
        },
    }


@router.get(
    "/api/reconciliation/latest",
    responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE,
)
def get_latest_reconciliation() -> dict:
    if _derived_repository is not None:
        saved = _derived_repository.get_latest_reconciliation_result()
        if saved is None:
            raise HTTPException(status_code=404, detail="reconciliation result not found")
        return {
            **saved,
            "meta": {"source": "derived"},
        }
    if latest_result is None:
        raise HTTPException(status_code=404, detail="reconciliation result not found")
    return {
        **asdict(latest_result),
        "meta": {"source": "memory"},
    }
