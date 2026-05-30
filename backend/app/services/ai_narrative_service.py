from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from datetime import datetime
from datetime import timezone
from threading import Lock
from typing import Any, Protocol
import json
import re

import httpx

from app.api.portfolio_analysis_contracts import AINarrativePayload
from app.api.portfolio_analysis_contracts import AnalysisStatus


STRUCTURED_OVERLAY_PENDING_TTL_SECONDS = 100.0
STRUCTURED_OVERLAY_TIMEOUT_SECONDS = 90.0


class AIProvider(Protocol):
    name: str

    def generate(self, *, section: str, metrics: dict[str, Any]) -> AINarrativePayload: ...


@dataclass(slots=True)
class MockAIProvider:
    name: str = "mock"

    def generate(self, *, section: str, metrics: dict[str, Any]) -> AINarrativePayload:
        return AINarrativePayload(
            provider=self.name,
            model="mock",
            status=AnalysisStatus.READY,
            summary=f"{section} 摘要基于本地结构化指标生成，未调用外部模型。",
            bullets=["结论来自当前持仓、行业集中度、行情与本地规则", "缺失的外部数据会保留为缺失，不使用猜测值填充"],
            risks=["外部行情、新闻或情绪数据不可用时，分析置信度会下降"],
            source_metrics=sorted(metrics.keys()),
            confidence=0.65,
        )

    def generate_portfolio_overlay(self, *, metrics: dict[str, Any]) -> dict[str, Any]:
        risk_rows = []
        for row in metrics.get("risk_rows", []) or []:
            if not isinstance(row, dict):
                continue
            symbol = str(row.get("symbol") or "").upper()
            if not symbol:
                continue
            weight = _number(row.get("weight_pct"))
            daily_change = _number(row.get("daily_change_pct"))
            relevance = str(row.get("ai_relevance") or "需确认")
            if weight >= 18:
                logic_status = "模拟AI：仓位已成为组合主风险，需要用最新基本面证据重新确认持有强度"
                recommendation = "模拟AI：保留核心观察，但暂停扩大同主题暴露"
            elif daily_change <= -5:
                logic_status = "模拟AI：今日跌幅显著，先确认是否有公司层面新信息"
                recommendation = "模拟AI：先复核新闻、财报和同行表现，再决定是否把回撤视为机会"
            else:
                logic_status = "模拟AI：当前逻辑未见硬性破坏，继续跟踪验证信号"
                recommendation = "模拟AI：维持观察，等待更强证据再调整权重"
            risk_rows.append(
                {
                    "symbol": symbol,
                    "last_price": row.get("current_price"),
                    "portfolio_weight": row.get("weight_pct"),
                    "unrealized_pnl": row.get("unrealized_pnl"),
                    "ai_relevance": relevance,
                    "ai_relevance_reason": "模拟结构化判断",
                    "logic_status": logic_status,
                    "suggestion": recommendation,
                    "risk_points": ["模拟AI：需确认基本面证据", "模拟AI：需控制组合集中度"],
                    "tracking_points": ["模拟AI：跟踪财报和行业催化", "模拟AI：跟踪价格相对强弱"],
                    "position_role": "观察仓",
                    "confidence": 0.7,
                }
            )
        return {
            "risk_rows": risk_rows,
            "rebalance_advice": {
                "cards": [
                    {"rank": "①", "title": "现在最值得研究的方向", "body": "模拟AI：优先复核最大AI链条持仓的需求、毛利率和订单能见度。"},
                    {"rank": "②", "title": "最可能被低估的标的", "body": "模拟AI：只把基本面仍强、但今日被市场拖累的标的列入观察。"},
                    {"rank": "③", "title": "最拥挤/最需要小心", "body": "模拟AI：权重过高或同主题重叠的标的需要控制新增风险预算。"},
                    {"rank": "④", "title": "未来30天需要盯的催化剂", "body": "模拟AI：财报指引、AI资本开支、HBM/光模块供需和同行订单。"},
                ],
                "action_today": "模拟AI：今天先处理证据核验，而不是给出交易数量。",
                "thinking_prompt": "模拟AI：最大的问题是当前高权重持仓的基本面证据是否仍足够强。",
                "market_note": "模拟AI：在主题拥挤时，调仓优先看集中度和失效条件。",
                "research_direction": "模拟AI：AI基础设施链条的需求持续性。",
                "undervalued_symbols": "模拟AI：需结合外部估值与基本面证据确认。",
                "crowded_symbols": "模拟AI：高权重和同主题重叠持仓。",
                "catalysts_30d": "模拟AI：财报、订单、资本开支和价格信号。",
                "data_90d": "模拟AI：未来90天重点看收入指引、毛利率、库存和交期。",
                "optimal_structure": "模拟AI：保留已验证核心，新增风险预算只给证据更清晰的方向。",
                "invalidation": "模拟AI：若需求、毛利率或订单证据转弱，主题持仓需要降级。",
                "confidence": 0.7,
            },
        }

    def generate_stock_memo(self, *, metrics: dict[str, Any]) -> dict[str, Any]:
        selected = metrics.get("selected_position") if isinstance(metrics.get("selected_position"), dict) else {}
        symbol = str(metrics.get("selected_symbol") or selected.get("symbol") or "").upper()
        if not symbol or not selected:
            return _stock_memo_unavailable(
                provider=self.name,
                model="mock",
                symbol=symbol or None,
                reason="selected_symbol_not_in_current_holdings",
            )
        weight = _number(selected.get("weight_pct"))
        daily_change = _number(selected.get("daily_change_pct"))
        unrealized = _number(selected.get("unrealized_pnl"))
        ai_relevance = _stock_ai_relevance(symbol=symbol, industry=str(selected.get("industry") or ""))
        position_role = _stock_position_role(weight, ai_relevance)
        return {
            "status": AnalysisStatus.READY.value,
            "symbol": symbol,
            "one_line_view": f"{symbol} 当前更适合作为{position_role}复核。",
            "position_role": position_role,
            "logic_status": "维持" if daily_change > -5 else "削弱",
            "ai_relevance": ai_relevance,
            "holding_thesis": [
                f"{symbol} 在组合中的权重约 {weight:.2f}%。",
                "当前分析只基于本地持仓快照，未补写外部新闻或财报。",
                "是否继续强化持仓逻辑，需要后续接入公司基本面证据验证。",
            ],
            "facts": [
                f"组合权重约 {weight:.2f}%。",
                f"未实现盈亏约 {unrealized:.2f}。",
                f"当日涨跌约 {daily_change:.2f}%。",
            ],
            "inferences": [
                "权重越高，对组合波动和主题暴露的影响越大。",
                "本地持仓数据不足以单独证明基本面增强或削弱。",
            ],
            "portfolio_impact": [
                "该标的会通过仓位权重直接影响组合净值波动。",
                "若其主题与其它持仓重叠，需要合并评估集中度。",
            ],
            "key_risks": [
                "外部新闻、财报和估值数据缺失。",
                "单日价格波动不能替代基本面判断。",
                "高权重标的会放大组合回撤。",
            ],
            "tracking_questions": [
                "最近一季收入、利润率和指引是否支持当前持仓逻辑？",
                "同行表现是否验证同一产业链趋势？",
                "当前估值是否已经反映主要利好？",
            ],
            "invalidation_signals": [
                "收入或利润率趋势明显弱于预期。",
                "行业订单、资本开支或需求证据转弱。",
                "高权重风险与基本面证据不匹配。",
            ],
            "read_only_suggestion": "只读建议：先复核持仓逻辑和外部证据，再评估是否需要调整组合风险暴露。",
            "confidence": 0.62,
        }


