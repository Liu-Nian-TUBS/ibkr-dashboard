# IBKR Dashboard

IBKR Dashboard 是一个本地运行的 IBKR 投资分析看板。它读取 Interactive Brokers Flex XML，对资产、持仓、业绩、交易记录和出入金记录做可视化分析。

本项目只做只读分析，不提供交易、下单、撤单或风控功能。

## 适合谁使用

- 有 IBKR 账户，并且可以导出 Flex XML 的用户。
- 想在自己电脑上查看投资组合，而不是把真实交易数据上传到第三方网站的用户。
- 不熟悉 Python、Node.js、Elasticsearch 等开发环境，但可以按步骤安装 Docker Desktop 的用户。

## V1 主要功能

- 设置与导入：基础币种、时区、实时价格优先、拉取频率、Finnhub 和 IBKR Flex 凭据保存、XML 文件导入。
- 资产总览：总资产、现金、持仓市值、年内佣金、资产收益、净值曲线、现金流事件。
- 净值曲线：支持简单加权、时间加权、现金加权；支持 1 周、本月至今、1 个月、3 个月、本年至今、1 年、全部和自定义区间。
- 对比曲线：支持标普 500、纳斯达克、QQQ；历史数据会使用本地缓存，缺失时再从外部数据源拉取。
- 持仓明细：持仓汇总饼图、行业分布饼图、自定义行业映射、持仓明细表、移动加权 / 摊薄成本切换、个股 K 线弹窗、买卖点标记。
- 业绩分析：盈利 TOP10、亏损 TOP10、累计盈利、累计亏损、交易胜率、盈亏日历、近一年月度交易统计。
- 交易明细：交易记录查询和出入金记录查询，支持时间、代码、方向、币种筛选和分页。

## V2 持仓分析

V2 仍然坚持只读分析，不会触发任何交易行为。新版把分析入口收敛为一个顶层“持仓分析”模块，里面包含三个子页：

- 市场分析：围绕当前持仓展示相关市场状态、相对强弱指数、组合影响、机会和风险。
- 持仓分析：展示因子暴露、集中度、相关性、尾部风险、智能主题暴露、宏观敏感性和对冲防御思路；本版不展示期权希腊值或到期分布。
- 个股分析：针对当前持仓或指定股票展示方向判断、核心变化、组合影响、产业链传导、市场误判和智能摘要。

所有 V2 指标都带有统一状态字段：数据来源、更新时间、置信度、状态和缺失原因。外部数据不可用时，页面会明确显示缺失，而不是用猜测值填充。

V2 还增加了这些集成能力：

- 模型 provider 可配置，第一版默认 OpenAI；没有 API Key 时会安全降级为不可用状态。
- 长桥行情可作为只读 provider 使用，用于补充历史 K 线和行情快照。
- Futu OpenD 只作为只读行情来源使用，接口层不包含下单、改单、撤单或解锁交易能力。
- Telegram 支持多 Chat ID 白名单、只读命令 dry-run 和定时日报发送。
- MCP stdio server 暴露只读工具，供 Claude Desktop、Codex Desktop 等客户端读取本地持仓分析。

## 技术栈

- 前端：React、TypeScript、Vite。
- 后端：Python、FastAPI。
- 存储：Elasticsearch。
- 启动方式：Docker Compose 一键启动前端、后端和数据库。
- 数据来源：IBKR Flex XML、长桥、Finnhub、Yahoo Finance、Futu OpenD（只读）。

普通使用不需要单独安装 Python、Node.js 或 Elasticsearch；Docker 会在启动时自动准备这些环境。

## 安装前准备

### 1. 安装 Docker Desktop

下载并安装 Docker Desktop：

- macOS / Windows: [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/)

安装完成后，打开 Docker Desktop。等它显示正在运行后，再继续下面的步骤。

### 2. 下载本项目

如果你已经安装 Git，可以在终端运行：

```bash
git clone <这个 GitHub 仓库地址>
cd ibkr-dashboard
```

如果你没有安装 Git，也可以在 GitHub 页面点击：

```text
Code -> Download ZIP
```

下载后解压，然后在终端进入解压出来的项目文件夹。

macOS 用户可以在 Finder 中打开项目文件夹，右键选择“服务 -> 新建位于文件夹位置的终端窗口”。如果没有这个菜单，也可以打开“终端”，输入 `cd `，把项目文件夹拖进终端，再按回车。

