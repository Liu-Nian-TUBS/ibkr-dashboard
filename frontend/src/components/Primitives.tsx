import type { ReactNode } from "react";
import type { ApiRecord } from "../lib/contracts";
import { asNumber, asText, clamp, deltaClass, formatCurrency, formatNumber, formatPercent } from "../lib/format";

export function PageHeader({
  eyebrow,
  title,
  description,
  meta,
}: {
  eyebrow: string;
  title: string;
  description: string;
  meta?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {meta ? <div className="page-header__meta">{meta}</div> : null}
    </header>
  );
}

export function Surface({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`surface ${className}`.trim()}>
      {(title || subtitle || action) && (
        <div className="surface__header">
          <div>
            {title ? <h2>{title}</h2> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {action ? <div className="surface__action">{action}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "positive" | "negative" | "accent";
}) {
  return (
    <div className={`metric-card metric-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

export function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "positive" | "negative" | "accent" }) {
  return <span className={`status-pill status-pill--${tone}`}>{children}</span>;
}

export function EmptyState({
  title,
  detail,
  compact = false,
}: {
  title: string;
  detail: string;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state ${compact ? "empty-state--compact" : ""}`}>
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state">
      <strong>数据读取失败</strong>
      <span>{message}</span>
      {onRetry ? <button type="button" onClick={onRetry}>重试</button> : null}
    </div>
  );
}

export function LoadingBlock({ label = "正在读取数据" }: { label?: string }) {
  return (
    <div className="loading-block">
      <span />
      <strong>{label}</strong>
    </div>
  );
}

export function DataState<T>({
  loading,
  error,
  data,
  onRetry,
  children,
}: {
  loading: boolean;
  error: string | null;
  data: T | null;
  onRetry: () => void;
  children: (data: T) => ReactNode;
}) {
  if (loading && !data) return <LoadingBlock />;
  if (error && !data) return <ErrorState message={error} onRetry={onRetry} />;
  if (!data) return <EmptyState title="暂无数据" detail="接口暂未返回可展示的数据。" />;
  return <>{children(data)}</>;
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}

export function Pager({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pager">
      <button type="button" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1}>上一页</button>
      <span>第 {page} / {pageCount} 页</span>
      <button type="button" onClick={() => onPageChange(Math.min(pageCount, page + 1))} disabled={page >= pageCount}>下一页</button>
    </div>
  );
}

export function DataTable({
  columns,
  rows,
  empty,
  onRowClick,
  sortKey,
  sortDir,
  onSort,
}: {
  columns: Array<{ key: string; label: string; align?: "left" | "right"; sortable?: boolean; render?: (row: ApiRecord, index: number) => ReactNode }>;
  rows: ApiRecord[];
  empty?: string;
  onRowClick?: (row: ApiRecord) => void;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  onSort?: (key: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.align === "right" ? "align-right" : undefined}>
                {onSort && column.sortable !== false ? (
                  <button
                    type="button"
                    className={`table-sort-button ${column.align === "right" ? "table-sort-button--right" : ""}`.trim()}
                    onClick={() => onSort(column.key)}
                  >
                    <span>{column.label}</span>
                    {sortKey === column.key ? <em>{sortDir === "asc" ? "↑" : "↓"}</em> : null}
                  </button>
                ) : column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="table-empty">{empty ?? "暂无数据"}</td>
            </tr>
          ) : rows.map((row, index) => (
            <tr key={`${asText(row.id ?? row.document_id ?? row.trade_id ?? row.symbol ?? index)}-${index}`} onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {columns.map((column) => (
                <td key={column.key} className={column.align === "right" ? "align-right" : undefined}>
                  {column.render ? column.render(row, index) : asText(row[column.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MiniLineChart({
  rows,
  valueKey,
  labelKey,
  currency,
}: {
  rows: ApiRecord[];
  valueKey: string;
  labelKey: string;
  currency: string;
}) {
  if (rows.length < 2) {
    return <EmptyState compact title="曲线数据不足" detail="导入更多历史快照后，这里会显示趋势。" />;
  }
  const width = 720;
  const height = 220;
  const values = rows.map((row) => asNumber(row[valueKey], 0));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = rows.map((row, index) => {
    const x = rows.length === 1 ? 0 : (index / (rows.length - 1)) * width;
    const y = height - ((asNumber(row[valueKey], 0) - min) / range) * height;
    return `${x},${y}`;
  }).join(" ");
  const first = rows[0];
  const last = rows[rows.length - 1];
  return (
    <div className="chart-box">
      <div className="chart-box__summary">
        <span>{asText(first[labelKey])}</span>
        <strong>{formatCurrency(last[valueKey], currency)}</strong>
        <span>{asText(last[labelKey])}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="趋势图">
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function BarList({
  rows,
  labelKey,
  valueKey,
  currency,
  limit = 8,
}: {
  rows: ApiRecord[];
  labelKey: string;
  valueKey: string;
  currency?: string;
  limit?: number;
}) {
  const visible = rows.slice(0, limit);
  const max = Math.max(...visible.map((row) => Math.abs(asNumber(row[valueKey], 0))), 1);
  if (visible.length === 0) return <EmptyState compact title="暂无分布数据" detail="导入持仓或交易数据后显示。" />;
  return (
    <div className="bar-list">
      {visible.map((row, index) => {
        const value = asNumber(row[valueKey], 0);
        const percent = clamp(Math.abs(value) / max, 0.02, 1) * 100;
        return (
          <div className="bar-row" key={`${asText(row[labelKey])}-${index}`}>
            <span>{asText(row[labelKey])}</span>
            <div><i style={{ width: `${percent}%` }} /></div>
            <strong>{currency ? formatCurrency(value, currency) : formatNumber(value)}</strong>
          </div>
        );
      })}
    </div>
  );
}

export function AllocationBars({
  rows,
  currency,
}: {
  rows: Array<{ label: string; value: number; weight?: number }>;
  currency: string;
}) {
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.value), 0);
  if (total <= 0) return <EmptyState compact title="暂无占比数据" detail="导入持仓快照后显示资产占比。" />;
  return (
    <div className="allocation-list">
      {rows.map((row) => {
        const weight = row.weight ?? row.value / total;
        return (
          <div className="allocation-row" key={row.label}>
            <div>
              <strong>{row.label}</strong>
              <span>{formatCurrency(row.value, currency)}</span>
            </div>
            <div className="allocation-row__track">
              <i style={{ width: `${clamp(weight, 0, 1) * 100}%` }} />
            </div>
            <em>{formatPercent(weight)}</em>
          </div>
        );
      })}
    </div>
  );
}

export function DeltaText({ value, currency }: { value: unknown; currency?: string }) {
  const klass = deltaClass(value);
  return <span className={`delta-text ${klass}`}>{currency ? formatCurrency(value, currency) : formatNumber(value)}</span>;
}