class OpenAIResponsesProvider:
    name = "openai"

    def __init__(self, *, api_key: str, model: str = "gpt-5-mini", timeout_seconds: float = 30.0) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_seconds

    def generate(self, *, section: str, metrics: dict[str, Any]) -> AINarrativePayload:
        if not self.api_key:
            return AINarrativePayload(
                provider=self.name,
                model=self.model,
                status=AnalysisStatus.UNAVAILABLE,
                confidence=0.0,
                reason="openai_api_key_not_configured",
            )
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "summary": {"type": "string"},
                "bullets": {"type": "array", "items": {"type": "string"}},
                "risks": {"type": "array", "items": {"type": "string"}},
                "confidence": {"type": "number"},
            },
            "required": ["summary", "bullets", "risks", "confidence"],
        }
        prompt = (
            "你是一个本地只读的持仓分析助手。只允许使用输入 JSON 中的结构化指标，禁止编造缺失数据、账户、新闻、订单或交易建议。"
            "所有输出必须使用简体中文，必须围绕“当前组合”解释，事实和推断要分开，不要输出英文标题或英文段落。"
            "返回一个 JSON 对象，字段为 summary、bullets、risks、confidence。"
            "summary 用一句话给出结论；bullets 用 3 到 6 条覆盖：主要暴露、今日变化、最大风险、后续关注信号；risks 列出当前不确定性。"
            f"\n分析分区：{section}\n结构化指标 JSON：\n{json.dumps(metrics, ensure_ascii=False, sort_keys=True)}"
        )
        try:
            response = httpx.post(
                "https://api.openai.com/v1/responses",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "input": prompt,
                    "text": {
                        "format": {
                            "type": "json_schema",
                            "name": "portfolio_narrative",
                            "schema": schema,
                            "strict": True,
                        }
                    },
                },
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            payload = response.json()
            text = payload.get("output_text") or _extract_output_text(payload)
            parsed = json.loads(text or "{}")
            return AINarrativePayload(
                provider=self.name,
                model=self.model,
                status=AnalysisStatus.READY,
                summary=str(parsed.get("summary") or ""),
                bullets=_coerce_string_list(parsed.get("bullets")),
                risks=_coerce_string_list(parsed.get("risks")),
                source_metrics=sorted(metrics.keys()),
                confidence=_coerce_confidence(parsed.get("confidence")),
            )
        except httpx.TimeoutException:
            return AINarrativePayload(
                provider=self.name,
                model=self.model,
                status=AnalysisStatus.ERROR,
                confidence=0.0,
                reason="openai_generation_timed_out",
            )
        except Exception as exc:
            return AINarrativePayload(
                provider=self.name,
                model=self.model,
                status=AnalysisStatus.ERROR,
                confidence=0.0,
                reason=f"openai_generation_failed: {exc}",
            )

    def generate_portfolio_overlay(self, *, metrics: dict[str, Any]) -> dict[str, Any]:
        if not self.api_key:
            return {
                "status": AnalysisStatus.UNAVAILABLE.value,
                "provider": self.name,
                "model": self.model,
                "reason": "openai_api_key_not_configured",
            }
        prompt = _portfolio_overlay_prompt(metrics)
        try:
            response = httpx.post(
                "https://api.openai.com/v1/responses",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "input": prompt,
                    "text": {
                        "format": {
                            "type": "json_schema",
                            "name": "portfolio_structured_overlay",
                            "schema": _portfolio_overlay_schema(),
                            "strict": True,
                        }
                    },
                },
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            payload = response.json()
            text = payload.get("output_text") or _extract_output_text(payload)
            parsed = json.loads(text or "{}")
            if not isinstance(parsed, dict):
                raise ValueError("portfolio overlay is not a JSON object")
            return parsed
        except httpx.TimeoutException:
            return {
                "status": AnalysisStatus.ERROR.value,
                "provider": self.name,
                "model": self.model,
                "reason": "openai_portfolio_overlay_timed_out",
            }
        except Exception as exc:
            return {
                "status": AnalysisStatus.ERROR.value,
                "provider": self.name,
                "model": self.model,
                "reason": f"openai_portfolio_overlay_failed: {exc}",
            }
    def generate_stock_memo(self, *, metrics: dict[str, Any]) -> dict[str, Any]:
        if not self.api_key:
            return _stock_memo_unavailable(
                provider=self.name,
                model=self.model,
                symbol=str(metrics.get("selected_symbol") or "").upper() or None,
                reason="openai_api_key_not_configured",
            )
        prompt = _stock_memo_prompt(metrics)
        try:
            response = httpx.post(
                "https://api.openai.com/v1/responses",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "input": prompt,
                    "text": {
                        "format": {
                            "type": "json_schema",
                            "name": "stock_research_memo",
                            "schema": _stock_memo_schema(),
                            "strict": True,
                        }
                    },
                },
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            payload = response.json()
            text = payload.get("output_text") or _extract_output_text(payload)
            parsed = json.loads(text or "{}")
            if not isinstance(parsed, dict):
                raise ValueError("stock memo is not a JSON object")
            return parsed
        except httpx.TimeoutException:
            return _stock_memo_unavailable(
                provider=self.name,
                model=self.model,
                symbol=str(metrics.get("selected_symbol") or "").upper() or None,
                reason="openai_stock_memo_timed_out",
                status=AnalysisStatus.ERROR,
            )
        except Exception as exc:
            return _stock_memo_unavailable(
                provider=self.name,
                model=self.model,
                symbol=str(metrics.get("selected_symbol") or "").upper() or None,
                reason=f"openai_stock_memo_failed: {exc}",
                status=AnalysisStatus.ERROR,
            )


