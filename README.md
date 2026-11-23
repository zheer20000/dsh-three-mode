# dsh-spec-flow

> 把「规格官 → 执行者」双会话流程固化成 DSH 插件的三模式工作流：
> 规格官只问不写、执行者只做不改需求、审查官只验不判，中间靠文件交接 + 人工闸门 + 状态机。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

<!-- 功能截图占位符：发布后替换成真实截图 -->
<!-- ![看板](./docs/screenshot-board.png) -->
<!-- ![规格官访谈](./docs/screenshot-officer.png) -->

## 一句话

一个 DSH（DeepSeek Harness）插件，用三个 preset + 状态机 + 看板，把「先想清楚再动手」固化成机械流程——防止需求没问清就开工、执行者跑偏、验收看不懂日志。

## Highlight

- **三模式 preset**：规格官（只问不写）、执行者（只做不改需求）、审查官（只验不判）。工具按 preset 隔离，不是靠提示词约束。
- **模型路由**：规格官 / 执行者用 `deepseek-v4-pro`，审查官强制 `deepseek-flash` 省钱；三角色模型可在 `models` 里配。
- **访谈闸门**：没经过人工「确认可以封装」，规格官写不了文件、封不了版——机械拒绝，不是提示。
- **打回熔断**：打回超 3 次自动冻结成 `frozen`，并生成 `005-人类介入单.md`，停止烧 Token。
- **人类可读验收**：执行者交 004 必须带「给人类的验收摘要」，缺了整单拒绝。
- **Git 自动保存**：验收通过后自动 `git commit` 任务目录，保留历史版本。
- **看板调度**：按 deadline 紧急度排序，逾期 / 临近高亮，reviewing 滞留提醒。
- **极简直通**：`simpleMode` 开关，极简任务单 Agent 快速搞定，跳过流水线。

## 架构

```
                 ┌─────────────┐
                 │  看板 (web)  │
                 └──────┬──────┘
                        │ GET  /spec-flow/board
                        │ POST /spec-flow/confirm
                        │ POST /spec-flow/review
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
   ┌──────────┐   ┌──────────┐   ┌──────────┐
   │ 规格官    │   │ 执行者    │   │ 审查官    │
   │ spec_ask │   │ spec_check│   │ spec_read│
   │ spec_write│  │ spec_report│  │ 读码 + 跑测│
   └────┬─────┘   └────┬─────┘   └────┬─────┘
        │ 001-003      │ 004-result    │ 施工单 / 验收指南
        └──────────────┼──────────────┘
                       ▼
             ┌──────────────────┐
             │  <任务名>/ 目录   │
             │  00-交接.json    │
             │  001-003 + 004   │
             └──────────────────┘
```

## 状态机

```
drafting → spec_ready → executing → reviewing → accepted | rejected | frozen
rejected → spec_ready
frozen（打回超 3 次，终态，生成人类介入单）
```

每一跳都由工具调用显式触发，没有自动串联。

## 快速安装

1. 把本插件 link 进你的 DSH profile（或在插件市场安装）。
2. 设置交付目录环境变量 `SPEC_FLOW_ROOT`（缺省 `~/dsh-spec-flow`）。
3. 重启 DSH。
4. 左栏点「规格」看板，开一个规格会话开始。

## 配置

| 配置 | 说明 |
| --- | --- |
| `specRoot` | 交付目录（等价 `SPEC_FLOW_ROOT`） |
| `models.officer / executor / reviewer` | 三角色模型 `{provider, model, reasoningEffort}` |
| `simpleMode` | 极简直通开关（默认 false） |
| `officerPreset / executorPreset / reviewerPreset` | 自定义 preset id |

## 自测

```bash
node selftest.mjs        # 35 项
node selftest-board.mjs  # 23 项
node selftest-v11.mjs    # 14 项
```

## 目录结构

```
dsh-spec-flow/
├── index.js          # host 入口：挂工具 + HTTP 接口 + 配置归一化
├── client.js         # 浏览器半边：看板
├── cordis.patch.yml  # 三个 preset + 提示词
├── lib/
│   ├── store.js      # 状态机 + 文件契约 + SPEC_ROOT
│   ├── tools.js      # 9 个 spec_* 工具
│   ├── attach.js     # 按 preset 挂工具 + 绑模型
│   ├── board.js      # 看板扫描 + 紧急度排序
│   ├── review.js     # 验收 + 熔断 + 人类介入单
│   ├── git.js        # 验收后 git commit
│   ├── gate.js       # 访谈闸门
│   ├── lint.js       # 5 条形式检查
│   └── result-doc.js # 004 校验
├── templates/004-result.md
└── docs/
```

## License

[MIT](./LICENSE)
