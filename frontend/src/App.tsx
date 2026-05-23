import { Component, Suspense, lazy, useMemo, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import type { NavItem, PageKey } from "./lib/contracts";
import { OverviewPage } from "./features/overview/OverviewPage";
import { PositionsPage } from "./features/positions/PositionsPage";
import { PerformancePage } from "./features/performance/PerformancePage";
import { TradesPage } from "./features/trades/TradesPage";
import { SettingsPage } from "./features/settings/SettingsPage";

const PortfolioAnalysisPage = lazy(() =>
  import("./features/portfolio-analysis/PortfolioAnalysisPage").then((module) => ({
    default: module.PortfolioAnalysisPage,
  }))
);

const NAV_ITEMS: NavItem[] = [
  { key: "overview", label: "资产总览", detail: "净值 / 曲线 / 状态", icon: "overview" },
  { key: "positions", label: "持仓明细", detail: "仓位 / 行业 / 成本", icon: "positions" },
  { key: "performance", label: "业绩分析", detail: "收益 / 日历 / 归因", icon: "performance" },
  { key: "trades", label: "交易明细", detail: "交易 / 现金 / 审计", icon: "trades" },
  { key: "portfolioAnalysis", label: "持仓分析", detail: "市场 / 风险 / 个股", icon: "analysis" },
  { key: "settings", label: "设置与导入", detail: "凭据 / XML / 集成", icon: "settings" },
];

const PAGE_RENDERERS: Record<PageKey, (navigate: (page: PageKey) => void) => JSX.Element> = {
  overview: (navigate) => <OverviewPage onNavigate={navigate} />,
  positions: () => <PositionsPage />,
  performance: () => <PerformancePage />,
  trades: () => <TradesPage />,
  portfolioAnalysis: () => (
    <Suspense fallback={<div className="loading-block"><span /><strong>正在加载持仓分析</strong></div>}>
      <PortfolioAnalysisPage />
    </Suspense>
  ),
  settings: () => <SettingsPage />,
};

function App() {
  const [activePage, setActivePage] = useState<PageKey>("overview");
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const activeItem = useMemo(() => NAV_ITEMS.find((item) => item.key === activePage) ?? NAV_ITEMS[0], [activePage]);
  const renderPage = PAGE_RENDERERS[activePage];

  return (
    <div className={`app-shell ${sidebarVisible ? "" : "app-shell--sidebar-hidden"}`.trim()}>
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
              <NavIcon name={item.icon ?? "overview"} />
              <strong>{item.label}</strong>
            </button>
          ))}
        </nav>

      </aside>

      <main className="main-stage">
        <div className="top-strip">
          <div className="top-strip__title">
            <button
              type="button"
              className="top-strip__menu"
              aria-label={sidebarVisible ? "隐藏侧边栏" : "显示侧边栏"}
              aria-expanded={sidebarVisible}
              onClick={() => setSidebarVisible((visible) => !visible)}
            >
              ☰
            </button>
            <div>
              <strong>{activePage === "overview" ? "本地投资控制台" : activeItem.label}</strong>
            </div>
          </div>
          <div className="top-strip__meta">
            <span><i />Flex 已配置</span>
            <span><i />AI 已配置</span>
            <span>数据 本地</span>
          </div>
        </div>
        <AppErrorBoundary resetKey={activePage}>
          {renderPage(setActivePage)}
        </AppErrorBoundary>
      </main>
    </div>
  );
}

function NavIcon({ name }: { name: string }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <span className="nav-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        {name === "overview" ? (
          <>
            <path {...common} d="M4 13.5 9.2 8l4.4 4 6.4-7" />
            <path {...common} d="M4 19h16" />
            <path {...common} d="M5 16v3" />
            <path {...common} d="M11 13v6" />
            <path {...common} d="M17 10v9" />
          </>
        ) : null}
        {name === "positions" ? (
          <>
            <rect {...common} x="4" y="5" width="16" height="14" rx="2" />
            <path {...common} d="M8 9h8" />
            <path {...common} d="M8 13h5" />
            <path {...common} d="M16 13h.01" />
          </>
        ) : null}
        {name === "performance" ? (
          <>
            <path {...common} d="M5 19V5" />
            <path {...common} d="M5 19h14" />
            <path {...common} d="M8 15l3-4 3 2 4-6" />
            <circle {...common} cx="11" cy="11" r="1" />
            <circle {...common} cx="18" cy="7" r="1" />
          </>
        ) : null}
        {name === "trades" ? (
          <>
            <path {...common} d="M7 7h11" />
            <path {...common} d="m15 4 3 3-3 3" />
            <path {...common} d="M17 17H6" />
            <path {...common} d="m9 14-3 3 3 3" />
          </>
        ) : null}
        {name === "analysis" ? (
          <>
            <circle {...common} cx="12" cy="12" r="7" />
            <path {...common} d="M12 5v7l5 3" />
            <path {...common} d="M8 18.2 6.5 21" />
            <path {...common} d="M16 18.2l1.5 2.8" />
          </>
        ) : null}
        {name === "settings" ? (
          <>
            <circle {...common} cx="12" cy="12" r="3" />
            <path {...common} d="M19 12a7.6 7.6 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2-1.1L14 3h-4l-.5 2.7a7 7 0 0 0-2 1.1l-2.4-1-2 3.5 2 1.5A7.6 7.6 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2 1.1L10 21h4l.5-2.7a7 7 0 0 0 2-1.1l2.4 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2Z" />
          </>
        ) : null}
      </svg>
    </span>
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
