import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type {
  OverviewBenchmarkBeta,
  OverviewResponse,
  OverviewRiskBenchmarkKey,
  OverviewRiskDashboard,
  OverviewRiskMetric,
  OverviewRiskMetricKey,
  OverviewRiskSeverity,
  OverviewRiskWarningResponse,
  OverviewRiskWindow,
  OverviewStressScenario,
} from "../../lib/contracts";
import { asNumber, asText, clamp, formatCurrency, formatNumber } from "../../lib/format";
import { StatusPill, Surface } from "../../components/Primitives";

const BENCHMARK_OPTIONS: Array<{ key: OverviewRiskBenchmarkKey; label: string }> = [
  { key: "qqq", label: "QQQ" },
  { key: "nasdaq", label: "NASDAQ" },
  { key: "sp500", label: "S&P 500" },
];

const WINDOW_OPTIONS: OverviewRiskWindow[] = [30, 60, 90, 120];
const BASE_SCENARIOS = [-5, -10, -15, -20];
const RISK_METRIC_ORDER: OverviewRiskMetricKey[] = [
  "net_exposure",
  "margin_usage",
  "largest_holding",
  "top3_concentration",
  "downside_breadth",
];

const RISK_LABELS: Record<OverviewRiskMetricKey, string> = {
  net_exposure: "净敞口",
  margin_usage: "保证金使用",
  largest_holding: "最大持仓",
  top3_concentration: "Top 3 集中度",
  downside_breadth: "下跌广度",
};

const SEVERITY_LABELS: Record<OverviewRiskSeverity, string> = {
  healthy: "健康",
  watch: "关注",
  caution: "谨慎",
  alert: "预警",
};

interface RiskWarningCacheEntry {
  window: OverviewRiskWindow;
  payload: OverviewRiskWarningResponse;
}

const riskWarningCache = new Map<OverviewRiskWindow, RiskWarningCacheEntry>();

