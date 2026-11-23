# dsh-spec-flow 状态

一句话：DSH 插件，把「规格官 → 执行者」双会话流程固化。

- **规格官**：只问、找盲点、列需求/计划/材料，产出 `001-requirements.md` / `002-plan.md` / `003-materials.md` 并封版。写文件前必须经过人工「确认可以封装」闸门。
- **执行者**：只按计划干活，产出 `004-result.md`（必须带「给人类的验收摘要」），逐条对账验收。
- **审查官**：执行者交完 004 进入 reviewing 后，看板点「召唤检察院」开一个审查官会话；它读需求、读代码、跑测试，做错写给执行者的改法，全对则生成一份能双击打开的「傻瓜级验收指南」（HTML）。
- 交付目录：`<SPEC_FLOW_ROOT>\<任务名>\`，交接文件 `00-交接.json`。

---

## 文件清单与作用

| 文件 | 作用 |
| --- | --- |
| `package.json` | 包清单；`dsh.bundle.patch` 指向 patch；`dsh.client` 声明浏览器模块 `client.js` |
| `cordis.patch.yml` | 4 项：host 行 + 三个 preset；三预设各绑不同模型，规格官提示词加「草稿摘要前置拦截」 |
| `index.js` | host 入口：挂工具 + 3 接口；配置归一化含 `models`（三角色模型）与 `simpleMode`（极简开关） |
| `client.js` | 浏览器半边：左栏「规格」图标 + 看板页（只读 + 开会话 + 通过/打回 + 确认封装 + 召唤检察院按钮） |
| `lib/store.js` | `SPEC_ROOT`、任务名校验、三件套 sha256、状态机（含 `frozen`）、`00-交接.json` 读写（含 `deadline`/`rejections`） |
| `lib/lint.js` | 5 条形式检查（文件存在 / 验收有 check / 假设有标注 / 非目标非空 / hash 一致） |
| `lib/tools.js` | 9 个工具：规格官 7、执行者 3、审查官 read；`spec_start`/`spec_declare` 支持 `deadline` |
| `lib/attach.js` | 按会话 preset 挂工具 + 按角色绑定模型（`agent.model.select`） |
| `lib/board.js` | 扫任务目录、读交接、计数；读 `deadline`，按紧急度排序 |
| `lib/review.js` | 验收：通过后 git commit；打回超 3 次冻结 + 生成人类介入单 |
| `lib/git.js` | 验收通过后对任务目录 `git add` + `commit`，保留历史版本 |
| `lib/gate.js` | 访谈闸门：只有人能在看板点「确认可以封装」，`openGate` 校验至少 1 轮 `spec_ask` |
| `lib/result-doc.js` | 004 模板加载 + 校验（必须有人类验收摘要，≥30 字，无占位符） |
| `templates/004-result.md` | 004 模板真源，`spec_report` 报错时把全文塞进返回 |
| `docs/DETAIL.md` | 详细设计（契约 / 状态机 / 工具 / 闸门 / 验收 / 接口 / 限制） |
| `locale/en.json` / `locale/zh.json` | 预留；UI 目前写死中文，未走 locale |
| `icon.svg` | 左栏图标 |
| `selftest.mjs` | 核心链路自测（35 项 ALL PASS） |
| `selftest-board.mjs` | 看板 / 验收 / 闸门自测（23 项 ALL PASS） |

---

## 当前完成度

**已实现并自测通过：**

- 状态机全链路：建任务 → 访谈 → 人工确认 → 写三件套 → 登记 → 封版（sha256）→ 执行 → 对账（逐条 passed/failed）→ 验收（通过/打回）→ 打回后重新封版清旧结果。
- 9 个工具，按 preset 隔离。
- 看板：左栏图标 + 页面 + 「开规格会话 / 开执行会话 / 确认可以封装 / 通过 / 打回 / 召唤检察院」。
- 访谈闸门：`spec_write` / `spec_finish` 在闸门关闭时硬拒绝，不是提示。
- 004 人类验收摘要强制校验：缺章节 / 太空 / 留占位符都整单拒绝。
- 验收规则：`review_by ≠ exec_by`，非 reviewing 不能验收。

**v1.1 升级：**
- 模型绑定：规格官 / 执行者 `deepseek-v4-pro`，审查官 `deepseek-flash`（最便宜）。
- 打回熔断：打回超 3 次冻结成 `frozen` + 生成 `005-人类介入单.md`，停止烧 Token。
- 源头污染：规格官写 001-003 前必须先 `spec_ask` 出「草稿摘要」，用选择题问缺口，禁止开放式问题。
- Git 自动保存：验收通过后对任务目录 `git commit`（「任务 [任务名] 验收通过」）。
- 看板：按 deadline 紧急度排序，逾期/24h 内高亮，reviewing 滞留超 48h 提醒。
- `simpleMode` 极简开关（默认关）：打开后看板出「极简直通」按钮，单 Agent 直通。

**自测：`selftest.mjs` 35 项、`selftest-board.mjs` 23 项、`selftest-v11.mjs` 14 项，全部 ALL PASS。**

**尚未现场验证（需要真会话）：**

- 真实会话里选「规格官」preset 跑一轮（下拉菜单是自绘控件，自动化点不开）。
- 看板「通过 / 打回」按钮（要有一个 `reviewing` 状态的任务才可见）。
- 重启 DSH 加载最新 host 模块后，`curl /spec-flow/board` 应返回 `acceptance_passed`（旧模块返回的是 `acceptance_done:0`）。

---

## 还剩什么

- [ ] 重启 DSH 生效，现场端到端跑一圈（规格官访谈 → 看板确认 → 封版 → 执行者 → 004 → 看板验收）。
- [ ] 现场确认执行者交 004 缺「给人类的验收摘要」时被 `spec_report` 拒绝。
- [ ] 看板三个按钮现场各点一遍（确认封装 / 通过 / 打回）。

## 已知限制

- HTTP 接口无鉴权，只在监听本机时安全；开了远程访问会暴露任务名。
- UI 文案写死中文，未走 locale 服务。
- 「确认可以封装」只机械要求 ≥1 轮 `spec_ask`，问得够不够由点按钮的人判断。
- 本地目录安装是链接，改代码要重启 DSH 才加载新模块。