class MiniMaxChatCompletionsProvider:
    name = "minimax"

    def __init__(
        self,
        *,
        api_key: str,
        model: str = "MiniMax-M2.5-highspeed",
        base_url: str = "https://api.minimaxi.com/v1",
        timeout_seconds: float = 90.0,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.last_model_used = model
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    def generate(self, *, section: str, metrics: dict[str, Any]) -> AINarrativePayload:
        if not self.api_key:
            return AINarrativePayload(
                provider=self.name,
                model=self.model,
                status=AnalysisStatus.UNAVAILABLE,
                confidence=0.0,
                reason=f"{self.name}_api_key_not_configured",
            )
        system_prompt = (
            "你是一个本地只读的持仓分析助手。只允许使用用户提供的结构化 JSON 指标。"
            "禁止编造缺失数据、新闻、账户、订单或交易动作。"
            "所有输出必须使用简体中文，必须围绕当前组合解释，事实和推断分开。"
            "只返回一个合法 JSON 对象，字段为 summary、bullets、risks、confidence。"
        )
        user_prompt = (
            f"分析分区：{section}\n"
            "输出要求：summary 用一句话给出结论；bullets 用 3 到 6 条覆盖主要暴露、今日变化、最大风险、后续关注信号；"
            "risks 列出当前不确定性。不要输出英文标题。\n"
            f"结构化指标 JSON：\n{json.dumps(metrics, ensure_ascii=False, sort_keys=True)}"
        )
        try:
            parsed = self._generate_json(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                prefer_response_format=False,
            )
        except ValueError:
            try:
                parsed = self._generate_json(
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    prefer_response_format=True,
                )
            except ValueError as exc:
                return AINarrativePayload(
                    provider=self.name,
                    model=self.model,
                    status=AnalysisStatus.ERROR,
                    confidence=0.0,
                    reason=f"{self.name}_generation_empty_or_invalid_json: {exc}",
                )
            except httpx.TimeoutException:
                return AINarrativePayload(
                    provider=self.name,
                    model=self.model,
                    status=AnalysisStatus.ERROR,
                    confidence=0.0,
                    reason=f"{self.name}_generation_timed_out",
                )
            except Exception as exc:
                return AINarrativePayload(
                    provider=self.name,
                    model=self.model,
                    status=AnalysisStatus.ERROR,
                    confidence=0.0,
                    reason=f"{self.name}_generation_failed: {exc}",
                )
        except httpx.TimeoutException:
            return AINarrativePayload(
                provider=self.name,
                model=self.model,
                status=AnalysisStatus.ERROR,
                confidence=0.0,
                reason=f"{self.name}_generation_timed_out",
            )
        except Exception as exc:
            return AINarrativePayload(
                provider=self.name,
                model=self.model,
                status=AnalysisStatus.ERROR,
                confidence=0.0,
                reason=f"{self.name}_generation_failed: {exc}",
            )
        try:
            return AINarrativePayload(
                provider=self.name,
                model=self.model,
                status=AnalysisStatus.READY,
                summary=str(parsed.get("summary") or ""),
                bullets=_coerce_string_list(parsed.get("bullets")),
                risks=_coerce_string_list(parsed.get("risks")),
                source_metrics=sorted(metrics.keys()),
                confidence=_coerce_confidence(parsed.get("confidence")),
            )
        except httpx.TimeoutException:
            return AINarrativePayload(
                provider=self.name,
                model=self.model,
                status=AnalysisStatus.ERROR,
                confidence=0.0,
                reason=f"{self.name}_generation_timed_out",
            )
        except Exception as exc:
            return AINarrativePayload(
                provider=self.name,
                model=self.model,
                status=AnalysisStatus.ERROR,
                confidence=0.0,
                reason=f"{self.name}_generation_failed: {exc}",
            )

    def _post_chat_completion(self, endpoint_url: str, payload: dict[str, Any]) -> httpx.Response:
        response = httpx.post(
            endpoint_url,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=httpx.Timeout(self.timeout_seconds, connect=10.0),
        )
        response.raise_for_status()
        return response

    def _generate_json(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        prefer_response_format: bool,
        max_tokens: int = 1600,
    ) -> dict[str, Any]:
        endpoint_url = _chat_completions_url(self.base_url)
        last_exc: Exception | None = None
        for model in self._model_candidates():
            payload = self._request_payload(
                model=model,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                response_format=prefer_response_format,
                max_tokens=max_tokens,
            )
            try:
                response = self._post_chat_completion(endpoint_url, payload)
                response_payload = _response_json(response)
                self._raise_response_error(response_payload)
                self.last_model_used = model
                return _parse_json_object(_extract_chat_completion_text(response_payload))
            except httpx.HTTPStatusError as exc:
                last_exc = exc
                if exc.response.status_code != 429 or model != self.model:
                    raise
                continue
        if last_exc is not None:
            raise last_exc
        raise ValueError("minimax_model_candidates_empty")

    def _model_candidates(self) -> list[str]:
        return _minimax_model_candidates(self.model)

    def _request_payload(
        self,
        *,
        model: str,
        system_prompt: str,
        user_prompt: str,
        response_format: bool,
        max_tokens: int,
    ) -> dict[str, Any]:
        return _minimax_request_payload(
            model=model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            response_format=response_format,
            max_tokens=max_tokens,
        )

    def _raise_response_error(self, payload: dict[str, Any]) -> None:
        _raise_for_minimax_base_resp(payload)

    def generate_portfolio_overlay(self, *, metrics: dict[str, Any]) -> dict[str, Any]:
        if not self.api_key:
            return {
                "status": AnalysisStatus.UNAVAILABLE.value,
                "provider": self.name,
                "model": self.model,
                "reason": f"{self.name}_api_key_not_configured",
            }
        system_prompt = (
            "你是本地只读投资看板中的结构化持仓风险校验器。只允许使用用户输入 JSON。"
            "禁止编造新闻、公告、账户、订单、价格和交易动作。只给定性分析建议，不给下单数量。"
            "必须返回合法 JSON 对象，字段严格匹配用户要求。"
        )
        user_prompt = _portfolio_overlay_prompt(metrics)
        original_timeout = self.timeout_seconds
        self.timeout_seconds = min(self.timeout_seconds, STRUCTURED_OVERLAY_TIMEOUT_SECONDS)
        try:
            return self._generate_json(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                prefer_response_format=True,
                max_tokens=5000,
            )
        except httpx.TimeoutException:
            return {
                "status": AnalysisStatus.ERROR.value,
                "provider": self.name,
                "model": self.model,
                "reason": f"{self.name}_portfolio_overlay_timed_out",
            }
        except Exception as exc:
            return {
                "status": AnalysisStatus.ERROR.value,
                "provider": self.name,
                "model": self.model,
                "reason": f"{self.name}_portfolio_overlay_failed: {exc}",
            }
        finally:
            self.timeout_seconds = original_timeout

    def generate_stock_memo(self, *, metrics: dict[str, Any]) -> dict[str, Any]:
        if not self.api_key:
            return _stock_memo_unavailable(
                provider=self.name,
                model=self.model,
                symbol=str(metrics.get("selected_symbol") or "").upper() or None,
                reason=f"{self.name}_api_key_not_configured",
            )
        system_prompt = (
            "你是本地只读 IBKR 投资看板中的个股持仓分析助手。"
            "只能使用用户输入 JSON，禁止编造新闻、财报、订单、估值、目标价、账户信息或交易动作。"
            "必须返回合法 JSON 对象，字段严格匹配用户要求。"
        )
        original_timeout = self.timeout_seconds
        self.timeout_seconds = min(self.timeout_seconds, STRUCTURED_OVERLAY_TIMEOUT_SECONDS)
        try:
            return self._generate_json(
                system_prompt=system_prompt,
                user_prompt=_stock_memo_prompt(metrics),
                prefer_response_format=True,
                max_tokens=3500,
            )
        except httpx.TimeoutException:
            return _stock_memo_unavailable(
                provider=self.name,
                model=self.model,
                symbol=str(metrics.get("selected_symbol") or "").upper() or None,
                reason=f"{self.name}_stock_memo_timed_out",
                status=AnalysisStatus.ERROR,
            )
        except Exception as exc:
            return _stock_memo_unavailable(
                provider=self.name,
                model=self.model,
                symbol=str(metrics.get("selected_symbol") or "").upper() or None,
                reason=f"{self.name}_stock_memo_failed: {exc}",
                status=AnalysisStatus.ERROR,
            )
        finally:
            self.timeout_seconds = original_timeout


class DeepSeekChatCompletionsProvider(MiniMaxChatCompletionsProvider):
    name = "deepseek"

    def __init__(
        self,
        *,
        api_key: str,
        model: str = "deepseek-v4-flash",
        base_url: str = "https://api.deepseek.com",
        timeout_seconds: float = 90.0,
    ) -> None:
        super().__init__(
            api_key=api_key,
            model=model,
            base_url=base_url,
            timeout_seconds=timeout_seconds,
        )

    def _model_candidates(self) -> list[str]:
        normalized = str(self.model or "").strip() or "deepseek-v4-flash"
        return [normalized]

    def _request_payload(
        self,
        *,
        model: str,
        system_prompt: str,
        user_prompt: str,
        response_format: bool,
        max_tokens: int,
    ) -> dict[str, Any]:
        return _openai_compatible_chat_request_payload(
            model=model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            response_format=response_format,
            max_tokens=max_tokens,
        )

    def _raise_response_error(self, payload: dict[str, Any]) -> None:
        return None


class CustomOpenAICompatibleProvider(MiniMaxChatCompletionsProvider):
    """Generic OpenAI-compatible provider (e.g. copilot2api, one-api, new-api)."""

    name = "custom"

    def __init__(
        self,
        *,
        api_key: str,
        model: str = "gpt-4o",
        base_url: str = "http://127.0.0.1:8080/v1",
        timeout_seconds: float = 120.0,
    ) -> None:
        super().__init__(
            api_key=api_key,
            model=model,
            base_url=base_url,
            timeout_seconds=timeout_seconds,
        )

    def _model_candidates(self) -> list[str]:
        normalized = str(self.model or "").strip() or "gpt-4o"
        return [normalized]

    def _request_payload(
        self,
        *,
        model: str,
        system_prompt: str,
        user_prompt: str,
        response_format: bool,
        max_tokens: int,
    ) -> dict[str, Any]:
        return _openai_compatible_chat_request_payload(
            model=model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            response_format=response_format,
            max_tokens=max_tokens,
        )

    def _raise_response_error(self, payload: dict[str, Any]) -> None:
        return None


class AINarrativeService:
    _shared_daily_cache: dict[tuple[str, str, str], AINarrativePayload] = {}
    _shared_refresh_state: dict[tuple[str, str, str], AINarrativePayload] = {}
    _shared_structured_cache: dict[tuple[str, str, str], dict[str, Any]] = {}
    _shared_structured_state: dict[tuple[str, str, str], dict[str, Any]] = {}
    _lock = Lock()

    def __init__(self) -> None:
        self._daily_cache = self._shared_daily_cache
        self._refresh_state = self._shared_refresh_state
        self._structured_cache = self._shared_structured_cache
        self._structured_state = self._shared_structured_state

    def generate(
        self,
        *,
        provider: AIProvider,
        section: str,
        metrics: dict[str, Any],
        cache_key: str = "default",
        force: bool = False,
    ) -> AINarrativePayload:
        key = self._key(provider=provider, section=section, cache_key=cache_key)
        with self._lock:
            cached = self._daily_cache.get(key)
        if cached is not None and not force:
            return cached
        compact_metrics = _compact_metrics_for_ai(metrics)
        if force:
            self.mark_refresh_started(provider=provider, section=section, cache_key=cache_key)
        narrative = provider.generate(section=section, metrics=compact_metrics)
        if narrative.status == AnalysisStatus.READY:
            narrative.as_of = narrative.as_of or _now_iso()
            with self._lock:
                self._daily_cache[key] = narrative
                self._refresh_state[key] = narrative
        elif force:
            fallback = _fallback_narrative(provider=provider, section=section, metrics=compact_metrics, reason=narrative.reason)
            with self._lock:
                self._refresh_state[key] = fallback
            return fallback
        elif narrative.status == AnalysisStatus.ERROR:
            return _fallback_narrative(provider=provider, section=section, metrics=compact_metrics, reason=narrative.reason)
        return narrative

    def generate_portfolio_overlay(
        self,
        *,
        provider: AIProvider,
        metrics: dict[str, Any],
        cache_key: str = "default",
        force: bool = False,
    ) -> dict[str, Any]:
        key = self._key(provider=provider, section="portfolio_overlay", cache_key=cache_key)
        with self._lock:
            cached = self._structured_cache.get(key)
        if cached is not None and not force:
            return dict(cached)

        generator = getattr(provider, "generate_portfolio_overlay", None)
        if not callable(generator):
            return _portfolio_overlay_unavailable(provider=provider, reason="provider_does_not_support_portfolio_overlay")

        compact_metrics = _compact_metrics_for_ai(metrics)
        if force:
            self.mark_portfolio_overlay_started(provider=provider, cache_key=cache_key)
        overlay = generator(metrics=compact_metrics)
        if not isinstance(overlay, dict):
            overlay = _portfolio_overlay_unavailable(provider=provider, reason="provider_returned_invalid_portfolio_overlay")
        overlay.setdefault("provider", provider.name)
        overlay.setdefault("model", _provider_model(provider))
        overlay.setdefault("as_of", _now_iso())
        overlay.setdefault("status", AnalysisStatus.READY.value)
        overlay.setdefault("confidence", _coerce_confidence(_portfolio_overlay_confidence(overlay)))
        with self._lock:
            if overlay.get("status") == AnalysisStatus.READY.value:
                self._structured_cache[key] = dict(overlay)
            self._structured_state[key] = dict(overlay)
        return overlay

    def cache_portfolio_overlay(
        self,
        *,
        provider: AIProvider,
        cache_key: str = "default",
        overlay: dict[str, Any],
    ) -> None:
        key = self._key(provider=provider, section="portfolio_overlay", cache_key=cache_key)
        with self._lock:
            if overlay.get("status") == AnalysisStatus.READY.value:
                self._structured_cache[key] = dict(overlay)
            self._structured_state[key] = dict(overlay)

    def generate_stock_memo(
        self,
        *,
        provider: AIProvider,
        metrics: dict[str, Any],
        cache_key: str = "default",
        force: bool = False,
    ) -> dict[str, Any]:
        key = self._key(provider=provider, section="stock_memo", cache_key=cache_key)
        with self._lock:
            cached = self._structured_cache.get(key)
        if cached is not None and not force:
            return dict(cached)

        generator = getattr(provider, "generate_stock_memo", None)
        if not callable(generator):
            return _stock_memo_unavailable(
                provider=provider.name,
                model=_provider_model(provider),
                symbol=str(metrics.get("selected_symbol") or "").upper() or None,
                reason="provider_does_not_support_stock_memo",
            )

        compact_metrics = _compact_metrics_for_ai(metrics)
        if force:
            self.mark_stock_memo_started(provider=provider, cache_key=cache_key)
        memo = generator(metrics=compact_metrics)
        if not isinstance(memo, dict):
            memo = _stock_memo_unavailable(
                provider=provider.name,
                model=_provider_model(provider),
                symbol=str(metrics.get("selected_symbol") or "").upper() or None,
                reason="provider_returned_invalid_stock_memo",
            )
        memo.setdefault("provider", provider.name)
        memo.setdefault("model", _provider_model(provider))
        memo.setdefault("as_of", _now_iso())
        memo.setdefault("status", AnalysisStatus.READY.value)
        memo.setdefault("confidence", _coerce_confidence(memo.get("confidence")))
        with self._lock:
            if memo.get("status") == AnalysisStatus.READY.value:
                self._structured_cache[key] = dict(memo)
            self._structured_state[key] = dict(memo)
        return memo

    def cached_portfolio_overlay_or_pending(
        self,
        *,
        provider: AIProvider,
        cache_key: str = "default",
    ) -> dict[str, Any]:
        key = self._key(provider=provider, section="portfolio_overlay", cache_key=cache_key)
        with self._lock:
            cached = self._structured_cache.get(key)
            state = self._structured_state.get(key)
        if cached is not None:
            return dict(cached)
        if state is not None:
            if _portfolio_overlay_pending_expired(state):
                expired = {
                    "status": AnalysisStatus.ERROR.value,
                    "provider": provider.name,
                    "model": _provider_model(provider),
                    "as_of": _now_iso(),
                    "confidence": 0.0,
                    "reason": "structured_ai_overlay_timed_out",
                }
                with self._lock:
                    self._structured_state[key] = expired
                return expired
            return dict(state)
        return _portfolio_overlay_pending(provider=provider, reason="structured_ai_overlay_waiting_for_background_refresh")

    def cached_portfolio_overlay_or_unavailable(
        self,
        *,
        provider: AIProvider,
        cache_key: str = "default",
    ) -> dict[str, Any]:
        key = self._key(provider=provider, section="portfolio_overlay", cache_key=cache_key)
        with self._lock:
            cached = self._structured_cache.get(key)
            state = self._structured_state.get(key)
        if cached is not None:
            return dict(cached)
        if state is not None:
            if state.get("status") == AnalysisStatus.PENDING.value and _portfolio_overlay_pending_expired(state):
                expired = {
                    "status": AnalysisStatus.ERROR.value,
                    "provider": provider.name,
                    "model": _provider_model(provider),
                    "as_of": _now_iso(),
                    "confidence": 0.0,
                    "reason": "structured_ai_overlay_timed_out",
                }
                with self._lock:
                    self._structured_state[key] = expired
                return expired
            return dict(state)
        return _portfolio_overlay_unavailable(provider=provider, reason="structured_ai_overlay_waiting_for_manual_refresh")

    def mark_portfolio_overlay_started(
        self,
        *,
        provider: AIProvider,
        cache_key: str = "default",
    ) -> None:
        key = self._key(provider=provider, section="portfolio_overlay", cache_key=cache_key)
        with self._lock:
            self._structured_state[key] = _portfolio_overlay_pending(
                provider=provider,
                reason="structured_ai_overlay_refresh_in_progress",
            )

    def cached_stock_memo_or_pending(
        self,
        *,
        provider: AIProvider,
        cache_key: str = "default",
    ) -> dict[str, Any]:
        key = self._key(provider=provider, section="stock_memo", cache_key=cache_key)
        with self._lock:
            cached = self._structured_cache.get(key)
            state = self._structured_state.get(key)
        if cached is not None:
            return dict(cached)
        if state is not None:
            if _portfolio_overlay_pending_expired(state):
                expired = {
                    "status": AnalysisStatus.ERROR.value,
                    "provider": provider.name,
                    "model": _provider_model(provider),
                    "as_of": _now_iso(),
                    "confidence": 0.0,
                    "reason": "stock_memo_generation_timed_out",
                }
                with self._lock:
                    self._structured_state[key] = expired
                return expired
            return dict(state)
        return _stock_memo_pending(provider=provider, reason="stock_memo_waiting_for_background_refresh")

    def mark_stock_memo_started(
        self,
        *,
        provider: AIProvider,
        cache_key: str = "default",
    ) -> None:
        key = self._key(provider=provider, section="stock_memo", cache_key=cache_key)
        with self._lock:
            self._structured_state[key] = _stock_memo_pending(
                provider=provider,
                reason="stock_memo_refresh_in_progress",
            )

    def mark_portfolio_overlay_failed(
        self,
        *,
        provider: AIProvider,
        cache_key: str = "default",
        reason: str,
    ) -> None:
        key = self._key(provider=provider, section="portfolio_overlay", cache_key=cache_key)
        with self._lock:
            self._structured_state[key] = {
                "status": AnalysisStatus.ERROR.value,
                "provider": provider.name,
                "model": _provider_model(provider),
                "as_of": _now_iso(),
                "confidence": 0.0,
                "reason": reason,
            }

    def mark_refresh_started(
        self,
        *,
        provider: AIProvider,
        section: str,
        cache_key: str = "default",
    ) -> None:
        key = self._key(provider=provider, section=section, cache_key=cache_key)
        with self._lock:
            self._refresh_state[key] = AINarrativePayload(
                provider=provider.name,
                model=_provider_model(provider),
                status=AnalysisStatus.PENDING,
                confidence=0.0,
                as_of=_now_iso(),
                reason="ai_narrative_refresh_in_progress",
            )

    def cached_or_pending(
        self,
        *,
        provider: AIProvider,
        section: str,
        cache_key: str = "default",
    ) -> AINarrativePayload:
        key = self._key(provider=provider, section=section, cache_key=cache_key)
        with self._lock:
            refresh_state = self._refresh_state.get(key)
            cached = self._daily_cache.get(key)
        if refresh_state is not None and refresh_state.status == AnalysisStatus.PENDING:
            return refresh_state
        if cached is not None:
            return cached
        if refresh_state is not None:
            return refresh_state
        return AINarrativePayload(
            provider=provider.name,
            model=_provider_model(provider),
            status=AnalysisStatus.PENDING,
            confidence=0.0,
            reason="ai_narrative_waiting_for_manual_refresh",
        )

    def _key(self, *, provider: AIProvider, section: str, cache_key: str) -> tuple[str, str, str]:
        return (date.today().isoformat(), provider.name, f"{section}:{cache_key}")


def _safe_refresh_error(*, provider: AIProvider, narrative: AINarrativePayload) -> AINarrativePayload:
    reason = narrative.reason or f"{provider.name}_generation_failed"
    if "timed_out" in reason or "timed out" in reason or "read operation timed out" in reason:
        reason = f"{provider.name}_generation_timed_out_retry_later"
    return AINarrativePayload(
        provider=provider.name,
        model=narrative.model or _provider_model(provider),
        status=AnalysisStatus.ERROR,
        confidence=0.0,
        as_of=_now_iso(),
        reason=reason,
    )


def _fallback_narrative(*, provider: AIProvider, section: str, metrics: dict[str, Any], reason: str | None) -> AINarrativePayload:
    metric_names = sorted(metrics.keys())
    return AINarrativePayload(
        provider="local_rules",
        model=None,
        status=AnalysisStatus.READY,
        summary="外部模型暂不可用，本摘要改用本地结构化指标生成；市场与持仓数据不受影响。",
        bullets=_fallback_bullets(section=section, metrics=metrics),
        risks=[
            f"外部模型 {provider.name} 生成失败，原因：{reason or 'unknown'}",
            "本地摘要只解释已有结构化数据，不补写新闻、公告或未接入情绪源。",
        ],
        source_metrics=metric_names,
        confidence=0.45,
        as_of=_now_iso(),
        reason=f"{provider.name}_fallback_to_local_rules",
    )


def _fallback_bullets(*, section: str, metrics: dict[str, Any]) -> list[str]:
    if section == "market":
        regime = metrics.get("market_regime", {})
        value = regime.get("value") if isinstance(regime, dict) else None
        return [
            f"当前市场状态：{value or '待判断'}。",
            "市场情绪优先使用外部指标，缺失时回退到本地规则代理。",
            "重点看市场状态如何传导到高权重持仓，而不是孤立看指数涨跌。",
        ]
    if section == "portfolio":
        return [
            "组合风险由集中度、主题暴露、相关性、尾部风险和宏观敏感性共同判断。",
            "高权重持仓与同主题持仓会放大组合波动。",
            "防御建议只提供风险方向，不包含交易执行。",
        ]
    return [
        "个股分析基于当前持仓、价格趋势、组合权重和本地风险规则。",
        "方向判断是短期信号，不代表基本面结论。",
        "需要继续跟踪价格、财报、公告和同主题持仓联动。",
    ]


def _portfolio_overlay_unavailable(*, provider: AIProvider, reason: str) -> dict[str, Any]:
    return {
        "status": AnalysisStatus.UNAVAILABLE.value,
        "provider": provider.name,
        "model": _provider_model(provider),
        "as_of": _now_iso(),
        "confidence": 0.0,
        "reason": reason,
    }


def _portfolio_overlay_pending(*, provider: AIProvider, reason: str) -> dict[str, Any]:
    return {
        "status": AnalysisStatus.PENDING.value,
        "provider": provider.name,
        "model": _provider_model(provider),
        "as_of": _now_iso(),
        "confidence": 0.0,
        "reason": reason,
    }


def _portfolio_overlay_pending_expired(state: dict[str, Any]) -> bool:
    if state.get("status") != AnalysisStatus.PENDING.value:
        return False
    as_of = state.get("as_of")
    if not isinstance(as_of, str) or not as_of:
        return True
    try:
        started = datetime.fromisoformat(as_of)
    except ValueError:
        return True
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - started).total_seconds() > STRUCTURED_OVERLAY_PENDING_TTL_SECONDS


