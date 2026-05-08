import { Component, useMemo, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import type { NavItem, PageKey } from "./lib/contracts";
import { OverviewPage } from "./features/overview/OverviewPage";
import { PositionsPage } from "./features/positions/PositionsPage";
import { PerformancePage } from "./features/performance/PerformancePage";
import { TradesPage } from "./features/trades/TradesPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { StockAnalysisPage } from "./features/stock-analysis/StockAnalysisPage";

const NAV_ITEMS: NavItem[] = [
  { key: "overview", label: "资产总览", detail: "净值 / 收益 / 同步" },
  { key: "positions", label: "持仓明细", detail: "仓位 / 行业 / 个股" },
  { key: "performance", label: "业绩分析", detail: "榜单 / 日历 / 月度" },
  { key: "trades", label: "交易明细", detail: "交易 / 出入金" },
  { key: "settings", label: "设置与导入", detail: "XML / 同步 / 数据源" },
  { key: "stockAnalysis", label: "个股分析", detail: "阶段化占位" },
];

const PAGE_RENDERERS: Record<PageKey, () => JSX.Element> = {
  overview: () => <OverviewPage />,
  positions: () => <PositionsPage />,
  performance: () => <PerformancePage />,
  trades: () => <TradesPage />,
  settings: () => <SettingsPage />,
  stockAnalysis: () => <StockAnalysisPage />,
};

function App() {
  const [activePage, setActivePage] = useState<PageKey>("overview");
  const activeItem = useMemo(() => NAV_ITEMS.find((item) => item.key === activePage) ?? NAV_ITEMS[0], [activePage]);
  const renderPage = PAGE_RENDERERS[activePage];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <span>IBKR</span>
          <div>
            <strong>Dashboard</strong>
          </div>
        </div>

        <nav className="nav-list" aria-label="主导航">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={item.key === activePage ? "active" : ""}
              onClick={() => setActivePage(item.key)}
            >
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </button>
          ))}
        </nav>

      </aside>

      <main className="main-stage">
        <div className="top-strip">
          <div>
            <span>当前页面</span>
            <strong>{activeItem.label}</strong>
          </div>
        </div>
        <AppErrorBoundary resetKey={activePage}>
          {renderPage()}
        </AppErrorBoundary>
      </main>
    </div>
  );
}

class AppErrorBoundary extends Component<
  { children: ReactNode; resetKey: PageKey },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("page_render_failed", error, info.componentStack);
  }

  componentDidUpdate(prevProps: { resetKey: PageKey }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-state">
          <strong>当前板块渲染失败</strong>
          <span>{this.state.error.message || "前端渲染时出现未知错误。"}</span>
          <button type="button" onClick={() => this.setState({ error: null })}>重试</button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default App;
