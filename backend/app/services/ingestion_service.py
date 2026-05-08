from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
from uuid import uuid4

from app.models.domain import ParsedXmlData
from app.services.xml_parser import parse_xml_file


@dataclass(slots=True)
class ImportSummary:
    file_path: str
    record_counts: dict[str, int]


@dataclass(slots=True)
class ImportTask:
    task_id: str
    status: str
    files: list[str]
    summaries: list[ImportSummary]
    errors: list[str]
    total_files: int
    processed_files: int
    progress: float


class RawRepositoryLike(Protocol):
    def upsert_parsed_data(self, parsed: ParsedXmlData) -> None: ...


class IngestionService:
    def __init__(self, raw_repository: RawRepositoryLike | None = None) -> None:
        self.tasks: dict[str, ImportTask] = {}
        self.raw_repository = raw_repository
        self.max_task_logs = 100

    def enqueue(self, files: list[str]) -> str:
        task_id = uuid4().hex
        while len(self.tasks) >= self.max_task_logs:
            oldest_task_id = next(iter(self.tasks))
            self.tasks.pop(oldest_task_id, None)
        self.tasks[task_id] = ImportTask(
            task_id=task_id,
            status="pending",
            files=files,
            summaries=[],
            errors=[],
            total_files=len(files),
            processed_files=0,
            progress=0.0,
        )
        return task_id

    def get_task(self, task_id: str) -> ImportTask | None:
        return self.tasks.get(task_id)

    def run_task(self, task_id: str) -> ImportTask | None:
        task = self.get_task(task_id)
        if task is None:
            return None

        task.status = "running"
        for file_path in task.files:
            try:
                task.summaries.append(self.import_file(file_path))
            except Exception as exc:  # pragma: no cover - defensive task bookkeeping
                task.errors.append(f"{file_path}: {exc}")
            finally:
                task.processed_files += 1
                if task.total_files > 0:
                    task.progress = task.processed_files / task.total_files
        task.status = "failed" if task.errors else "completed"
        if task.total_files == 0:
            task.progress = 1.0
        return task

    def import_file(self, file_path: str) -> ImportSummary:
        parsed = parse_xml_file(self._resolve_file_path(file_path))
        if self.raw_repository is not None:
            self.raw_repository.upsert_parsed_data(parsed)
        return ImportSummary(
            file_path=file_path,
            record_counts={
                "account_snapshots": len(parsed.account_snapshots),
                "positions": len(parsed.positions),
                "trades": len(parsed.trades),
                "cash_transactions": len(parsed.cash_transactions),
                "statement_funds_lines": len(parsed.statement_funds_lines),
                "fx_rates": len(parsed.fx_rates),
            },
        )

    def _resolve_file_path(self, file_path: str) -> str:
        candidate = Path(file_path)
        if candidate.exists():
            return str(candidate)
        workspace_candidate = Path.cwd().parent / file_path
        if workspace_candidate.exists():
            return str(workspace_candidate)
        return file_path

