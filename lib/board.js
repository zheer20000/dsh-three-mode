/**
 * 看板数据：只读扫 交付根目录 下每个任务的 00-交接.json。
 *
 * 不碰文件内容以外的任何东西，不修正、不迁移、不猜测坏文件。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { HANDOFF_FILE, SPEC_FILES } from './store.js'

/** ISO 字符串转毫秒，非法返回 null。 */
function deadlineMs(value) {
  if (typeof value !== 'string') return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

/** 一个任务的摘要。 */
function summarize(task, handoff, stats) {
  const acceptance = Array.isArray(handoff.acceptance) ? handoff.acceptance : []
  const passed = acceptance.filter((item) => item && item.result === 'passed').length
  const failed = acceptance.filter((item) => item && item.result === 'failed').length
  return {
    task,
    status: typeof handoff.status === 'string' ? handoff.status : 'unknown',
    spec_hash: typeof handoff.spec_hash === 'string' ? handoff.spec_hash : '',
    spec_by: handoff.spec_by ?? null,
    exec_by: handoff.exec_by ?? null,
    review_by: handoff.review_by ?? null,
    acceptance_total: acceptance.length,
    acceptance_passed: passed,
    acceptance_failed: failed,
    interview_rounds: Array.isArray(handoff.interview) ? handoff.interview.length : 0,
    gate_open: handoff.gate?.open === true,
    assumptions_total: Array.isArray(handoff.assumptions) ? handoff.assumptions.length : 0,
    non_goals_total: Array.isArray(handoff.non_goals) ? handoff.non_goals.length : 0,
    deadline: typeof handoff.deadline === 'string' ? handoff.deadline : null,
    deadline_ms: deadlineMs(handoff.deadline),
    updated_at: stats?.mtimeMs ?? null,
    readable: true,
    error: null,
  }
}

/**
 * 扫描任务目录。
 * @param {string} specRoot
 * @returns {Promise<{root: string, tasks: any[], scanned_at: number}>}
 */
export async function listTasks(specRoot) {
  const tasks = []
  let entries = []
  try {
    entries = await fs.readdir(specRoot, { withFileTypes: true })
  } catch {
    return { root: specRoot, tasks: [], scanned_at: Date.now(), error: '无法读取目录' }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(specRoot, entry.name)
    const handoffPath = path.join(dir, HANDOFF_FILE)
    let text
    let stats
    try {
      stats = await fs.stat(handoffPath)
      text = await fs.readFile(handoffPath, 'utf8')
    } catch {
      continue // 没有交接文件的目录不算任务
    }
    let handoff
    try {
      handoff = JSON.parse(text)
    } catch {
      tasks.push({
        task: entry.name, status: 'broken', spec_hash: '', spec_by: null, exec_by: null, review_by: null,
        acceptance_total: 0, acceptance_passed: 0, acceptance_failed: 0, interview_rounds: 0, gate_open: false, assumptions_total: 0, non_goals_total: 0,
        deadline: null, deadline_ms: null,
        updated_at: stats.mtimeMs, readable: false, error: '00-交接.json 解析失败',
      })
      continue
    }
    if (handoff === null || typeof handoff !== 'object') continue
    tasks.push(summarize(entry.name, handoff, stats))
  }
  tasks.sort((a, b) => {
    const ad = a.deadline_ms
    const bd = b.deadline_ms
    if (ad === null && bd === null) return (b.updated_at ?? 0) - (a.updated_at ?? 0)
    if (ad === null) return 1
    if (bd === null) return -1
    return ad - bd
  })
  return { root: specRoot, tasks, scanned_at: Date.now(), files: SPEC_FILES.map(([, name]) => name) }
}
