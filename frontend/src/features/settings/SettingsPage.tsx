import { ChangeEvent, useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { ApiRecord, ImportTaskResponse, PageState, SettingsResponse, SettingsUpdatePayload } from "../../lib/contracts";
import { asArray, asNumber, asText, formatDateTimeMinute, formatInteger } from "../../lib/format";
import { DataState, DataTable, EmptyState, Field, MetricCard, PageHeader, StatusPill, Surface } from "../../components/Primitives";

interface SettingsForm {
  base_currency: string;
  timezone: string;
  finnhub_api_key: string;
  flex_token: string;
  flex_query_id: string;
  pull_frequency_minutes: number;
  display_realtime_prices: boolean;
  ai_provider: "openai" | "minimax" | "mock";
  openai_api_key: string;
  minimax_api_key: string;
  minimax_base_url: string;
  futu_connection_mode: "disabled" | "local_opend" | "longbridge";
  futu_opend_host: string;
  futu_opend_port: number;
  telegram_bot_token: string;
  telegram_allowlisted_chat_ids: string;
  telegram_reports_enabled: boolean;
  telegram_daily_report_time: string;
  mcp_server_enabled: boolean;
  report_cache_enabled: boolean;
  report_cache_ttl_minutes: number;
}

const defaultForm: SettingsForm = {
  base_currency: "USD",
  timezone: "America/New_York",
  finnhub_api_key: "",
  flex_token: "",
  flex_query_id: "",
  pull_frequency_minutes: 60,
  display_realtime_prices: false,
  ai_provider: "openai",
  openai_api_key: "",
  minimax_api_key: "",
  minimax_base_url: "https://api.minimaxi.com/v1",
  futu_connection_mode: "disabled",
  futu_opend_host: "127.0.0.1",
  futu_opend_port: 11111,
  telegram_bot_token: "",
  telegram_allowlisted_chat_ids: "",
  telegram_reports_enabled: false,
  telegram_daily_report_time: "08:30",
  mcp_server_enabled: false,
  report_cache_enabled: true,
  report_cache_ttl_minutes: 60,
};

const currencyOptions = [
  { value: "USD", label: "USD" },
  { value: "HKD", label: "HKD" },
  { value: "RMB", label: "RMB" },
];

const timezoneOptions = [
  { value: "Asia/Shanghai", label: "中国北京" },
  { value: "America/New_York", label: "美国纽约" },
];

const frequencyOptions = [
  { value: 30, label: "30 分钟" },
  { value: 60, label: "1 小时" },
  { value: 360, label: "6 小时" },
  { value: 720, label: "12 小时" },
  { value: 1440, label: "1 天" },
];

type SettingsTab = "system" | "ai" | "sources" | "integrations" | "xml";

const settingsTabs: Array<{ key: SettingsTab; label: string }> = [
  { key: "system", label: "系统参数" },
  { key: "ai", label: "AI provider" },
  { key: "sources", label: "数据来源" },
  { key: "integrations", label: "MCP与Telegram" },
  { key: "xml", label: "XML导入" },
];

function hasMaskedValue(value: string): boolean {
  return value.includes("*");
}

function parseTelegramChatIds(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function SettingsPage() {
  const [state, setState] = useState<PageState<SettingsResponse>>({ data: null, loading: true, error: null });
  const [form, setForm] = useState<SettingsForm>(defaultForm);
  const [activeTab, setActiveTab] = useState<SettingsTab>("system");
  const [message, setMessage] = useState("");
  const [importResult, setImportResult] = useState<ImportTaskResponse | null>(null);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await api.settings();
      setState({ data, loading: false, error: null });
      setForm({
        base_currency: asText(data.base_currency, "USD"),
        timezone: asText(data.timezone, "America/New_York"),
        finnhub_api_key: asText(data.finnhub_api_key, ""),
        flex_token: asText(data.flex_token, ""),
        flex_query_id: asText(data.flex_query_id, ""),
        pull_frequency_minutes: asNumber(data.pull_frequency_minutes, 60),
        display_realtime_prices: Boolean(data.display_realtime_prices),
        ai_provider: data.ai_provider ?? "openai",
        openai_api_key: asText(data.openai_api_key, ""),
        minimax_api_key: asText(data.minimax_api_key, ""),
        minimax_base_url: asText(data.minimax_base_url, "https://api.minimaxi.com/v1"),
        futu_connection_mode: data.futu_connection_mode ?? "disabled",
        futu_opend_host: asText(data.futu_opend_host, "127.0.0.1"),
        futu_opend_port: asNumber(data.futu_opend_port, 11111),
        telegram_bot_token: asText(data.telegram_bot_token, ""),
        telegram_allowlisted_chat_ids: data.telegram_allowlisted_chat_ids.join("\n"),
        telegram_reports_enabled: Boolean(data.telegram_reports_enabled),
        telegram_daily_report_time: asText(data.telegram_daily_report_time, "08:30"),
        mcp_server_enabled: Boolean(data.mcp_server_enabled),
        report_cache_enabled: Boolean(data.report_cache_enabled),
        report_cache_ttl_minutes: asNumber(data.report_cache_ttl_minutes, 60),
      });
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error instanceof Error ? error.message : "unknown error" }));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setMessage("正在保存设置...");
    try {
      const payload: SettingsUpdatePayload = {
        base_currency: form.base_currency,
        timezone: form.timezone,
        finnhub_api_key: form.finnhub_api_key,
        flex_token: form.flex_token,
        flex_query_id: form.flex_query_id,
        pull_frequency_minutes: form.pull_frequency_minutes,
        display_realtime_prices: form.display_realtime_prices,
        ai_provider: form.ai_provider,
        openai_api_key: form.openai_api_key,
        minimax_api_key: form.minimax_api_key,
        minimax_base_url: form.minimax_base_url,
        futu_connection_mode: form.futu_connection_mode,
        futu_opend_host: form.futu_opend_host,
        futu_opend_port: form.futu_opend_port,
        telegram_bot_token: form.telegram_bot_token,
        telegram_allowlisted_chat_ids: parseTelegramChatIds(form.telegram_allowlisted_chat_ids),
        telegram_reports_enabled: form.telegram_reports_enabled,
        telegram_daily_report_time: form.telegram_daily_report_time,
        mcp_server_enabled: form.mcp_server_enabled,
        report_cache_enabled: form.report_cache_enabled,
        report_cache_ttl_minutes: form.report_cache_ttl_minutes,
      };
      if (hasMaskedValue(form.finnhub_api_key)) delete payload.finnhub_api_key;
      if (hasMaskedValue(form.flex_token)) delete payload.flex_token;
      if (hasMaskedValue(form.openai_api_key)) delete payload.openai_api_key;
      if (hasMaskedValue(form.minimax_api_key)) delete payload.minimax_api_key;
      if (hasMaskedValue(form.telegram_bot_token)) delete payload.telegram_bot_token;
      await api.saveSettings(payload);
      setMessage("设置已保存");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    }
  };

  const runAction = async (label: string, action: () => Promise<ApiRecord>) => {
    setMessage(`${label}...`);
    try {
      const result = await action();
      setMessage(`${label}完成：${asText(result.status ?? result.message ?? result.ok, "ok")}`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${label}失败`);
    }
  };

  const handleXmlFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    setMessage("正在读取 XML 文件...");
    try {
      const payload = await Promise.all(files.map(async (file) => ({ filename: file.name, content: await file.text() })));
      const created = await api.createImportTask(payload);
      const run = await api.runImportTask(created.run_url);
      setImportResult(run);
      setMessage(`导入任务完成：${asText(run.status, "completed")}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <DataState loading={state.loading} error={state.error} data={state.data} onRetry={load}>
      {(data) => (
        <>
          <PageHeader
            eyebrow="设置与导入"
            title="本地分析控制台"
            description="密钥默认脱敏，各功能配置按用途归组；所有集成保持只读数据读取或摘要发送边界。"
            meta={
              <>
                <StatusPill tone={data.flex_query_id ? "positive" : "neutral"}>{data.flex_query_id ? "Flex 已配置" : "待配置 Flex"}</StatusPill>
                <StatusPill tone={data.ai_provider === "mock" || data.openai_api_key || data.minimax_api_key ? "positive" : "neutral"}>
                  {data.ai_provider === "minimax"
                    ? (data.minimax_api_key || data.openai_api_key ? "MiniMax 已配置" : "待配置 MiniMax")
                    : (data.ai_provider === "mock" ? "Mock AI" : (data.openai_api_key ? "OpenAI 已配置" : "待配置 OpenAI"))}
                </StatusPill>
                <button type="button" onClick={load}>刷新</button>
              </>
            }
          />

          {message ? <div className="message-bar">{message}</div> : null}

          <div className="settings-layout">
            <div className="settings-tabs" role="tablist" aria-label="设置分组">
              {settingsTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.key}
                  className={activeTab === tab.key ? "active" : ""}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === "system" ? (
              <Surface title="系统参数" subtitle="全局展示口径、同步节奏与分析缓存。">
                <div className="settings-compact-grid">
                  <Field label="基础币种">
                    <select value={form.base_currency} onChange={(event) => setForm({ ...form, base_currency: event.target.value })}>
                      {currencyOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="时区">
                    <select value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })}>
                      {timezoneOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="拉取频率">
                    <select value={form.pull_frequency_minutes} onChange={(event) => setForm({ ...form, pull_frequency_minutes: Number(event.target.value) })}>
                      {frequencyOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="缓存有效期">
                    <input
                      type="number"
                      min={1}
                      value={form.report_cache_ttl_minutes}
                      onChange={(event) => setForm({ ...form, report_cache_ttl_minutes: Number(event.target.value) })}
                    />
                  </Field>
                </div>
                <div className="settings-switch-grid settings-switch-row">
                  <label className="switch-field switch-field--wide">
                    <input
                      type="checkbox"
                      checked={form.display_realtime_prices}
                      onChange={(event) => setForm({ ...form, display_realtime_prices: event.target.checked })}
                    />
                    <span className="switch-control" />
                    <span>
                      <strong>优先展示实时价格</strong>
                      <small>总览与持仓会使用报价服务重算市值</small>
                    </span>
                  </label>
                  <label className="switch-field switch-field--wide">
                    <input
                      type="checkbox"
                      checked={form.report_cache_enabled}
                      onChange={(event) => setForm({ ...form, report_cache_enabled: event.target.checked })}
                    />
                    <span className="switch-control" />
                    <span>
                      <strong>分析报告缓存</strong>
                      <small>AI 与日报复用缓存结果</small>
                    </span>
                  </label>
                </div>
                <div className="row-actions">
                  <button type="button" onClick={save}>保存系统参数</button>
                </div>
              </Surface>
            ) : null}

            {activeTab === "ai" ? (
              <Surface title="AI provider" subtitle="选择摘要生成供应商；已保存密钥脱敏显示，输入新值才会覆盖。">
                <div className="settings-compact-grid">
                  <Field label="AI Provider">
                    <select value={form.ai_provider} onChange={(event) => setForm({ ...form, ai_provider: event.target.value as SettingsForm["ai_provider"] })}>
                      <option value="openai">OpenAI</option>
                      <option value="minimax">MiniMax</option>
                      <option value="mock">Mock</option>
                    </select>
                  </Field>
                  <Field label="OpenAI API Key">
                    <input value={form.openai_api_key} onChange={(event) => setForm({ ...form, openai_api_key: event.target.value })} />
                  </Field>
                  <Field label="MiniMax API Key">
                    <input value={form.minimax_api_key} onChange={(event) => setForm({ ...form, minimax_api_key: event.target.value })} />
                  </Field>
                  <Field label="MiniMax Base URL">
                    <input value={form.minimax_base_url} onChange={(event) => setForm({ ...form, minimax_base_url: event.target.value })} />
                  </Field>
                </div>
                <div className="row-actions">
                  <button type="button" onClick={save}>保存 AI 配置</button>
                </div>
              </Surface>
            ) : null}

            {activeTab === "sources" ? (
              <Surface title="数据来源" subtitle="IBKR Flex、行情供应商、同步与数据刷新集中在这里。">
                <div className="settings-compact-grid">
                  <Field label="Flex Token">
                    <input value={form.flex_token} onChange={(event) => setForm({ ...form, flex_token: event.target.value })} />
                  </Field>
                  <Field label="Flex Query ID">
                    <input value={form.flex_query_id} onChange={(event) => setForm({ ...form, flex_query_id: event.target.value })} />
                  </Field>
                  <Field label="Finnhub API Key">
                    <input value={form.finnhub_api_key} onChange={(event) => setForm({ ...form, finnhub_api_key: event.target.value })} />
                  </Field>
                  <Field label="行情 Provider">
                    <select value={form.futu_connection_mode} onChange={(event) => setForm({ ...form, futu_connection_mode: event.target.value as SettingsForm["futu_connection_mode"] })}>
                      <option value="disabled">关闭</option>
                      <option value="longbridge">长桥</option>
                      <option value="local_opend">本地 OpenD</option>
                    </select>
                  </Field>
                  <Field label="OpenD Host">
                    <input value={form.futu_opend_host} onChange={(event) => setForm({ ...form, futu_opend_host: event.target.value })} />
                  </Field>
                  <Field label="OpenD Port">
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={form.futu_opend_port}
                      onChange={(event) => setForm({ ...form, futu_opend_port: Number(event.target.value) })}
                    />
                  </Field>
                </div>
                <div className="settings-action-panel">
                  <div className="action-grid settings-action-grid">
                    <button type="button" onClick={() => runAction("每日同步", api.runDailySync)}>运行每日同步</button>
                    <button type="button" onClick={() => runAction("IBKR 连通性测试", api.testIbkr)}>测试 IBKR</button>
                    <button type="button" onClick={() => runAction("Finnhub 连通性测试", api.testFinnhub)}>测试 Finnhub</button>
                    <button type="button" onClick={() => runAction("Futu OpenD 连通性测试", api.testFutu)}>测试 Futu OpenD</button>
                    <button type="button" onClick={() => runAction("长桥连通性测试", api.testLongbridge)}>测试长桥</button>
                    <button type="button" onClick={() => runAction("刷新报价", api.refreshQuotes)}>刷新报价</button>
                    <button type="button" onClick={() => runAction("刷新历史K线", api.refreshMarketHistory)}>刷新历史K线</button>
                  </div>
                  <div className="status-grid status-grid--single">
                    <div>
                      <span>上次同步时间</span>
                      <strong>{formatDateTimeMinute(data.last_successful_sync_at_local ?? data.last_successful_sync_at)}</strong>
                    </div>
                  </div>
                </div>
                <div className="row-actions">
                  <button type="button" onClick={save}>保存数据来源</button>
                </div>
              </Surface>
            ) : null}

            {activeTab === "integrations" ? (
              <Surface title="MCP与Telegram" subtitle="MCP 只暴露只读工具；Telegram 只发送已生成的摘要。">
                <div className="settings-compact-grid">
                  <Field label="Telegram Bot Token">
                    <input value={form.telegram_bot_token} onChange={(event) => setForm({ ...form, telegram_bot_token: event.target.value })} />
                  </Field>
                  <Field label="Telegram 日报时间">
                    <input
                      type="time"
                      value={form.telegram_daily_report_time}
                      onChange={(event) => setForm({ ...form, telegram_daily_report_time: event.target.value })}
                    />
                  </Field>
                  <Field label="Telegram Chat IDs">
                    <textarea
                      value={form.telegram_allowlisted_chat_ids}
                      onChange={(event) => setForm({ ...form, telegram_allowlisted_chat_ids: event.target.value })}
                      rows={3}
                    />
                  </Field>
                </div>
                <div className="settings-switch-grid settings-switch-row">
                  <label className="switch-field switch-field--wide">
                    <input
                      type="checkbox"
                      checked={form.telegram_reports_enabled}
                      onChange={(event) => setForm({ ...form, telegram_reports_enabled: event.target.checked })}
                    />
                    <span className="switch-control" />
                    <span>
                      <strong>Telegram 日报</strong>
                      <small>按配置时间发送只读摘要</small>
                    </span>
                  </label>
                  <label className="switch-field switch-field--wide">
                    <input
                      type="checkbox"
                      checked={form.mcp_server_enabled}
                      onChange={(event) => setForm({ ...form, mcp_server_enabled: event.target.checked })}
                    />
                    <span className="switch-control" />
                    <span>
                      <strong>MCP Server</strong>
                      <small>暴露只读工具入口</small>
                    </span>
                  </label>
                </div>
                <div className="row-actions">
                  <button type="button" onClick={save}>保存 MCP 与 Telegram</button>
                </div>
              </Surface>
            ) : null}

            {activeTab === "xml" ? (
              <Surface title="XML导入" subtitle="支持真实 Flex XML 本地导入；页面不会展示 XML 原文。" className="settings-import-surface">
                <div className="xml-import-panel">
                  <Field label="选择 XML">
                    <input type="file" accept=".xml,text/xml" multiple onChange={handleXmlFiles} />
                  </Field>
                </div>
                {importResult ? (
                  <div className="metric-grid metric-grid--compact">
                    <MetricCard label="任务状态" value={asText(importResult.status)} tone={importResult.status === "completed" ? "positive" : "neutral"} />
                    <MetricCard label="处理文件" value={`${formatInteger(importResult.processed_files)} / ${formatInteger(importResult.total_files)}`} />
                    <MetricCard label="进度" value={`${Math.round(asNumber(importResult.progress, 0) * 100)}%`} />
                  </div>
                ) : (
                  <EmptyState title="等待导入" detail="选择 XML 后会创建任务并立即运行；真实文件不会提交到仓库。" compact />
                )}
                <DataTable
                  rows={asArray(importResult?.summaries)}
                  columns={[
                    { key: "file_path", label: "文件", render: () => "本地 XML" },
                    { key: "record_counts", label: "映射记录", render: (row) => {
                      const counts = row.record_counts && typeof row.record_counts === "object" ? row.record_counts as ApiRecord : {};
                      return Object.entries(counts).map(([key, value]) => `${key}:${value}`).join(" / ");
                    } },
                  ]}
                  empty="暂无导入摘要"
                />
              </Surface>
            ) : null}
          </div>
        </>
      )}
    </DataState>
  );
}
