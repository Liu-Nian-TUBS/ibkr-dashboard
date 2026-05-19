from typing import Protocol

import httpx

from app.api.portfolio_analysis_contracts import PortfolioAnalysisSectionKey
from app.services.portfolio_analysis_service import PortfolioAnalysisService
from app.services.settings_service import SettingsService


class TelegramHttpClient(Protocol):
    def post(self, url: str, *, json: dict[str, object], timeout: float) -> httpx.Response: ...


class TelegramDeliveryService:
    def __init__(self, *, bot_token: str, client: TelegramHttpClient | None = None) -> None:
        self._bot_token = bot_token.strip()
        self._client = client or httpx.Client()

    def send_message(self, *, chat_id: str, text: str) -> dict[str, object]:
        if not self._bot_token:
            return {"ok": False, "status": "missing_bot_token"}
        try:
            response = self._client.post(
                f"https://api.telegram.org/bot{self._bot_token}/sendMessage",
                json={
                    "chat_id": chat_id,
                    "text": text,
                    "disable_web_page_preview": True,
                },
                timeout=10.0,
            )
        except httpx.HTTPError:
            return {"ok": False, "status": "delivery_failed"}
        if response.status_code >= 400:
            return {"ok": False, "status": "telegram_api_error", "status_code": response.status_code}
        return {"ok": True, "status": "sent"}


class TelegramCommandService:
    def __init__(
        self,
        *,
        settings_service: SettingsService,
        analysis_service: PortfolioAnalysisService,
        raw_repository: object | None = None,
    ) -> None:
        self._settings_service = settings_service
        self._analysis_service = analysis_service
        self._raw_repository = raw_repository

    def handle_command(self, *, chat_id: str, text: str) -> dict[str, object]:
        settings = self._settings_service.get()
        normalized_chat_id = str(chat_id).strip()
        if normalized_chat_id not in settings.telegram_allowlisted_chat_ids:
            return {"ok": False, "status": "forbidden", "message": "该会话不在允许列表中"}
        command = text.strip().split()[0].lower() if text.strip() else ""
        if command in {"/overview", "/summary"}:
            return {"ok": True, "status": "ready", "message": self._overview_message()}
        if command == "/positions":
            return {"ok": True, "status": "ready", "message": self._positions_message()}
        if command == "/risk":
            analysis = self._analysis_service.get_analysis(section=PortfolioAnalysisSectionKey.PORTFOLIO)
            concentration = analysis.sections.portfolio.concentration
            return {
                "ok": True,
                "status": analysis.sections.portfolio.status,
                "message": "组合风险："
                + ", ".join(
                    f"{_metric_label(key)}={metric.value}{_unit_label(metric.unit)}"
                    for key, metric in concentration.items()
                ),
            }
        if command in {"/cashflow", "/cash"}:
            return {"ok": True, "status": "ready", "message": self._cashflow_message()}
        if command == "/market":
            analysis = self._analysis_service.get_analysis(section=PortfolioAnalysisSectionKey.MARKET)
            return {
                "ok": True,
                "status": analysis.sections.market.status,
                "message": f"市场状态：{analysis.sections.market.regime.value or '缺少行情数据'}",
            }
        if command == "/report":
            message, status = self.build_daily_report_message()
            return {"ok": True, "status": status, "message": message}
        return {"ok": False, "status": "unsupported_command", "message": "暂不支持该只读命令"}

    def build_daily_report_message(self) -> tuple[str, str]:
        analysis = self._analysis_service.get_analysis()
        return (
            (
                "持仓分析日报："
                f"整体={_status_label(analysis.status.value)}；"
                f"市场={_status_label(analysis.sections.market.status.value)}；"
                f"组合={_status_label(analysis.sections.portfolio.status.value)}；"
                f"个股={_status_label(analysis.sections.stock.status.value)}"
            ),
            analysis.status.value,
        )

    def deliver_daily_report(self, delivery_service: TelegramDeliveryService) -> dict[str, object]:
        settings = self._settings_service.get()
        if not settings.telegram_reports_enabled:
            return {"status": "disabled", "sent": 0, "failed": 0, "results": []}
        if not settings.telegram_allowlisted_chat_ids:
            return {"status": "missing_chat_ids", "sent": 0, "failed": 0, "results": []}
        message, _status = self.build_daily_report_message()
        results = [
            {
                "chat_id": chat_id,
                **delivery_service.send_message(chat_id=chat_id, text=message),
            }
            for chat_id in settings.telegram_allowlisted_chat_ids
        ]
        sent = sum(1 for result in results if result.get("ok") is True)
        failed = len(results) - sent
        return {
            "status": "sent" if failed == 0 else "partial_failure",
            "sent": sent,
            "failed": failed,
            "results": results,
        }

    def _overview_message(self) -> str:
        latest = self._raw_repository.get_latest_account_snapshot() if self._raw_repository is not None else None
        if not latest:
            return "账户概览不可用：没有账户快照"
        return (
            f"账户概览 {latest.get('report_date')}："
            f"净值={latest.get('total_equity')} {latest.get('base_currency')}"
        )

    def _positions_message(self) -> str:
        if self._raw_repository is None:
            return "持仓不可用：存储尚未配置"
        rows = self._raw_repository.es.search(index="ibkr_position_snapshots_v1", size=5)
        if not rows:
            return "持仓不可用：没有当前持仓"
        symbols = ", ".join(str(row.get("symbol", "")) for row in rows if row.get("symbol"))
        return f"主要持仓：{symbols}"

    def _cashflow_message(self) -> str:
        if self._raw_repository is None:
            return "现金流不可用：存储尚未配置"
        rows = self._raw_repository.es.search(index="ibkr_stmt_funds_lines_v1", size=100)
        total = sum(_to_float(row.get("amount")) for row in rows)
        return f"现金流记录数={len(rows)}，合计={round(total, 2)}"


def _to_float(value: object) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _status_label(status: str) -> str:
    labels = {
        "ready": "已就绪",
        "pending": "生成中",
        "missing_data": "缺数据",
        "stale": "需更新",
        "unavailable": "不可用",
        "error": "错误",
    }
    return labels.get(status, status)


def _metric_label(key: str) -> str:
    labels = {
        "sector": "行业集中度",
        "single_name": "单票集中度",
        "ai_theme": "智能主题",
    }
    return labels.get(key, key)


def _unit_label(unit: str | None) -> str:
    if unit == "percent":
        return "%"
    return unit or ""
