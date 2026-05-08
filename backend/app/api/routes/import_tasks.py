from dataclasses import asdict
from pathlib import Path
from uuid import uuid4
import tempfile

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.api.response_models import STORAGE_UNAVAILABLE_OPENAPI_RESPONSE
from app.services.ingestion_service import IngestionService

router = APIRouter()
ingestion_service = IngestionService()


class ImportTaskRequest(BaseModel):
    files: list[str]


class ImportContentFile(BaseModel):
    filename: str
    content: str


class ImportContentTaskRequest(BaseModel):
    files: list[ImportContentFile]


def set_ingestion_service(service: IngestionService) -> None:
    global ingestion_service
    ingestion_service = service


@router.post(
    "/api/import/tasks",
    status_code=202,
    responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE,
)
def create_import_task(request: ImportTaskRequest) -> dict[str, str]:
    task_id = ingestion_service.enqueue(request.files)
    return {
        "task_id": task_id,
        "task_url": f"/api/import/tasks/{task_id}",
        "run_url": f"/api/import/tasks/{task_id}/run",
    }


@router.post(
    "/api/import/tasks/content",
    status_code=202,
    responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE,
)
@router.post(
    "/api/import/tasks/content/create",
    status_code=202,
    responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE,
)
def create_import_task_from_content(request: ImportContentTaskRequest) -> dict[str, str | int]:
    if not request.files:
        raise HTTPException(status_code=400, detail="files must not be empty")
    upload_dir = Path(tempfile.gettempdir()) / "ibkr-dashboard-imports"
    upload_dir.mkdir(parents=True, exist_ok=True)
    saved_paths: list[str] = []
    for item in request.files:
        if not item.content.strip():
            continue
        filename = Path(item.filename).name or "statement.xml"
        save_path = upload_dir / f"{uuid4().hex}_{filename}"
        save_path.write_text(item.content, encoding="utf-8")
        saved_paths.append(str(save_path))
    if not saved_paths:
        raise HTTPException(status_code=400, detail="no valid xml content provided")
    task_id = ingestion_service.enqueue(saved_paths)
    return {
        "task_id": task_id,
        "task_url": f"/api/import/tasks/{task_id}",
        "run_url": f"/api/import/tasks/{task_id}/run",
        "accepted_files": len(saved_paths),
    }


@router.get(
    "/api/import/tasks/{task_id}",
    responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE,
)
def get_import_task(task_id: str) -> dict:
    task = ingestion_service.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="import task not found")
    payload = asdict(task)
    payload["task_url"] = f"/api/import/tasks/{task_id}"
    payload["run_url"] = f"/api/import/tasks/{task_id}/run"
    return payload


@router.post(
    "/api/import/tasks/{task_id}/run",
    responses=STORAGE_UNAVAILABLE_OPENAPI_RESPONSE,
)
def run_import_task(task_id: str) -> dict:
    task = ingestion_service.run_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="import task not found")
    _cleanup_temp_import_files(task.files)
    payload = asdict(task)
    payload["task_url"] = f"/api/import/tasks/{task_id}"
    payload["run_url"] = f"/api/import/tasks/{task_id}/run"
    return payload


def _cleanup_temp_import_files(files: list[str]) -> None:
    upload_dir = (Path(tempfile.gettempdir()) / "ibkr-dashboard-imports").resolve()
    for file_path in files:
        try:
            candidate = Path(file_path).resolve()
        except OSError:
            continue
        if upload_dir not in candidate.parents:
            continue
        try:
            candidate.unlink(missing_ok=True)
        except OSError:
            continue
