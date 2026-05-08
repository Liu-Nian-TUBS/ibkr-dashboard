from app.repositories.es_client import ElasticsearchLike


class SettingsRepository:
    def __init__(self, es_client: ElasticsearchLike) -> None:
        self.es = es_client

    def upsert_settings(self, doc: dict) -> None:
        self.es.update(
            index="app_settings_v1",
            id="global",
            doc=doc,
            doc_as_upsert=True,
        )

    def get_settings(self) -> dict | None:
        try:
            return self.es.get(index="app_settings_v1", id="global")["_source"]
        except Exception:
            return None
