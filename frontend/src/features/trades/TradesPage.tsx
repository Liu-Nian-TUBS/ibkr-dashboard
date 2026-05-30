import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { ApiRecord } from "../../lib/contracts";
import { useApiData } from "../../lib/useApiData";
import {
  asArray,
  asNumber,
  asRecord,
  asText,
  deltaClass,
  formatCurrency,
  formatDate,
  formatDateTimeMinute,
  formatInteger,
} from "../../lib/format";
import { DataState, DataTable, DeltaText, Field, MetricCard, PageHeader, PaginationFooter, SegmentedControl, StatusPill, Surface } from "../../components/Primitives";

type TradeQuery = {
  symbol: string;
  side: string;
  source: string;
  start_date: string;
  end_date: string;
  page: number;
  page_size: number;
};

type CashFlowQuery = {
  currency: string;
  flow_type: string;
  start_date: string;
  end_date: string;
  page: number;
  page_size: number;
};

type TradesTab = "trades" | "manual" | "cash";

export function TradesPage() {
  const [activeTab, setActiveTab] = useState<TradesTab>("trades");

  return (
    <div className="trades-page">
      <PageHeader
        eyebrow="交易明细"
        title="交易记录与资金流水"
        meta={<StatusPill tone="accent">只读分析</StatusPill>}
      />

      <SegmentedControl
        ariaLabel="交易明细分类"
        className="trades-tabs segmented-control--compact"
        options={[{ value: "trades", label: "交易记录" }, { value: "manual", label: "手动录入" }, { value: "cash", label: "出入金流水" }]}
        value={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "trades" ? <TradeRecordsPanel /> : activeTab === "manual" ? <ManualTradePanel /> : <CashFlowsPanel />}
    </div>
  );
}

function TradeRecordsPanel() {
  const [query, setQuery] = useState<TradeQuery>({ symbol: "", side: "", source: "", start_date: "", end_date: "", page: 1, page_size: 20 });
  const { state, load } = useApiData<ApiRecord>(() => api.trades(query), [query]);

  return (
    <Surface title="交易流水" className="trades-surface">
      <div className="module-filter-bar module-filter-bar--trade">
        <Field label="开始时间">
          <input type="date" value={query.start_date} onChange={(event) => setQuery({ ...query, start_date: event.target.value, page: 1 })} />
        </Field>
        <Field label="结束时间">
          <input type="date" value={query.end_date} onChange={(event) => setQuery({ ...query, end_date: event.target.value, page: 1 })} />
        </Field>
        <Field label="股票代码">
          <input value={query.symbol} placeholder="AAPL" onChange={(event) => setQuery({ ...query, symbol: event.target.value.toUpperCase(), page: 1 })} />
        </Field>
        <Field label="买入/卖出">
          <select value={query.side} onChange={(event) => setQuery({ ...query, side: event.target.value, page: 1 })}>
            <option value="">全部</option>
            <option value="BUY">买入</option>
            <option value="SELL">卖出</option>
          </select>
        </Field>
        <Field label="数据来源">
          <select value={query.source} onChange={(event) => setQuery({ ...query, source: event.target.value, page: 1 })}>
            <option value="">全部</option>
            <option value="ibkr">IBKR</option>
            <option value="manual">手动录入</option>
          </select>
        </Field>
      </div>

      <DataState loading={state.loading} error={state.error} data={state.data} onRetry={load}>
        {(data) => <TradeRecordsContent data={data} query={query} setQuery={setQuery} />}
      </DataState>
    </Surface>
  );
}