def _stock_memo_unavailable(
    *,
    provider: str,
    model: str | None,
    symbol: str | None,
    reason: str,
    status: AnalysisStatus = AnalysisStatus.UNAVAILABLE,
) -> dict[str, Any]:
    return {
        "status": status.value,
        "provider": provider,
        "model": model,
        "symbol": symbol,
        "one_line_view": None,
        "position_role": None,
        "logic_status": None,
        "ai_relevance": None,
        "holding_thesis": [],
        "facts": [],
        "inferences": [],
        "portfolio_impact": [],
        "key_risks": [],
        "tracking_questions": [],
        "invalidation_signals": [],
        "read_only_suggestion": None,
        "confidence": 0.0,
        "as_of": _now_iso(),
        "reason": reason,
    }


def _stock_memo_pending(*, provider: AIProvider, reason: str) -> dict[str, Any]:
    return {
        "status": AnalysisStatus.PENDING.value,
        "provider": provider.name,
        "model": _provider_model(provider),
        "symbol": None,
        "confidence": 0.0,
        "as_of": _now_iso(),
        "reason": reason,
    }


def _stock_memo_schema() -> dict[str, Any]:
    string_array = {"type": "array", "items": {"type": "string"}}
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "status": {"type": "string", "enum": ["ready", "unavailable"]},
            "symbol": {"type": ["string", "null"]},
            "one_line_view": {"type": ["string", "null"]},
            "position_role": {"type": ["string", "null"], "enum": ["核心仓", "卫星仓", "观察仓", "待复核仓", None]},
            "logic_status": {"type": ["string", "null"], "enum": ["增强", "维持", "削弱", "无法判断", None]},
            "ai_relevance": {"type": ["string", "null"], "enum": ["极高", "高", "中", "低", "无", "无法判断", None]},
            "holding_thesis": string_array,
            "facts": string_array,
            "inferences": string_array,
            "portfolio_impact": string_array,
            "key_risks": string_array,
            "tracking_questions": string_array,
            "invalidation_signals": string_array,
            "read_only_suggestion": {"type": ["string", "null"]},
            "confidence": {"type": "number"},
        },
        "required": [
            "status",
            "symbol",
            "one_line_view",
            "position_role",
            "logic_status",
            "ai_relevance",
            "holding_thesis",
            "facts",
            "inferences",
            "portfolio_impact",
            "key_risks",
            "tracking_questions",
            "invalidation_signals",
            "read_only_suggestion",
            "confidence",
        ],
    }