## 启动

在项目文件夹里运行：

```bash
docker compose up --build
```

第一次启动会下载基础镜像和依赖，通常需要几分钟。看到终端里持续输出日志是正常的，不要关闭这个终端窗口。

启动完成后，打开浏览器访问：

```text
http://localhost:5176
```

以后再次启动，仍然在项目文件夹里运行：

```bash
docker compose up
```

## 本机开发模式（不使用 Docker）

如果你要继续开发，推荐使用本机开发模式。项目根目录支持一条命令同时启动后端和前端。

### 第一次准备

1. 安装 Python 3（建议 3.12+）。
2. 安装 Node.js（建议 20+）。
3. 确保本机可用 Elasticsearch（默认读取 `http://127.0.0.1:9200`）。

### 一条命令启动

在项目根目录运行：

```bash
npm run dev:all
```

脚本会自动处理以下事项：

- 首次创建 `.venv` 虚拟环境并安装后端依赖。
- 首次安装前端依赖（`frontend/node_modules`）。
- 启动后端（`http://127.0.0.1:8085`）和前端（`http://127.0.0.1:5176`）。

停止方式：在当前终端按 `Ctrl + C`，脚本会同时停止前后端进程。

### 可选环境变量

你可以在启动前临时覆盖默认端口和 ES 地址：

```bash
BACKEND_PORT=8086 FRONTEND_PORT=5177 ES_HOST=http://127.0.0.1:9200 npm run dev:all
```

## V2 集成配置

### OpenAI / MiniMax 与智能摘要

进入“设置与导入”，在 V2 集成设置中选择模型 provider。第一版默认是 `openai`。

- `openai`：填写 OpenAI API Key，后端会通过 OpenAI Responses API 生成结构化摘要。
- `minimax`：填写 MiniMax API Key，后端会调用 MiniMax OpenAI-compatible Chat Completions API，默认模型是 `MiniMax-M2.7`，默认 Base URL 是 `https://api.minimaxi.com/v1`。
- `mock`：开发和测试用的本地模拟 provider，不会访问外部服务。

如果 MiniMax key 误填在 OpenAI API Key 中，切换到 `minimax` 后后端会把 OpenAI Key 字段作为兼容兜底读取；推荐后续把它移动到 MiniMax API Key 字段，避免误用 `openai` provider 时打到 `https://api.openai.com/v1/responses` 后返回 401。

MiniMax 有不同区域入口：中国区通常使用 `https://api.minimaxi.com/v1`，国际区文档常见 `https://api.minimax.io/v1`。如果出现 401，先确认 API Key 对应的区域，再调整设置页里的 MiniMax Base URL。

持仓分析页默认只读取结构化指标和当天已缓存的智能摘要，不会在每次进入板块时同步请求外部模型。需要更新文案时，在页面点击“刷新智能摘要”；后端会通过 `/api/portfolio-analysis/narrative/refresh` 触发后台刷新，并把当天成功结果写入内存缓存。MiniMax 或 OpenAI 慢响应、超时只会影响这次摘要刷新，不会阻塞持仓分析数据加载，也不会用超时错误覆盖当天可用缓存。

### 长桥与 Futu OpenD 只读行情

推荐优先使用长桥 provider。它通过 Codex 环境里的 `longbridge` CLI 读取报价和日 K 线，不需要本机安装或打开 Futu OpenD。

进入“设置与导入 -> V2 分析集成”，把“行情 Provider”切换为“长桥”并保存。保存后可以测试长桥连通性：

```bash
curl -X POST http://127.0.0.1:8085/api/settings/data-sources/longbridge/test \
  -H 'Content-Type: application/json' \
  -d '{"symbol":"AAPL","days":5}'
```

也可以手动重拉持仓和核心市场指数的历史 K 线，结果会写入本地持久化缓存 `~/.cache/ibkr-dashboard/market-history.json`，后续总览和持仓分析会优先复用这些数据：

```bash
curl -X POST http://127.0.0.1:8085/api/settings/data-sources/history/refresh \
  -H 'Content-Type: application/json' \
  -d '{"days":365}'
```

如果只想刷新指定标的：

