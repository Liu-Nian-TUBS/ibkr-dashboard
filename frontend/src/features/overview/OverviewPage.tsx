import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { api } from "../../lib/api";
import type { ApiRecord, PageState } from "../../lib/contracts";
import { asArray, asNumber, asRecord, asText, clamp, deltaClass, formatCurrency, formatDate, formatDateTimeMinute, formatPercent } from "../../lib/format";
import { DataState, MetricCard, PageHeader, StatusPill, Surface } from "../../components/Primitives";

type ReturnMethod = "simple" | "twr" | "cash";
type RangeKey = "1w" | "mtd" | "1m" | "3m" | "ytd" | "1y" | "all" | "custom";

interface CurvePoint {
  date: string;
  label: string;
  equity: number;
  cash: number;
  marketValue: number;
}

interface FlowEvent {
  date: string;
  label: string;
  amount: number;
  flowType: "inflow" | "outflow";
}

interface BenchmarkSeries {
  key: string;
  label: string;
  symbol: string;
  status: string;
  source: string;
  points: Array<{ date: string; value: number }>;
}

interface ChartSeries {
  key: string;
  label: string;
  color: string;
  points: Array<{ date: string; value: number; netValue?: number }>;
}

const METHOD_OPTIONS: Array<{ key: ReturnMethod; label: string }> = [
  { key: "simple", label: "简单加权" },
  { key: "twr", label: "时间加权" },
  { key: "cash", label: "现金加权" },
];

const RANGE_OPTIONS: Array<{ key: RangeKey; label: string }> = [
  { key: "1w", label: "1周" },
  { key: "mtd", label: "本月至今" },
  { key: "1m", label: "1个月" },
  { key: "3m", label: "3个月" },
  { key: "ytd", label: "本年至今" },
  { key: "1y", label: "1年" },
  { key: "all", label: "全部" },
  { key: "custom", label: "自定义" },
];

const DEFAULT_BENCHMARKS: BenchmarkSeries[] = [
  { key: "sp500", label: "标普500", symbol: "^GSPC", status: "pending", source: "", points: [] },
  { key: "nasdaq", label: "纳斯达克", symbol: "^IXIC", status: "pending", source: "", points: [] },
  { key: "qqq", label: "QQQ", symbol: "QQQ", status: "pending", source: "", points: [] },
];

interface BenchmarkLoadState {
  key: string | null;
  rows: ApiRecord[] | null;
  loading: boolean;
  error: string | null;
}

let overviewPageCache: ApiRecord | null = null;
let overviewBenchmarkCache: { key: string; rows: ApiRecord[] } | null = null;

