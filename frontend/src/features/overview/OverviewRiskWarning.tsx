import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type {
  OverviewBenchmarkBeta,
  OverviewPositionBeta,
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
import { asNumber, asText, clamp, formatCurrency, formatDate, formatNumber } from "../../lib/format";
import { Surface } from "../../components/Primitives";

const BENCHMARK_OPTIONS: Array<{ key: OverviewRiskBenchmarkKey; label: string; fullLabel: string }> = [
  { key: "qqq", label: "NDX100", fullLabel: "Nasdaq 100" },
  { key: "nasdaq", label: "NASDAQ", fullLabel: "Nasdaq" },
  { key: "sp500", label: "SPX", fullLabel: "S&P 500" },
];

const WINDOW_OPTIONS: OverviewRiskWindow[] = [30, 60, 90, 120];
const BASE_SCENARIOS = [-5, -10, -15, -20];
const STRESS_SCENARIO_LABELS: Record<number, string> = {
  [-5]: "轻度回调",
  [-10]: "中度调整",
  [-15]: "深度回撤",
  [-20]: "极端压力",
};
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
  const hasCurrentPayload = riskState.data?.window === window && (riskState.data?.benchmarks.some((item) => item.key === benchmark) ?? false);

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
    if (hasCurrentPayload) return;
    void loadRiskWarning();
  }, [hasCurrentPayload, loadRiskWarning, section]);

  const selectedBenchmark = useMemo(
    () => riskState.data?.benchmarks.find((item) => item.key === benchmark) ?? null,
    [benchmark, riskState.data?.benchmarks],
  );
  const benchmarkOption = BENCHMARK_OPTIONS.find((option) => option.key === benchmark) ?? BENCHMARK_OPTIONS[0];
  const scenarioRows = useMemo(
    () => buildStandardScenarioRows(riskState.data, selectedBenchmark, benchmark),
    [benchmark, riskState.data, selectedBenchmark],
  );
  const customScenario = useMemo(
    () => computeScenario(riskState.data, selectedBenchmark, customDrawdown, "自定义跌幅", "custom"),
    [customDrawdown, riskState.data, selectedBenchmark],
  );
  const betaPositions = useMemo(
    () => (riskState.data?.positions ?? []).map((position) => {
      const beta = normalizePositionBeta(position.betas?.[benchmark] ?? position.beta);
      return {
        ...position,
        beta: beta.value,
        weighted_contribution: beta.weightedContribution,
        observations: beta.observations,
        status: beta.status ?? position.status,
        reason: beta.reason ?? position.reason,
      };
    }),
    [benchmark, riskState.data?.positions],
  );
  const betaDetailRows = useMemo(
    () => [...betaPositions]
      .sort((left, right) => Math.abs(asNumber(right.market_value, 0)) - Math.abs(asNumber(left.market_value, 0)))
      .slice(0, 15),
    [betaPositions],
  );
  const missingReasons = riskState.data?.missing_reasons ?? [];
  const portfolioBeta = selectedBenchmark?.portfolio_beta ?? null;
  const betaStatus = riskState.loading ? "Beta 计算中" : statusLabel(riskState.data?.status);

  return (
    <>
      {section === "beta" ? null : <Surface
        title="持仓核心风险"
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
              {metric.status !== "ready" && metric.reason ? <small>{metric.reason}</small> : null}
            </article>
          ))}
        </div>
      </Surface>}

      {section === "dashboard" ? null : <Surface
        title="Beta 相关性压力测试"
        action={
          <label className="overview-beta-window">
            <span>Beta 窗口</span>
            <select
              aria-label="Beta 窗口"
              value={window}
              onChange={(event) => setWindow(Number(event.target.value) as OverviewRiskWindow)}
            >
              {WINDOW_OPTIONS.map((item) => (
                <option key={item} value={item}>{item} 日</option>
              ))}
            </select>
          </label>
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

        <div className="overview-beta-update">
          <span>Beta 更新时间：{formatDate(riskState.data?.beta_updated_at)}</span>
          <b>{betaStatus}</b>
        </div>

        {riskState.error ? (
          <div className="overview-risk-error">
            <strong>数据获取失败，点击重试</strong>
            <span>{riskState.error}</span>
            <button type="button" onClick={() => void loadRiskWarning(true)}>重试</button>
          </div>
        ) : null}

        <div className="overview-beta-hero">
          <div>
            <span>组合加权 Beta</span>
            <strong>{portfolioBeta === null || portfolioBeta === undefined ? "计算中" : formatNumber(portfolioBeta, 2)}</strong>
            <small>vs {benchmarkOption.fullLabel} · {riskState.data?.window ?? window} 日窗口</small>
          </div>
          <p>
            大盘跌 1% → 组合跌约
            <b>{portfolioBeta === null || portfolioBeta === undefined ? "-" : `${formatNumber(Math.abs(portfolioBeta), 2)}%`}</b>
          </p>
        </div>

        <div className="overview-risk-table-wrap">
          <table className="overview-risk-table overview-risk-table--stress">
            <colgroup>
              <col className="overview-risk-table__scenario" />
              <col className="overview-risk-table__drawdown" />
              <col className="overview-risk-table__beta" />
              <col className="overview-risk-table__loss" />
              <col className="overview-risk-table__equity-loss" />
              <col className="overview-risk-table__level" />
            </colgroup>
            <thead>
              <tr>
                <th>情景</th>
                <th>大盘跌幅</th>
                <th>Beta 放大</th>
                <th>预估损失</th>
                <th>净资产损失</th>
                <th>风险级别</th>
              </tr>
            </thead>
            <tbody>
              {scenarioRows.map((row) => (
                <tr key={row.key ?? row.label}>
                  <td>{row.label}</td>
                  <td>{formatDrawdownPercent(row.drawdown_pct)}</td>
                  <td className="overview-beta-multiplier">{formatBetaMultiplier(row.portfolio_beta)}</td>
                  <td className="delta-text--negative">{formatCurrency(row.stress_loss, currency, 0)}</td>
                  <td>{formatScenarioLossPct(row, riskState.data?.equity)}</td>
                  <td><StressLevelBadge row={row} /></td>
                </tr>
              ))}
              {riskState.data?.var_comparison ? (
                <tr>
                  <td>单日 VaR</td>
                  <td>历史波动率</td>
                  <td className="overview-beta-multiplier">—</td>
                  <td className="delta-text--negative">{formatCurrency(riskState.data.var_comparison.stress_loss, currency, 0)}</td>
                  <td>{formatScenarioLossPct(riskState.data.var_comparison, riskState.data?.equity)}</td>
                  <td><StressLevelBadge row={riskState.data.var_comparison} fixedTone="monitor" /></td>
                </tr>
              ) : (
                <tr>
                  <td>单日 VaR</td>
                  <td>历史波动率</td>
                  <td className="overview-beta-multiplier">—</td>
                  <td>-</td>
                  <td>-</td>
                  <td><StressLevelBadge label="数据不足" fixedTone="monitor" /></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <label className="overview-risk-slider overview-beta-custom-slider">
          <span>自定义跌幅</span>
          <strong>{formatDrawdownPercent(customDrawdown)}</strong>
          <input
            type="range"
            min="-30"
            max="-1"
            step="0.5"
            value={customDrawdown}
            onChange={(event) => setCustomDrawdown(clamp(Number(event.target.value), -30, -1))}
          />
        </label>

        <div className="overview-beta-custom-card">
          <div>
            <span>预估损失（自定义）</span>
            <small>Beta {portfolioBeta === null || portfolioBeta === undefined ? "-" : formatNumber(portfolioBeta, 2)} × 大盘跌 {formatDrawdownPercent(customDrawdown)}</small>
          </div>
          <strong className="delta-text--negative">{formatCurrency(customScenario.stress_loss, currency, 0)}</strong>
          <small>净资产 {formatScenarioLossPct(customScenario, riskState.data?.equity)}</small>
        </div>

        <p className="overview-beta-formula">
          损失估算 = 总持仓市值 × 组合 Beta × 跌幅；Margin 使用率极低时，强平风险忽略不计。
        </p>

        {selectedBenchmark?.reason || missingReasons.length > 0 ? (
          <div className="overview-beta-missing">
            {[selectedBenchmark?.reason, ...missingReasons].filter(Boolean).slice(0, 2).map((reason) => (
              <span key={String(reason)}>{reason}</span>
            ))}
          </div>
        ) : null}

        <button
          type="button"
          className="overview-risk-detail-toggle"
          onClick={() => setDetailOpen((open) => !open)}
        >
          {detailOpen ? "收起个仓 Beta 明细" : `展开个仓 Beta 明细（${riskState.data?.window ?? window} 日 · ${betaDetailRows.length} 个持仓）`}
        </button>

        {detailOpen ? (
          <div className="overview-risk-table-wrap">
            <table className="overview-risk-table overview-risk-table--detail">
              <thead>
                <tr>
                  <th>标的</th>
                  <th>仓位权重</th>
                  <th>Beta（{benchmarkOption.fullLabel}）</th>
                  <th>加权贡献</th>
                  <th>Beta 强度</th>
                </tr>
              </thead>
              <tbody>
                {betaDetailRows.length > 0 ? betaDetailRows.map((position) => (
                  <tr key={position.symbol}>
                    <td>{position.symbol}</td>
                    <td>{formatPercentPoint(position.weight_pct)}</td>
                    <td className={betaValueClass(position.beta)}>{position.beta === null || position.beta === undefined ? "计算中" : formatNumber(position.beta, 2)}</td>
                    <td className="overview-beta-contribution">{formatWeightedContribution(position.weighted_contribution, position.beta, position.weight_pct)}</td>
                    <td><BetaStrength value={position.beta} status={position.status} reason={position.reason} /></td>
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

        <button
          type="button"
          className="overview-beta-refresh"
          onClick={() => void loadRiskWarning(true)}
          disabled={riskState.loading}
        >
          {riskState.loading ? "刷新中" : "刷新 Beta 数据"}
        </button>
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

function buildStandardScenarioRows(
  data: OverviewRiskWarningResponse | null,
  benchmark: OverviewBenchmarkBeta | null,
  benchmarkKey: OverviewRiskBenchmarkKey,
): OverviewStressScenario[] {
  const backendRows = data?.selected_benchmark === benchmarkKey ? data.scenarios : [];
  return BASE_SCENARIOS.map((drawdown) => {
    const matched = backendRows.find((row) => typeof row.drawdown_pct === "number" && Math.abs(normalizeDrawdown(row.drawdown_pct) - drawdown) < 0.01);
    return matched ?? computeScenario(data, benchmark, drawdown, STRESS_SCENARIO_LABELS[drawdown] ?? `${Math.abs(drawdown)}% 回撤`);
  });
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
      equity_loss_pct: null,
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
    equity_loss_pct: equity > 0 ? (stressLoss / equity) * 100 : null,
    status: "ready",
    source: benchmark?.source ?? "risk-warning",
    reason: null,
  };
}

function normalizeDrawdown(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return Number.NaN;
  return Math.abs(value) <= 1 ? value * 100 : value;
}

function formatPercentPoint(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  const digits = Math.abs(value) >= 10 ? 1 : 2;
  return `${value.toFixed(digits)}%`;
}

function formatDrawdownPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  const normalized = normalizeDrawdown(value);
  const digits = Math.abs(normalized) >= 10 ? 1 : 2;
  return `${normalized.toFixed(digits)}%`;
}

function formatBetaMultiplier(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "-" : `×${formatNumber(value, 2)}`;
}

function formatScenarioLossPct(row: OverviewStressScenario, equity: number | null | undefined): string {
  const explicit = typeof row.equity_loss_pct === "number" && Number.isFinite(row.equity_loss_pct) ? row.equity_loss_pct : null;
  if (explicit !== null) return formatPercentPoint(explicit);
  const stressLoss = asNumber(row.stress_loss, Number.NaN);
  const equityValue = asNumber(equity, Number.NaN);
  if (!Number.isFinite(stressLoss) || !Number.isFinite(equityValue) || equityValue === 0) return "-";
  return formatPercentPoint((stressLoss / equityValue) * 100);
}

function stressToneForScenario(row: OverviewStressScenario): "monitor" | "watch" | "alert" {
  if (row.status !== "ready") return "monitor";
  const lossPct = Math.abs(asNumber(row.equity_loss_pct, Number.NaN));
  if (!Number.isFinite(lossPct)) return "monitor";
  if (lossPct >= 20) return "alert";
  if (lossPct >= 5) return "watch";
  return "monitor";
}

function stressToneLabel(tone: "monitor" | "watch" | "alert"): string {
  if (tone === "alert") return "预警";
  if (tone === "watch") return "关注";
  return "监控";
}

function betaTone(value: number | null | undefined): "low" | "medium" | "high" | "missing" {
  if (value === null || value === undefined || !Number.isFinite(value)) return "missing";
  if (value >= 1.5) return "high";
  if (value >= 1.1) return "medium";
  return "low";
}

function betaToneLabel(tone: "low" | "medium" | "high" | "missing"): string {
  if (tone === "high") return "高 Beta";
  if (tone === "medium") return "中 Beta";
  if (tone === "low") return "低 Beta";
  return "数据不足";
}

function betaValueClass(value: number | null | undefined): string {
  const tone = betaTone(value);
  return `overview-beta-value overview-beta-value--${tone}`;
}

function formatWeightedContribution(value: number | null | undefined, beta: number | null | undefined, weightPct: number | null | undefined): string {
  if (typeof value === "number" && Number.isFinite(value)) return formatNumber(value, 3);
  if (typeof beta === "number" && Number.isFinite(beta) && typeof weightPct === "number" && Number.isFinite(weightPct)) {
    return formatNumber(beta * (weightPct / 100), 3);
  }
  return "-";
}

function statusLabel(status: string | null | undefined): string {
  if (status === "ready") return "已计算";
  if (status === "partial") return "部分可用";
  if (status === "calculating") return "Beta 计算中";
  return "数据不足";
}

function normalizePositionBeta(value: OverviewPositionBeta["beta"] | undefined): {
  value: number | null;
  weightedContribution?: number | null;
  observations?: number;
  status?: "ready" | "missing_data";
  reason?: string | null;
} {
  if (value && typeof value === "object") {
    return {
      value: value.value,
      weightedContribution: value.weighted_contribution,
      observations: value.observations,
      status: value.status,
      reason: value.reason,
    };
  }
  return {
    value: typeof value === "number" && Number.isFinite(value) ? value : null,
  };
}

function RiskBadge({ severity, children }: { severity: OverviewRiskSeverity; children: string }) {
  return <span className={`overview-risk-badge overview-risk-badge--${severity}`}>{children}</span>;
}

function StressLevelBadge({
  row,
  label,
  fixedTone,
}: {
  row?: OverviewStressScenario;
  label?: string;
  fixedTone?: "monitor" | "watch" | "alert";
}) {
  const tone = fixedTone ?? (row ? stressToneForScenario(row) : "monitor");
  return <span className={`overview-stress-badge overview-stress-badge--${tone}`}>{label ?? stressToneLabel(tone)}</span>;
}

function BetaStrength({ value, status, reason }: { value: number | null | undefined; status: string; reason: string | null | undefined }) {
  const tone = status === "ready" ? betaTone(value) : "missing";
  const width = value === null || value === undefined || !Number.isFinite(value) ? 0 : clamp(Math.abs(value) / 2.2 * 100, 8, 100);
  return (
    <div className="overview-beta-strength">
      <span><i className={`overview-beta-strength__bar overview-beta-strength__bar--${tone}`} style={{ width: `${width}%` }} /></span>
      <small>{tone === "missing" ? reason || "数据不足" : betaToneLabel(tone)}</small>
    </div>
  );
}
