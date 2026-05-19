1. 增加持仓分析板块，去掉原来的个股分析板块（实际上是内容更多了）
2. 接入Telegram，可以定时发送分析日报，特定指令来快速查询账户信息
3. 上线 MCP server，把ibkr-dashboard作为MCP服务接入 Claude Desktop / CodeX Desktop 等 AI客户端，添加read-only tools 让 AI 直接查你的持仓 / 收益 / wheel / 风险 / 现金流
4. 用Echarts代替SVG，功能更加强大
5. 重构前端UI风格，看看nothing style

接入futu skills hub：https://www.futunn.com/skills/futu-install.md
## 市场分析
#### 指标
对市场进行指标量化

| **维度**        | **数据**                 |
| ------------- | ---------------------- |
| 评论情绪          | futu-comment-sentiment |
| RSI           | 技术超买超卖                 |
| IV percentile | 期权情绪                   |
| Put/Call      | 风险偏好                   |
| 新闻热度          | narrative温度            |
| 成交量异常         | 情绪强化                   |
| ETF流入         | 被动资金                   |
| 分析师revision   | sell-side方向            |
#### 输出
| **状态**               | **定义**  |
| -------------------- | ------- |
| Fear Compression     | 悲观但抛压衰减 |
| Capitulation Zone    | 极端恐慌    |
| Euphoric Momentum    | 狂热趋势    |
| Crowded Long         | 多头过度拥挤  |
| Narrative Exhaustion | 热点开始疲劳  |
### 推荐输出结构
```
市场正在进入：
【高波动成长股风险压缩阶段】

原因：
- 悲观评论占比 82%
- RSI 22
- Put/Call > 1.8
- IV percentile 91%
- 新闻情绪转负

特点：
- AI主线仍强
- 但拥挤度快速上升
- 市场开始从GPU扩散到power/networking
- 高估值AI应用开始分化

风险：
如果下周CPI高于预期，
AI高beta资产可能出现集中回撤
```
我希望不光是文字，还可以配以图表，比如可以将RSI做成指针图更易于理解
## 持仓分析
| **内容**           | **意义**  |
| ---------------- | ------- |
| Delta            | 方向暴露    |
| Gamma            | 波动风险    |
| Theta            | 时间损耗    |
| Vega             | IV风险    |
| Sector exposure  | 行业集中    |
| AI concentration | AI拥挤    |
| Correlation      | 同涨同跌    |
| Event risk       | 财报/FOMC |
| Liquidity risk   | 流动性     |
| Tail risk        | 极端风险    |
### 这个模块应该分四层
#### 组合风险（核心）
| **内容**               | **意义** |
| -------------------- | ------ |
| Delta                | 方向     |
| Gamma                | 波动     |
| Vega                 | IV     |
| Sector concentration | 集中度    |
| Correlation          | 同跌风险   |
| AI beta              | AI暴露   |
#### 到期风险
- theta decay
- IV crush
- earnings risk
- expiration clustering
#### AI组合顾问
```
当前组合：

- AI beta 暴露过高
- 实际依赖：
  Nvidia + hyperscaler CapEx

隐藏风险：
如果AI CapEx预期下降，
组合会出现：
- growth compression
- IV collapse
- AI链同步回撤

建议：
- 增加电力链对冲
- 减少高IV AI应用股
- 用QQQ put spread对冲
```
## 个股分析
使用AI的API key来分析个股；使用我自己写的skills，配合futu skills对个股进行分析，对个股上线相关指标（参考资产总览的指标）
### 推荐输出结构
```
方向：偏多

核心变化：
Meta 上调 AI CapEx 指引

真正受益：
不是 Meta 本身，
而是：
- HBM
- 光模块
- 电力设备

市场误判：
市场仍把这理解为GPU需求，
但真正瓶颈已迁移到networking和power

需要跟踪：
- CoWoS扩产
- 800G订单
- GEV backlog
```
