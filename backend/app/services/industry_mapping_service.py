from typing import Any

from app.repositories.industry_mapping_repository import IndustryMappingRepository


DEFAULT_INDUSTRY_MAPPINGS: dict[str, str] = {
    "AAPL": "信息技术 / 消费电子",
    "AMAT": "信息技术 / 半导体设备",
    "AMD": "信息技术 / 半导体",
    "ASML": "信息技术 / 半导体设备",
    "AVGO": "信息技术 / 半导体",
    "BA": "工业 / 航空航天与国防",
    "GOOG": "通信服务 / 互联网平台",
    "GOOGL": "通信服务 / 互联网平台",
    "INTC": "信息技术 / 半导体",
    "LRCX": "信息技术 / 半导体设备",
    "META": "通信服务 / 互联网平台",
    "MSFT": "信息技术 / 软件与云计算",
    "MU": "信息技术 / 存储半导体",
    "NVDA": "信息技术 / AI芯片",
    "QCOM": "信息技术 / 通信半导体",
    "RKLB": "工业 / 航空航天与国防",
    "SMCI": "信息技术 / AI服务器",
    "TSLA": "可选消费 / 电动车",
    "TSM": "信息技术 / 半导体代工",
}


class IndustryMappingService:
    def __init__(self, repository: IndustryMappingRepository | None = None) -> None:
        self._repository = repository
        self._mappings: dict[str, str] = {}
        if self._repository is not None:
            self._mappings = dict(self._repository.list_mappings())

    def set(self, symbol: str, industry: str) -> dict[str, str]:
        normalized_symbol = symbol.upper()
        self._mappings[normalized_symbol] = industry
        if self._repository is not None:
            self._repository.upsert_mapping(symbol=normalized_symbol, industry=industry)
        return {"symbol": normalized_symbol, "industry": industry}

    def get(self, symbol: str) -> str | None:
        normalized = symbol.upper()
        return self._mappings.get(normalized) or DEFAULT_INDUSTRY_MAPPINGS.get(normalized)

    def get_override(self, symbol: str) -> str | None:
        return self._mappings.get(symbol.upper())

    def delete(self, symbol: str) -> bool:
        key = symbol.upper()
        if key in self._mappings:
            del self._mappings[key]
            if self._repository is not None:
                self._repository.mark_deleted(symbol=key)
            return True
        return False

    def list_all(self) -> list[dict[str, str]]:
        return [
            {"symbol": s, "industry": i}
            for s, i in sorted(self._mappings.items())
        ]

    def get_industry_summary(self) -> dict[str, Any]:
        industry_symbols: dict[str, list[str]] = {}
        for symbol, industry in self._mappings.items():
            industry_symbols.setdefault(industry, []).append(symbol)
        industries = [
            {
                "industry": industry,
                "symbols": sorted(symbols),
                "count": len(symbols),
            }
            for industry, symbols in sorted(industry_symbols.items())
        ]
        return {"industries": industries, "total_industries": len(industries)}