function TradeRecordsContent({
  data,
  query,
  setQuery,
}: {
  data: ApiRecord;
  query: TradeQuery;
  setQuery: (query: TradeQuery) => void;
}) {
  const summary = asRecord(data.summary);
  const rows = asArray(data.items);
  const total = asNumber(data.total, rows.length);

  return (
    <>
      <div className="metric-grid metric-grid--compact trades-kpi-grid trades-kpi-grid--trade">
        <MetricCard label="成交笔数" value={formatInteger(summary.trade_count)} />
        <MetricCard label="买入笔数" value={formatInteger(summary.buy_count)} tone="positive" />
        <MetricCard label="卖出笔数" value={formatInteger(summary.sell_count)} tone="negative" />
        <MetricCard label="佣金" value={formatCurrency(summary.commission_abs_sum, asText(data.display_currency, "USD"))} tone="negative" />
        <MetricCard label="已实现盈亏" value={<DeltaText value={summary.realized_pnl_sum} currency={asText(data.display_currency, "USD")} />} tone={deltaClass(summary.realized_pnl_sum)} />
      </div>

      <DataTable
        rows={rows}
        columns={[
          { key: "trade_date", label: "成交时间", render: (row) => formatDateTimeMinute(row.trade_date ?? row.trade_date_iso) },
          { key: "symbol", label: "股票代码" },
          { key: "source", label: "来源", render: (row) => asText(row.source) === "manual" ? "手动" : "IBKR" },
          { key: "side", label: "方向", render: (row) => <DirectionPill value={asText(row.side)} buyLabel="买入" sellLabel="卖出" /> },
          { key: "trade_price", label: "成交价", align: "right", render: (row) => formatCurrency(row.trade_price, getTradeCurrency(row)) },
          { key: "quantity", label: "数量", align: "right", render: (row) => formatQuantity(row.quantity) },
          { key: "ib_commission", label: "佣金", align: "right", render: (row) => formatCurrency(Math.abs(asNumber(row.ib_commission, 0)), getTradeCurrency(row)) },
          { key: "notional_abs", label: "成交金额", align: "right", render: (row) => formatCurrency(row.notional_abs, getTradeCurrency(row)) },
          { key: "fifo_pnl_realized", label: "已实现盈亏", align: "right", render: (row) => <DeltaText value={row.fifo_pnl_realized} currency={getTradeCurrency(row)} /> },
        ]}
        empty="暂无交易记录"
      />

      <PaginationFooter
        page={query.page}
        pageSize={query.page_size}
        total={total}
        onPageChange={(page) => setQuery({ ...query, page })}
        onPageSizeChange={(pageSize) => setQuery({ ...query, page_size: pageSize, page: 1 })}
      />
    </>
  );
}

