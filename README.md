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

## 技术栈

- 前端：React、TypeScript、Vite。
- 后端：Python、FastAPI。
- 存储：Elasticsearch。
- 启动方式：Docker Compose 一键启动前端、后端和数据库。
- 数据来源：IBKR Flex XML、Finnhub、Yahoo Finance。

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
- 个股分析板块目前未开发，后续将提供 AI 功能，对持仓 / 个股进行个性化分析。
