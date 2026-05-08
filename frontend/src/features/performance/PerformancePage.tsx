import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { api } from "../../lib/api";
import type { ApiRecord, PageState } from "../../lib/contracts";
import {
  asArray,
  asNumber,
  asRecord,
  asText,
  clamp,
  deltaClass,
  formatCurrency,
  formatInteger,
  formatMonth,
  formatNumber,
  formatPercent,
} from "../../lib/format";
import { DataState, DeltaText, EmptyState, MetricCard, PageHeader, StatusPill, Surface } from "../../components/Primitives";

type CalendarMode = "month" | "year";

type TradeMonthRow = {
  month: string;
  trade_count: number;
  trade_notional_abs: number;
};

type MonthCalendarCell =
  | { empty: true; key: string }
  | { empty: false; key: string; day: number; date: string; value: number; realized: number; unrealized: number };

export function PerformancePage() {
  const [state, setState] = useState<PageState<ApiRecord>>({ data: null, loading: true, error: null });

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await api.performance();
      setState({ data, loading: false, error: null });
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error instanceof Error ? error.message : "unknown error" }));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <DataState loading={state.loading} error={state.error} data={state.data} onRetry={load}>
      {(data) => <PerformanceContent data={data} onRefresh={load} />}
    </DataState>
  );
}

function PerformanceContent({
  data,
  onRefresh,
}: {
  data: ApiRecord;
  onRefresh: () => void;
}) {
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("month");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const currency = asText(data.display_currency, "USD");
  const pnlLeaderboard = asRecord(data.pnl_leaderboard);
  const leaderboardSummary = asRecord(pnlLeaderboard.summary);
  const topProfit = asArray(pnlLeaderboard.top_profit);
  const topLoss = asArray(pnlLeaderboard.top_loss);
  const calendar = asRecord(data.pnl_calendar);
  const daily = asArray(calendar.daily);
  const monthly = asArray(calendar.monthly);
  const monthlyTradeStats = asArray(data.monthly_trade_stats);
  const monthOptions = useMemo(() => buildMonthOptions(daily, monthly), [daily, monthly]);
  const yearOptions = useMemo(() => buildYearOptions(daily, monthly), [daily, monthly]);
  const tradeRows = useMemo(() => buildRecentTradeRows(monthlyTradeStats), [monthlyTradeStats]);
  const selectorOptions = calendarMode === "month" ? monthOptions : yearOptions;
  const selectorValue = calendarMode === "month" ? selectedMonth : selectedYear;
  const tradeWinRate = leaderboardSummary.trade_win_rate ?? leaderboardSummary.win_rate;

  useEffect(() => {
    if (monthOptions.length === 0) {
      if (selectedMonth) setSelectedMonth("");
      return;
    }
    if (!monthOptions.includes(selectedMonth)) {
      setSelectedMonth(monthOptions[0]);
    }
  }, [monthOptions, selectedMonth]);

  useEffect(() => {
    if (yearOptions.length === 0) {
      if (selectedYear) setSelectedYear("");
      return;
    }
    if (!yearOptions.includes(selectedYear)) {
      setSelectedYear(yearOptions[0]);
    }
  }, [selectedYear, yearOptions]);

  return (
    <>
      <PageHeader
        eyebrow="业绩分析"
        title="收益贡献、盈亏日历与交易节奏"
        description="贡献榜按累计口径统计，盈亏日历按当日或当月涨跌金额展示。"
        meta={
          <>
            <StatusPill tone="accent">{asText(data.valuation_mode, "mixed")}</StatusPill>
            <button type="button" onClick={onRefresh}>刷新</button>
          </>
        }
      />

      <div className="metric-grid metric-grid--compact">
        <MetricCard label="至今累计盈利" value={<DeltaText value={leaderboardSummary.total_profit} currency={currency} />} tone="positive" />
        <MetricCard label="至今累计亏损" value={<DeltaText value={leaderboardSummary.total_loss} currency={currency} />} tone="negative" />
        <MetricCard label="净收益贡献" value={<DeltaText value={leaderboardSummary.net_pnl} currency={currency} />} tone={deltaClass(leaderboardSummary.net_pnl)} />
        <MetricCard label="交易胜率" value={formatPercent(tradeWinRate)} tone="accent" />
        <MetricCard label="盈利标的" value={formatInteger(leaderboardSummary.winning_symbols)} tone="positive" />
        <MetricCard label="亏损标的" value={formatInteger(leaderboardSummary.losing_symbols)} tone="negative" />
      </div>

      <div className="content-grid">
        <Surface title="盈利 TOP10" subtitle="按已实现盈亏 + 未实现盈亏排序。">
          <ContributionList rows={topProfit} currency={currency} />
        </Surface>
        <Surface title="亏损 TOP10" subtitle="亏损越靠前，对总收益拖累越大。">
          <ContributionList rows={topLoss} currency={currency} negative />
        </Surface>
      </div>

      <Surface
        title="盈亏日历"
        subtitle={calendarMode === "month" ? "按日显示所选月份的当日盈亏。" : "按月汇总所选年份的月度盈亏。"}
        action={
          <div className="performance-panel-toolbar">
            <select
              value={selectorValue}
              onChange={(event) => {
                if (calendarMode === "month") {
                  setSelectedMonth(event.target.value);
                } else {
                  setSelectedYear(event.target.value);
                }
              }}
            >
              {selectorOptions.length === 0 ? <option value="">暂无数据</option> : null}
              {selectorOptions.map((option) => (
                <option key={option} value={option}>
                  {calendarMode === "month" ? formatMonth(option) : `${option} 年`}
                </option>
              ))}
            </select>
            <div className="segmented-control segmented-control--compact" role="group" aria-label="日历维度">
              <button type="button" className={calendarMode === "month" ? "active" : ""} onClick={() => setCalendarMode("month")}>月</button>
              <button type="button" className={calendarMode === "year" ? "active" : ""} onClick={() => setCalendarMode("year")}>年</button>
            </div>
          </div>
        }
      >
        <PnlCalendar
          mode={calendarMode}
          selectedMonth={selectedMonth}
          selectedYear={selectedYear}
          daily={daily}
          monthly={monthly}
          currency={currency}
        />
      </Surface>

      <Surface title="月度交易统计" subtitle="近一年交易笔数柱状图。">
        <MonthlyTradeChart rows={tradeRows} currency={currency} />
      </Surface>
    </>
  );
}