function ManualTradePanel() {
  const [trades, setTrades] = useState<ApiRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    symbol: "", side: "BUY", quantity: "", trade_price: "",
    trade_date: new Date().toISOString().slice(0, 10),
    currency: "USD", account_id: "manual", commission: "0", notes: "",
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const fetchTrades = async () => {
    setLoading(true);
    try {
      const data = await api.manualTrades({ page_size: 200 });
      setTrades(asArray((data as ApiRecord).items));
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchTrades(); }, []);

  const handleCreate = async () => {
    if (!form.symbol || !form.quantity || !form.trade_price) return;
    setSubmitting(true);
    try {
      await api.createManualTrade({
        symbol: form.symbol.toUpperCase(),
        side: form.side,
        quantity: parseFloat(form.quantity),
        trade_price: parseFloat(form.trade_price),
        trade_date: form.trade_date,
        currency: form.currency.toUpperCase(),
        account_id: form.account_id || "manual",
        commission: parseFloat(form.commission) || 0,
        notes: form.notes,
      });
      setForm({ symbol: "", side: "BUY", quantity: "", trade_price: "",
        trade_date: new Date().toISOString().slice(0, 10),
        currency: "USD", account_id: "manual", commission: "0", notes: "" });
      await fetchTrades();
    } finally { setSubmitting(false); }
  };

  const handleDelete = async (tradeId: string) => {
    if (!confirm("确定删除这条交易记录？")) return;
    await api.deleteManualTrade(tradeId);
    await fetchTrades();
  };

  const startEdit = (trade: ApiRecord) => {
    setEditingId(asText(trade.trade_id));
    setEditForm({
      symbol: asText(trade.symbol), side: asText(trade.side, "BUY"),
      quantity: String(trade.quantity ?? ""), trade_price: String(trade.trade_price ?? ""),
      trade_date: asText(trade.trade_date), currency: asText(trade.currency, "USD"),
      account_id: asText(trade.account_id, "manual"),
      commission: String(trade.ib_commission ?? "0"), notes: asText(trade.notes),
    });
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    await api.updateManualTrade(editingId, {
      symbol: editForm.symbol?.toUpperCase(),
      side: editForm.side,
      quantity: parseFloat(editForm.quantity || "0"),
      trade_price: parseFloat(editForm.trade_price || "0"),
      trade_date: editForm.trade_date,
      currency: editForm.currency?.toUpperCase(),
      account_id: editForm.account_id,
      commission: parseFloat(editForm.commission || "0"),
      notes: editForm.notes,
    });
    setEditingId(null);
    await fetchTrades();
  };

  return (
    <Surface title="手动录入交易" className="trades-surface">
      <div className="module-filter-bar module-filter-bar--trade">
        <Field label="代码">
          <input value={form.symbol} placeholder="AAPL" onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="方向">
          <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })}>
            <option value="BUY">买入</option>
            <option value="SELL">卖出</option>
          </select>
        </Field>
        <Field label="数量">
          <input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
        </Field>
        <Field label="价格">
          <input type="number" step="0.01" value={form.trade_price} onChange={(e) => setForm({ ...form, trade_price: e.target.value })} />
        </Field>
        <Field label="日期">
          <input type="date" value={form.trade_date} onChange={(e) => setForm({ ...form, trade_date: e.target.value })} />
        </Field>
        <Field label="币种">
          <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="平台">
          <input value={form.account_id} placeholder="manual" onChange={(e) => setForm({ ...form, account_id: e.target.value })} />
        </Field>
        <Field label="佣金">
          <input type="number" step="0.01" value={form.commission} onChange={(e) => setForm({ ...form, commission: e.target.value })} />
        </Field>
        <Field label="备注">
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </div>
      <div style={{ margin: "0.5rem 0" }}>
        <button className="btn btn--primary" disabled={submitting} onClick={handleCreate}>
          {submitting ? "提交中..." : "添加交易"}
        </button>
      </div>

      {loading ? <p>加载中...</p> : (
        <DataTable
          rows={trades}
          columns={[
            { key: "trade_date", label: "日期", render: (row) => editingId === asText(row.trade_id) ? <input type="date" value={editForm.trade_date || ""} onChange={(e) => setEditForm({ ...editForm, trade_date: e.target.value })} style={{ width: "7rem" }} /> : formatDate(row.trade_date) },
            { key: "account_id", label: "平台", render: (row) => editingId === asText(row.trade_id) ? <input value={editForm.account_id || ""} onChange={(e) => setEditForm({ ...editForm, account_id: e.target.value })} style={{ width: "5rem" }} /> : asText(row.account_id) },
            { key: "symbol", label: "代码", render: (row) => editingId === asText(row.trade_id) ? <input value={editForm.symbol || ""} onChange={(e) => setEditForm({ ...editForm, symbol: e.target.value.toUpperCase() })} style={{ width: "5rem" }} /> : asText(row.symbol) },
            { key: "side", label: "方向", render: (row) => editingId === asText(row.trade_id) ? <select value={editForm.side || "BUY"} onChange={(e) => setEditForm({ ...editForm, side: e.target.value })}><option value="BUY">买入</option><option value="SELL">卖出</option></select> : <DirectionPill value={asText(row.side)} buyLabel="买入" sellLabel="卖出" /> },
            { key: "trade_price", label: "价格", align: "right", render: (row) => editingId === asText(row.trade_id) ? <input type="number" step="0.01" value={editForm.trade_price || ""} onChange={(e) => setEditForm({ ...editForm, trade_price: e.target.value })} style={{ width: "5rem" }} /> : formatCurrency(row.trade_price, asText(row.currency, "USD")) },
            { key: "quantity", label: "数量", align: "right", render: (row) => editingId === asText(row.trade_id) ? <input type="number" value={editForm.quantity || ""} onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value })} style={{ width: "4rem" }} /> : formatQuantity(row.quantity) },
            { key: "ib_commission", label: "佣金", align: "right", render: (row) => editingId === asText(row.trade_id) ? <input type="number" step="0.01" value={editForm.commission || ""} onChange={(e) => setEditForm({ ...editForm, commission: e.target.value })} style={{ width: "4rem" }} /> : formatCurrency(Math.abs(asNumber(row.ib_commission, 0)), asText(row.currency, "USD")) },
            { key: "notes", label: "备注", render: (row) => editingId === asText(row.trade_id) ? <input value={editForm.notes || ""} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} style={{ width: "6rem" }} /> : asText(row.notes) },
            { key: "actions", label: "操作", render: (row) => {
              const tid = asText(row.trade_id);
              if (editingId === tid) {
                return <><button className="btn btn--small" onClick={handleUpdate}>保存</button> <button className="btn btn--small" onClick={() => setEditingId(null)}>取消</button></>;
              }
              return <><button className="btn btn--small" onClick={() => startEdit(row)}>编辑</button> <button className="btn btn--small btn--danger" onClick={() => handleDelete(tid)}>删除</button></>;
            }},
          ]}
          empty="暂无手动录入的交易记录"
        />
      )}
    </Surface>
  );
}

function CashFlowsPanel() {
  const [query, setQuery] = useState<CashFlowQuery>({ currency: "", flow_type: "", start_date: "", end_date: "", page: 1, page_size: 20 });
  const { state, load } = useApiData<ApiRecord>(() => api.cashFlows(query), [query]);

  return (
    <Surface title="出入金流水" className="trades-surface">
      <div className="module-filter-bar module-filter-bar--cash">
        <Field label="开始时间">
          <input type="date" value={query.start_date} onChange={(event) => setQuery({ ...query, start_date: event.target.value, page: 1 })} />
        </Field>
        <Field label="结束时间">
          <input type="date" value={query.end_date} onChange={(event) => setQuery({ ...query, end_date: event.target.value, page: 1 })} />
        </Field>
        <Field label="币种">
          <input value={query.currency} placeholder="USD" onChange={(event) => setQuery({ ...query, currency: event.target.value.toUpperCase(), page: 1 })} />
        </Field>
        <Field label="入金/出金">
          <select value={query.flow_type} onChange={(event) => setQuery({ ...query, flow_type: event.target.value, page: 1 })}>
            <option value="">全部</option>
            <option value="inflow">入金</option>
            <option value="outflow">出金</option>
          </select>
        </Field>
      </div>

      <DataState loading={state.loading} error={state.error} data={state.data} onRetry={load}>
        {(data) => <CashFlowsContent data={data} query={query} setQuery={setQuery} />}
      </DataState>
    </Surface>
  );
}

