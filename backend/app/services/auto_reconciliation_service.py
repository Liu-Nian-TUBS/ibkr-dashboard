from typing import Any

from app.repositories.derived_repository import DerivedRepository
from app.repositories.raw_repository import RawRepository


class AutoReconciliationService:
    def __init__(
        self,
        *,
        raw_repository: RawRepository,
        derived_repository: DerivedRepository,
    ) -> None:
        self._raw = raw_repository
        self._derived = derived_repository

    def reconcile_date(
        self,
        *,
        account_id: str,
        report_date: str,
        tolerance: float = 0.01,
    ) -> dict[str, Any]:
        snapshot = self._get_snapshot(account_id, report_date)
        if snapshot is None:
            return {"status": "skipped", "reason": "no_snapshot"}

        snapshot_equity = float(snapshot.get("total_equity", 0) or 0)
        snapshot_cash = float(snapshot.get("cash", 0) or 0)

        positions = self._raw.es.search(
            index="ibkr_position_snapshots_v1",
            size=500,
            term_filters={"account_id": account_id},
        )
        summary_positions = [
            p for p in positions
            if p.get("report_date") == report_date
            and p.get("level_of_detail") == "SUMMARY"
        ]
        positions_total = sum(
            float(p.get("market_value_snapshot", 0) or 0)
            for p in summary_positions
        )
        expected_equity = snapshot_cash + positions_total
        diff = abs(snapshot_equity - expected_equity)
        status = "passed" if diff <= tolerance else "failed"

        result = {
            "account_id": account_id,
            "report_date": report_date,
            "status": status,
            "snapshot_equity": snapshot_equity,
            "snapshot_cash": snapshot_cash,
            "positions_total_market_value": positions_total,
            "expected_equity": expected_equity,
            "diff": round(diff, 2),
        }

        doc_id = f"{account_id}_{report_date}_recon"
        self._derived.upsert_reconciliation_result(doc_id=doc_id, doc=result)
        self._derived.upsert_reconciliation_result(doc_id="latest", doc=result)
        return result

    def _get_snapshot(self, account_id: str, report_date: str) -> dict | None:
        doc_id = f"{account_id}_{report_date}"
        try:
            return self._raw.get_account_snapshot(doc_id)
        except Exception:
            return None
