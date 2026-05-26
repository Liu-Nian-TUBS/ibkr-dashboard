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
import { asNumber, clamp, formatNumber } from "../../lib/format";

export const BENCHMARK_OPTIONS: Array<{ key: OverviewRiskBenchmarkKey; label: string; fullLabel: string }> = [
  { key: "qqq", label: "NDX100", fullLabel: "Nasdaq 100" },
  { key: "nasdaq", label: "NASDAQ", fullLabel: "Nasdaq" },
  { key: "sp500", label: "SPX", fullLabel: "S&P 500" },
];

export const WINDOW_OPTIONS: OverviewRiskWindow[] = [30, 60, 90, 120];

export const SEVERITY_LABELS: Record<OverviewRiskSeverity, string> = {
  healthy: "健康",
  watch: "关注",
  caution: "谨慎",
  alert: "预警",
};

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

export function normalizeRiskDashboard(data: OverviewResponse): OverviewRiskDashboard {
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

export function severityForMetric(key: OverviewRiskMetricKey, value: number): OverviewRiskSeverity {
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

export function buildStandardScenarioRows(
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

export function computeScenario(
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

export function normalizeDrawdown(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return Number.NaN;
  return Math.abs(value) <= 1 ? value * 100 : value;
}

export function formatPercentPoint(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  const digits = Math.abs(value) >= 10 ? 1 : 2;
  return `${value.toFixed(digits)}%`;
}

export function formatDrawdownPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  const normalized = normalizeDrawdown(value);
  const digits = Math.abs(normalized) >= 10 ? 1 : 2;
  return `${normalized.toFixed(digits)}%`;
}

export function formatBetaMultiplier(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "-" : `×${formatNumber(value, 2)}`;
}

export function formatScenarioLossPct(row: OverviewStressScenario, equity: number | null | undefined): string {
  const explicit = typeof row.equity_loss_pct === "number" && Number.isFinite(row.equity_loss_pct) ? row.equity_loss_pct : null;
  if (explicit !== null) return formatPercentPoint(explicit);
  const stressLoss = asNumber(row.stress_loss, Number.NaN);
  const equityValue = asNumber(equity, Number.NaN);
  if (!Number.isFinite(stressLoss) || !Number.isFinite(equityValue) || equityValue === 0) return "-";
  return formatPercentPoint((stressLoss / equityValue) * 100);
}

export type StressTone = "monitor" | "watch" | "alert";

export function stressToneForScenario(row: OverviewStressScenario): StressTone {
  if (row.status !== "ready") return "monitor";
  const lossPct = Math.abs(asNumber(row.equity_loss_pct, Number.NaN));
  if (!Number.isFinite(lossPct)) return "monitor";
  if (lossPct >= 20) return "alert";
  if (lossPct >= 5) return "watch";
  return "monitor";
}

export function stressToneLabel(tone: StressTone): string {
  if (tone === "alert") return "预警";
  if (tone === "watch") return "关注";
  return "监控";
}

export type BetaTone = "low" | "medium" | "high" | "missing";

export function betaTone(value: number | null | undefined): BetaTone {
  if (value === null || value === undefined || !Number.isFinite(value)) return "missing";
  if (value >= 1.5) return "high";
  if (value >= 1.1) return "medium";
  return "low";
}

export function betaToneLabel(tone: BetaTone): string {
  if (tone === "high") return "高 Beta";
  if (tone === "medium") return "中 Beta";
  if (tone === "low") return "低 Beta";
  return "数据不足";
}

export function betaValueClass(value: number | null | undefined): string {
  const tone = betaTone(value);
  return `overview-beta-value overview-beta-value--${tone}`;
}

export function formatWeightedContribution(value: number | null | undefined, beta: number | null | undefined, weightPct: number | null | undefined): string {
  if (typeof value === "number" && Number.isFinite(value)) return formatNumber(value, 3);
  if (typeof beta === "number" && Number.isFinite(beta) && typeof weightPct === "number" && Number.isFinite(weightPct)) {
    return formatNumber(beta * (weightPct / 100), 3);
  }
  return "-";
}

export function statusLabel(status: string | null | undefined): string {
  if (status === "ready") return "已计算";
  if (status === "partial") return "部分可用";
  if (status === "calculating") return "Beta 计算中";
  return "数据不足";
}

export function normalizePositionBeta(value: OverviewPositionBeta["beta"] | undefined): {
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

function maxSeverity(severities: OverviewRiskSeverity[]): OverviewRiskSeverity {
  const order: OverviewRiskSeverity[] = ["healthy", "watch", "caution", "alert"];
  return severities.reduce((highest, item) => order.indexOf(item) > order.indexOf(highest) ? item : highest, "healthy");
}