function CashFlowsContent({
  data,
  query,
  setQuery,
}: {
  data: ApiRecord;
  query: CashFlowQuery;
  setQuery: (query: CashFlowQuery) => void;
}) {
  const summary = asRecord(data.summary);
  const byCurrency = asRecord(summary.by_currency);
  const currencyRows = Object.entries(byCurrency).map(([currency, value]) => ({ currency, ...asRecord(value) }));
  const rows = asArray(data.items);
  const total = asNumber(data.total, rows.length);

  return (
    <>
      <div className="metric-grid metric-grid--compact trades-kpi-grid trades-kpi-grid--cash">
        <MetricCard label="流水总笔数" value={formatInteger(summary.flow_count ?? total)} />
        <MetricCard label="入金笔数" value={formatInteger(summary.inflow_count)} tone="positive" />
        <MetricCard label="出金笔数" value={formatInteger(summary.outflow_count)} tone="negative" />
      </div>

      <div className="currency-breakdown">
        {currencyRows.length === 0 ? (
          <div className="empty-state empty-state--compact">
            <strong>暂无币种统计</strong>
            <span>导入或筛选出入金流水后显示。</span>
          </div>
        ) : currencyRows.map((row) => {
          const record = asRecord(row);
          const currency = asText(record.currency, "USD");
          return (
            <div className="currency-summary" key={currency}>
              <strong>{currency}</strong>
              <span>累计入金 {formatCurrency(record.inflow_amount, currency)}</span>
              <span>累计出金 {formatCurrency(Math.abs(asNumber(record.outflow_amount, 0)), currency)}</span>
              <span>净流入 <DeltaText value={record.net_amount} currency={currency} /></span>
            </div>
          );
        })}
      </div>

      <DataTable
        rows={rows}
        columns={[
          { key: "report_date", label: "发生时间", render: (row) => formatDateTimeMinute(row.date_time ?? row.report_date ?? row.report_date_iso) },
          { key: "currency", label: "币种" },
          { key: "flow_type", label: "方向", render: (row) => <DirectionPill value={asText(row.flow_type)} buyLabel="入金" sellLabel="出金" inflow /> },
          { key: "amount", label: "金额", align: "right", render: (row) => <DeltaText value={row.amount} currency={getCashCurrency(row)} /> },
          { key: "settlement_date", label: "结算日", render: (row) => formatDate(row.settlement_date_iso ?? row.settlement_date ?? row.settle_date ?? row.report_date_iso ?? row.report_date) },
          { key: "transaction_id", label: "流水号", render: (row) => asText(row.transaction_id ?? row.document_id) },
        ]}
        empty="暂无出入金记录"
      />

      <PaginationFooter
        page={query.page}
        pageSize={query.page_size}
        total={total}
        onPageChange={(page) => setQuery({ ...query, page })}
        onPageSizeChange={(pageSize) => setQuery({ ...query, page_size: pageSize, page: 1 })}
      />
    </>
  );
}

function DirectionPill({
  value,
  buyLabel,
  sellLabel,
  inflow = false,
}: {
  value: string;
  buyLabel: string;
  sellLabel: string;
  inflow?: boolean;
}) {
  const normalized = value.toUpperCase();
  const positive = normalized === "BUY" || normalized === "INFLOW";
  const label = positive ? buyLabel : normalized === "SELL" || normalized === "OUTFLOW" ? sellLabel : value;
  return <span className={`direction-pill direction-pill--${positive || inflow && normalized === "INFLOW" ? "positive" : "negative"}`}>{label}</span>;
}

function getTradeCurrency(row: ApiRecord): string {
  return asText(row.notional_currency ?? row.currency, "USD");
}

function getCashCurrency(row: ApiRecord): string {
  return asText(row.currency, "USD");
}

function formatQuantity(value: unknown): string {
  const parsed = asNumber(value, Number.NaN);
  if (!Number.isFinite(parsed)) return "-";
  const absolute = Math.abs(parsed);
  if (Number.isInteger(absolute)) return formatInteger(absolute);
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 4,
    minimumFractionDigits: 0,
  }).format(absolute);
}