def _stock_memo_prompt(metrics: dict[str, Any]) -> str:
    return (
        "你是一个本地只读的 IBKR 持仓分析助手。你的任务是分析用户当前持仓中的一个已选择股票。\n\n"
        "严格规则：\n"
        "1. 只能分析输入 JSON 中 selected_symbol 对应的持仓股票。\n"
        "2. 如果 selected_symbol 不在 current_holdings 里，返回 unavailable，不要分析。\n"
        "3. 只能使用输入 JSON 提供的数据；缺失的数据必须明确写“缺失”或“无法判断”。\n"
        "4. 可以做投资逻辑推理，但必须把“事实”和“推断”分开。\n"
        "5. 禁止编造新闻、财报、订单、估值、价格、目标价、账户信息或外部数据。\n"
        "6. 禁止给出下单数量、具体交易指令、止盈止损价格或任何执行型建议。\n"
        "7. 输出必须是简体中文。\n"
        "8. 输出必须是合法 JSON，不要 Markdown，不要额外解释。\n\n"
        "分析目标：\n"
        "请围绕 selected_symbol 生成一份个股持仓分析，重点回答："
        "这只股票在当前组合里的角色是什么；当前持有它最可能依赖的核心投资逻辑是什么；"
        "这个逻辑现在看起来是增强、维持、削弱，还是无法判断；它和 AI 主线、行业趋势、组合风险之间的关系是什么；"
        "当前最应该继续验证的 3 个问题是什么；哪些情况会让这只股票的持仓逻辑失效。\n\n"
        "输出 JSON 字段必须为：status、symbol、one_line_view、position_role、logic_status、ai_relevance、"
        "holding_thesis、facts、inferences、portfolio_impact、key_risks、tracking_questions、"
        "invalidation_signals、read_only_suggestion、confidence。\n"
        "position_role 只能是 核心仓/卫星仓/观察仓/待复核仓。"
        "logic_status 只能是 增强/维持/削弱/无法判断。"
        "ai_relevance 只能是 极高/高/中/低/无/无法判断。"
        "holding_thesis、facts、inferences、portfolio_impact、key_risks、tracking_questions、invalidation_signals 各 2-4 条。\n"
        f"输入 JSON：\n{json.dumps(metrics, ensure_ascii=False, sort_keys=True)}"
    )


