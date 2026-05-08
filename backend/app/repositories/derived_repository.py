from app.repositories.es_client import ElasticsearchLike


class DerivedRepository:
    def __init__(self, es_client: ElasticsearchLike) -> None:
        self.es = es_client

    def upsert_portfolio_return(self, *, doc_id: str, doc: dict) -> None:
        self.es.update(
            index="portfolio_returns_v1",
            id=doc_id,
            doc=doc,
            doc_as_upsert=True,
        )

    def get_portfolio_return(self, doc_id: str) -> dict | None:
        try:
            return self.es.get(index="portfolio_returns_v1", id=doc_id)["_source"]
        except Exception:
            return None

    def list_portfolio_returns(self, *, size: int = 50) -> list[dict]:
        try:
            return self.es.search(
                index="portfolio_returns_v1",
                size=size,
                sort_field="date",
                descending=True,
            )
        except Exception:
            return []

    def upsert_reconciliation_result(self, *, doc_id: str, doc: dict) -> None:
        self.es.update(
            index="reconciliation_results_v1",
            id=doc_id,
            doc=doc,
            doc_as_upsert=True,
        )

    def get_latest_reconciliation_result(self) -> dict | None:
        try:
            return self.es.get(index="reconciliation_results_v1", id="latest")["_source"]
        except Exception:
            return None
