from dataclasses import asdict
from typing import Any

from app.models.domain import ParsedXmlData
from app.repositories.es_client import ElasticsearchLike


class RawRepository:
    def __init__(self, es_client: ElasticsearchLike) -> None:
        self.es = es_client

    def upsert_account_snapshot(self, doc: dict) -> None:
        self.es.update(
            index="ibkr_account_snapshots_v1",
            id=doc["id"],
            doc=doc,
            doc_as_upsert=True,
        )

    def get_account_snapshot(self, doc_id: str) -> dict:
        return self.es.get(index="ibkr_account_snapshots_v1", id=doc_id)["_source"]

    def get_latest_account_snapshot(self) -> dict[str, Any] | None:
        records = self.es.search(
            index="ibkr_account_snapshots_v1",
            size=1,
            sort_field="report_date",
            descending=True,
        )
        if not records:
            return None
        return records[0]

    def list_positions(
        self,
        *,
        symbol: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> list[dict[str, Any]]:
        filters: dict[str, str] = {}
        if symbol:
            filters["symbol"] = symbol
        return self.es.search(
            index="ibkr_position_snapshots_v1",
            offset=max(page - 1, 0) * page_size,
            size=page_size,
            sort_field="report_date",
            descending=True,
            term_filters=filters or None,
        )

    def list_trades(
        self,
        *,
        symbol: str | None = None,
        side: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> list[dict[str, Any]]:
        filters: dict[str, str] = {}
        if symbol:
            filters["symbol"] = symbol
        if side:
            filters["side"] = side
        return self.es.search(
            index="ibkr_trade_records_v1",
            offset=max(page - 1, 0) * page_size,
            size=page_size,
            term_filters=filters or None,
        )

    def list_cash_flows(
        self,
        *,
        page: int = 1,
        page_size: int = 20,
    ) -> list[dict[str, Any]]:
        return self.es.search(
            index="ibkr_stmt_funds_lines_v1",
            offset=max(page - 1, 0) * page_size,
            size=page_size,
            sort_field="report_date",
            descending=True,
        )

    def upsert_parsed_data(self, parsed: ParsedXmlData) -> None:
        for record in parsed.account_snapshots:
            self._upsert_record("ibkr_account_snapshots_v1", record.document_id, record)
        for record in parsed.positions:
            self._upsert_record("ibkr_position_snapshots_v1", record.document_id, record)
        for record in parsed.trades:
            self._upsert_record("ibkr_trade_records_v1", record.trade_id, record)
        for record in parsed.cash_transactions:
            self._upsert_record("ibkr_cash_transactions_v1", record.transaction_id, record)
        for record in parsed.statement_funds_lines:
            self._upsert_record("ibkr_stmt_funds_lines_v1", record.document_id, record)
        for record in parsed.fx_rates:
            self._upsert_record("ibkr_fx_rates_v1", record.document_id, record)

    def _upsert_record(self, index: str, doc_id: str, record: object) -> None:
        self.es.update(
            index=index,
            id=doc_id,
            doc=asdict(record),
            doc_as_upsert=True,
        )