def _stock_ai_relevance(*, symbol: str, industry: str) -> str:
    token = f"{symbol} {industry}".upper()
    if any(key in token for key in ("NVDA", "AVGO", "TSM", "ASML", "AMD", "SMCI", "MU", "HBM", "SEMICONDUCTOR")):
        return "极高"
    if any(key in token for key in ("MSFT", "GOOGL", "GOOG", "META", "AI", "DATA CENTER", "CLOUD")):
        return "高"
    if any(key in token for key in ("TSLA", "ROBOT", "AUTO", "SERVER", "AEROSPACE")):
        return "中"
    return "低"


def _stock_position_role(weight_pct: float, ai_relevance: str) -> str:
    if weight_pct >= 18 and ai_relevance in {"极高", "高"}:
        return "核心仓"
    if weight_pct >= 8:
        return "卫星仓"
    if weight_pct >= 2:
        return "观察仓"
    return "待复核仓"


def _portfolio_overlay_schema() -> dict[str, Any]:
    string_array = {"type": "array", "items": {"type": "string"}}
    card_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "rank": {"type": "string"},
            "icon": {"type": "string"},
            "title": {"type": "string"},
            "body": {"type": "string"},
        },
        "required": ["rank", "title", "body"],
    }
    row_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "symbol": {"type": "string"},
            "last_price": {"type": ["number", "string", "null"]},
            "portfolio_weight": {"type": ["number", "string", "null"]},
            "unrealized_pnl": {"type": ["number", "string", "null"]},
            "ai_relevance": {"type": "string"},
            "ai_relevance_reason": {"type": "string"},
            "logic_status": {"type": "string"},
            "suggestion": {"type": "string"},
            "risk_points": string_array,
            "tracking_points": string_array,
            "position_role": {"type": "string"},
            "confidence": {"type": "number"},
        },
        "required": [
            "symbol",
            "last_price",
            "portfolio_weight",
            "unrealized_pnl",
            "ai_relevance",
            "ai_relevance_reason",
            "logic_status",
            "suggestion",
            "risk_points",
            "tracking_points",
            "position_role",
            "confidence",
        ],
    }
    advice_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "cards": {"type": "array", "items": card_schema},
            "action_today": {"type": "string"},
            "thinking_prompt": {"type": "string"},
            "market_note": {"type": "string"},
            "research_direction": {"type": "string"},
            "undervalued_symbols": {"type": "string"},
            "crowded_symbols": {"type": "string"},
            "catalysts_30d": {"type": "string"},
            "data_90d": {"type": "string"},
            "optimal_structure": {"type": "string"},
            "invalidation": {"type": "string"},
            "confidence": {"type": "number"},
        },
        "required": [
            "cards",
            "action_today",
            "thinking_prompt",
            "market_note",
            "research_direction",
            "undervalued_symbols",
            "crowded_symbols",
            "catalysts_30d",
            "data_90d",
            "optimal_structure",
            "invalidation",
            "confidence",
        ],
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "risk_rows": {"type": "array", "items": row_schema},
            "rebalance_advice": advice_schema,
            "confidence": {"type": "number"},
        },
        "required": ["risk_rows", "rebalance_advice", "confidence"],
    }


