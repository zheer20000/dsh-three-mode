# 规格官 / 执行者

把「先想清楚，再动手」拆成两个会话，交接靠文件而不是靠对话记忆。

## 它解决什么

一个会话里既问需求又写代码，结果是：需求没问清楚就开始写，写到一半发现方向不对，回头改已经写好的东西。这套流程把两件事拆开，用 preset 把权限也拆开。

## 三个预设

| 预设 | 能用什么 | 不能做什么 |
| --- | --- | --- |
| 规格官 `spec-officer` | `spec_*` 工具、只读文件、提问 | 没有 bash、edit、apply_patch，写不了仓库 |
| 执行者 `spec-exec` | 读写代码、跑测试、`spec_*` 工具 | 没有 subagent / subagent_fork |
| 审查官 `spec-reviewer` | 读需求/代码、跑测试、写验收指南 HTML、`spec_read` | 不改代码（edit 关闭） |

工具是**按会话挂载**的，不是靠提示词约束：用标准预设开的会话，工具表里根本不存在 `spec_write`。

## 文件契约

```
<SPEC_FLOW_ROOT>\<任务名>\
  00-交接.json          状态、hash、验收、假设、非目标、deadline、rejections
  001-requirements.md
  002-plan.md
  003-materials.md
  004-result.md
```

任务名 4–20 个字符，只能是汉字、字母、数字、下划线、连字符。

## 状态机

```
drafting → spec_ready → executing → reviewing → accepted | rejected | frozen
rejected → spec_ready
```

每次跳转都由工具调用显式触发，没有自动串联。打回（rejected）超 3 次会冻结成 `frozen`，生成 `005-人类介入单.md`，不再自动重做。

## 工具

规格官：`spec_ask`、`spec_start`、`spec_write`、`spec_declare`、`spec_lint`、`spec_finish`、`spec_read`

执行者：`spec_check`、`spec_report`、`spec_read`

`spec_report` 一次交两样：`content`（004 全文）和 `results`（每条验收一个 `{id, result: passed|failed}`，`failed` 必须带 `reason`）。少一条就整单拒绝，004 不写、状态不改，避免出现"看板显示 0/3 但执行者说干完了"。

004 必须有「## 给人类的验收摘要」一章：一句话结论、用人话说做了什么、别人怎么自己验证。没这一章或摘要还是空壳，`spec_report` 直接拒绝，并把模板（`templates/004-result.md`）附在错误里。日志、堆栈、测试框架原始输出不能当唯一证据。

## 访谈闸门

规格官不能自己决定"问够了"。三个硬阶段：

1. **访谈**：每轮最多 3 问，`spec_ask` 登记后必须真的问用户；每轮更新盲点清单和材料清单。
2. **确认**：只有人能打开闸门——看板上点「确认可以封装」。`spec_write` 和 `spec_finish` 在闸门关闭时直接报错，不是提示。
3. **封装**：写 001-003 → `spec_declare` → `spec_lint` → `spec_finish`。

闸门只有一条机械条件：至少记录过一轮提问。够不够问清楚，由点按钮的人判断。

## 验收

`reviewing` 状态在看板上出现「通过」「打回」「召唤检察院」：

- 召唤检察院 → 开一个审查官会话，读需求/代码、跑测试，做错写改法、全对出「傻瓜级验收指南」

- 通过 → `accepted`，写入 `review_by`（默认 `user`，不能等于 `exec_by`）
- 打回 → `rejected`，规格官改完 001-003 后 `spec_finish` 重新封版；重新封版会清空上一轮的执行结果，执行方要重跑
- 打回超过 3 次 → `frozen`，生成 `005-人类介入单.md`，停止自动重做
- 通过 → `accepted`，后台自动 `git commit` 任务目录，保留历史版本

## 接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/spec-flow/board` | 任务列表（只读） |
| POST | `/spec-flow/confirm` | `{task}`：打开封装闸门 |
| POST | `/spec-flow/review` | `{task, decision: accepted\|rejected}` |

## 五条形式规则（`spec_lint`）

1. 001/002/003 都在且非空
2. 每条验收有 `check`（谁、做什么、看到什么算过）
3. 每条假设标了 `confirmed` 或 `assumed`
4. 非目标至少一条
5. 交接里的 `spec_hash` 与当前三件套一致

只查形式，不判断内容好坏。v1 只提示，不拦截。

## 限制

- 看板是只读列表 + 三个动作（开规格会话、开执行会话、验收通过/打回），不能改文件内容。
- 接口没有鉴权，只在监听本机时安全；开了远程访问会暴露任务名。
- 页面文案写死中文，没走 locale 服务。
- 只装在 desktop profile。
