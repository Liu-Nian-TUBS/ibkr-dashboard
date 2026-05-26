import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import type {
  OverviewPositionBeta,
  OverviewResponse,
  OverviewRiskBenchmarkKey,
  OverviewRiskSeverity,
  OverviewRiskWarningResponse,
  OverviewRiskWindow,
  OverviewStressScenario,
} from "../../lib/contracts";
import { asNumber, clamp, formatCurrency, formatDate, formatNumber } from "../../lib/format";
import { Surface } from "../../components/Primitives";
import {
  BENCHMARK_OPTIONS,
  SEVERITY_LABELS,
  WINDOW_OPTIONS,
  betaTone,
  betaToneLabel,
  betaValueClass,
  buildStandardScenarioRows,
  computeScenario,
  formatBetaMultiplier,
  formatDrawdownPercent,
  formatPercentPoint,
  formatScenarioLossPct,
  formatWeightedContribution,
  normalizePositionBeta,
  normalizeRiskDashboard,
  statusLabel,
  stressToneForScenario,
  stressToneLabel,
  type StressTone,
} from "./riskCalculations";

interface RiskWarningCacheEntry {
  window: OverviewRiskWindow;
  payload: OverviewRiskWarningResponse;
}

export function OverviewRiskDashboard({ data }: { data: OverviewResponse }) {
  const dashboard = useMemo(() => normalizeRiskDashboard(data), [data]);

  return (
    <Surface
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
    </Surface>
  );
}

export function OverviewBetaStress({ currency }: { currency: string }) {
  const [benchmark, setBenchmark] = useState<OverviewRiskBenchmarkKey>("qqq");
  const [window, setWindow] = useState<OverviewRiskWindow>(60);
  const [customDrawdown, setCustomDrawdown] = useState(-12.5);
  const [detailOpen, setDetailOpen] = useState(false);
  const riskWarningCache = useRef(new Map<OverviewRiskWindow, RiskWarningCacheEntry>());
  const [riskState, setRiskState] = useState<{
    data: OverviewRiskWarningResponse | null;
    loading: boolean;
    error: string | null;
  }>({ data: null, loading: false, error: null });

  const hasCurrentPayload = riskState.data?.window === window && (riskState.data?.benchmarks.some((item) => item.key === benchmark) ?? false);

  const loadRiskWarning = useCallback(async (force = false) => {
    const cached = riskWarningCache.current.get(window)?.payload ?? null;
    if (!force && cached?.benchmarks.some((item) => item.key === benchmark)) {
      setRiskState({ data: cached, loading: false, error: null });
      return;
    }
    setRiskState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const payload = await api.overviewRiskWarning({ benchmark, window });
      riskWarningCache.current.set(window, { window, payload });
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
    if (hasCurrentPayload) return;
    void loadRiskWarning();
  }, [hasCurrentPayload, loadRiskWarning]);

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
    () => (riskState.data?.positions ?? []).map((position) => normalizeBetaPosition(position, benchmark)),
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
    <Surface
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
                <td className="overview-beta-multiplier">-</td>
                <td className="delta-text--negative">{formatCurrency(riskState.data.var_comparison.stress_loss, currency, 0)}</td>
                <td>{formatScenarioLossPct(riskState.data.var_comparison, riskState.data?.equity)}</td>
                <td><StressLevelBadge row={riskState.data.var_comparison} fixedTone="monitor" /></td>
              </tr>
            ) : (
              <tr>
                <td>单日 VaR</td>
                <td>历史波动率</td>
                <td className="overview-beta-multiplier">-</td>
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
    </Surface>
  );
}

function normalizeBetaPosition(position: OverviewPositionBeta, benchmark: OverviewRiskBenchmarkKey) {
  const beta = normalizePositionBeta(position.betas?.[benchmark] ?? position.beta);
  return {
    ...position,
    beta: beta.value,
    weighted_contribution: beta.weightedContribution,
    observations: beta.observations,
    status: beta.status ?? position.status,
    reason: beta.reason ?? position.reason,
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
  fixedTone?: StressTone;
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