def _portfolio_overlay_prompt(metrics: dict[str, Any]) -> str:
    return (
        "你是一名专业的全球股票投资分析助手，擅长结合持仓数据、AI产业链逻辑、财报、新闻事件、技术面和市场情绪，"
        "对单个持仓标的进行投资逻辑分析。\n"
        "现在请逐个分析输入 JSON 中 risk_rows 的每一个持仓标的；每一行都必须当作单个持仓标的独立判断。\n"
        "输入字段说明：symbol=标的，current_price=当前价，weight_pct=组合权重百分比，unrealized_pnl=浮盈亏，"
        "avg_cost=持仓成本，position_qty=持仓数量，news_summary/earnings_summary/technical_summary/sentiment_summary 为可用摘要；"
        "如果新闻或财报摘要缺失，可以基于公开常识和行业逻辑分析；如果技术面或情绪摘要缺失，不要编造具体指标。\n"
        "分析任务：为每个标的生成 AI关联度、逻辑状态、建议、风险点、跟踪重点、仓位角色。\n"
        "AI关联度只能从 极高/高/中/低/无 中选择："
        "极高=AI算力、GPU、HBM、AI光模块、AI半导体核心基础设施等直接受益；"
        "高=AI软件、Agentic AI、AI数据中心、AI基础设施、AI半导体ETF等高度相关；"
        "中=代工、数据中心材料、自动驾驶、机器人、服务器供应链等间接受益；"
        "低=弱关联或边缘受益；无=基本无关。\n"
        "ai_relevance_reason 用一句话写成类似 HBM核心、AI算力核心、自动驾驶/机器人、太空/航天；无关联时写无。\n"
        "逻辑状态必须判断：投资逻辑是否仍成立、是否属于AI主线、是否有财报/订单/行业景气/新闻催化支撑、"
        "是否存在估值过高/政策风险/竞争压力/逻辑弱化、是否进入业绩兑现阶段、权重是否匹配逻辑强度、浮盈亏是否影响操作空间。"
        "逻辑状态要简洁直接，例如：强，AI主线明确，业绩兑现仍在延续；弱，和AI主题关联低，需独立验证买入逻辑。\n"
        "建议必须考虑权重、浮盈亏、AI关联度、逻辑强弱、核心仓/卫星仓/观察仓/待清理仓定位和组合集中度；"
        "可使用：持有、维持、小幅增持、回调时补仓、逐步增仓、减仓、暂不加仓、确认逻辑后再加仓、评估是否止损清仓。"
        "建议是只读分析建议，不能给下单数量，不能指示执行交易。\n"
        "严格输出 JSON，不要 Markdown，不要多余解释。顶层字段为 risk_rows、rebalance_advice、confidence。"
        "risk_rows 每行字段必须为：symbol、last_price、portfolio_weight、unrealized_pnl、ai_relevance、ai_relevance_reason、"
        "logic_status、suggestion、risk_points、tracking_points、position_role、confidence。"
        "position_role 只能是 核心仓/卫星仓/观察仓/待清理仓。risk_points 和 tracking_points 各 2-3 条。"
        "rebalance_advice 字段：cards、action_today、thinking_prompt、market_note、research_direction、undervalued_symbols、"
        "crowded_symbols、catalysts_30d、data_90d、optimal_structure、invalidation、confidence。\n"
        "cards 中每张卡可带 icon，允许值为 compass/search/alert/calendar/check。\n"
        f"输入 JSON：\n{json.dumps(metrics, ensure_ascii=False, sort_keys=True)}"
    )


def _portfolio_overlay_confidence(overlay: dict[str, Any]) -> float:
    advice = overlay.get("rebalance_advice")
    if isinstance(advice, dict) and advice.get("confidence") is not None:
        return _coerce_confidence(advice.get("confidence"))
    return _coerce_confidence(overlay.get("confidence"))


def _compact_metrics_for_ai(metrics: dict[str, Any]) -> dict[str, Any]:
    compact = _compact_value(metrics, depth=0)
    if isinstance(compact, dict):
        return compact
    return {"metrics": compact}


