import { useMemo, useState } from "react";

type OverviewPoint = {
  report_date?: string;
  report_date_iso?: string;
  equity?: number;
  cash?: number;
  market_value?: number;
};

type OverviewPanelProps = {
  data: Record<string, unknown>;
};

const RANGE_OPTIONS = [
  { id: "1W", label: "1周", days: 7 },
  { id: "MTD", label: "本月至今", days: 31 },
  { id: "1M", label: "1个月", days: 31 },
  { id: "3M", label: "3个月", days: 93 },
  { id: "YTD", label: "本年至今", days: 365 },
  { id: "1Y", label: "1年", days: 365 },
  { id: "ALL", label: "全部", days: 10000 },
  { id: "CUSTOM", label: "自定义", days: 0 }
];

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "number") {
    return value.toLocaleString("zh-CN");
  }
  return String(value);
}

function formatCurrency(value: unknown, _currency = "USD"): string {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return "-";
  return num.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return `${(num * 100).toFixed(2)}%`;
}

function toDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  if (raw.includes("-")) return new Date(`${raw}T00:00:00`);
  if (raw.length === 8) {
    return new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00`);
  }
  return null;
}

function getPath(points: OverviewPoint[], width: number, height: number, valueKey: "equity" | "market_value"): string {
  if (points.length < 2) return "";
  const padding = 22;
  const values = points.map((item) => Number(item[valueKey] ?? 0));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  return points
    .map((item, idx) => {
      const x = padding + (idx / (points.length - 1)) * (width - padding * 2);
      const y = padding + (1 - (Number(item[valueKey] ?? 0) - min) / range) * (height - padding * 2);
      return `${idx === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export default function OverviewPanel({ data }: OverviewPanelProps) {
  const [range, setRange] = useState("ALL");
  const [metricMode, setMetricMode] = useState("simple");
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const currency = String(data.display_currency ?? "USD");
  const hasData = Boolean(data.report_date);
  const topHoldings = Array.isArray(data.top_holdings)
    ? (data.top_holdings as Array<Record<string, unknown>>)
    : [];
  const points = Array.isArray(data.equity_curve)
    ? (data.equity_curve as Array<Record<string, unknown>>)
    : [];
  const parsedPoints: OverviewPoint[] = points.map((point) => ({
    report_date: String(point.report_date ?? ""),
    report_date_iso: String(point.report_date_iso ?? ""),
    equity: Number(point.equity ?? 0),
    cash: Number(point.cash ?? 0),
    market_value: Number(point.market_value ?? 0)
  }));
  const filteredPoints = useMemo(() => {
    if (parsedPoints.length <= 2) return parsedPoints;
    if (range === "ALL") return parsedPoints;
    const latest = toDate(parsedPoints[parsedPoints.length - 1].report_date_iso || parsedPoints[parsedPoints.length - 1].report_date);
    if (!latest) return parsedPoints;
    if (range === "CUSTOM") {
      const start = toDate(customStart);
      const end = toDate(customEnd);
      if (!start || !end) return parsedPoints;
      return parsedPoints.filter((point) => {
        const d = toDate(point.report_date_iso || point.report_date);
        return Boolean(d && d >= start && d <= end);
      });
    }
    const option = RANGE_OPTIONS.find((item) => item.id === range);
    if (!option) return parsedPoints;
    const floor = new Date(latest);
    floor.setDate(floor.getDate() - option.days);
    return parsedPoints.filter((point) => {
      const d = toDate(point.report_date_iso || point.report_date);
      return Boolean(d && d >= floor && d <= latest);
    });
  }, [parsedPoints, range, customStart, customEnd]);

  if (!hasData) {
    return (
      <div className="empty">
        <h3>暂无账户数据</h3>
        <p>请先导入 XML 或执行每日同步，随后页面会自动显示真实资产数据。</p>
      </div>
    );
  }

  const width = 860;
  const height = 220;
  const equityPath = getPath(filteredPoints, width, height, "equity");
  const totalAssetPath = getPath(filteredPoints, width, height, "market_value");
  const latestPoint = filteredPoints[filteredPoints.length - 1];
  const firstPoint = filteredPoints[0];
  const cumulativeReturn = firstPoint?.equity ? (Number(latestPoint?.equity ?? 0) - Number(firstPoint.equity)) / Number(firstPoint.equity) : null;
  const cumulativeProfit = firstPoint ? Number(latestPoint?.equity ?? 0) - Number(firstPoint.equity ?? 0) : null;

  return (
    <div>
      <div className="section">
        <h4>资产看板</h4>
        <div className="kv-grid">
          <div className="kv-item"><span>报告日期</span><strong>{formatValue(data.report_date_iso)}</strong></div>
          <div className="kv-item"><span>总资产</span><strong>{formatCurrency(data.equity, currency)}</strong></div>
          <div className="kv-item"><span>现金</span><strong>{formatCurrency(data.cash, currency)}</strong></div>
          <div className="kv-item"><span>股票市值</span><strong>{formatCurrency(data.market_value, currency)}</strong></div>
          <div className="kv-item"><span>日变动</span><strong>{formatCurrency(data.daily_change, currency)}</strong></div>
          <div className="kv-item"><span>日收益率</span><strong>{formatPercent(data.daily_return)}</strong></div>
          <div className="kv-item"><span>持仓数量</span><strong>{formatValue(data.positions_count)}</strong></div>
          <div className="kv-item"><span>已实现盈亏</span><strong>{formatCurrency(data.realized_pnl, currency)}</strong></div>
          <div className="kv-item"><span>未实现盈亏</span><strong>{formatCurrency(data.unrealized_pnl, currency)}</strong></div>
          <div className="kv-item"><span>总盈亏</span><strong>{formatCurrency(data.total_pnl, currency)}</strong></div>
          <div className="kv-item"><span>当日 TWR</span><strong>{formatPercent(data.twr_daily)}</strong></div>
          <div className="kv-item"><span>YTD TWR</span><strong>{formatPercent(data.twr_ytd)}</strong></div>
          <div className="kv-item"><span>YTD MWRR</span><strong>{formatPercent(data.mwrr_ytd)}</strong></div>
          <div className="kv-item"><span>YTD 简单加权</span><strong>{formatPercent(data.ytd_simple_weighted)}</strong></div>
          <div className="kv-item"><span>至今 MWRR</span><strong>{formatPercent(data.mwrr_all_time)}</strong></div>
          <div className="kv-item"><span>年内分红</span><strong>{formatCurrency(data.dividends, currency)}</strong></div>
          <div className="kv-item"><span>年内利息</span><strong>{formatCurrency(data.interest, currency)}</strong></div>
          <div className="kv-item"><span>年内佣金</span><strong>{formatCurrency(data.commissions, currency)}</strong></div>
        </div>
      </div>

      <div className="section">
        <div className="row-actions">
          <h4 style={{ margin: 0 }}>净值趋势</h4>
          <span className="muted">
            累计收益：{formatCurrency(cumulativeProfit, currency)}（{formatPercent(cumulativeReturn)}）
          </span>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>时间范围</span>
            <select value={range} onChange={(event) => setRange(event.target.value)}>
              {RANGE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>收益口径</span>
            <select value={metricMode} onChange={(event) => setMetricMode(event.target.value)}>
              <option value="simple">简单加权</option>
              <option value="twr">时间加权（TWR）</option>
              <option value="mwrr">现金加权（MWRR）</option>
            </select>
          </label>
          <label className="field checkbox-field">
            <input type="checkbox" checked={compareEnabled} onChange={(event) => setCompareEnabled(event.target.checked)} />
            <span>显示基准对比（SP500/Nasdaq/QQQ）</span>
          </label>
        </div>
        {range === "CUSTOM" ? (
          <div className="form-grid">
            <label className="field">
              <span>开始日期</span>
              <input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
            </label>
            <label className="field">
              <span>结束日期</span>
              <input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
            </label>
          </div>
        ) : null}
        {compareEnabled ? <p className="muted">基准对比数据接口待接入，当前先保留对比位。</p> : null}
        {filteredPoints.length < 2 ? (
          <p className="muted">暂无足够历史快照，无法绘制净值趋势。</p>
        ) : (
          <svg viewBox={`0 0 ${width} ${height}`} className="curve-chart" role="img">
            <rect x={0} y={0} width={width} height={height} rx={8} fill="#0d1117" />
            <path d={equityPath} fill="none" stroke="#2f81f7" strokeWidth="2.5" />
          </svg>
        )}
      </div>

      <div className="section">
        <div className="row-actions">
          <h4 style={{ margin: 0 }}>总资产趋势</h4>
          <span className="muted">用于观察资产规模变化，后续支持出入金点位标注。</span>
        </div>
        {filteredPoints.length < 2 ? (
          <p className="muted">暂无足够历史快照，无法绘制总资产趋势。</p>
        ) : (
          <svg viewBox={`0 0 ${width} ${height}`} className="curve-chart" role="img">
            <rect x={0} y={0} width={width} height={height} rx={8} fill="#0d1117" />
            <path d={totalAssetPath} fill="none" stroke="#3fb950" strokeWidth="2.5" />
          </svg>
        )}
        <p className="muted">出入金标注：当前后端未提供事件点明细，图中暂不展示标注。</p>
      </div>

      <div className="section">
        <h4>前五大持仓</h4>
        {topHoldings.length === 0 ? (
          <p className="muted">暂无持仓数据</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>代码</th>
                <th>行业</th>
                <th>市值</th>
              </tr>
            </thead>
            <tbody>
              {topHoldings.map((item) => (
                <tr key={String(item.symbol ?? "")}>
                  <td>{formatValue(item.symbol)}</td>
                  <td>{formatValue(item.industry)}</td>
                  <td>{formatCurrency(item.market_value, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
