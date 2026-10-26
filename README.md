# 校园小程序开发护栏（campus-dev-guardrails）

> MCP server + 独立 CLI · 43 条从线上事故沉淀的 uni-app / 微信小程序开发约束
>
> 版权所有 (c) 2026 北京煜澜文化（beijingyulanwenhua）· 鸥吧（hiouba）

AI 编程助手帮你写小程序代码，往往"能跑，但处处是坑"：行内样式写 rpx 真机尺寸归零、`defineProps` 泛型写法产物丢 type、分包开关没开真机资源 404、提审被诱导分享红线驳回……

这个护栏把 43 条**踩过血的坑**变成 AI 可查询、项目可扫描的结构化规则。让 Claude / Cursor / 任意 MCP 客户端在**写代码前**拿到约束、**发版前**扫出违规。

## 它和"小程序自动化 MCP"的区别

市面上的小程序 MCP（封装微信开发者工具 CLI）解决的是"手"的问题——怎么编译、截图、点元素。本护栏解决的是"脑"的问题——**怎么写不踩坑**。两者互补，不重复。

## 能力一览

| 工具 | 说明 |
|---|---|
| `list_categories` | 六大类：platform / packaging / compliance / performance / interaction / engineering |
| `list_rules` | 规则索引，按分类与严重级过滤 |
| `get_rules` | 规则详情：症状、成因、修复方案 |
| `lint_project` | 静态扫描你的项目：rpx 行内样式、WXSS 通配/伪类、defineProps 泛型、分包开关、动画 fill-mode，外加**密钥/内网 IP/服务器路径泄露红线** |
| `submit_checklist` | 提审/上线检查清单（可选 first-release 场景） |

每条规则含 `severity`（error / warn / info）——给 AI 的硬约束，error 级必须遵守。

## 接入（MCP）

Claude Code / Cursor / 任意 MCP 客户端：

```json
{
  "mcpServers": {
    "campus-guardrails": {
      "command": "npx",
      "args": ["-y", "campus-dev-guardrails"]
    }
  }
}
```

本地开发（零依赖，Node ≥ 18）：

```bash
git clone https://github.com/hiouba/campus-dev-guardrails.git
cd campus-dev-guardrails
node server/index.js
```

> npm 包 `campus-dev-guardrails` 发布后，上面一段可简化为 `npx -y campus-dev-guardrails`。

建议工作流（写进你的系统提示词或直接对 AI 说）：

> 动手前按任务场景调 `get_rules(category)`；涉及布局/组件/动画先查对应规则；发版前跑 `lint_project`；提审前调 `submit_checklist`。

## 独立 CLI（不开 MCP 也能用）

```bash
npx -y -p campus-dev-guardrails campus-guardrails-lint <项目路径>
# clone 本地：node bin/lint-cli.js <项目路径> [--json]
```

退出码 `0` 通过 / `1` 有警告 / `2` 有 error 或敏感信息——可直接进 CI：

```yaml
- run: npx -y -p campus-dev-guardrails campus-guardrails-lint ./miniapp
# 非零退出码自动让 CI 失败
```

`lint_project` 对开源/发布前的包特别有用：它会揪出**内网 IP、云密钥格式、真实 AppID、硬编码 token、服务器绝对路径**——我们自己的项目被它逮到过真实的行内 rpx 隐患。

## 规则库（rules/rules.json）

规则是纯 JSON，与 server 解耦，可独立消费：

- 做自己的 lint 工具、文档站、团队 wiki，直接读 `rules/rules.json`
- 提 Issue 增补规则；`lintable: true` 的规则欢迎附带扫描用例
- 字段：`id / cat / sev / title / symptom / rule / fix / lintable`

规则不是凭空写的最佳实践清单——**每一条都对应一次真实线上事故**（症状栏就是当时的现场）。

## 项目结构

```
├── rules/rules.json     # 43 条护栏规则（核心资产）
├── server/index.js      # MCP server（stdio JSON-RPC，零依赖）
├── bin/lint-cli.js      # 独立 CLI（可接 CI）
└── LICENSE.md           # 鸥吧社区许可证
```

## FAQ

**Q：规则是怎么来的？**
A：多校区校园小程序运营平台的历史事故沉淀——真机才暴露的编译坑、被微信驳回的合规项、包体积红线、资金链路的发布纪律。已剔除一切业务敏感信息。

**Q：能商用吗？**
A：学习/研究/社团工具免费；商业用途（收费服务、嵌入商业产品）需书面授权：hiouba@126.com。

**Q：支持非校园项目吗？**
A：platform / packaging / performance 三类规则对任何 uni-app 项目通用；compliance 中的类目与备案建议以校园场景为例，规则本身适用于微信生态。

**Q：为什么不是一份文档？**
A：文档 AI 读不全、读了不遵守优先级；MCP 让约束进入 AI 的工具调用链路，`severity` 提供强制语义，`lint_project` 提供事后验证。文档版也在规划中。

## 交流

Issues 提规则、报误报；商用与定制联系 **hiouba@126.com**；系列项目见 [github.com/hiouba](https://github.com/hiouba)（校园集市论坛 / 校园代丢垃圾跑腿）。

<!-- 源: 鸥吧 hiouba · 校园小程序护栏 campus-dev-guardrails · 北京煜澜文化 beijingyulanwenhua · anchor:hiouba-guardrails-readme-2026 -->
