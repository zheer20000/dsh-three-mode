/**
 * 文件契约与状态机：spec-flow 的唯一事实来源。
 *
 * 这里不做任何模型侧判断，只负责：路径拼装、任务名校验、三件套 hash、
 * 交接文件读写、状态流转的合法性。
 *
 * 目录约定：
 *   <SPEC_FLOW_ROOT>\<任务名>\
 *     00-交接.json
 *     001-requirements.md
 *     002-plan.md
 *     003-materials.md
 *     004-result.md
 *
 * 状态机（只允许这些跳转，且每一跳由外部显式触发）：
 *   drafting -> spec_ready -> executing -> reviewing -> accepted | rejected
 *   rejected -> spec_ready
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

/** 交付目录。由 SPEC_FLOW_ROOT 环境变量决定，缺省为 ~/dsh-spec-flow。任何工具调用都不得传入其他根目录。 */
export const SPEC_ROOT = process.env.SPEC_FLOW_ROOT || path.join(os.homedir(), 'dsh-spec-flow')

/** 三件套。顺序固定，hash 依赖这个顺序。 */
export const SPEC_FILES = [
  ['requirements', '001-requirements.md'],
  ['plan', '002-plan.md'],
  ['materials', '003-materials.md'],
]

/** 执行产物。不进 hash。 */
export const RESULT_FILE = '004-result.md'

/** 交接文件。 */
export const HANDOFF_FILE = '00-交接.json'

/** 打回重做熔断：超过这个次数直接冻结，不再烧 Token。 */
export const MAX_REJECTIONS = 3

/** 冻结时生成的人类介入单。 */
export const INTERVENTION_FILE = '005-人类介入单.md'

/** 合法状态。 */
export const STATUSES = ['drafting', 'spec_ready', 'executing', 'reviewing', 'accepted', 'rejected', 'frozen']

/** 允许的跳转。空数组表示终态。 */
export const TRANSITIONS = {
  drafting: ['spec_ready'],
  spec_ready: ['executing'],
  executing: ['reviewing'],
  reviewing: ['accepted', 'rejected', 'frozen'],
  rejected: ['spec_ready'],
  accepted: [],
  frozen: [],
}

/** 交接文件固定字段。少一个就是坏文件，多一个不算错。 */
export const HANDOFF_FIELDS = [
  'task', 'spec_hash', 'status', 'spec_by', 'exec_by', 'review_by',
  'acceptance', 'assumptions', 'non_goals', 'deadline', 'rejections',
]

const TASK_MIN = 4
const TASK_MAX = 20
/** 汉字、字母、数字、下划线、连字符；不含空格、点、路径分隔符。 */
const TASK_RE = /^[\p{Script=Han}A-Za-z0-9_-]+$/u

/**
 * 校验任务名。
 * @param {unknown} task
 * @returns {{ok: true, task: string} | {ok: false, error: string}}
 */
export function validateTask(task) {
  if (typeof task !== 'string') return { ok: false, error: '任务名必须是字符串' }
  const name = task.trim()
  if (name.length < TASK_MIN || name.length > TASK_MAX) {
    return { ok: false, error: `任务名长度必须是 ${TASK_MIN}-${TASK_MAX} 个字符，当前 ${name.length} 个` }
  }
  if (!TASK_RE.test(name)) {
    return { ok: false, error: '任务名只能包含汉字、字母、数字、下划线、连字符，不能有空格或标点' }
  }
  return { ok: true, task: name }
}

/** 任务目录。 */
export function taskDir(specRoot, task) {
  return path.join(specRoot, task)
}

/** 单文件路径。 */
export function filePath(specRoot, task, key) {
  const entry = SPEC_FILES.find(([k]) => k === key)
  if (!entry) throw new Error(`未知文件 ${key}`)
  return path.join(taskDir(specRoot, task), entry[1])
}

/** 默认根目录下的路径，供工具输出给模型看。 */
export function relOf(specRoot, task, name) {
  return path.join(specRoot, task, name)
}

/** 目录是否存在。 */
export function taskExists(specRoot, task) {
  return existsSync(taskDir(specRoot, task))
}

/** 原子写：先写临时文件再改名，避免半截文件。 */
export async function writeAtomic(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmp, text, 'utf8')
  await fs.rename(tmp, file)
}

/** 读文本，缺失返回 null。 */
export async function readText(file) {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw error
  }
}

/** 读交接文件，缺失或损坏返回 null。 */
export async function readHandoff(specRoot, task) {
  const text = await readText(path.join(taskDir(specRoot, task), HANDOFF_FILE))
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** 写交接文件。 */
export async function writeHandoff(specRoot, task, handoff) {
  await writeAtomic(path.join(taskDir(specRoot, task), HANDOFF_FILE), `${JSON.stringify(handoff, null, 2)}\n`)
}

/**
 * 三件套内容 hash。
 * 文件缺失按空串参与计算，这样"少了一个文件"也会改变 hash。
 * @returns {Promise<{hash: string, missing: string[]}>}
 */
export async function specHash(specRoot, task) {
  const hash = createHash('sha256')
  const missing = []
  for (const [, name] of SPEC_FILES) {
    const text = await readText(path.join(taskDir(specRoot, task), name))
    if (text === null) missing.push(name)
    hash.update(name)
    hash.update('\0')
    hash.update(text ?? '')
    hash.update('\0')
  }
  return { hash: `sha256:${hash.digest('hex')}`, missing }
}

/** 判断一次状态跳转是否合法。 */
export function canTransition(from, to) {
  const allowed = TRANSITIONS[from]
  return Array.isArray(allowed) && allowed.includes(to)
}