export function OverviewPage() {
  const [state, setState] = useState<PageState<ApiRecord>>({
    data: overviewPageCache,
    loading: overviewPageCache === null,
    error: null,
  });
  const [benchmarkState, setBenchmarkState] = useState<BenchmarkLoadState>({
    key: overviewBenchmarkCache?.key ?? null,
    rows: overviewBenchmarkCache?.rows ?? null,
    loading: false,
    error: null,
  });

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await api.overview();
      overviewPageCache = data;
      setState({ data, loading: false, error: null });
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error instanceof Error ? error.message : "unknown error" }));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const benchmarkRange = useMemo(() => resolveBenchmarkRange(state.data), [state.data]);

  useEffect(() => {
    if (!benchmarkRange) return;
    if (overviewBenchmarkCache?.key === benchmarkRange.key) {
      setBenchmarkState({
        key: benchmarkRange.key,
        rows: overviewBenchmarkCache.rows,
        loading: false,
        error: null,
      });
      return;
    }
    let cancelled = false;
    setBenchmarkState({
      key: benchmarkRange.key,
      rows: null,
      loading: true,
      error: null,
    });
    api.overviewBenchmarks({
      start_date: benchmarkRange.startDate,
      end_date: benchmarkRange.endDate,
    })
      .then((payload) => {
        if (cancelled) return;
        const rows = asArray(payload.benchmark_series).length > 0
          ? asArray(payload.benchmark_series)
          : asArray(payload.items);
        overviewBenchmarkCache = { key: benchmarkRange.key, rows };
        setBenchmarkState({
          key: benchmarkRange.key,
          rows,
          loading: false,
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setBenchmarkState({
          key: benchmarkRange.key,
          rows: null,
          loading: false,
          error: error instanceof Error ? error.message : "unknown error",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [benchmarkRange]);

  return (
    <DataState loading={state.loading} error={state.error} data={state.data} onRetry={load}>
      {(data) => (
        <OverviewContent
          data={data}
          onRefresh={load}
          benchmarkRows={benchmarkState.rows}
          benchmarkLoading={benchmarkState.loading}
          benchmarkError={benchmarkState.error}
        />
      )}
    </DataState>
  );
}

function resolveBenchmarkRange(data: ApiRecord | null): { key: string; startDate: string; endDate: string } | null {
  if (!data) return null;
  const netValueCurve = asRecord(data.net_value_curve);
  const rows = asArray(netValueCurve.rows).length > 0 ? asArray(netValueCurve.rows) : asArray(data.equity_curve);
  const curveRows = normalizeCurveRows(rows);
  const startDate = curveRows[0]?.date ?? "";
  const endDate = curveRows[curveRows.length - 1]?.date ?? "";
  if (!startDate || !endDate) return null;
  return { key: `${startDate}|${endDate}`, startDate, endDate };
}

function OverviewContent({
  data,
  onRefresh,
  benchmarkRows,
  benchmarkLoading,
  benchmarkError,
}: {
  data: ApiRecord;
  onRefresh: () => void;
  benchmarkRows: ApiRecord[] | null;
  benchmarkLoading: boolean;
  benchmarkError: string | null;
}) {
  const [method, setMethod] = useState<ReturnMethod>("simple");
  const [range, setRange] = useState<RangeKey>("ytd");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const currency = asText(data.display_currency, "USD");
  const valuationMode = asText(data.valuation_mode, "snapshot");
  const syncAtRaw = data.last_successful_sync_at_local ?? data.last_successful_sync_at;
  const syncAt = syncAtRaw ? formatDateTimeMinute(syncAtRaw) : "";
  const valuationTime = valuationMode === "realtime"
    ? formatDateTimeMinute(data.valuation_as_of_local ?? data.valuation_as_of)
    : formatDate(data.report_date_iso ?? data.report_date);
  const valuationHint = valuationMode === "realtime" ? `实时价格 ${valuationTime}` : `XML 快照 ${valuationTime}`;
  const netValueCurve = asRecord(data.net_value_curve);
  const curveRows = useMemo(() => {
    const rows = asArray(netValueCurve.rows).length > 0 ? asArray(netValueCurve.rows) : asArray(data.equity_curve);
    return normalizeCurveRows(rows);
  }, [data.equity_curve, netValueCurve.rows]);
  const flowEvents = useMemo(() => {
    const rows = asArray(netValueCurve.cash_flow_events).length > 0
      ? asArray(netValueCurve.cash_flow_events)
      : asArray(data.asset_flow_events);
    return normalizeFlowEvents(rows);
  }, [data.asset_flow_events, netValueCurve.cash_flow_events]);
  const benchmarkSeries = useMemo(() => {
    const fallbackRows = asArray(netValueCurve.benchmark_series).length > 0
      ? asArray(netValueCurve.benchmark_series)
      : asArray(data.benchmark_series);
    const rows = benchmarkRows && benchmarkRows.length > 0 ? benchmarkRows : fallbackRows;
    return normalizeBenchmarkSeries(rows);
  }, [benchmarkRows, data.benchmark_series, netValueCurve.benchmark_series]);
  const selectedRange = useMemo(
    () => selectRange(curveRows, range, customStart, customEnd),
    [curveRows, customEnd, customStart, range],
  );
  const selectedFlows = useMemo(
    () => flowEvents.filter((event) => event.date > selectedRange.startDate && event.date <= selectedRange.endDate),
    [flowEvents, selectedRange.endDate, selectedRange.startDate],
  );
  const returnSummary = useMemo(
    () => calculateReturn(selectedRange.points, selectedFlows, method),
    [method, selectedFlows, selectedRange.points],
  );
  const portfolioReturnSeries = useMemo(
    () => buildPortfolioReturnSeries(selectedRange.points, selectedFlows, method),
    [method, selectedFlows, selectedRange.points],
  );
  const benchmarkReturnSeries = useMemo(
    () => buildBenchmarkReturnSeries(benchmarkSeries, selectedRange),
    [benchmarkSeries, selectedRange],
  );
  const defaultCustomStart = curveRows[0]?.date ?? "";
  const defaultCustomEnd = curveRows[curveRows.length - 1]?.date ?? "";
  const dashboardMetrics = [
    { label: "账户净值", value: formatCurrency(data.equity, currency), tone: "accent" as const, hint: valuationHint },
    { label: "当日盈亏", value: formatCurrency(data.daily_change, currency), tone: deltaClass(data.daily_change), hint: formatPercent(data.daily_return) },
    { label: "现金", value: formatCurrency(data.cash, currency), tone: "neutral" as const },
    { label: "股票市值", value: formatCurrency(data.market_value, currency), tone: "neutral" as const },
    { label: "总盈亏", value: formatCurrency(data.total_pnl, currency), tone: deltaClass(data.total_pnl), hint: `已实现 ${formatCurrency(data.realized_pnl, currency)}` },
    { label: "未实现盈亏", value: formatCurrency(data.unrealized_pnl, currency), tone: deltaClass(data.unrealized_pnl) },
    { label: "年初至今 TWR", value: formatPercent(data.twr_ytd), tone: deltaClass(data.twr_ytd) },
    { label: "年初至今 MWRR", value: formatPercent(data.mwrr_ytd), tone: deltaClass(data.mwrr_ytd) },
    { label: "至今 MWRR", value: formatPercent(data.mwrr_all_time), tone: deltaClass(data.mwrr_all_time) },
    { label: "年内分红", value: formatCurrency(data.dividends, currency), tone: "positive" as const },
    { label: "年内利息", value: formatCurrency(data.interest, currency), tone: "positive" as const },
    { label: "年内佣金", value: formatCurrency(data.commissions, currency), tone: "negative" as const },
  ];

  return (
    <>
      <PageHeader
        eyebrow="资产总览"
        title="账户净值与资金曲线"
        description="净值、收益和资金流统一按设置币种展示。"
        meta={
          <>
            <StatusPill tone={valuationMode === "realtime" ? "positive" : "neutral"}>
              {valuationMode === "realtime" ? "实时估值" : "快照估值"}
            </StatusPill>
            {syncAt ? <StatusPill tone="neutral">同步 {syncAt}</StatusPill> : null}
            <button type="button" onClick={onRefresh}>刷新</button>
          </>
        }
      />

      <div className="metric-grid">
        {dashboardMetrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>

      <Surface
        title="净值曲线"
        action={
          <div className="surface-action-group">
            <StatusPill tone="accent">{selectedRange.points.length} 个快照</StatusPill>
            {benchmarkLoading ? <StatusPill tone="neutral">参考曲线加载中</StatusPill> : null}
            {!benchmarkLoading && benchmarkError ? <StatusPill tone="negative">参考曲线待重试</StatusPill> : null}
            {!benchmarkLoading && !benchmarkError && benchmarkReturnSeries.length > 0 ? (
              <StatusPill tone="positive">参考曲线已缓存</StatusPill>
            ) : null}
          </div>
        }
        className="overview-surface"
      >
        <div className="overview-control-bar">
          <SegmentedControl
            label="计算方式"
            options={METHOD_OPTIONS}
            value={method}
            onChange={setMethod}
          />
          <SegmentedControl
            label="时间范围"
            options={RANGE_OPTIONS}
            value={range}
            onChange={setRange}
          />
          {range === "custom" ? (
            <div className="date-range-inline">
              <label>
                <span>开始</span>
                <input
                  type="date"
                  value={customStart || defaultCustomStart}
                  max={customEnd || defaultCustomEnd}
                  onChange={(event) => setCustomStart(event.target.value)}
                />
              </label>
              <label>
                <span>结束</span>
                <input
                  type="date"
                  value={customEnd || defaultCustomEnd}
                  min={customStart || defaultCustomStart}
                  onChange={(event) => setCustomEnd(event.target.value)}
                />
              </label>
            </div>
          ) : null}
        </div>

        <TrendChart
          currency={currency}
          emptyTitle="净值快照不足"
          emptyDetail="导入更多账户快照后显示净值曲线。"
          series={[
            portfolioReturnSeries,
            ...benchmarkReturnSeries,
          ]}
          events={selectedFlows}
          summary={
            <div className="chart-kpi-pair">
              <ChartKpi
                label="累计收益"
                value={formatCurrency(returnSummary.amount, currency)}
                tone={deltaClass(returnSummary.amount ?? 0)}
              />
              <ChartKpi
                label="收益率"
                value={formatPercent(returnSummary.rate)}
                tone={deltaClass(returnSummary.rate ?? 0)}
              />
            </div>
          }
        />

        {selectedFlows.length > 0 ? (
          <div className="flow-event-list">
            {selectedFlows.slice(0, 8).map((event) => (
              <span key={`${event.date}-${event.amount}`} className={`flow-event flow-event--${event.flowType}`}>
                <strong>{event.label}</strong>
                <em>{formatDate(event.date)}</em>
                <b>{formatCurrency(event.amount, currency)}</b>
              </span>
            ))}
          </div>
        ) : null}
      </Surface>
    </>
  );
}

function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  wide = false,
}: {
  label: string;
  options: Array<{ key: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  wide?: boolean;
}) {
  return (
    <div className={`segmented-field ${wide ? "segmented-field--wide" : ""}`}>
      <span>{label}</span>
      <div className="segmented-control">
        {options.map((option) => (
          <button
            type="button"
            key={option.key}
            className={value === option.key ? "active" : ""}
            onClick={() => onChange(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TrendChart({
  series,
  currency,
  summary,
  events = [],
  emptyTitle,
  emptyDetail,
}: {
  series: ChartSeries[];
  currency: string;
  summary: ReactNode;
  events?: FlowEvent[];
  emptyTitle: string;
  emptyDetail: string;
}) {
  const [hoverState, setHoverState] = useState<{ x: number; time: number; date: string } | null>(null);
  const mainSeries = series[0];
  const mainPoints = mainSeries?.points ?? [];
  if (mainPoints.length < 2) {
    return (
      <div className="chart-frame chart-frame--empty">
        <div className="chart-kpi">{summary}</div>
        <div className="empty-state empty-state--compact">
          <strong>{emptyTitle}</strong>
          <span>{emptyDetail}</span>
        </div>
      </div>
    );
  }

  const width = 960;
  const height = 380;
  const padding = { top: 56, right: 24, bottom: 30, left: 58 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const values = series.flatMap((line) => line.points.map((point) => point.value)).filter(Number.isFinite);
  const returnAxis = getReturnAxis(values);
  const yMin = returnAxis.min;
  const yMax = returnAxis.max;
  const yRange = yMax - yMin || 1;
  const pointTimes = mainPoints.map((point) => dateToTime(point.date)).filter(Number.isFinite);
  const minTime = pointTimes[0] ?? 0;
  const maxTime = pointTimes[pointTimes.length - 1] ?? minTime + 1;
  const timeRange = maxTime - minTime || 1;
  const scaleXByTime = (time: number) => padding.left + clamp((time - minTime) / timeRange, 0, 1) * plotWidth;
  const scaleXByDate = (date: string) => scaleXByTime(dateToTime(date));
  const indexForDate = (date: string) => {
    const target = dateToTime(date);
    let nearest = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    mainPoints.forEach((point, index) => {
      const distance = Math.abs(dateToTime(point.date) - target);
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    });
    return nearest;
  };
  const scaleY = (value: number) => padding.top + (1 - ((value - yMin) / yRange)) * plotHeight;
  const linePath = (points: Array<{ date: string; value: number; netValue?: number }>) => points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${scaleXByDate(point.date).toFixed(2)} ${scaleY(point.value).toFixed(2)}`)
    .join(" ");
  const gridValues = returnAxis.ticks;
  const hoverPoint = hoverState ? interpolatePointAtTime(mainPoints, hoverState.time, hoverState.date) : null;
  const hoverX = hoverState?.x ?? 0;
  const hoverY = hoverPoint ? scaleY(hoverPoint.value) : 0;
  const tooltipClassName = `chart-tooltip ${hoverX > padding.left + plotWidth - 230 ? "chart-tooltip--left" : ""}`.trim();
  const tooltipY = clamp(hoverY, padding.top + 82, height - padding.bottom - 82);

  const handleMouseMove = (event: MouseEvent<SVGSVGElement>) => {
    const svgPoint = clientPointToSvgPoint(event.currentTarget, event);
    const x = clamp(svgPoint.x, padding.left, width - padding.right);
    const targetTime = minTime + ((x - padding.left) / plotWidth) * timeRange;
    setHoverState({ x, time: targetTime, date: isoFromDate(new Date(targetTime)) });
  };

  return (
    <div className="chart-frame">
      <div className="chart-kpi">{summary}</div>
      <div className="chart-legend chart-legend--overlay" aria-label="净值曲线图例">
        {series.map((line) => (
          <span key={line.key}>
            <i
              className={line.key === mainSeries.key ? "chart-legend__line" : "chart-legend__line chart-legend__line--dashed"}
              style={{ backgroundColor: line.key === mainSeries.key ? line.color : undefined, borderColor: line.color }}
            />
            {line.label}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="趋势曲线"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverState(null)}
      >
        <defs>
          <clipPath id="return-chart-plot-area">
            <rect x={padding.left} y={padding.top} width={plotWidth} height={plotHeight} />
          </clipPath>
        </defs>
        <rect x="0" y="0" width={width} height={height} rx="8" />
        {gridValues.map((value) => {
          const y = scaleY(value);
          return (
            <g key={value}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="chart-grid-line" />
              <text x={padding.left - 12} y={y + 4} className="chart-axis-label" textAnchor="end">{formatPercent(value)}</text>
            </g>
          );
        })}
        {yMin < 0 && yMax > 0 ? (
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={scaleY(0)}
            y2={scaleY(0)}
            className="chart-zero-line"
          />
        ) : null}
        {mainPoints.map((point, index) => {
          if (index % Math.max(Math.ceil(mainPoints.length / 4), 1) !== 0 && index !== mainPoints.length - 1) return null;
          const x = scaleXByDate(point.date);
          return (
            <text key={point.date} x={x} y={height - 10} className="chart-axis-label" textAnchor={index === 0 ? "start" : index === mainPoints.length - 1 ? "end" : "middle"}>
              {formatDate(point.date).slice(5)}
            </text>
          );
        })}
        <g clipPath="url(#return-chart-plot-area)">
          {series.map((line) => (
            <path
              key={line.key}
              d={linePath(line.points)}
              fill="none"
              stroke={line.color}
              strokeWidth={line.key === mainSeries.key ? 3.5 : 2}
              strokeDasharray={line.key === mainSeries.key ? undefined : "8 7"}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="chart-line"
            />
          ))}
          {events.map((event) => {
            const x = scaleXByDate(event.date);
            const point = mainPoints[indexForDate(event.date)];
            const y = scaleY(point.value);
            return (
              <g key={`${event.date}-${event.amount}`} className={`cashflow-marker cashflow-marker--${event.flowType}`}>
                <line x1={x} x2={x} y1={padding.top} y2={height - padding.bottom} />
                <circle cx={x} cy={y} r="5" />
              </g>
            );
          })}
          {hoverPoint ? (
            <g className="chart-hover-layer">
              <line x1={hoverX} x2={hoverX} y1={padding.top} y2={height - padding.bottom} />
              <circle cx={hoverX} cy={hoverY} r="5" />
            </g>
          ) : null}
          <rect
            x={padding.left}
            y={padding.top}
            width={plotWidth}
            height={plotHeight}
            className="chart-hover-capture"
          />
        </g>
      </svg>
      {hoverPoint ? (
        <div
          className={tooltipClassName}
          style={{ left: `${(hoverX / width) * 100}%`, top: `${(tooltipY / height) * 100}%` }}
        >
          <strong>{formatDate(hoverPoint.date)}</strong>
          <span>账户净值 {formatCurrency(hoverPoint.netValue, currency)}</span>
          {series.map((line) => {
            const point = hoverState ? interpolatePointAtTime(line.points, hoverState.time, hoverState.date) : null;
            if (!point) return null;
            return <span key={line.key}>{line.label} {formatPercent(point.value)}</span>;
          })}
        </div>
      ) : null}
    </div>
  );
}

function clientPointToSvgPoint(svg: SVGSVGElement, event: MouseEvent<SVGSVGElement>) {
  const matrix = svg.getScreenCTM();
  if (matrix) {
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(matrix.inverse());
    return { x: transformed.x, y: transformed.y };
  }
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  return {
    x: viewBox.x + ((event.clientX - rect.left) / rect.width) * viewBox.width,
    y: viewBox.y + ((event.clientY - rect.top) / rect.height) * viewBox.height,
  };
}

function ChartKpi({ label, value, tone }: { label: string; value: ReactNode; tone: "neutral" | "positive" | "negative" | "accent" }) {
  return (
    <span className={`chart-kpi-item chart-kpi-item--${tone}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function normalizeCurveRows(rows: ApiRecord[]): CurvePoint[] {
  const points: CurvePoint[] = [];
  for (const row of rows) {
    const date = normalizeIsoDate(row.report_date_iso ?? row.report_date);
    if (!date) continue;
    points.push({
      date,
      label: formatDate(date),
      equity: asNumber(row.equity ?? row.total_equity, 0),
      cash: asNumber(row.cash, 0),
      marketValue: asNumber(row.market_value ?? row.stock_market_value, 0),
    });
  }
  points.sort((left, right) => left.date.localeCompare(right.date));
  return points;
}

function normalizeFlowEvents(rows: ApiRecord[]): FlowEvent[] {
  const events: FlowEvent[] = [];
  for (const row of rows) {
    const date = normalizeIsoDate(row.report_date_iso ?? row.report_date ?? row.date);
    const amount = asNumber(row.amount, 0);
    if (!date || Math.abs(amount) < 1e-9) continue;
    events.push({
      date,
      amount,
      label: asText(row.label, amount >= 0 ? "入金" : "出金"),
      flowType: amount >= 0 ? "inflow" : "outflow",
    });
  }
  events.sort((left, right) => left.date.localeCompare(right.date));
  return events;
}

function normalizeBenchmarkSeries(rows: ApiRecord[]): BenchmarkSeries[] {
  if (rows.length === 0) return DEFAULT_BENCHMARKS;
  return rows.map((row, index) => {
    const fallback = DEFAULT_BENCHMARKS[index] ?? DEFAULT_BENCHMARKS[0];
    return {
      key: asText(row.key, fallback.key),
      label: asText(row.label, fallback.label),
      symbol: asText(row.symbol, fallback.symbol),
      status: asText(row.status, "pending"),
      source: asText(row.source, ""),
      points: asArray(row.points)
        .map((point) => {
          const date = normalizeIsoDate(point.report_date_iso ?? point.date);
          if (!date) return null;
          return { date, value: asNumber(point.value ?? point.close, 0) };
        })
        .filter((point): point is { date: string; value: number } => Boolean(point)),
    };
  });
}

function buildPortfolioReturnSeries(points: CurvePoint[], events: FlowEvent[], method: ReturnMethod): ChartSeries {
  return {
    key: "portfolio",
    label: "账户收益率",
    color: "#226f54",
    points: points.map((point, index) => {
      if (index === 0) {
        return { date: point.date, value: 0, netValue: point.equity };
      }
      const throughDate = points.slice(0, index + 1);
      const throughEvents = events.filter(
        (event) => event.date > throughDate[0].date && event.date <= point.date,
      );
      return {
        date: point.date,
        value: calculateReturn(throughDate, throughEvents, method).rate ?? 0,
        netValue: point.equity,
      };
    }),
  };
}

function buildBenchmarkReturnSeries(benchmarks: BenchmarkSeries[], selectedRange: { points: CurvePoint[]; startDate: string; endDate: string }): ChartSeries[] {
  return benchmarks
    .filter((benchmark) => benchmark.points.length > 1)
    .map((benchmark, index) => {
      const visible = benchmark.points.filter((point) => point.date >= selectedRange.startDate && point.date <= selectedRange.endDate);
      if (visible.length < 2) return null;
      const base = visible[0].value;
      if (base <= 0) return null;
      return {
        key: benchmark.key,
        label: benchmark.label,
        color: ["#5c5a97", "#a05a16", "#2f6f9f"][index] ?? "#5c5a97",
        points: visible.map((point) => ({
          date: point.date,
          value: (point.value / base) - 1,
        })),
      };
    })
    .filter((series): series is ChartSeries => Boolean(series));
}

function getReturnAxis(values: number[]): { min: number; max: number; ticks: number[] } {
  const finiteValues = values.filter(Number.isFinite);
  if (finiteValues.length === 0) {
    return { min: -0.01, max: 0.01, ticks: [-0.01, 0, 0.01] };
  }

  let rawMin = Math.min(0, ...finiteValues);
  let rawMax = Math.max(0, ...finiteValues);
  if (Math.abs(rawMax - rawMin) < 1e-9) {
    const pad = Math.max(Math.abs(rawMax) * 0.12, 0.01);
    rawMin -= pad;
    rawMax += pad;
  }

  const rawRange = rawMax - rawMin;
  const pad = Math.max(rawRange * 0.025, 0.001);
  const min = normalizeTick(rawMin < 0 ? rawMin - pad : rawMin);
  const max = normalizeTick(rawMax > 0 ? rawMax + pad : rawMax);
  const tickCount = 5;
  const ticks = Array.from({ length: tickCount }, (_, index) => (
    normalizeTick(min + ((max - min) * index) / (tickCount - 1))
  ));
  return { min, max, ticks };
}

function normalizeTick(value: number): number {
  const normalized = Number(value.toFixed(8));
  return Math.abs(normalized) < 1e-10 ? 0 : normalized;
}

function interpolatePointAtTime(
  points: Array<{ date: string; value: number; netValue?: number }>,
  time: number,
  displayDate?: string,
) {
  if (points.length === 0) return null;
  const first = points[0];
  const firstTime = dateToTime(first.date);
  if (time <= firstTime) return first;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const previousTime = dateToTime(previous.date);
    const currentTime = dateToTime(current.date);
    if (time > currentTime) continue;
    const span = currentTime - previousTime || 1;
    const ratio = clamp((time - previousTime) / span, 0, 1);
    return {
      date: displayDate ?? isoFromDate(new Date(time)),
      value: previous.value + (current.value - previous.value) * ratio,
      netValue: interpolateOptionalNumber(previous.netValue, current.netValue, ratio),
    };
  }

  return points[points.length - 1];
}

function interpolateOptionalNumber(previous: number | undefined, current: number | undefined, ratio: number) {
  if (previous === undefined || current === undefined) return previous ?? current;
  return previous + (current - previous) * ratio;
}

function selectRange(points: CurvePoint[], range: RangeKey, customStart: string, customEnd: string) {
  if (points.length === 0) {
    return { points: [], startDate: "", endDate: "" };
  }
  const lastDate = points[points.length - 1].date;
  const firstDate = points[0].date;
  const endDate = range === "custom" ? (customEnd || lastDate) : lastDate;
  const startDate = range === "custom" ? (customStart || firstDate) : getRangeStart(range, endDate, firstDate);
  const filtered = points.filter((point) => point.date >= startDate && point.date <= endDate);
  const anchor = points.filter((point) => point.date < startDate).pop();
  const selected = anchor && filtered.length > 0 ? [anchor, ...filtered] : filtered;
  return {
    points: selected.length > 0 ? selected : points.slice(-2),
    startDate: selected[0]?.date ?? startDate,
    endDate: selected[selected.length - 1]?.date ?? endDate,
  };
}

function getRangeStart(range: RangeKey, endDate: string, firstDate: string): string {
  const end = dateFromIso(endDate);
  if (!end) return firstDate;
  if (range === "all") return firstDate;
  if (range === "1w") return isoFromDate(addDays(end, -7));
  if (range === "mtd") return isoFromDate(new Date(end.getFullYear(), end.getMonth(), 1));
  if (range === "1m") return isoFromDate(addMonths(end, -1));
  if (range === "3m") return isoFromDate(addMonths(end, -3));
  if (range === "ytd") return isoFromDate(new Date(end.getFullYear(), 0, 1));
  if (range === "1y") return isoFromDate(addMonths(end, -12));
  return firstDate;
}

function calculateReturn(points: CurvePoint[], events: FlowEvent[], method: ReturnMethod): { amount: number | null; rate: number | null } {
  if (points.length < 2) return { amount: null, rate: null };
  const first = points[0];
  const last = points[points.length - 1];
  const netFlow = events.reduce((sum, event) => sum + event.amount, 0);
  const amount = last.equity - first.equity - netFlow;
  if (method === "twr") {
    let growth = 1;
    let periods = 0;
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      if (Math.abs(previous.equity) < 1e-12) continue;
      const flow = events
        .filter((event) => event.date > previous.date && event.date <= current.date)
        .reduce((sum, event) => sum + event.amount, 0);
      const dailyReturn = (current.equity - previous.equity - flow) / previous.equity;
      if (Math.abs(dailyReturn) >= 0.5) continue;
      growth *= 1 + dailyReturn;
      periods += 1;
    }
    if (periods === 0) return { amount: null, rate: null };
    const rate = growth - 1;
    return { amount: first.equity * rate, rate };
  }
  if (method === "cash") {
    const totalDays = Math.max(daysBetween(first.date, last.date), 1);
    const weightedFlow = events.reduce((sum, event) => {
      const elapsed = clamp(daysBetween(first.date, event.date), 0, totalDays);
      return sum + event.amount * ((totalDays - elapsed) / totalDays);
    }, 0);
    const denominator = first.equity + weightedFlow;
    return {
      amount,
      rate: Math.abs(denominator) < 1e-12 ? null : amount / denominator,
    };
  }
  const denominator = first.equity + netFlow;
  return {
    amount,
    rate: Math.abs(denominator) < 1e-12 ? null : amount / denominator,
  };
}

function normalizeIsoDate(value: unknown): string {
  const text = asText(value, "");
  if (!text) return "";
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return "";
}

function dateFromIso(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateToTime(value: string): number {
  return dateFromIso(value)?.getTime() ?? 0;
}

function isoFromDate(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(value: Date, months: number): Date {
  const next = new Date(value);
  next.setMonth(next.getMonth() + months);
  return next;
}

function daysBetween(start: string, end: string): number {
  const startDate = dateFromIso(start);
  const endDate = dateFromIso(end);
  if (!startDate || !endDate) return 0;
  return Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
}