def _compact_value(value: Any, *, depth: int) -> Any:
    if depth >= 5:
        return _short_scalar(value)
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in value.items():
            if key in {"sparkline", "playbook", "charts", "evidence_links"}:
                continue
            if key == "market_pulse" and isinstance(item, list):
                result[key] = [_compact_pulse(row) for row in item[:8] if isinstance(row, dict)]
                continue
            if key == "top_positions" and isinstance(item, list):
                result[key] = [_compact_value(row, depth=depth + 1) for row in item[:6]]
                continue
            if key == "risk_rows" and isinstance(item, list):
                result[key] = [_compact_value(row, depth=depth + 1) for row in item[:30]]
                continue
            if key in {"portfolio_impact", "opportunities", "risks", "strategy", "watch_signals", "core_changes"} and isinstance(item, list):
                result[key] = [_compact_value(row, depth=depth + 1) for row in item[:6]]
                continue
            result[str(key)] = _compact_value(item, depth=depth + 1)
        return result
    if isinstance(value, list):
        return [_compact_value(item, depth=depth + 1) for item in value[:8]]
    return _short_scalar(value)


def _compact_pulse(row: dict[str, Any]) -> dict[str, Any]:
    return {
        key: _short_scalar(row.get(key))
        for key in ("key", "title", "value", "change", "change_percent", "badge", "reading", "source", "confidence")
        if row.get(key) not in (None, "", [])
    }


def _short_scalar(value: Any) -> Any:
    if isinstance(value, str):
        return value if len(value) <= 260 else f"{value[:257]}..."
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    if isinstance(value, dict):
        return {
            key: _short_scalar(item)
            for key, item in value.items()
            if key in {"value", "unit", "source", "status", "confidence", "reason", "label", "tone"}
        }
    return str(value)[:260]


def _number(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed == parsed else default


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _provider_model(provider: Any) -> str | None:
    return str(getattr(provider, "last_model_used", "") or getattr(provider, "model", "") or "") or None


def _minimax_model_candidates(model: str) -> list[str]:
    normalized = str(model or "").strip() or "MiniMax-M2.5-highspeed"
    candidates = [normalized]
    if normalized == "MiniMax-M2.7-highspeed":
        candidates.append("MiniMax-M2.5-highspeed")
    return candidates


def build_ai_provider(
    *,
    provider_name: str,
    openai_api_key: str,
    ai_model: str = "",
    minimax_api_key: str = "",
    minimax_base_url: str = "https://api.minimaxi.com/v1",
    deepseek_api_key: str = "",
    deepseek_base_url: str = "https://api.deepseek.com",
    custom_api_key: str = "",
    custom_base_url: str = "http://127.0.0.1:8080/v1",
) -> AIProvider:
    normalized = (provider_name or "openai").lower()
    if normalized == "mock":
        return MockAIProvider()
    if normalized == "minimax":
        return MiniMaxChatCompletionsProvider(
            api_key=minimax_api_key or openai_api_key,
            model=ai_model or "MiniMax-M2.5-highspeed",
            base_url=minimax_base_url or "https://api.minimaxi.com/v1",
        )
    if normalized == "deepseek":
        return DeepSeekChatCompletionsProvider(
            api_key=deepseek_api_key,
            model=ai_model or "deepseek-v4-flash",
            base_url=deepseek_base_url or "https://api.deepseek.com",
        )
    if normalized == "custom":
        return CustomOpenAICompatibleProvider(
            api_key=custom_api_key or openai_api_key,
            model=ai_model or "gpt-4o",
            base_url=custom_base_url or "http://127.0.0.1:8080/v1",
        )
    return OpenAIResponsesProvider(api_key=openai_api_key, model=ai_model or "gpt-5-mini")


def _extract_output_text(payload: dict[str, Any]) -> str:
    chunks: list[str] = []
    for item in payload.get("output", []) or []:
        for content in item.get("content", []) or []:
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                chunks.append(str(content["text"]))
    return "".join(chunks)


def _chat_completions_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith("/chat/completions"):
        return normalized
    return f"{normalized}/chat/completions"


def _minimax_request_payload(
    *,
    model: str,
    system_prompt: str,
    user_prompt: str,
    response_format: bool,
    max_tokens: int = 1600,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
        "max_tokens": max_tokens,
        "reasoning_split": True,
    }
    if response_format:
        payload["response_format"] = {"type": "json_object"}
    return payload


def _openai_compatible_chat_request_payload(
    *,
    model: str,
    system_prompt: str,
    user_prompt: str,
    response_format: bool,
    max_tokens: int = 1600,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
        "max_tokens": max_tokens,
    }
    if response_format:
        payload["response_format"] = {"type": "json_object"}
    return payload


def _extract_chat_completion_text(payload: dict[str, Any]) -> str:
    for key in ("output_text", "text", "reply"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value
    choices = payload.get("choices", []) or []
    if not choices:
        return ""
    message = choices[0].get("message", {}) or {}
    content = message.get("content", "")
    if isinstance(content, list):
        chunks = []
        for item in content:
            if isinstance(item, dict) and item.get("text"):
                chunks.append(str(item["text"]))
            elif isinstance(item, str):
                chunks.append(item)
        text = "".join(chunks)
        if text.strip():
            return text
    elif isinstance(content, dict):
        for key in ("text", "content"):
            value = content.get(key)
            if isinstance(value, str) and value.strip():
                return value
    elif isinstance(content, str) and content.strip():
        return content
    for key in ("reasoning_content", "reasoning", "text"):
        value = message.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return ""


def _parse_json_object(text: str) -> dict[str, Any]:
    stripped = _strip_think_tags(text).strip()
    if not stripped:
        raise ValueError("AI response content is empty")
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", stripped, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        stripped = fenced.group(1).strip()
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError as exc:
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start < 0 or end <= start:
            raise ValueError(f"AI response does not contain a complete JSON object: {stripped[:240]}") from exc
        try:
            parsed = json.loads(stripped[start : end + 1])
        except json.JSONDecodeError as inner_exc:
            raise ValueError(f"AI response contains incomplete JSON: {stripped[:240]}") from inner_exc
    if not isinstance(parsed, dict):
        raise ValueError("AI response is not a JSON object")
    return parsed


def _coerce_string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if item not in (None, "")]
    if value in (None, ""):
        return []
    return [str(value)]


def _coerce_confidence(value: Any) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return 0.0
    if confidence > 1:
        confidence = confidence / 100
    return max(0.0, min(1.0, confidence))


def _response_json(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError as exc:
        preview = _response_body_preview(response)
        raise ValueError(f"AI response is not JSON: {preview}") from exc
    if not isinstance(payload, dict):
        raise ValueError("AI response JSON is not an object")
    return payload


def _response_body_preview(response: httpx.Response) -> str:
    text = (response.text or "").strip()
    if not text:
        return "empty HTTP body"
    return text[:240]


def _raise_for_minimax_base_resp(payload: dict[str, Any]) -> None:
    base_resp = payload.get("base_resp")
    if not isinstance(base_resp, dict):
        return
    status_code = base_resp.get("status_code")
    if status_code in (None, 0, "0"):
        return
    status_msg = str(base_resp.get("status_msg") or "unknown MiniMax base_resp error")
    raise ValueError(f"MiniMax base_resp status {status_code}: {status_msg}")


def _strip_think_tags(text: str) -> str:
    return re.sub(r"<think\b[^>]*>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE)
