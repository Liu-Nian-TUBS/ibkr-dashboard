import { useEffect, useMemo, useRef } from "react";
import type { EChartsOption } from "echarts";
import * as echarts from "echarts/core";
import { BarChart, GaugeChart, HeatmapChart, LineChart, RadarChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, RadarComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  GaugeChart,
  HeatmapChart,
  GridComponent,
  LegendComponent,
  LineChart,
  RadarChart,
  ScatterChart,
  RadarComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export function EChart({
  option,
  height = 280,
}: {
  option: EChartsOption;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const theme = useMemo(() => ({
    color: ["#ff3b30", "#111111", "#4b5563", "#d97706", "#047857"],
    textStyle: {
      fontFamily: "\"Aptos\", \"PingFang SC\", \"Noto Sans SC\", sans-serif",
      color: "#20231f",
    },
  }), []);

  useEffect(() => {
    if (!ref.current) return undefined;
    const chart = echarts.init(ref.current, theme);
    chart.setOption(option, true);
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [option, theme]);

  return <div className="echart-canvas" ref={ref} style={{ height }} />;
}

export function baseGrid() {
  return {
    left: 44,
    right: 20,
    top: 34,
    bottom: 36,
    containLabel: true,
  };
}
