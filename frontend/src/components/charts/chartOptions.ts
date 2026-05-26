import type { EChartsOption } from "echarts";
import type { EChartsPayload } from "../../lib/contracts";
import { asNumber, asText, formatCurrency, formatInteger, formatNumber } from "../../lib/format";
import { baseGrid } from "./EChart";

export type TradeCountOptionRow = {
  key: string;
  label: string;
  trade_count: number;
  trade_notional_abs: number;
};

export function buildTradeCountChartOption({
  rows,
  currency,
}: {
  rows: TradeCountOptionRow[];
  currency: string;
}): EChartsOption {
  const maxCount = Math.max(...rows.map((row) => row.trade_count), 1);
  return {
    animationDuration: 240,
    grid: { left: 32, right: 8, top: 12, bottom: 24, containLabel: true },
    tooltip: {
      trigger: "axis",
      borderColor: "#20231f",
      backgroundColor: "rgba(255,255,255,0.98)",
      textStyle: { color: "#20231f", fontSize: 12, fontWeight: 700 },
      axisPointer: { type: "shadow", shadowStyle: { color: "rgba(32,35,31,0.06)" } },
      formatter: (params) => {
        const item = Array.isArray(params) ? params[0] : params;
        const row = rows[asNumber((item as { dataIndex?: unknown }).dataIndex, -1)];
        const count = asNumber((item as { value?: unknown }).value, 0);
        return [
          `<strong>${row?.key ?? asText((item as { axisValue?: unknown }).axisValue, "")}</strong>`,
          `交易笔数 ${formatInteger(count)}`,
          row ? `交易额 ${formatCurrency(row.trade_notional_abs, currency)}` : "",
        ].filter(Boolean).join("<br/>");
      },
    },
    xAxis: {
      type: "category",
      data: rows.map((row) => row.label),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#20231f" } },
      axisLabel: { color: "#5d6558", fontSize: 11, fontWeight: 800, hideOverlap: true },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: maxCount,
      splitNumber: 3,
      axisLabel: { color: "#5d6558", fontSize: 11, fontWeight: 800, formatter: (value: number) => formatInteger(value) },
      splitLine: { lineStyle: { color: "rgba(32,35,31,0.13)", type: "dashed" } },
    },
    series: [{
      name: "交易笔数",
      type: "bar",
      data: rows.map((row) => row.trade_count),
      barMaxWidth: 22,
      itemStyle: {
        color: "#20231f",
        borderRadius: [4, 4, 0, 0],
      },
      emphasis: {
        itemStyle: { color: "#4b5147" },
      },
    }],
  };
}