```bash
curl -X POST http://127.0.0.1:8085/api/settings/data-sources/history/refresh \
  -H 'Content-Type: application/json' \
  -d '{"symbols":["AAPL","QQQ","^IXIC"],"days":365}'
```

长桥不可用时，历史行情仍会按 Finnhub、Yahoo Finance、Nasdaq 的顺序兜底。

如果本机已经运行 Futu OpenD，也可以把行情 Provider 切换为“本地 OpenD”，并填写 host 和 port。默认 host 是 `127.0.0.1`，默认 port 是 `11111`。

这些集成都只读取快照报价和日 K 线；当前版本不做期权操作，也不依赖期权行情。项目代码不包含交易、下单、撤单或解锁交易接口。

保存设置后可以测试 OpenD：

```bash
curl -X POST http://127.0.0.1:8085/api/settings/data-sources/futu/test \
  -H 'Content-Type: application/json' \
  -d '{"symbol":"AAPL"}'
```

如果返回 `futu_api_package_not_installed`，先在后端环境安装依赖：

```bash
cd backend
.venv/bin/python -m pip install -e .
```

### Telegram 命令与日报

Telegram 配置包含 Bot Token、白名单 Chat ID、日报开关和日报时间。多个 Chat ID 可以用逗号、空格或换行分隔。

接入步骤：

1. 在 Telegram 找 `@BotFather` 创建 bot，保存 Bot Token。
2. 给你的 bot 发一条消息，例如 `/start`。
3. 用 Bot API 查询 chat id：

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates"
```

4. 把返回里的 `message.chat.id` 填入白名单 Chat ID。群组或频道一般是负数 ID。
5. 保存 Bot Token、白名单、日报时间；需要自动日报时再打开“Telegram 日报”。

当前后端提供只读命令 dry-run 接口，方便先验证命令返回内容和白名单规则：

```bash
curl -X POST http://127.0.0.1:8085/api/telegram/commands/dry-run \
  -H 'Content-Type: application/json' \
  -d '{"chat_id":"123456789","text":"/risk"}'
```

支持的命令包括：

```text
/overview
/positions
/risk
/cashflow
/market
/report
```

日报调度默认关闭。开启后，后端会按设置中的日报时间把 `/report` 内容发送给所有白名单 Chat ID。部署真实 Bot 前，可以先用 dry-run 查看日报内容和发送人数：

```bash
curl -X POST http://127.0.0.1:8085/api/telegram/reports/dry-run
```

### Claude Desktop MCP 配置

MCP server 是 stdio 进程，启动目录需要指向后端目录。下面示例使用本机 Python 虚拟环境；如果你使用 Docker 或其他 Python 路径，请替换 `command`。

Claude Desktop 的 macOS 配置文件通常在：

```text
~/Library/Application Support/Claude/claude_desktop_config.json
```

加入：

```json
{
  "mcpServers": {
    "ibkr-dashboard": {
      "command": "/Users/your-name/cursor/ibkr-dashboard/backend/.venv/bin/python",
      "args": ["-m", "app.mcp_server"],
      "cwd": "/Users/your-name/cursor/ibkr-dashboard/backend",
      "env": {
        "ES_BACKEND": "http",
        "ES_HOST": "http://127.0.0.1:9200"
      }
    }
  }
}
```

保存后重启 Claude Desktop。MCP 工具是只读的，可列出持仓、读取风险摘要、读取市场/组合/个股分析，不提供任何交易动作。

### Codex Desktop MCP 配置

Codex Desktop / Codex CLI 使用 TOML 配置时，可以在 `~/.codex/config.toml` 加入同一个 stdio server：

```toml
[mcp_servers.ibkr-dashboard]
command = "/Users/your-name/cursor/ibkr-dashboard/backend/.venv/bin/python"
args = ["-m", "app.mcp_server"]
cwd = "/Users/your-name/cursor/ibkr-dashboard/backend"