function ContributionList({ rows, currency, negative = false }: { rows: ApiRecord[]; currency: string; negative?: boolean }) {
  const visible = rows.slice(0, 10);
  if (visible.length === 0) {
    return <EmptyState compact title="暂无贡献数据" detail="导入持仓和交易记录后显示。" />;
  }
  const max = Math.max(...visible.map((row) => Math.abs(asNumber(row.total_pnl, 0))), 1);
  return (
    <div className="contribution-list">
      {visible.map((row, index) => {
        const total = asNumber(row.total_pnl, 0);
        const width = clamp(Math.abs(total) / max, 0.04, 1) * 100;
        return (
          <div className={`contribution-row ${negative ? "contribution-row--negative" : ""}`.trim()} key={`${asText(row.symbol)}-${index}`}>
            <div className="contribution-row__head">
              <strong>{asText(row.symbol)}</strong>
              <DeltaText value={total} currency={currency} />
            </div>
            <div className="contribution-track">
              <i style={{ width: `${width}%` }} />
            </div>
            <div className="contribution-row__meta">
              <span>已实现 {formatCurrency(row.realized_pnl, currency)}</span>
              <span>未实现 {formatCurrency(row.unrealized_pnl, currency)}</span>
              <span>{formatInteger(row.trade_count)} 笔</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PnlCalendar({
  mode,
  selectedMonth,
  selectedYear,
  daily,
  monthly,
  currency,
}: {
  mode: CalendarMode;
  selectedMonth: string;
  selectedYear: string;
  daily: ApiRecord[];
  monthly: ApiRecord[];
  currency: string;
}) {
  if (mode === "year") {
    return <YearPnlCalendar selectedYear={selectedYear} monthly={monthly} currency={currency} />;
  }
  return <MonthPnlCalendar selectedMonth={selectedMonth} daily={daily} currency={currency} />;
}

function MonthPnlCalendar({ selectedMonth, daily, currency }: { selectedMonth: string; daily: ApiRecord[]; currency: string }) {
  if (!selectedMonth) {
    return <EmptyState compact title="暂无日历数据" detail="导入交易记录后显示盈亏日历。" />;
  }
  const [year, month] = selectedMonth.split("-").map((part) => Number(part));
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const dailyMap = new Map(daily.map((row) => {
    const realized = asNumber(row.realized_pnl, 0);
    const unrealized = asNumber(row.unrealized_pnl, 0);
    return [
      normalizeDateKey(row.date_iso ?? row.date),
      {
        value: asNumber(row.total_pnl, realized + unrealized),
        realized,
        unrealized,
      },
    ];
  }));
  const cells: MonthCalendarCell[] = [
    ...Array.from({ length: firstDay }, (_, index): MonthCalendarCell => ({ empty: true, key: `empty-${index}` })),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const date = `${selectedMonth}-${String(day).padStart(2, "0")}`;
      const pnl = dailyMap.get(date) ?? { value: 0, realized: 0, unrealized: 0 };
      return { empty: false, key: date, day, date, ...pnl };
    }),
  ];
  const maxAbs = Math.max(...cells.map((cell) => Math.abs(cell.empty ? 0 : cell.value)), 0);
  return (
    <div className="pnl-calendar">
      <div className="pnl-calendar__weekdays">
        {["日", "一", "二", "三", "四", "五", "六"].map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className="pnl-calendar__grid">
        {cells.map((cell) => {
          if (cell.empty === true) return <div className="pnl-day pnl-day--empty" key={cell.key} />;
          return (
            <div
              className="pnl-day"
              key={cell.key}
              style={getPnlHeatStyle(cell.value, maxAbs)}
              title={`${cell.date} 当日盈亏 ${formatCurrency(cell.value, currency)} / 已实现 ${formatCurrency(cell.realized, currency)} / 未实现变动 ${formatCurrency(cell.unrealized, currency)}`}
            >
              <span>{cell.day}</span>
              {cell.value !== 0 ? <strong className={deltaClass(cell.value)}>{formatCurrency(cell.value, currency, 0)}</strong> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function YearPnlCalendar({ selectedYear, monthly, currency }: { selectedYear: string; monthly: ApiRecord[]; currency: string }) {
  if (!selectedYear) {
    return <EmptyState compact title="暂无年度数据" detail="导入交易记录后显示年度盈亏。" />;
  }
  const monthlyMap = new Map(monthly.map((row) => {
    const realized = asNumber(row.realized_pnl, 0);
    const unrealized = asNumber(row.unrealized_pnl, 0);
    return [
      normalizeMonthKey(row.month),
      {
        value: asNumber(row.total_pnl, realized + unrealized),
        realized,
        unrealized,
      },
    ];
  }));
  const cells = Array.from({ length: 12 }, (_, index) => {
    const month = `${selectedYear}-${String(index + 1).padStart(2, "0")}`;
    const pnl = monthlyMap.get(month) ?? { value: 0, realized: 0, unrealized: 0 };
    return { month, ...pnl };
  });
  const maxAbs = Math.max(...cells.map((cell) => Math.abs(cell.value)), 0);
  return (
    <div className="pnl-calendar pnl-calendar--year">
      {cells.map((cell) => (
        <div
          className="pnl-month"
          key={cell.month}
          style={getPnlHeatStyle(cell.value, maxAbs)}
          title={`${formatMonth(cell.month)} 月度盈亏 ${formatCurrency(cell.value, currency)} / 已实现 ${formatCurrency(cell.realized, currency)} / 未实现变动 ${formatCurrency(cell.unrealized, currency)}`}
        >
          <span>{formatMonth(cell.month)}</span>
          {cell.value !== 0 ? <strong className={deltaClass(cell.value)}>{formatCurrency(cell.value, currency, 0)}</strong> : <em>0</em>}
        </div>
      ))}
    </div>
  );
}

function MonthlyTradeChart({ rows, currency }: { rows: TradeMonthRow[]; currency: string }) {
  if (rows.length === 0) {
    return <EmptyState compact title="暂无交易统计" detail="导入交易记录后显示近一年交易笔数。" />;
  }
  const width = 900;
  const height = 280;
  const padding = { top: 18, right: 18, bottom: 46, left: 52 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxCount = Math.max(...rows.map((row) => row.trade_count), 1);
  const yTicks = Array.from(new Set([0, Math.ceil(maxCount / 2), maxCount]));
  const slotWidth = plotWidth / rows.length;
  const barWidth = Math.max(18, slotWidth * 0.58);
  const totalTrades = rows.reduce((sum, row) => sum + row.trade_count, 0);
  const totalNotional = rows.reduce((sum, row) => sum + row.trade_notional_abs, 0);
  const averageTrades = totalTrades / rows.length;

  return (
    <div className="monthly-trade-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="近一年月度交易笔数柱状图">
        {yTicks.map((tick) => {
          const y = padding.top + plotHeight - (tick / maxCount) * plotHeight;
          return (
            <g key={tick}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="monthly-trade-chart__grid" />
              <text x={padding.left - 12} y={y + 4} textAnchor="end">{formatInteger(tick)}</text>
            </g>
          );
        })}
        {rows.map((row, index) => {
          const barHeight = (row.trade_count / maxCount) * plotHeight;
          const x = padding.left + index * slotWidth + (slotWidth - barWidth) / 2;
          const y = padding.top + plotHeight - barHeight;
          return (
            <g key={row.month}>
              <rect x={x} y={y} width={barWidth} height={barHeight} rx="5" className="monthly-trade-chart__bar">
                <title>{`${formatMonth(row.month)} ${formatInteger(row.trade_count)} 笔`}</title>
              </rect>
              <text x={x + barWidth / 2} y={height - 18} textAnchor="middle">{formatMonth(row.month).slice(5)}</text>
            </g>
          );
        })}
      </svg>
      <div className="trade-stat-summary">
        <div className="trade-stat-card">
          <span>总交易笔数</span>
          <strong>{formatInteger(totalTrades)}</strong>
        </div>
        <div className="trade-stat-card">
          <span>总交易额</span>
          <strong>{formatCurrency(totalNotional, currency)}</strong>
        </div>
        <div className="trade-stat-card">
          <span>月均交易</span>
          <strong>{formatNumber(averageTrades, 1)}</strong>
        </div>
      </div>
    </div>
  );
}

function buildMonthOptions(daily: ApiRecord[], monthly: ApiRecord[]): string[] {
  const keys = new Set<string>();
  for (const row of daily) {
    const key = normalizeDateKey(row.date_iso ?? row.date).slice(0, 7);
    if (key.length === 7) keys.add(key);
  }
  for (const row of monthly) {
    const key = normalizeMonthKey(row.month);
    if (key) keys.add(key);
  }
  return [...keys].sort().reverse();
}

function buildYearOptions(daily: ApiRecord[], monthly: ApiRecord[]): string[] {
  const keys = new Set<string>();
  for (const month of buildMonthOptions(daily, monthly)) {
    keys.add(month.slice(0, 4));
  }
  return [...keys].sort().reverse();
}

function buildRecentTradeRows(rows: ApiRecord[]): TradeMonthRow[] {
  const monthly = new Map<string, TradeMonthRow>();
  for (const row of rows) {
    const month = normalizeMonthKey(row.month);
    if (!month) continue;
    monthly.set(month, {
      month,
      trade_count: asNumber(row.trade_count, 0),
      trade_notional_abs: asNumber(row.trade_notional_abs, 0),
    });
  }
  const keys = [...monthly.keys()].sort();
  const lastMonth = keys[keys.length - 1];
  if (!lastMonth) return [];
  return Array.from({ length: 12 }, (_, index) => {
    const month = addMonths(lastMonth, index - 11);
    return monthly.get(month) ?? { month, trade_count: 0, trade_notional_abs: 0 };
  });
}

function normalizeDateKey(value: unknown): string {
  const text = asText(value, "");
  const digits = text.replace(/\D/g, "");
  if (digits.length < 8) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function normalizeMonthKey(value: unknown): string {
  const text = asText(value, "");
  const digits = text.replace(/\D/g, "");
  if (digits.length < 6) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}`;
}

function addMonths(month: string, offset: number): string {
  const [year, monthIndex] = month.split("-").map((part) => Number(part));
  const date = new Date(year, monthIndex - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getPnlHeatStyle(value: number, maxAbs: number): CSSProperties {
  if (value === 0 || maxAbs <= 0) return {};
  const intensity = clamp(Math.abs(value) / maxAbs, 0.12, 1);
  const alpha = 0.1 + intensity * 0.42;
  const color = value > 0 ? "20, 122, 74" : "177, 58, 50";
  return {
    backgroundColor: `rgba(${color}, ${alpha})`,
    borderColor: `rgba(${color}, ${0.18 + intensity * 0.28})`,
  };
}
