from app.repositories.es_client import ElasticsearchLike


class IndustryMappingRepository:
    def __init__(self, es_client: ElasticsearchLike) -> None:
        self.es = es_client
        self.index = "symbol_industry_overrides_v1"

    def upsert_mapping(self, *, symbol: str, industry: str) -> None:
        self.es.update(
            index=self.index,
            id=symbol.upper(),
            doc={"symbol": symbol.upper(), "industry": industry, "deleted": False},
            doc_as_upsert=True,
        )

    def mark_deleted(self, *, symbol: str) -> None:
        self.es.update(
            index=self.index,
            id=symbol.upper(),
            doc={"symbol": symbol.upper(), "deleted": True},
            doc_as_upsert=True,
        )

    def list_mappings(self) -> dict[str, str]:
        try:
            docs = self.es.search(index=self.index, size=1000, sort_field="symbol", descending=False)
        except RuntimeError as exc:
            # HTTP ES backend may return 404 before first write creates this index.
            if "404" in str(exc):
                return {}
            raise
        mappings: dict[str, str] = {}
        for doc in docs:
            if doc.get("deleted"):
                continue
            symbol = str(doc.get("symbol", "")).upper()
            industry = str(doc.get("industry", ""))
            if symbol and industry:
                mappings[symbol] = industry
        return mappings