export function buildPortfolioAnalysisChartOption(chart: EChartsPayload, currency: string): EChartsOption {
  const points = chart.series[0]?.points ?? [];
  if (chart.chart_type === "gauge") {
    return {
      tooltip: { formatter: "{a}: {c}" },
      series: [{
        name: chart.title,
        type: "gauge",
        min: 0,
        max: 100,
        progress: { show: true, width: 10 },
        axisLine: { lineStyle: { width: 10 } },
        detail: { formatter: "{value}", fontSize: 24 },
        data: [{ value: asNumber(points[0]?.value, 0), name: chart.title }],
      }],
    };
  }
  if (chart.chart_type === "bar") {
    return {
      grid: baseGrid(),
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: points.map((point) => String(point.name ?? point.date ?? "")), axisLabel: { rotate: 20 } },
      yAxis: { type: "value" },
      series: [{ type: "bar", data: points.map((point) => asNumber(point.value, 0)), barMaxWidth: 42 }],
    };
  }
  if (chart.chart_type === "waterfall") {
    let running = 0;
    const offsets: number[] = [];
    const values = points.map((point) => asNumber(point.value, 0));
    values.forEach((value) => {
      offsets.push(value >= 0 ? running : running + value);
      running += value;
    });
    return {
      grid: baseGrid(),
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) => formatCurrency(value, currency),
      },
      xAxis: { type: "category", data: points.map((point) => String(point.name ?? "")), axisLabel: { rotate: 20 } },
      yAxis: { type: "value", axisLabel: { formatter: (value: number) => formatCurrency(value, currency) } },
      series: [
        { type: "bar", stack: "total", data: offsets, itemStyle: { color: "transparent" }, emphasis: { disabled: true } },
        {
          name: chart.series[0]?.name ?? chart.title,
          type: "bar",
          stack: "total",
          data: values,
          barMaxWidth: 42,
          itemStyle: { color: (params: unknown) => asNumber((params as { value?: unknown }).value, 0) >= 0 ? "#147a4a" : "#b13a32" },
        },
      ],
    };
  }
  if (chart.chart_type === "scatter") {
    return {
      grid: baseGrid(),
      tooltip: {
        formatter: (params: unknown): string => {
          const item = params as { data?: [number, number, number, string] };
          const [x, y, value, name] = item.data ?? [0, 0, 0, ""];
          return `${name}<br/>${String(chart.options.x_label ?? "X")}：${formatNumber(x)}%<br/>${String(chart.options.y_label ?? "Y")}：${formatNumber(y)}%<br/>市值：${formatCurrency(value, currency)}`;
        },
      },
      xAxis: { type: "value", name: String(chart.options.x_label ?? ""), min: 0, scale: true },
      yAxis: { type: "value", name: String(chart.options.y_label ?? ""), scale: true },
      series: [{
        name: chart.series[0]?.name ?? chart.title,
        type: "scatter",
        symbolSize: (value: number[]) => Math.max(14, Math.min(36, asNumber(value[0], 0) * 1.35)),
        data: points.map((point) => [asNumber(point.x, 0), asNumber(point.y, 0), asNumber(point.value, 0), String(point.name ?? "")]),
        itemStyle: { color: (params: unknown) => {
          const data = (params as { data?: unknown }).data;
          return asNumber(Array.isArray(data) ? data[1] : 0, 0) >= 0 ? "#147a4a" : "#b13a32";
        } },
        label: { show: true, formatter: (params: unknown) => {
          const data = (params as { data?: unknown }).data;
          return String(Array.isArray(data) ? data[3] ?? "" : "");
        }, position: "top" },
      }],
    };
  }
  if (chart.chart_type === "radar") {
    return {
      tooltip: {},
      radar: {
        indicator: points.map((point) => ({ name: String(point.name ?? ""), max: 100 })),
        radius: "68%",
      },
      series: [{ type: "radar", data: [{ value: points.map((point) => asNumber(point.value, 0)), name: chart.title }] }],
    };
  }
  if (chart.chart_type === "heatmap") {
    const xLabels = Array.isArray(chart.options.x_labels) ? chart.options.x_labels.map(String) : [];
    const yLabels = Array.isArray(chart.options.y_labels) ? chart.options.y_labels.map(String) : [];
    return {
      grid: baseGrid(),
      tooltip: {
        formatter: (params: unknown): string => {
          const item = Array.isArray(params) ? params[0] : params;
          const shaped = item as { value?: unknown; name?: string };
          const value = Array.isArray(shaped.value) ? shaped.value[2] : "";
          return `${shaped.name ?? chart.title}：${formatNumber(value)}%`;
        },
      },
      xAxis: { type: "category", data: xLabels },
      yAxis: { type: "category", data: yLabels },
      visualMap: { min: asNumber(chart.options.min, 0), max: asNumber(chart.options.max, 100), calculable: false, orient: "horizontal", left: "center", bottom: 0 },
      series: [{
        type: "heatmap",
        data: points.map((point) => [asNumber(point.x, 0), asNumber(point.y, 0), asNumber(point.value, 0)]),
        label: { show: true, formatter: (params: unknown) => {
          const value = (params as { value?: unknown }).value;
          return `${formatNumber(Array.isArray(value) ? value[2] : 0, 0)}%`;
        }, fontSize: 10 },
      }],
    };
  }
  return {
    grid: baseGrid(),
    legend: chart.series.length > 1 ? { top: 0, right: 8, textStyle: { fontSize: 11 } } : undefined,
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) => chart.unit === currency ? formatCurrency(value, currency) : chart.unit === "percent" ? `${formatNumber(value)}%` : formatNumber(value),
    },
    xAxis: { type: "category", data: points.map((point) => String(point.date ?? point.name ?? "")) },
    yAxis: { type: "value", scale: true },
    series: chart.series.map((series) => ({
      name: series.name,
      type: "line",
      smooth: true,
      showSymbol: false,
      data: series.points.map((point) => asNumber(point.value, 0)),
    })),
  };
}
