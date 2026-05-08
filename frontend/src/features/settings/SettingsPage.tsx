import { ChangeEvent, useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { ApiRecord, ImportTaskResponse, PageState } from "../../lib/contracts";
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
}

const defaultForm: SettingsForm = {
  base_currency: "USD",
  timezone: "America/New_York",
  finnhub_api_key: "",
  flex_token: "",
  flex_query_id: "",
  pull_frequency_minutes: 60,
  display_realtime_prices: false,
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

export function SettingsPage() {
  const [state, setState] = useState<PageState<ApiRecord>>({ data: null, loading: true, error: null });
  const [form, setForm] = useState<SettingsForm>(defaultForm);
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
      const payload = {
        ...form,
        finnhub_api_key: form.finnhub_api_key.includes("*") ? undefined : form.finnhub_api_key,
        flex_token: form.flex_token.includes("*") ? undefined : form.flex_token,
      };
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
            eyebrow="设置 / 导入 / 同步 / 数据源"
            title="数据源与本地导入控制台"
            description="密钥默认脱敏，XML 只作为本地导入输入；导入后页面通过后端索引读取归一化数据。"
            meta={
              <>
                <StatusPill tone={data.flex_query_id ? "positive" : "neutral"}>{data.flex_query_id ? "Flex 已配置" : "待配置 Flex"}</StatusPill>
                <button type="button" onClick={load}>刷新</button>
              </>
            }
          />

          {message ? <div className="message-bar">{message}</div> : null}

          <div className="content-grid">
            <Surface title="系统参数" subtitle="保存后会影响全局展示币种、时区和拉取频率。">
              <div className="form-grid">
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
              </div>
              <div className="settings-switch-row">
                <label className="switch-field switch-field--wide">
                  <input
                    type="checkbox"
                    checked={form.display_realtime_prices}
                    onChange={(event) => setForm({ ...form, display_realtime_prices: event.target.checked })}
                  />
                  <span className="switch-control" />
                  <span>
                    <strong>优先展示实时价格</strong>
                    <small>开启后总览与持仓会使用报价服务重算市值</small>
                  </span>
                </label>
              </div>
              <div className="row-actions">
                <button type="button" onClick={save}>保存设置</button>
              </div>
            </Surface>

            <Surface title="凭据" subtitle="已保存的密钥会脱敏；输入新值才会覆盖旧值。">
              <div className="form-grid">
                <Field label="Finnhub API Key">
                  <input value={form.finnhub_api_key} onChange={(event) => setForm({ ...form, finnhub_api_key: event.target.value })} />
                </Field>
                <Field label="Flex Token">
                  <input value={form.flex_token} onChange={(event) => setForm({ ...form, flex_token: event.target.value })} />
                </Field>
                <Field label="Flex Query ID">
                  <input value={form.flex_query_id} onChange={(event) => setForm({ ...form, flex_query_id: event.target.value })} />
                </Field>
              </div>
              <div className="row-actions">
                <button type="button" onClick={save}>保存凭据</button>
              </div>
            </Surface>
          </div>

          <div className="content-grid">
            <Surface title="XML 导入" subtitle="支持真实 Flex XML 本地导入；页面不会展示 XML 原文。" className="settings-import-surface">
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

            <Surface title="同步与数据源" subtitle="这些动作只拉取和刷新数据，不提供任何交易能力。">
              <div className="action-grid">
                <button type="button" onClick={() => runAction("每日同步", api.runDailySync)}>运行每日同步</button>
                <button type="button" onClick={() => runAction("IBKR 连通性测试", api.testIbkr)}>测试 IBKR</button>
                <button type="button" onClick={() => runAction("Finnhub 连通性测试", api.testFinnhub)}>测试 Finnhub</button>
                <button type="button" onClick={() => runAction("刷新报价", api.refreshQuotes)}>刷新报价</button>
              </div>
              <div className="status-grid status-grid--single">
                <div>
                  <span>上次同步时间</span>
                  <strong>{formatDateTimeMinute(data.last_successful_sync_at_local ?? data.last_successful_sync_at)}</strong>
                </div>
              </div>
            </Surface>
          </div>
        </>
      )}
    </DataState>
  );
}
