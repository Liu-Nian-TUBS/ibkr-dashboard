import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { EChartsOption } from "echarts";
import { api } from "../../lib/api";
import type {
  ApiRecord,
  EChartsPayload,
  PageState,
  PortfolioAnalysisResponse,
  PortfolioRiskRow,
  PortfolioAnalysisSectionKey,
  StandardMetric,
} from "../../lib/contracts";
import { asNumber, deltaClass, formatCurrency, formatNumber } from "../../lib/format";
import { DataState, EmptyState, Field, LoadingBlock, MetricCard, PageHeader, StatusPill, Surface } from "../../components/Primitives";
import { EChart, baseGrid } from "../../components/charts/EChart";

const tabs: Array<{ key: PortfolioAnalysisSectionKey; label: string }> = [
  { key: "market", label: "市场分析" },
  { key: "portfolio", label: "持仓分析" },
  { key: "stock", label: "个股分析" },
];

export function PortfolioAnalysisPage() {
  const [section, setSection] = useState<PortfolioAnalysisSectionKey>("market");
  const [symbol, setSymbol] = useState("");
  const [activeSymbol, setActiveSymbol] = useState("");
  const [state, setState] = useState<PageState<PortfolioAnalysisResponse>>({ data: null, loading: true, error: null });
  const responseCache = useRef<Map<string, PortfolioAnalysisResponse>>(new Map());

  const load = useCallback(async (options?: { showLoading?: boolean; symbolOverride?: string; force?: boolean; skipCache?: boolean }) => {
    const showLoading = options?.showLoading ?? true;
    const requestSymbol = options?.symbolOverride ?? activeSymbol;
    const cacheKey = `${section}:${section === "stock" ? requestSymbol || "" : ""}`;
    const cached = responseCache.current.get(cacheKey);
    if (cached && !options?.force && !options?.skipCache) {
      setState({ data: cached, loading: false, error: null });
      return cached;
    }
    if (showLoading) setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await api.portfolioAnalysis({ section, symbol: section === "stock" ? requestSymbol || undefined : undefined });
      responseCache.current.set(cacheKey, data);
      setState({ data, loading: false, error: null });
      if (data.sections.stock.symbol) {
        setSymbol((prev) => prev || data.sections.stock.symbol || "");
        setActiveSymbol((prev) => prev || data.sections.stock.symbol || "");
      }
      return data;
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error instanceof Error ? error.message : "unknown error" }));
      return null;
    }
  }, [activeSymbol, section]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const portfolio = state.data?.sections.portfolio;
    if (section !== "portfolio" || portfolio?.analysis_meta?.ai_overlay_status !== "pending") return undefined;
    const timer = window.setTimeout(() => {
      void load({ showLoading: false, skipCache: true });
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [load, section, state.data?.sections.portfolio?.analysis_meta?.ai_overlay_status]);

  useEffect(() => {
    const stock = state.data?.sections.stock;
    if (section !== "stock" || stock?.memo?.status !== "pending") return undefined;
    const timer = window.setTimeout(() => {
      void load({ showLoading: false, symbolOverride: stock.symbol || activeSymbol, skipCache: true });
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [activeSymbol, load, section, state.data?.sections.stock?.memo?.status, state.data?.sections.stock?.symbol]);

  const runStockQuery = (nextSymbol?: string) => {
    const targetSymbol = (nextSymbol ?? symbol).trim().toUpperCase();
    setSymbol(targetSymbol);
    setActiveSymbol(targetSymbol);
    void load({ symbolOverride: targetSymbol, force: true });
  };
  const selectedCacheKey = `${section}:${section === "stock" ? activeSymbol || "" : ""}`;
  const cachedData = responseCache.current.get(selectedCacheKey) ?? null;
  const currentData = responseMatchesCurrentRequest(state.data, section, activeSymbol)
    ? state.data
    : cachedData;
  const blockingLoading = state.loading && !currentData;

  return (
    <PortfolioAnalysisShell
      section={section}
      setSection={setSection}
      data={currentData}
      loading={blockingLoading}
      reload={() => void load({ force: true })}
    >
      <DataState loading={blockingLoading} error={state.error} data={currentData} onRetry={load}>
        {(data) => (
          <>
            {section === "market" ? <MarketPanel data={data} /> : null}
            {section === "portfolio" ? <PortfolioPanel data={data} /> : null}
            {section === "stock" ? <StockPanel data={data} symbol={symbol} onSymbolChange={runStockQuery} /> : null}
          </>
        )}
      </DataState>
    </PortfolioAnalysisShell>
  );
}

function PortfolioAnalysisShell({
  section,
  setSection,
  data,
  loading,
  reload,
  children,
}: {
  section: PortfolioAnalysisSectionKey;
  setSection: (section: PortfolioAnalysisSectionKey) => void;
  data: PortfolioAnalysisResponse | null;
  loading: boolean;
  reload: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <PageHeader
        eyebrow="V2 / 持仓智能"
        title="持仓分析"
        description="市场、组合和个股三段式只读分析；缺失外部数据时显示明确来源状态。"
        meta={
          <>
            <StatusPill tone={data?.status === "ready" ? "positive" : "neutral"}>{data ? statusLabel(data.status) : "加载中"}</StatusPill>
            <StatusPill>{data?.display_currency ?? "-"}</StatusPill>
            {loading ? <StatusPill tone="neutral">正在加载</StatusPill> : null}
            <button type="button" onClick={reload} disabled={loading}>{loading ? "刷新中" : "刷新数据"}</button>
          </>
        }
      />

      <div className="analysis-tabs" role="tablist" aria-label="持仓分析分区">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            className={section === item.key ? "active" : ""}
            onClick={() => setSection(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <LoadingBlock label={section === "portfolio" ? "正在生成持仓分析，包含结构化AI判断和风险图表" : "正在读取持仓分析数据"} />
      ) : children}
    </>
  );
}

function responseMatchesCurrentRequest(
  data: PortfolioAnalysisResponse | null,
  section: PortfolioAnalysisSectionKey,
  activeSymbol: string,
): data is PortfolioAnalysisResponse {
  if (!data) return false;
  const responseSection = data.request?.section ?? data.active_section ?? null;
  if (responseSection && responseSection !== section) return false;
  if (section !== "stock") return true;
  const requested = activeSymbol.trim().toUpperCase();
  return !requested || data.request?.symbol === requested || data.sections.stock.symbol === requested;
}

function MarketPanel({ data }: { data: PortfolioAnalysisResponse }) {
  const market = data.sections.market;
  const strategy = market.strategy ?? [];
  const strategySummary = strategy[0] ?? {};
  const pulse = market.market_pulse ?? [];
  return (
    <div className="market-pulse-page">
      <section className="market-pulse-hero">
        <div>
          <span className="market-pulse-kicker">每日市场脉搏</span>
          <h2>今日美股情绪观察</h2>
          <p>优先使用 CNN Fear & Greed、长桥市场温度、长桥社区热度和富途OpenD行情代理；不可用时才回退到本地规则。</p>
        </div>
        <div className="market-pulse-hero__meta">
          <StatusPill tone={market.status === "ready" ? "positive" : "neutral"}>{statusLabel(market.status)}</StatusPill>
          <StatusPill tone="accent">{String(market.regime.value ?? "待判断")}</StatusPill>
          <span>{new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })}</span>
        </div>
      </section>

      <section className={`market-today-brief market-today-brief--${recordText(strategySummary, "tone", "neutral")}`}>
        <div className="market-today-brief__headline">
          <span>今日市场</span>
          <strong>{marketTodaySummary(market, strategySummary)}</strong>
        </div>
        <div className="market-today-brief__columns">
          <InsightList title="对当前组合的影响" items={market.portfolio_impact} compact />
          <InsightList title="机会 / 风险" items={[...market.opportunities, ...market.risks]} compact />
        </div>
      </section>

      <div className="market-pulse-grid">
        {pulse.length ? pulse.map((item) => <MarketPulseCard key={recordText(item, "key", recordText(item, "title", ""))} item={item} />) : (
          <MetricFromContract label="市场状态" metric={market.regime} />
        )}
      </div>

    </div>
  );
}

function marketTodaySummary(market: PortfolioAnalysisResponse["sections"]["market"], strategy: ApiRecord): string {
  const explicit = recordText(strategy, "summary", "");
  if (explicit) return explicit;
  const rsi = market.indicators.rsi?.value;
  const rsiText = typeof rsi === "number" ? formatNumber(rsi) : rsi === null || rsi === undefined ? "-" : String(rsi);
  const benchmark = benchmarkFromSource(market.indicators.rsi?.source ?? "QQQ");
  const regime = String(market.regime.value ?? "待判断");
  const sizing = regime === "拥挤多头" || regime === "亢奋动量" ? "观察仓/小仓位" : regime === "投降区间" || regime === "恐慌压缩" ? "防守仓位" : "常规节奏";
  return `当前${benchmark} RSI=${rsiText}，市场处于${regime}。建议新仓位控制在${sizing}，已持仓标的今日大跌须区分基本面恶化 vs 市场拖累。`;
}

function benchmarkFromSource(source: string): string {
  if (source.includes("SPY")) return "SPY";
  if (source.includes("QQQ")) return "QQQ";
  if (source.includes("^NDX")) return "NDX";
  return "QQQ";
}

function PortfolioPanel({ data }: { data: PortfolioAnalysisResponse }) {
  const portfolio = data.sections.portfolio;
  const priorityAlerts = (portfolio.alerts ?? []).filter((alert) => ["high", "medium"].includes(recordText(alert, "severity", "low")));
  const chart = portfolio.charts.slice(0, 1);
  return (
    <div className="analysis-layout">
      <Surface title="组合风险" subtitle="只展示需要优先处理的集中度和主题风险。">
        <RiskAlertSummary alerts={priorityAlerts} />
      </Surface>

      <Surface title="持仓风险分析" subtitle="逐项校验当前持仓的AI主题关联、逻辑状态和只读分析建议。">
        <PortfolioAIStatus portfolio={portfolio} />
        <PortfolioRiskTable rows={portfolio.risk_rows ?? []} currency={data.display_currency} />
        <AnalysisMeta meta={portfolio.analysis_meta} />
        <div className="portfolio-risk-chart">
          <ChartGrid charts={chart} currency={data.display_currency} />
        </div>
      </Surface>

      <Surface title="调仓建议" subtitle="只读分析建议，不包含交易执行或下单数量。">
        <RebalanceAdvicePanel advice={portfolio.rebalance_advice} />
      </Surface>
    </div>
  );
}

function StockPanel({
  data,
  symbol,
  onSymbolChange,
}: {
  data: PortfolioAnalysisResponse;
  symbol: string;
  onSymbolChange: (symbol: string) => void;
}) {
  const stock = data.sections.stock;
  const memo = stock.memo;
  const options = stock.available_symbols ?? [];
  const selectedSymbol = stock.symbol || symbol || options[0]?.symbol || "";
  return (
    <div className="analysis-layout">
      <Surface
        title="个股选择"
        subtitle="只能选择当前持仓中的股票。"
      >
        {options.length ? (
          <div className="stock-select-control">
            <Field label="股票代码">
              <select value={selectedSymbol} onChange={(event) => onSymbolChange(event.target.value)}>
                {options.map((item) => (
                  <option key={item.symbol} value={item.symbol}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : (
          <EmptyState title="暂无持仓股票" detail="导入最新 Flex XML 后，这里会显示可分析的当前持仓。" compact />
        )}
      </Surface>

      <Surface title={`${memo.symbol || selectedSymbol || "-"} 个股分析`} subtitle="围绕当前持仓逻辑生成，只读且不包含交易执行指令。">
        <StockMemo memo={memo} />
      </Surface>
    </div>
  );
}

function StockMemo({ memo }: { memo: PortfolioAnalysisResponse["sections"]["stock"]["memo"] }) {
  if (memo.status === "pending") {
    return <LoadingBlock label="正在生成个股分析" />;
  }
  if (memo.status !== "ready") {
    return <EmptyState title="个股分析不可用" detail={memo.reason || "当前没有可用于分析的持仓数据。"} compact />;
  }
  return (
    <div className="stock-memo">
      <div className="stock-memo__summary">
        <strong>{memo.one_line_view || "暂无结论"}</strong>
        <div>
          <StatusPill tone="accent">{memo.position_role || "待复核仓"}</StatusPill>
          <StatusPill tone={memo.logic_status === "削弱" ? "negative" : memo.logic_status === "增强" ? "positive" : "neutral"}>
            逻辑{memo.logic_status || "无法判断"}
          </StatusPill>
          <StatusPill>AI关联 {memo.ai_relevance || "无法判断"}</StatusPill>
        </div>
      </div>

      <div className="stock-memo__grid">
        <MemoList title="持仓逻辑" items={memo.holding_thesis} />
        <MemoList title="事实" items={memo.facts} />
        <MemoList title="推断" items={memo.inferences} />
        <MemoList title="组合影响" items={memo.portfolio_impact} />
        <MemoList title="主要风险" items={memo.key_risks} />
        <MemoList title="继续验证" items={memo.tracking_questions} />
      </div>

      <MemoList title="逻辑失效信号" items={memo.invalidation_signals} />
      {memo.read_only_suggestion ? <p className="stock-memo__suggestion">{memo.read_only_suggestion}</p> : null}
      <p className="analysis-meta-line">
        <span>{sourceLabel(memo.source)}</span>
        <span>置信度 {Math.round((memo.confidence ?? 0) * 100)}%</span>
      </p>
    </div>
  );
}

function MemoList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="stock-memo__list">
      <strong>{title}</strong>
      <ul>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

function MetricFromContract({ label, metric }: { label: string; metric: StandardMetric }) {
  const value = metric.unit === "percent"
    ? `${formatNumber(metric.value)}%`
    : metric.unit && ["USD", "HKD", "CNY", "RMB"].includes(metric.unit)
      ? formatCurrency(metric.value, metric.unit)
      : metric.value === null
        ? "-"
        : `${formatNumber(metric.value)}${metric.unit && metric.unit !== "index" && metric.unit !== "ratio" ? ` ${metric.unit}` : ""}`;
  const tone = metric.status === "ready" ? "positive" : metric.status === "error" ? "negative" : "neutral";
  return (
    <MetricCard
      label={label}
      value={typeof metric.value === "string" ? metric.value : value}
      tone={tone}
      hint={metricHint(metric)}
    />
  );
}

function MarketPulseCard({ item }: { item: ApiRecord }) {
  const value = recordNumber(item, "value");
  const change = recordNumber(item, "change");
  const changePercent = recordNumber(item, "change_percent");
  const badge = recordObject(item, "badge");
  const playbook = recordArray(item, "playbook");
  const sparkline = recordArray(item, "sparkline");
  const accent = recordText(item, "accent", "green");
  const tone = recordText(badge, "tone", "neutral");
  return (
    <article className={`market-pulse-card market-pulse-card--${accent}`}>
      <div className="market-pulse-card__top">
        <div>
          <span className="market-pulse-card__bar" />
          <h3>{recordText(item, "title", "-")} <small>· {recordText(item, "symbol", "")}</small></h3>
          <p>{recordText(item, "subtitle", "")}</p>
        </div>
        <span className={`market-chip market-chip--${tone}`}>{recordText(badge, "label", "观察")}</span>
      </div>
      <div className="market-pulse-card__value">
        <strong>{value === null ? "-" : formatNumber(value)}</strong>
        {change !== null || changePercent !== null ? (
          <span className={(changePercent ?? change ?? 0) < 0 ? "negative" : "positive"}>
            {change !== null ? `${change > 0 ? "+" : ""}${formatNumber(change)}` : ""}
            {changePercent !== null ? ` / ${changePercent > 0 ? "+" : ""}${formatNumber(changePercent)}%` : ""}
          </span>
        ) : null}
      </div>
      {sparkline.length ? <MiniSparkline points={sparkline} /> : <ThresholdBand rows={playbook} />}
      <p className="market-pulse-card__reading">{recordText(item, "reading", "")}</p>
      <div className="market-pulse-card__source">
        <span>{recordText(item, "source", "来源未注明")}</span>
        <em>置信度 {Math.round((recordNumber(item, "confidence") ?? 0) * 100)}%</em>
      </div>
      {playbook.length ? <PlaybookRows rows={playbook} /> : null}
    </article>
  );
}

function MiniSparkline({ points }: { points: ApiRecord[] }) {
  const values = points.map((point) => recordNumber(point, "value")).filter((value): value is number => value !== null);
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 0.0001);
  const d = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 100;
      const y = 36 - ((value - min) / range) * 32;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg className="market-sparkline" viewBox="0 0 100 42" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} />
      <circle cx="100" cy={36 - ((values[values.length - 1] - min) / range) * 32} r="2.4" />
    </svg>
  );
}

function ThresholdBand({ rows }: { rows: ApiRecord[] }) {
  if (!rows.length) return null;
  return (
    <div className="threshold-band">
      {rows.map((row, index) => (
        <span key={`${recordText(row, "range", "")}-${index}`} className={recordBool(row, "active") ? "active" : ""} />
      ))}
    </div>
  );
}

function PlaybookRows({ rows }: { rows: ApiRecord[] }) {
  return (
    <div className="market-playbook-rows">
      {rows.map((row, index) => (
        <div key={`${recordText(row, "range", "")}-${index}`} className={recordBool(row, "active") ? "active" : ""}>
          <span>{recordText(row, "range", "-")}</span>
          <strong>{recordText(row, "label", "-")}</strong>
          <em>{recordText(row, "action", "-")}</em>
        </div>
      ))}
    </div>
  );
}

function RiskAlertGrid({ alerts }: { alerts: ApiRecord[] }) {
  if (!alerts.length) return null;
  return (
    <div className="risk-alert-grid">
      {alerts.map((alert, index) => (
        <article className={`risk-alert risk-alert--${recordText(alert, "severity", "low")}`} key={`${recordText(alert, "title", "alert")}-${index}`}>
          <span>{severityLabel(recordText(alert, "severity", "low"))}</span>
          <strong>{recordText(alert, "title", "风险提示")}</strong>
          <p>{recordText(alert, "detail", "")}</p>
        </article>
      ))}
    </div>
  );
}

function RiskAlertSummary({ alerts }: { alerts: ApiRecord[] }) {
  if (!alerts.length) {
    return <EmptyState compact title="暂无高/中优先级风险" detail="当前组合未触发需要优先处理的集中度或主题风险。" />;
  }
  return (
    <div className="risk-summary-list">
      {alerts.map((alert, index) => (
        <div className={`risk-summary risk-summary--${recordText(alert, "severity", "medium")}`} key={`${recordText(alert, "title", "alert")}-${index}`}>
          <span>{severityLabel(recordText(alert, "severity", "medium"))}</span>
          <strong>{recordText(alert, "title", "风险提示")}</strong>
          <p>{recordText(alert, "detail", "")}</p>
        </div>
      ))}
    </div>
  );
}

function PortfolioRiskTable({ rows, currency }: { rows: PortfolioRiskRow[]; currency: string }) {
  if (!rows.length) return <EmptyState compact title="暂无持仓风险分析" detail="导入最新持仓快照后显示逐项风险校验。" />;
  return (
    <div className="portfolio-risk-table-wrap">
      <table className="portfolio-risk-table">
        <thead>
          <tr>
            <th>标的</th>
            <th>当前价</th>
            <th>权重</th>
            <th>浮盈亏</th>
            <th>AI关联度</th>
            <th>逻辑状态</th>
            <th>建议</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.symbol}>
              <td><strong>{row.symbol}</strong></td>
              <td>{formatCurrency(row.current_price, currency)}</td>
              <td>{formatNumber(row.weight_pct)}%</td>
              <td className={deltaClass(row.unrealized_pnl)}>
                {formatCurrency(row.unrealized_pnl, currency)}
              </td>
              <td>
                <span className={`risk-relevance risk-relevance--${relevanceTone(row.ai_relevance)}`}>{row.ai_relevance}</span>
              </td>
              <td>
                <div className="risk-cell-with-evidence">
                  <span>{row.logic_status}</span>
                  {row.position_role ? <small>仓位角色：{row.position_role}</small> : null}
                  {row.risk_points?.length ? <small>风险：{row.risk_points.slice(0, 2).join("；")}</small> : null}
                  {!row.risk_points?.length && row.evidence.length ? <small>{row.evidence.slice(0, 2).join("；")}</small> : null}
                </div>
              </td>
              <td>
                <div className="risk-cell-with-evidence">
                  <span>{row.recommendation}</span>
                  {row.tracking_points?.length ? <small>跟踪：{row.tracking_points.slice(0, 2).join("；")}</small> : null}
                  <small title={row.reason ?? undefined}>
                    {sourceLabel(row.source)} · 置信度 {Math.round((row.confidence ?? 0) * 100)}%
                  </small>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PortfolioAIStatus({ portfolio }: { portfolio: PortfolioAnalysisResponse["sections"]["portfolio"] }) {
  const meta = portfolio.analysis_meta ?? {};
  const rowSources = (portfolio.risk_rows ?? []).map((row) => row.source).join("+");
  const adviceSource = portfolio.rebalance_advice?.source ?? "";
  const combinedSource = `${rowSources}+${adviceSource}`;
  const inferredReady = combinedSource.includes("structured_ai");
  const inferredRules = combinedSource.includes("portfolio_ai_rules");
  const status = recordText(meta, "ai_overlay_status", inferredReady ? "ready" : inferredRules ? "unavailable" : "missing_data");
  const provider = recordText(meta, "ai_overlay_provider", providerFromSource(combinedSource));
  const reason = recordText(meta, "ai_overlay_reason", inferredRules ? "structured_ai_overlay_missing_from_response" : "");
  const localFallback = provider === "local_rules" || reason.startsWith("fallback_after_");
  const title = status === "ready" && !localFallback
    ? `AI判断：${aiProviderLabel(provider)} 结构化输出已应用`
    : status === "pending"
      ? `AI判断：${aiProviderLabel(provider)} 正在生成，当前临时显示本地规则校验`
      : `AI判断：${aiFallbackLabel(reason)}，当前显示本地规则校验`;
  const detail = status === "ready" && !localFallback
    ? "表格中的AI关联度、逻辑状态、建议和调仓建议已由结构化模型覆盖；数值字段仍来自持仓数据。"
    : status === "pending"
      ? "页面会自动刷新结果。模型没有返回前，规则结果只作为临时占位。"
      : "这不是模型结论。OpenAI/MiniMax 不可用时，页面会继续展示本地只读规则结果，避免分析卡住。";
  return (
    <div className={`portfolio-ai-status portfolio-ai-status--${status === "ready" && !localFallback ? "ready" : status === "pending" ? "pending" : "fallback"}`}>
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function RebalanceAdvicePanel({ advice }: { advice: PortfolioAnalysisResponse["sections"]["portfolio"]["rebalance_advice"] }) {
  if (!advice || advice.status !== "ready") {
    return <EmptyState compact title="暂无调仓建议" detail="缺少持仓或外部研究上下文时不生成建议。" />;
  }
  const cards = advice.cards ?? [];
  return (
    <div className="rebalance-advice">
      <div className="rebalance-card-grid">
        {cards.slice(0, 4).map((card, index) => (
          <article className="rebalance-card" key={`${recordText(card, "title", "card")}-${index}`}>
            <span>{recordText(card, "rank", `0${index + 1}`)}</span>
            <strong>{recordText(card, "title", "-")}</strong>
            <p>{recordText(card, "body", "-")}</p>
          </article>
        ))}
      </div>
      <div className="rebalance-advice__body">
        {advice.action_today ? <AdviceParagraph title="今日最需要行动的事" body={advice.action_today} /> : null}
        {advice.thinking_prompt ? <AdviceParagraph title="一个需要认真思考的问题" body={advice.thinking_prompt} /> : null}
        {advice.market_note ? <AdviceParagraph title="市场环境提示" body={advice.market_note} /> : null}
        {advice.optimal_structure ? <AdviceParagraph title="当前最优交易结构" body={advice.optimal_structure} /> : null}
        {advice.invalidation ? <AdviceParagraph title="失效条件" body={advice.invalidation} /> : null}
      </div>
      <p className="analysis-meta-line">
        {sourceLabel(advice.source)} · 置信度 {Math.round((advice.confidence ?? 0) * 100)}%{advice.as_of ? ` · ${advice.as_of}` : ""}
      </p>
    </div>
  );
}

function AdviceParagraph({ title, body }: { title: string; body: string }) {
  return (
    <section>
      <h3>{title}</h3>
      <p>{body}</p>
    </section>
  );
}

function AnalysisMeta({ meta }: { meta: ApiRecord }) {
  if (!Object.keys(meta).length) return null;
  const missing = Array.isArray(meta.missing_reasons) ? meta.missing_reasons.map(String) : [];
  const overlayStatus = recordText(meta, "ai_overlay_status", "unavailable");
  const overlayProvider = recordText(meta, "ai_overlay_provider", "");
  const overlayReason = recordText(meta, "ai_overlay_reason", "");
  return (
    <div className={`analysis-meta-line analysis-meta-line--${overlayStatus === "ready" ? "ai-ready" : "ai-fallback"}`}>
      <span>
        {overlayStatus === "ready"
          ? `AI判断：${aiProviderLabel(overlayProvider)} 结构化输出`
          : `AI判断：${aiFallbackLabel(overlayReason)}，当前显示本地规则校验`}
      </span>
      <span>
        {sourceLabel(recordText(meta, "source", "portfolio_positions"))}
        {" · "}
        置信度 {Math.round((recordNumber(meta, "confidence") ?? 0) * 100)}%
        {recordBool(meta, "external_ready") ? " · 已接入外部研究信号" : " · 外部研究信号不足"}
        {missing.length ? ` · 缺口：${missing.slice(0, 2).join("、")}` : ""}
      </span>
    </div>
  );
}

function InsightList({ title, items, compact = false }: { title: string; items: string[]; compact?: boolean }) {
  if (!items.length) return null;
  return (
    <div className={`analysis-insights ${compact ? "analysis-insights--compact" : ""}`}>
      <strong>{title}</strong>
      <ul>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

function ChartGrid({ charts, currency }: { charts: EChartsPayload[]; currency: string }) {
  if (!charts.length) return <EmptyState compact title="暂无图表" detail="当前分析没有返回可视化 payload。" />;
  return (
    <div className="analysis-chart-grid">
      {charts.map((chart, index) => (
        <div className="analysis-chart-card" key={`${chart.title}-${index}`}>
          {chart.options.description ? <p>{String(chart.options.description)}</p> : null}
          {chart.status === "ready" && chart.series.length ? (
            <EChart option={chartOption(chart, currency)} height={chart.chart_type === "gauge" ? 240 : 300} />
          ) : (
            <EmptyState compact title={chart.title} detail={`${statusLabel(chart.status)} · ${sourceLabel(chart.source)}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function chartOption(chart: EChartsPayload, currency: string): EChartsOption {
  const points = chart.series[0]?.points ?? [];
  if (chart.chart_type === "gauge") {
    return {
      tooltip: { formatter: "{a}: {c}" },
      series: [{
        name: chart.title,
        type: "gauge",
        min: 0,
        max: 100,
        progress: { show: true, width: 10 },
        axisLine: { lineStyle: { width: 10 } },
        detail: { formatter: "{value}", fontSize: 24 },
        data: [{ value: asNumber(points[0]?.value, 0), name: chart.title }],
      }],
    };
  }
  if (chart.chart_type === "bar") {
    return {
      grid: baseGrid(),
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: points.map((point) => String(point.name ?? point.date ?? "")), axisLabel: { rotate: 20 } },
      yAxis: { type: "value" },
      series: [{ type: "bar", data: points.map((point) => asNumber(point.value, 0)), barMaxWidth: 42 }],
    };
  }
  if (chart.chart_type === "waterfall") {
    let running = 0;
    const offsets: number[] = [];
    const values = points.map((point) => asNumber(point.value, 0));
    values.forEach((value) => {
      offsets.push(value >= 0 ? running : running + value);
      running += value;
    });
    return {
      grid: baseGrid(),
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) => formatCurrency(value, currency),
      },
      xAxis: { type: "category", data: points.map((point) => String(point.name ?? "")), axisLabel: { rotate: 20 } },
      yAxis: { type: "value", axisLabel: { formatter: (value: number) => formatCurrency(value, currency) } },
      series: [
        { type: "bar", stack: "total", data: offsets, itemStyle: { color: "transparent" }, emphasis: { disabled: true } },
        {
          name: chart.series[0]?.name ?? chart.title,
          type: "bar",
          stack: "total",
          data: values,
          barMaxWidth: 42,
          itemStyle: { color: (params: { value: number }) => params.value >= 0 ? "#147a4a" : "#b13a32" },
        },
      ],
    };
  }
  if (chart.chart_type === "scatter") {
    return {
      grid: baseGrid(),
      tooltip: {
        formatter: (params: unknown): string => {
          const item = params as { data?: [number, number, number, string] };
          const [x, y, value, name] = item.data ?? [0, 0, 0, ""];
          return `${name}<br/>${String(chart.options.x_label ?? "X")}：${formatNumber(x)}%<br/>${String(chart.options.y_label ?? "Y")}：${formatNumber(y)}%<br/>市值：${formatCurrency(value, currency)}`;
        },
      },
      xAxis: { type: "value", name: String(chart.options.x_label ?? ""), min: 0, scale: true },
      yAxis: { type: "value", name: String(chart.options.y_label ?? ""), scale: true },
      series: [{
        name: chart.series[0]?.name ?? chart.title,
        type: "scatter",
        symbolSize: (value: number[]) => Math.max(14, Math.min(36, asNumber(value[0], 0) * 1.35)),
        data: points.map((point) => [asNumber(point.x, 0), asNumber(point.y, 0), asNumber(point.value, 0), String(point.name ?? "")]),
        itemStyle: { color: (params: { data?: unknown[] }) => asNumber(params.data?.[1], 0) >= 0 ? "#147a4a" : "#b13a32" },
        label: { show: true, formatter: (params: { data?: unknown[] }) => String(params.data?.[3] ?? ""), position: "top" },
      }],
    };
  }
  if (chart.chart_type === "radar") {
    return {
      tooltip: {},
      radar: {
        indicator: points.map((point) => ({ name: String(point.name ?? ""), max: 100 })),
        radius: "68%",
      },
      series: [{ type: "radar", data: [{ value: points.map((point) => asNumber(point.value, 0)), name: chart.title }] }],
    };
  }
  if (chart.chart_type === "heatmap") {
    const xLabels = Array.isArray(chart.options.x_labels) ? chart.options.x_labels.map(String) : [];
    const yLabels = Array.isArray(chart.options.y_labels) ? chart.options.y_labels.map(String) : [];
    return {
      grid: baseGrid(),
      tooltip: {
        formatter: (params: unknown): string => {
          const item = Array.isArray(params) ? params[0] : params;
          const shaped = item as { value?: unknown; name?: string };
          const value = Array.isArray(shaped.value) ? shaped.value[2] : "";
          return `${shaped.name ?? chart.title}：${formatNumber(value)}%`;
        },
      },
      xAxis: { type: "category", data: xLabels },
      yAxis: { type: "category", data: yLabels },
      visualMap: { min: asNumber(chart.options.min, 0), max: asNumber(chart.options.max, 100), calculable: false, orient: "horizontal", left: "center", bottom: 0 },
      series: [{
        type: "heatmap",
        data: points.map((point) => [asNumber(point.x, 0), asNumber(point.y, 0), asNumber(point.value, 0)]),
        label: { show: true, formatter: (params: { value?: unknown[] }) => `${formatNumber(Array.isArray(params.value) ? params.value[2] : 0, 0)}%`, fontSize: 10 },
      }],
    };
  }
  return {
    grid: baseGrid(),
    legend: chart.series.length > 1 ? { top: 0, right: 8, textStyle: { fontSize: 11 } } : undefined,
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) => chart.unit === currency ? formatCurrency(value, currency) : chart.unit === "percent" ? `${formatNumber(value)}%` : formatNumber(value),
    },
    xAxis: { type: "category", data: points.map((point) => String(point.date ?? point.name ?? "")) },
    yAxis: { type: "value", scale: true },
    series: chart.series.map((series) => ({
      name: series.name,
      type: "line",
      smooth: true,
      showSymbol: false,
      data: series.points.map((point) => asNumber(point.value, 0)),
    })),
  };
}

function recordObject(record: ApiRecord, key: string): ApiRecord {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as ApiRecord : {};
}

function recordArray(record: ApiRecord, key: string): ApiRecord[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is ApiRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function recordText(record: ApiRecord, key: string, fallback = ""): string {
  const value = record[key];
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function recordNumber(record: ApiRecord, key: string): number | null {
  const value = record[key];
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function recordBool(record: ApiRecord, key: string): boolean {
  return record[key] === true;
}

function severityLabel(severity: string): string {
  const labels: Record<string, string> = {
    high: "高优先级",
    medium: "中优先级",
    low: "观察",
  };
  return labels[severity] ?? "观察";
}

function relevanceTone(value: string): string {
  if (value.startsWith("极高")) return "high";
  if (value.startsWith("中")) return "medium";
  if (value.startsWith("低")) return "low";
  return "none";
}

function metricLabel(key: string): string {
  const labels: Record<string, string> = {
    rsi: "相对强弱指数",
    ndx_rsi: "纳指100强弱",
    fear_greed: "恐惧贪婪",
    vix: "波动率指数",
    vix_change: "波动率日变化",
    portfolio_weighted_change: "组合日变化",
    breadth: "上涨广度",
    iv_percentile: "隐波分位",
    put_call_ratio: "拥挤度代理",
    news_heat: "新闻/主题热度",
    volume_anomaly: "成交量异常",
    sector: "行业集中度",
    single_name: "单票集中度",
    ai_theme: "智能主题",
    growth: "成长因子",
    ai_beta: "智能主题弹性",
    semiconductor: "半导体",
    cyclical: "周期/高波动",
    top3_weight: "前三大权重",
    theme_cluster: "主题簇相关",
    daily_loss_at_risk: "单日损失估算",
    downside_breadth: "下跌广度",
    rates: "利率敏感",
    liquidity: "流动性敏感",
    ai_capex: "智能资本开支敏感",
    last_price: "最新价",
    portfolio_weight: "组合权重",
    daily_change: "日变化",
    unrealized_pnl: "未实现盈亏",
    trend_score: "趋势分",
    sentiment: "情绪",
  };
  return labels[key] ?? key;
}

function metricHint(metric: StandardMetric): string {
  return `${statusLabel(metric.status)} · 数据来源：${sourceLabel(metric.source)}`;
}

function sourceLabel(source: string): string {
  if (!source) return "未注明";
  if (source.includes("structured_ai")) return "结构化模型分析";
  if (source.includes("portfolio_ai_rules")) return "本地规则校验";
  if (source.includes("portfolio_positions")) return "当前持仓快照";
  if (source.includes("portfolio_theme_proxy")) return "持仓主题代理";
  if (source.includes("market_data_provider")) return "行情数据提供方";
  if (source.includes("cnn_fear_greed")) return "CNN Fear & Greed";
  if (source.includes("longbridge_market_temp")) return "长桥市场温度";
  if (source.includes("longbridge_topic")) return "长桥社区";
  if (source.includes("futu_market_heat")) return "富途市场热度";
  if (source.includes("futu_watchlist_heat")) return "富途关注热度";
  if (source.includes("market_crowding_proxy")) return "本地拥挤度代理";
  if (source.includes("futu")) return "富途行情";
  if (source.includes("longbridge")) return "长桥行情";
  if (source.includes("yahoo")) return "雅虎行情";
  if (source.includes("finnhub")) return "Finnhub 行情";
  if (source.includes("nasdaq")) return "纳斯达克行情";
  if (source.includes("mock")) return "本地模拟";
  if (source.includes("openai")) return "OpenAI";
  if (source.includes("minimax")) return "MiniMax";
  return "本地规则";
}

function aiProviderLabel(provider: string): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "minimax") return "MiniMax";
  if (provider === "mock") return "Mock AI";
  if (provider === "local_rules") return "本地规则";
  return provider || "模型";
}

function aiFallbackLabel(reason: string): string {
  if (!reason) return "未返回结构化模型结果";
  if (reason.includes("429") || reason.toLowerCase().includes("too many requests")) return "OpenAI 限流或额度不足";
  if (reason.includes("api_key_not_configured")) return "模型密钥未配置";
  if (reason.includes("timed_out")) return "模型调用超时";
  if (reason.includes("failed")) return "模型生成失败";
  if (reason.includes("does_not_support")) return "当前 provider 不支持结构化输出";
  if (reason.includes("missing_from_response")) return "后端未返回结构化AI状态";
  if (reason.includes("in_progress")) return "模型仍在生成";
  return reason;
}

function providerFromSource(source: string): string {
  if (source.includes("openai")) return "openai";
  if (source.includes("minimax")) return "minimax";
  if (source.includes("mock")) return "mock";
  return "";
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    ready: "已就绪",
    pending: "生成中",
    missing_data: "缺数据",
    stale: "需更新",
    unavailable: "不可用",
    error: "错误",
  };
  return labels[status] ?? status;
}
