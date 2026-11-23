/**
 * 规格官与执行者共用的七个工具。
 *
 * 这些工具只在对应 preset 的会话里挂载（见 attach.js），所以"规格官没有写代码的
 * 手"是工具表层面的事实，不是提示词层面的请求。
 *
 * 返回值一律是普通 JSON：ok 为 false 表示这次动作没有被接受，error/reason 说明原因。
 */
import path from 'node:path'
import { lint } from './lint.js'
import { checkResultDoc, resultTemplate } from './result-doc.js'
import {
  canTransition, filePath, readHandoff, readText, RESULT_FILE, specHash,
  taskDir, taskExists, validateTask, writeAtomic, writeHandoff, HANDOFF_FILE,
} from './store.js'

/** 统一的工具输出渲染。 */
function output(value) {
  return {
    schema: { type: 'object' },
    render: (_args, result) => [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  }
}

/** 失败结果。 */
function fail(error, extra = {}) {
  return { ok: false, error, ...extra }
}

/** 归一化截止时间：缺省返回 undefined（保持原值），合法转 ISO 字符串，非法返回 null。 */
function normalizeDeadline(value) {
  if (value === undefined || value === null || value === '') return undefined
  const ms = typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' ? new Date(value.trim()).getTime() : NaN
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

/** 文件键的中文名，给模型看。 */
const FILE_LABEL = {
  requirements: '001-requirements.md',
  plan: '002-plan.md',
  materials: '003-materials.md',
}

/** 只接受三件套的写入。 */
function checkSpecKey(file) {
  return typeof file === 'string' && Object.hasOwn(FILE_LABEL, file) ? file : undefined
}

/** 解析验收条目，缺 id 就补 A1/A2。 */
function normalizeAcceptance(input) {
  if (!Array.isArray(input)) return undefined
  return input.map((item, index) => {
    const row = item && typeof item === 'object' ? item : {}
    return {
      id: typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `A${index + 1}`,
      text: typeof row.text === 'string' ? row.text : '',
      check: typeof row.check === 'string' ? row.check : '',
    }
  })
}

/** 解析假设条目，缺 id 就补 S1/S2。 */
function normalizeAssumptions(input) {
  if (!Array.isArray(input)) return undefined
  return input.map((item, index) => {
    const row = item && typeof item === 'object' ? item : {}
    return {
      id: typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `S${index + 1}`,
      text: typeof row.text === 'string' ? row.text : '',
      state: row.state === 'confirmed' || row.state === 'assumed' ? row.state : '',
    }
  })
}

/** 解析非目标。 */
function normalizeNonGoals(input) {
  if (!Array.isArray(input)) return undefined
  return input.map((text) => (typeof text === 'string' ? text : '')).filter((text) => text.trim().length > 0)
}

/**
 * 造一组绑定到某个根目录的工具。
 * @param {string} specRoot
 */
export function createTools(specRoot) {
  /** 读任务并确认交接文件在。 */
  async function requireTask(task) {
    const checked = validateTask(task)
    if (!checked.ok) return { error: checked }
    if (!taskExists(specRoot, checked.task)) {
      return { error: fail(`任务目录不存在：${path.join(specRoot, checked.task)}`) }
    }
    const handoff = await readHandoff(specRoot, checked.task)
    if (handoff === null) return { error: fail(`00-交接.json 缺失或损坏：${path.join(taskDir(specRoot, checked.task), HANDOFF_FILE)}`) }
    return { task: checked.task, handoff }
  }

  const specStart = {
    name: 'spec_start',
    description: '在交付根目录（SPEC_FLOW_ROOT）下新建一个任务目录并写入初始 00-交接.json。任务名 4-20 个字符，只能用汉字、字母、数字、下划线、连字符；目录已存在时拒绝，不会覆盖。',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '任务名，同时作为目录名，例如 会话看板插件' },
        deadline: { type: 'string', description: '可选：截止时间（ISO 8601 或可解析日期），看板按它排紧急度' },
      },
      required: ['task'],
      additionalProperties: false,
    },
    output: output(),
    execute: async ({ task, deadline }) => {
      const checked = validateTask(task)
      if (!checked.ok) return checked
      if (taskExists(specRoot, checked.task)) {
        return fail(`任务目录已存在：${path.join(specRoot, checked.task)}；换一个任务名，或用 spec_read 继续已有任务`)
      }
      const handoff = {
        task: checked.task,
        spec_hash: '',
        status: 'drafting',
        spec_by: 'spec-officer',
        exec_by: null,
        review_by: null,
        acceptance: [],
        assumptions: [],
        non_goals: [],
        deadline: normalizeDeadline(deadline) ?? null,
        rejections: 0,
        interview: [],
        gate: { open: false, by: null, at: null },
      }
      await writeHandoff(specRoot, checked.task, handoff)
      return {
        ok: true,
        task: checked.task,
        dir: path.join(specRoot, checked.task),
        next: '用 spec_write 依次写 requirements / plan / materials，再用 spec_declare 登记验收与非目标',
      }
    },
  }

  const specAsk = {
    name: 'spec_ask',
    description: '记录一轮提问（1-3 个问题，每个都要带你倾向的默认答案），然后必须在对话里把这些问题原样问给用户。这是唯一会推进「访谈轮数」的动作；看板上的「确认可以封装」按钮要等至少记录过一轮才会出现。',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '任务名' },
        questions: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: '要问用户的具体问题' },
              my_default: { type: 'string', description: '你倾向的默认答案，让用户能只回「1 对 2 改」' },
            },
            required: ['question'],
            additionalProperties: false,
          },
        },
      },
      required: ['task', 'questions'],
      additionalProperties: false,
    },
    output: output(),
    execute: async ({ task, questions }) => {
      const found = await requireTask(task)
      if (found.error) return found.error
      if (found.handoff.status !== 'drafting' && found.handoff.status !== 'rejected') {
        return fail(`当前状态是 ${found.handoff.status}，只有 drafting 或 rejected 能补充访谈`)
      }
      if (!Array.isArray(questions) || questions.length === 0) return fail('至少问一个问题')
      if (questions.length > 3) return fail('一轮最多 3 个问题；问多了用户不会认真回答')
      const round = (Array.isArray(found.handoff.interview) ? found.handoff.interview.length : 0) + 1
      const rows = questions
        .map((item, index) => ({
          id: `Q${round}.${index + 1}`,
          question: typeof item === 'string' ? item : String(item?.question ?? ''),
          my_default: item && typeof item === 'object' && typeof item.my_default === 'string' ? item.my_default : '',
        }))
        .filter((row) => row.question.trim().length > 0)
      if (rows.length === 0) return fail('问题内容为空')

      const interview = [
        ...(Array.isArray(found.handoff.interview) ? found.handoff.interview : []),
        { round, questions: rows, at: Date.now() },
      ]
      await writeHandoff(specRoot, found.task, { ...found.handoff, interview })
      const gateOpen = found.handoff.gate?.open === true
      return {
        ok: true,
        task: found.task,
        round,
        rounds: interview.length,
        gate_open: gateOpen,
        next: gateOpen
          ? '继续问，或直接 spec_write'
          : '把这些问题原样问给用户。讨论清楚、盲点都有说法之后，请用户在看板上点「确认可以封装」，再写文件',
      }
    },
  }

  const specWrite = {
    name: 'spec_write',
    description: '把内容写入当前任务的 001-requirements.md、002-plan.md 或 003-materials.md。只能写这三个文件，路径由程序拼好；写不了别的任何文件。',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '任务名' },
        file: { type: 'string', enum: ['requirements', 'plan', 'materials'], description: 'requirements=001-requirements.md，plan=002-plan.md，materials=003-materials.md' },
        content: { type: 'string', description: '完整文件内容（Markdown），整篇覆盖' },
      },
      required: ['task', 'file', 'content'],
      additionalProperties: false,
    },
    output: output(),
    execute: async ({ task, file, content }) => {
      const key = checkSpecKey(file)
      if (!key) return fail('file 只能是 requirements、plan、materials 之一')
      if (typeof content !== 'string' || content.trim().length === 0) return fail('content 不能为空')
      const found = await requireTask(task)
      if (found.error) return found.error
      if (found.handoff.gate?.open !== true) {
        return fail('还没确认需求，不能写文件。先用 spec_ask 记录这一轮提问，请用户在看板上点「确认可以封装」，再回来写。', {
          gate_open: false,
          rounds: Array.isArray(found.handoff.interview) ? found.handoff.interview.length : 0,
        })
      }
      const target = filePath(specRoot, found.task, key)
      await writeAtomic(target, content.endsWith('\n') ? content : `${content}\n`)
      return { ok: true, task: found.task, path: target, file: FILE_LABEL[key], bytes: Buffer.byteLength(content, 'utf8') }
    },
  }

  const specDeclare = {
    name: 'spec_declare',
    description: '把验收标准、假设、非目标登记进 00-交接.json，并立刻返回 lint 结果。每条验收必须有 check（判定方式：谁、做什么、看到什么算过）；每条假设必须标 confirmed（用户确认过）或 assumed（你的假设）；非目标至少一条。',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '任务名' },
        acceptance: {
          type: 'array',
          description: '验收标准；id 可省略，程序会补 A1/A2',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              text: { type: 'string', description: '要达成什么' },
              check: { type: 'string', description: '怎么判定过：命令、观察点或人工动作' },
            },
            required: ['text', 'check'],
            additionalProperties: false,
          },
        },
        assumptions: {
          type: 'array',
          description: '假设；id 可省略，程序会补 S1/S2',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              text: { type: 'string' },
              state: { type: 'string', enum: ['confirmed', 'assumed'] },
            },
            required: ['text', 'state'],
            additionalProperties: false,
          },
        },
        non_goals: {
          type: 'array',
          description: '明确不做的事，至少一条',
          items: { type: 'string' },
        },
        deadline: { type: 'string', description: '可选：截止时间，看板按它排紧急度' },
      },
      required: ['task', 'acceptance', 'assumptions', 'non_goals'],
      additionalProperties: false,
    },
    output: output(),
    execute: async ({ task, acceptance, assumptions, non_goals, deadline }) => {
      const found = await requireTask(task)
      if (found.error) return found.error
      const rows = normalizeAcceptance(acceptance)
      const guesses = normalizeAssumptions(assumptions)
      const goals = normalizeNonGoals(non_goals)
      if (rows === undefined) return fail('acceptance 必须是数组')
      if (guesses === undefined) return fail('assumptions 必须是数组')
      if (goals === undefined) return fail('non_goals 必须是字符串数组')
      const handoff = { ...found.handoff, acceptance: rows, assumptions: guesses, non_goals: goals, deadline: normalizeDeadline(deadline) ?? found.handoff.deadline ?? null }
      await writeHandoff(specRoot, found.task, handoff)
      const report = await lint(specRoot, found.task)
      return { ok: report.ok, task: found.task, lint: report, next: report.ok ? '形式检查通过，可以 spec_finish' : '按 issues 逐条补齐后重新 spec_declare 或 spec_write' }
    },
  }

  const specLint = {
    name: 'spec_lint',
    description: '对当前任务跑五条形式规则：三件套齐全、验收有 check、假设有 confirmed/assumed 标注、非目标非空、spec_hash 与 001-003 一致。只查形式，不判断内容好坏。',
    parameters: {
      type: 'object',
      properties: { task: { type: 'string', description: '任务名' } },
      required: ['task'],
      additionalProperties: false,
    },
    output: output(),
    execute: async ({ task }) => {
      const found = await requireTask(task)
      if (found.error) return found.error
      const report = await lint(specRoot, found.task)
      return { task: found.task, status: found.handoff.status, ...report }
    },
  }

  const specFinish = {
    name: 'spec_finish',
    description: '封版：计算 001-003 的 hash 写进 00-交接.json，状态改为 spec_ready。有 lint 问题时默认拒绝；确实要带问题交接，传 acknowledge_issues=true。封版后执行方再改 001-003 会被 spec_check 拒绝。',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '任务名' },
        acknowledge_issues: { type: 'boolean', description: '带未解决的 lint 问题强行封版' },
      },
      required: ['task'],
      additionalProperties: false,
    },
    output: output(),
    execute: async ({ task, acknowledge_issues }) => {
      const found = await requireTask(task)
      if (found.error) return found.error
      if (found.handoff.gate?.open !== true) {
        return fail('还没确认需求，不能封版。先访谈，再请用户在看板上点「确认可以封装」。', { gate_open: false })
      }
      if (found.handoff.status !== 'drafting' && found.handoff.status !== 'rejected') {
        return fail(`当前状态是 ${found.handoff.status}，只有 drafting 或被退回（rejected）能封版`)
      }
      const report = await lint(specRoot, found.task)
      if (!report.ok && acknowledge_issues !== true) {
        return fail('lint 未通过，未封版；逐条修完再来，或在确认要带问题上交时传 acknowledge_issues=true', { lint: report })
      }
      const { hash } = await specHash(specRoot, found.task)
      // 重新封版时清掉上一轮的执行结果：需求变了，旧结果不能继续算数。
      const acceptance = (Array.isArray(found.handoff.acceptance) ? found.handoff.acceptance : [])
        .map((item) => {
          const rest = { ...item }
          delete rest.result
          delete rest.reason
          return rest
        })
      await writeHandoff(specRoot, found.task, { ...found.handoff, acceptance, spec_hash: hash, status: 'spec_ready' })
      return {
        ok: true,
        task: found.task,
        status: 'spec_ready',
        spec_hash: hash,
        lint: report,
        next: '把任务目录告诉用户；执行会话先跑 spec_check',
      }
    },
  }

  const specCheck = {
    name: 'spec_check',
    description: '执行前的门禁：比对 00-交接.json 里的 spec_hash 与当前 001-003。不一致说明需求在封版后被改过，必须停下并报告，不要按旧计划干活。通过时返回需求文件路径、验收清单、假设和非目标，并把状态推进到 executing。',
    parameters: {
      type: 'object',
      properties: { task: { type: 'string', description: '任务名' } },
      required: ['task'],
      additionalProperties: false,
    },
    output: output(),
    execute: async ({ task }) => {
      const found = await requireTask(task)
      if (found.error) return found.error
      const handoff = found.handoff
      if (handoff.status !== 'spec_ready' && handoff.status !== 'executing') {
        return fail(`当前状态是 ${handoff.status}，还没到可以执行的阶段（需要 spec_ready）`)
      }
      const { hash } = await specHash(specRoot, task)
      if (handoff.spec_hash !== hash) {
        return {
          ok: false,
          reason: 'spec_changed',
          expected: handoff.spec_hash,
          actual: hash,
          action: '停下。需求在封版后被修改，不要继续执行；把差异报告给用户，等规格会话重新封版',
        }
      }
      if (handoff.status === 'spec_ready') {
        if (!canTransition('spec_ready', 'executing')) return fail('状态机不允许 spec_ready -> executing')
        await writeHandoff(specRoot, task, { ...handoff, status: 'executing', exec_by: 'spec-exec' })
      }
      return {
        ok: true,
        task,
        status: 'executing',
        spec_hash: hash,
        files: {
          requirements: filePath(specRoot, task, 'requirements'),
          plan: filePath(specRoot, task, 'plan'),
          materials: filePath(specRoot, task, 'materials'),
        },
        acceptance: handoff.acceptance,
        assumptions: handoff.assumptions,
        non_goals: handoff.non_goals,
        rules: [
          '不许重新讨论需求，不许扩大范围，不许自己发明验收标准',
          '不许修改 001-003 和 00-交接.json',
          '每完成一条验收，在 004 里贴证据（命令输出、文件路径）',
        ],
      }
    },
  }

  const specReport = {
    name: 'spec_report',
    description: '把执行结果写成 004-result.md，并把每一条验收的 result（passed / failed）写进 00-交接.json，然后把状态推进到 reviewing。004 必须有一个「## 给人类的验收摘要」章节：一句话结论、你做了什么、别人怎么自己验证。每一条验收都必须有结果；少一条就整单拒绝。failed 必须写 reason。',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '任务名' },
        content: { type: 'string', description: '004-result.md 的完整内容（Markdown），逐条对照验收并贴证据' },
        results: {
          type: 'array',
          description: '每条验收的结果；id 必须与 001/交接里的验收 id 一致',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '验收 id，例如 A1' },
              result: { type: 'string', enum: ['passed', 'failed'] },
              reason: { type: 'string', description: 'result 为 failed 时必填：为什么没过' },
            },
            required: ['id', 'result'],
            additionalProperties: false,
          },
        },
      },
      required: ['task', 'content', 'results'],
      additionalProperties: false,
    },
    output: output(),
    execute: async ({ task, content, results }) => {
      const found = await requireTask(task)
      if (found.error) return found.error
      if (typeof content !== 'string' || content.trim().length === 0) return fail('content 不能为空')

      const docCheck = checkResultDoc(content)
      if (!docCheck.ok) return fail(docCheck.error, { template: resultTemplate() })

      const status = found.handoff.status
      if (status !== 'executing' && status !== 'reviewing') {
        return fail(`当前状态是 ${status}，只有 executing 能交结果（先 spec_check）；reviewing 只接受补交结果`)
      }

      const acceptance = Array.isArray(found.handoff.acceptance)
        ? found.handoff.acceptance.map((item) => ({ ...item }))
        : []
      if (acceptance.length === 0) {
        return fail('交接里没有验收条目，无法交结果；先让规格官 spec_declare')
      }

      if (!Array.isArray(results)) return fail('results 必须是数组，每条验收给一个 result')
      const byId = new Map(acceptance.map((item) => [item.id, item]))
      const unknown = []
      for (const row of results) {
        const id = row && typeof row.id === 'string' ? row.id.trim() : ''
        const value = row && typeof row.result === 'string' ? row.result.trim() : ''
        const item = byId.get(id)
        if (!item) {
          unknown.push(id || '(空 id)')
          continue
        }
        if (value !== 'passed' && value !== 'failed') {
          return fail(`验收 ${id} 的 result 只能是 passed 或 failed，收到「${value}」`)
        }
        const reason = row && typeof row.reason === 'string' ? row.reason.trim() : ''
        if (value === 'failed' && reason === '') {
          return fail(`验收 ${id} 标了 failed 但没写 reason；未达成必须给原因`)
        }
        item.result = value
        if (reason) item.reason = reason
        else delete item.reason
      }
      if (unknown.length > 0) {
        return fail(`results 里有不存在的验收 id：${unknown.join('、')}；可用的是 ${acceptance.map((item) => item.id).join('、')}`)
      }

      const missing = acceptance
        .filter((item) => item.result !== 'passed' && item.result !== 'failed')
        .map((item) => item.id)
      if (missing.length > 0) {
        return fail(`还有 ${missing.length} 条验收没有结果：${missing.join('、')}。每条都要 passed 或 failed，没跑的写 failed 并说明原因`, {
          missing,
          acceptance,
        })
      }

      const next = acceptance.filter((item) => item.result === 'passed').length
      const target = path.join(taskDir(specRoot, task), RESULT_FILE)
      await writeAtomic(target, content.endsWith('\n') ? content : `${content}\n`)

      if (status === 'executing') {
        if (!canTransition('executing', 'reviewing')) return fail('状态机不允许 executing -> reviewing')
        await writeHandoff(specRoot, task, { ...found.handoff, acceptance, status: 'reviewing' })
      } else {
        // reviewing 阶段补交：只更新结果，不重复跳转
        await writeHandoff(specRoot, task, { ...found.handoff, acceptance })
      }

      return {
        ok: true,
        task,
        status: 'reviewing',
        path: target,
        passed: next,
        failed: acceptance.length - next,
        next: '等验收人点通过或打回；accepted 的 review_by 不能等于 exec_by',
      }
    },
  }

  const specRead = {
    name: 'spec_read',
    description: '读当前任务的文件：requirements、plan、materials、result 或 handoff。用于回看已写内容，避免靠记忆复述。',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '任务名' },
        file: { type: 'string', enum: ['requirements', 'plan', 'materials', 'result', 'handoff'] },
      },
      required: ['task', 'file'],
      additionalProperties: false,
    },
    output: output(),
    execute: async ({ task, file }) => {
      const found = await requireTask(task)
      if (found.error) return found.error
      const name = file === 'handoff' ? HANDOFF_FILE
        : file === 'result' ? RESULT_FILE
          : checkSpecKey(file) ? FILE_LABEL[file] : undefined
      if (!name) return fail('file 只能是 requirements、plan、materials、result、handoff')
      const target = path.join(taskDir(specRoot, task), name)
      const text = await readText(target)
      if (text === null) return fail(`文件不存在：${target}`)
      const capped = text.length > 20000 ? `${text.slice(0, 20000)}\n\n…（已截断，原文 ${text.length} 字符）` : text
      return { ok: true, task, file: name, path: target, content: capped }
    },
  }

  return {
    officer: [specAsk, specStart, specWrite, specDeclare, specLint, specFinish, specRead],
    executor: [specCheck, specReport, specRead],
    reviewer: [specRead],
  }
}