[mcp_servers.ibkr-dashboard.env]
ES_BACKEND = "http"
ES_HOST = "http://127.0.0.1:9200"
```

保存后重启 Codex Desktop，或重开 Codex 会话。不同安装版本如果提供图形化 MCP 配置入口，填入同样的 `command`、`args`、`cwd`、`env` 即可。

如果只是开发烟测，不连接 Elasticsearch，可以临时使用：

```bash
cd backend
ES_BACKEND=in_memory .venv/bin/python -m app.mcp_server --list-tools
```

## 停止

如果是用 `docker compose up` 启动的，在同一个终端窗口按：

```text
Ctrl + C
```

如果你想让它在后台运行，可以用：

```bash
docker compose up -d
```

后台运行时，停止命令是：

```bash
docker compose down
```

`docker compose down` 不会删除已经导入的数据和设置。只有运行下面这个命令才会清空本地数据库，请谨慎使用：

```bash
docker compose down -v
```

## 第一次使用

1. 打开 `http://localhost:5176`。
2. 进入“设置与导入”。
3. 设置基础币种：`USD`、`HKD` 或 `RMB`。V1 中基础币种只影响资产总览，其他页面保持 XML 原始口径。
4. 设置时区：中国北京或美国纽约。
5. 按需填写 Finnhub API Key。没有 Key 也可以先使用，部分实时行情和历史数据可能会受限。
6. 如果要使用 IBKR Flex 在线同步，填写 Flex Token 和 Query ID。
7. 如果你已经有 Flex XML 文件，直接在 XML 导入模块选择文件并导入。
8. 导入成功后，进入“资产总览”“持仓明细”“业绩分析”“交易明细”查看数据。

## 如何获取 IBKR Flex XML

1. 进入 Flex Queries 页面。

登录 IB 网页端后，按下面路径点击菜单：

```text
Performance & Reports -> Flex Queries -> Activity Flex Query
```

2. 创建查询模板。

如果你还没有 Activity Flex Query 模板，点击右侧的 `+` 按钮新建一个。

3. 勾选 Sections。

在 `Sections (Select Multiple)` 页面中，建议把所有 Section 都勾选。点击任意 Section 展开后，里面的每一项子字段也需要全部勾选，可以使用页面里的 `Select All`。输出格式必须选择 `XML`。

如果字段缺失，导入后可能出现资产、持仓、交易或出入金数据不完整。

4. 配置 General Configuration。

具体如何配置请参考我的视频。小白用户可以把能勾的都勾选。

5. 获取 Query ID 与 Token。

保存模板后，IBKR 会生成一个 Query ID。然后进入 Flex Web Service 页面，勾选 Flex Web Service Status 启用服务。页面中间的 Current Token 会显示一长串数字，这就是你的 Token。

6. 下载 XML 文件。

配置完成后，点击运行查询。IBKR 会生成 XML 文件，点击下载并保存到本地。建议下载完整的历史区间（从开户日至今），这样本系统的业绩归因、持仓成本、交易排名等高级分析才会更准确。

对于年份较多的历史文件，建议按照自然年来导出 XML 文件。

XML 文件保存在你自己的电脑上，然后通过本项目的“设置与导入”页面导入。

## 数据和隐私

- 真实 XML 文件不会被上传。
- 应用数据默认保存在 Docker 的本地卷 `es_data` 中。
- 删除容器不会删除数据；删除 Docker 卷才会清空数据。
- IBKR Flex Token、Finnhub API Key 等凭据只应保存在本地设置中。

## 常见问题

### 打不开 http://localhost:5176

先确认 Docker Desktop 正在运行，然后在项目文件夹重新执行：

```bash
docker compose up --build
```

如果提示端口被占用，先停止旧服务：

```bash
docker compose down
```

然后再启动。

### 第一次启动很慢

正常。第一次会下载 Python、Node.js、Elasticsearch 等运行环境。后续启动会快很多。

### 导入 XML 后没有数据

确认导入的是 IBKR Flex XML，而不是 PDF、CSV 或普通活动报表。也可以重新导出一个包含持仓、交易、现金流水和账户净值的 Flex Query。

### 设置基础币种后，为什么其他页面没变

这是 V1 的设计。为了避免跨页面币种换算造成口径不一致，基础币种只影响资产总览；持仓、交易、业绩等页面保留账户和 XML 的原始计价口径。

## 当前限制

- 长期历史行情、基准历史数据和外部行情接口已经预留并接入缓存，但仍依赖公开数据源可用性和频率限制。
- V2 个股分析已经接入统一持仓分析框架；如果外部行情、Futu OpenD、OpenAI 或 MiniMax 不可用，对应指标会显示为缺失或不可用。
- Telegram 已提供后端只读命令、日报调度和 Bot API 发送层；真实 Bot Token、网络连通性和部署方式需要在运行环境中配置。
