import { EmptyState, MetricCard, PageHeader, StatusPill, Surface } from "../../components/Primitives";

export function StockAnalysisPage() {
  return (
    <>
      <PageHeader
        eyebrow="个股分析"
        title="单标的画像占位"
        description="这里保留未来个股分析的稳定接口，不展示伪造 K 线、买卖点或行情历史。"
        meta={<StatusPill tone="accent">staged</StatusPill>}
      />

      <div className="metric-grid metric-grid--compact">
        <MetricCard label="接口状态" value="unsupported_history" tone="accent" />
        <MetricCard label="价格柱" value="等待历史行情表" />
        <MetricCard label="买卖点" value="等待 K 线坐标" />
        <MetricCard label="收益归因" value="等待后端聚合" />
      </div>

      <Surface title="未来契约" subtitle="页面已预留 symbolAnalysisState，后续后端补齐即可接入。">
        <EmptyState
          title="未接入历史价格模型"
          detail="V1 会从真实 XML 与现有 API 完成数据闭环；PPP0/K 线/基准历史数据进入后续阶段。"
        />
      </Surface>
    </>
  );
}