export function OverviewRiskWarning({
  data,
  currency,
  section = "all",
}: {
  data: OverviewResponse;
  currency: string;
  section?: "dashboard" | "beta" | "all";
}) {
  const [benchmark, setBenchmark] = useState<OverviewRiskBenchmarkKey>("qqq");
  const [window, setWindow] = useState<OverviewRiskWindow>(60);
  const [customDrawdown, setCustomDrawdown] = useState(-12.5);
  const [detailOpen, setDetailOpen] = useState(false);
  const [riskState, setRiskState] = useState<{
    data: OverviewRiskWarningResponse | null;
    loading: boolean;
    error: string | null;
  }>({ data: riskWarningCache.get(60)?.payload ?? null, loading: false, error: null });

  const dashboard = useMemo(() => normalizeRiskDashboard(data), [data]);
  const hasBenchmarkInPayload = riskState.data?.benchmarks.some((item) => item.key === benchmark) ?? false;

  const loadRiskWarning = useCallback(async (force = false) => {
    const cached = riskWarningCache.get(window)?.payload ?? null;
    if (!force && cached?.benchmarks.some((item) => item.key === benchmark)) {
      setRiskState({ data: cached, loading: false, error: null });
      return;
    }
    setRiskState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const payload = await api.overviewRiskWarning({ benchmark, window });
      riskWarningCache.set(window, { window, payload });
      setRiskState({ data: payload, loading: false, error: null });
    } catch (error) {
      setRiskState((prev) => ({
        data: prev.data,
        loading: false,
        error: error instanceof Error ? error.message : "unknown error",
      }));
    }
  }, [benchmark, window]);

  useEffect(() => {
    if (section === "dashboard") return;
    if (hasBenchmarkInPayload) return;
    void loadRiskWarning();
  }, [hasBenchmarkInPayload, loadRiskWarning, section]);

  const selectedBenchmark = useMemo(
    () => riskState.data?.benchmarks.find((item) => item.key === benchmark) ?? null,
    [benchmark, riskState.data?.benchmarks],
  );
  const scenarioRows = useMemo(
    () => buildScenarioRows(riskState.data, selectedBenchmark, customDrawdown),
    [customDrawdown, riskState.data, selectedBenchmark],
  );
  const betaPositions = useMemo(
    () => (riskState.data?.positions ?? []).map((position) => ({
      ...position,
      beta: position.betas?.[benchmark] ?? position.beta,
    })),
    [benchmark, riskState.data?.positions],
  );
  const missingReasons = riskState.data?.missing_reasons ?? [];
  const sources = riskState.data?.sources ?? [];

  return (
    <>
      {section === "beta" ? null : <Surface
        title="持仓核心风险"
        subtitle="本地快照优先，缺失项保留状态与原因。"
        action={<RiskBadge severity={dashboard.highest_severity}>{SEVERITY_LABELS[dashboard.highest_severity]}</RiskBadge>}
        className="overview-risk-panel"
      >
        <div className="overview-risk-board">
          {dashboard.metrics.map((metric) => (
            <article key={metric.key} className={`overview-risk-card overview-risk-card--${metric.severity}`}>
              <div className="overview-risk-card__top">
                <span>{metric.label}</span>
                <RiskBadge severity={metric.severity}>{SEVERITY_LABELS[metric.severity]}</RiskBadge>
              </div>
              <strong>{formatPercentPoint(metric.value)}</strong>
              <div className="overview-risk-progress" aria-label={`${metric.label} ${formatPercentPoint(metric.value)}`}>
                <span style={{ width: `${clamp(asNumber(metric.progress_pct, 0), 0, 100)}%` }} />
              </div>
              <p>{metric.action || metric.threshold_label || "等待更多可追溯数据"}</p>
              <small>{metric.status === "ready" ? metric.source : metric.reason || "数据不足"}</small>
            </article>
          ))}
        </div>
        <div className="overview-risk-meta">
          <span>更新：{dashboard.updated_at ? asText(dashboard.updated_at) : "暂无"}</span>
          <span>状态：{dashboard.status === "ready" ? "已计算" : dashboard.status === "partial" ? "部分可用" : "数据不足"}</span>
        </div>
      </Surface>}

      {section === "dashboard" ? null : <Surface
        title="Beta 压力测试"
        subtitle="按基准相关性估算组合回撤压力，外部数据缺失时不编造 Beta。"
        action={
          <div className="overview-risk-action">
            <select
              aria-label="Beta 窗口"
              value={window}
              onChange={(event) => setWindow(Number(event.target.value) as OverviewRiskWindow)}
            >
              {WINDOW_OPTIONS.map((item) => (
                <option key={item} value={item}>{item} 日</option>
              ))}
            </select>
            <button type="button" onClick={() => void loadRiskWarning(true)} disabled={riskState.loading}>
              {riskState.loading ? "加载中" : "重试"}
            </button>
          </div>
        }
        className="overview-beta-panel"
      >
        <div className="overview-risk-tabs" role="tablist" aria-label="压力测试基准">
          {BENCHMARK_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={benchmark === option.key}
              className={benchmark === option.key ? "active" : ""}
              onClick={() => setBenchmark(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {riskState.error ? (
          <div className="overview-risk-error">
            <strong>数据获取失败，点击重试</strong>
            <span>{riskState.error}</span>
            <button type="button" onClick={() => void loadRiskWarning(true)}>重试</button>
          </div>
        ) : null}

        <div className="overview-beta-summary">
          <MetricCell label="组合 Beta" value={selectedBenchmark?.portfolio_beta === null || selectedBenchmark?.portfolio_beta === undefined ? "计算中" : formatNumber(selectedBenchmark.portfolio_beta, 2)} />
          <MetricCell label="持仓市值" value={formatCurrency(riskState.data?.total_market_value ?? data.market_value, currency)} />
          <MetricCell label="窗口" value={`${riskState.data?.window ?? window} 日`} />
          <MetricCell label="状态" value={riskState.loading ? "Beta 计算中" : statusLabel(riskState.data?.status)} />
        </div>

        <label className="overview-risk-slider">
          <span>自定义回撤 {customDrawdown.toFixed(1)}%</span>
          <input
            type="range"
            min="-30"
            max="-1"
            step="0.5"
            value={customDrawdown}
            onChange={(event) => setCustomDrawdown(clamp(Number(event.target.value), -30, -1))}
          />
        </label>

        <div className="overview-risk-table-wrap">
          <table className="overview-risk-table overview-risk-table--stress">
            <thead>
              <tr>
                <th>情景</th>
                <th>基准回撤</th>
                <th>预估损失</th>
                <th>压力后净值</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {scenarioRows.map((row) => (
                <tr key={row.key ?? row.label}>
                  <td>{row.label}</td>
                  <td>{formatPercentPoint(row.drawdown_pct)}</td>
                  <td className="delta-text--negative">{formatCurrency(row.stress_loss, currency)}</td>
                  <td>{formatCurrency(row.projected_equity, currency)}</td>
                  <td><span>{statusLabel(row.status)}</span></td>
                </tr>
              ))}
              {riskState.data?.var_comparison ? (
                <tr>
                  <td>一日 VaR</td>
                  <td>{formatPercentPoint(riskState.data.var_comparison.drawdown_pct)}</td>
                  <td className="delta-text--negative">{formatCurrency(riskState.data.var_comparison.stress_loss, currency)}</td>
                  <td>{formatCurrency(riskState.data.var_comparison.projected_equity, currency)}</td>
                  <td><span>{statusLabel(riskState.data.var_comparison.status)}</span></td>
                </tr>
              ) : (
                <tr>
                  <td>一日 VaR</td>
                  <td>-</td>
                  <td>-</td>
                  <td>-</td>
                  <td><span>数据不足</span></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="overview-risk-footnotes">
          {riskState.loading ? <StatusPill tone="neutral">Beta 计算中</StatusPill> : null}
          {selectedBenchmark?.reason ? <StatusPill tone="neutral">{selectedBenchmark.reason}</StatusPill> : null}
          {sources.slice(0, 2).map((source) => <StatusPill key={source} tone="neutral">{source}</StatusPill>)}
          {missingReasons.slice(0, 2).map((reason) => <StatusPill key={reason} tone="negative">{reason}</StatusPill>)}
        </div>

        <button
          type="button"
          className="overview-risk-detail-toggle"
          onClick={() => setDetailOpen((open) => !open)}
        >
          {detailOpen ? "收起 Beta 明细" : "展开 Beta 明细"}
        </button>

        {detailOpen ? (
          <div className="overview-risk-table-wrap">
            <table className="overview-risk-table overview-risk-table--detail">
              <thead>
                <tr>
                  <th>代码</th>
                  <th>权重</th>
                  <th>市值</th>
                  <th>Beta</th>
                  <th>状态/原因</th>
                </tr>
              </thead>
              <tbody>
                {betaPositions.length > 0 ? betaPositions.map((position) => (
                  <tr key={position.symbol}>
                    <td>{position.symbol}</td>
                    <td>{formatPercentPoint(position.weight_pct)}</td>
                    <td>{formatCurrency(position.market_value, currency)}</td>
                    <td>{position.beta === null || position.beta === undefined ? "计算中" : formatNumber(position.beta, 2)}</td>
                    <td><span>{position.status === "ready" ? position.source : position.reason || "数据不足"}</span></td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5}>暂无 Beta 明细</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </Surface>}
    </>
  );
}

function normalizeRiskDashboard(data: OverviewResponse): OverviewRiskDashboard {
  if (data.risk_dashboard?.metrics?.length) {
    const metrics = RISK_METRIC_ORDER.map((key) => data.risk_dashboard?.metrics.find((metric) => metric.key === key) ?? missingMetric(key));
    return {
      ...data.risk_dashboard,
      metrics,
    };
  }

  const equity = asNumber(data.equity, 0);
  const marketValue = asNumber(data.market_value, 0);
  const cash = asNumber(data.cash, 0);
  const topHoldings = Array.isArray(data.top_holdings) ? data.top_holdings : [];
  const totalHoldingValue = topHoldings.reduce((sum, item) => sum + Math.abs(asNumber(item.market_value ?? item.value, 0)), 0);
  const sortedValues = topHoldings
    .map((item) => Math.abs(asNumber(item.market_value ?? item.value, 0)))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => right - left);

  const netExposure = equity > 0 ? (marketValue / equity) * 100 : null;
  const borrowed = Math.max(0, -cash, marketValue - equity);
  const marginUsage = equity > 0 ? (borrowed / equity) * 100 : null;
  const largestHolding = totalHoldingValue > 0 ? (sortedValues[0] / totalHoldingValue) * 100 : null;
  const top3 = totalHoldingValue > 0 ? (sortedValues.slice(0, 3).reduce((sum, value) => sum + value, 0) / totalHoldingValue) * 100 : null;

  const metrics: OverviewRiskMetric[] = [
    fallbackMetric("net_exposure", netExposure, "股票市值 / 净值", "本地快照"),
    fallbackMetric("margin_usage", marginUsage, "借款金额 / 净值", "本地快照"),
    fallbackMetric("largest_holding", largestHolding, "最大持仓 / 总持仓", "持仓快照"),
    fallbackMetric("top3_concentration", top3, "前三持仓 / 总持仓", "持仓快照"),
    missingMetric("downside_breadth", "等待后端提供前一日持仓价格"),
  ];
  return {
    status: metrics.every((metric) => metric.status === "ready") ? "ready" : metrics.some((metric) => metric.status === "ready") ? "partial" : "missing_data",
    highest_severity: maxSeverity(metrics.map((metric) => metric.severity)),
    updated_at: data.valuation_as_of_local ?? data.report_date_iso ?? data.report_date ?? null,
    metrics,
  };
}

function fallbackMetric(key: OverviewRiskMetricKey, value: number | null, threshold: string, source: string): OverviewRiskMetric {
  if (value === null || !Number.isFinite(value)) return missingMetric(key);
  const severity = severityForMetric(key, value);
  return {
    key,
    label: RISK_LABELS[key],
    value,
    unit: "percent",
    status: "ready",
    severity,
    threshold_label: threshold,
    progress_pct: clamp(value, 0, 100),
    source,
    reason: "",
    action: severity === "healthy" ? "保持观察" : "关注集中度与回撤压力",
  };
}

function missingMetric(key: OverviewRiskMetricKey, reason = "缺少可计算数据"): OverviewRiskMetric {
  return {
    key,
    label: RISK_LABELS[key],
    value: null,
    unit: "percent",
    status: "missing_data",
    severity: "watch",
    threshold_label: "待计算",
    progress_pct: 0,
    source: "本地数据",
    reason,
    action: "导入更多快照后显示",
  };
}

function severityForMetric(key: OverviewRiskMetricKey, value: number): OverviewRiskSeverity {
  if (key === "net_exposure") {
    if (value <= 100) return "healthy";
    if (value <= 120) return "watch";
    if (value <= 150) return "caution";
    return "alert";
  }
  if (key === "margin_usage") {
    if (value <= 20) return "healthy";
    if (value <= 30) return "watch";
    if (value <= 50) return "caution";
    return "alert";
  }
  if (key === "largest_holding") {
    if (value <= 15) return "healthy";
    if (value <= 25) return "watch";
    if (value <= 35) return "caution";
    return "alert";
  }
  if (key === "top3_concentration") {
    if (value <= 40) return "healthy";
    if (value <= 60) return "watch";
    if (value <= 75) return "caution";
    return "alert";
  }
  if (value <= 40) return "healthy";
  if (value <= 55) return "watch";
  if (value <= 70) return "caution";
  return "alert";
}

function maxSeverity(severities: OverviewRiskSeverity[]): OverviewRiskSeverity {
  const order: OverviewRiskSeverity[] = ["healthy", "watch", "caution", "alert"];
  return severities.reduce((highest, item) => order.indexOf(item) > order.indexOf(highest) ? item : highest, "healthy");
}

function buildScenarioRows(
  data: OverviewRiskWarningResponse | null,
  benchmark: OverviewBenchmarkBeta | null,
  customDrawdown: number,
): OverviewStressScenario[] {
  const backendRows = data?.scenarios ?? [];
  const rows = BASE_SCENARIOS.map((drawdown) => {
    const matched = backendRows.find((row) => Math.abs(normalizeDrawdown(row.drawdown_pct) - drawdown) < 0.01);
    return matched ?? computeScenario(data, benchmark, drawdown, `${Math.abs(drawdown)}% 回撤`);
  });
  const custom = computeScenario(data, benchmark, customDrawdown, "自定义回撤", "custom");
  return [...rows, custom];
}

function computeScenario(
  data: OverviewRiskWarningResponse | null,
  benchmark: OverviewBenchmarkBeta | null,
  drawdown: number,
  label: string,
  key = String(drawdown),
): OverviewStressScenario {
  const beta = benchmark?.portfolio_beta ?? null;
  const totalMarketValue = asNumber(data?.total_market_value, 0);
  const equity = asNumber(data?.equity, 0);
  if (beta === null || !Number.isFinite(beta) || totalMarketValue <= 0) {
    return {
      key,
      label,
      drawdown_pct: drawdown,
      portfolio_beta: beta,
      stress_loss: null,
      projected_equity: null,
      status: "missing_data",
      source: benchmark?.source ?? "risk-warning",
      reason: benchmark?.reason ?? "Beta 计算中 / 数据不足",
    };
  }
  const stressLoss = totalMarketValue * beta * (drawdown / 100);
  return {
    key,
    label,
    drawdown_pct: drawdown,
    portfolio_beta: beta,
    stress_loss: stressLoss,
    projected_equity: equity > 0 ? equity + stressLoss : null,
    status: "ready",
    source: benchmark?.source ?? "risk-warning",
    reason: null,
  };
}

function normalizeDrawdown(value: number): number {
  return Math.abs(value) <= 1 ? value * 100 : value;
}

function formatPercentPoint(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  const normalized = normalizeDrawdown(value);
  const digits = Math.abs(normalized) >= 10 ? 1 : 2;
  return `${normalized.toFixed(digits)}%`;
}

function statusLabel(status: string | null | undefined): string {
  if (status === "ready") return "已计算";
  if (status === "partial") return "部分可用";
  if (status === "calculating") return "Beta 计算中";
  return "数据不足";
}

function RiskBadge({ severity, children }: { severity: OverviewRiskSeverity; children: string }) {
  return <span className={`overview-risk-badge overview-risk-badge--${severity}`}>{children}</span>;
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="overview-beta-cell">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
