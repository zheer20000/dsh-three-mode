/**
 * 访谈闸门：只有人能在看板上打开它。
 *
 * 规格官在闸门打开前写不了 001-003，也封不了版——这不是提示词约束，是工具拒绝。
 * 打开闸门的条件：状态还在 drafting/rejected，且至少记录过一轮提问（spec_ask）。
 */
import { readHandoff, validateTask, writeHandoff } from './store.js'

/**
 * @param {string} specRoot
 * @param {{task: unknown, by?: string}} input
 * @returns {Promise<{ok: true, task: string, rounds: number, gate_open: true} | {ok: false, code: string, error: string}>}
 */
export async function openGate(specRoot, input) {
  const checked = validateTask(input?.task)
  if (!checked.ok) return { ok: false, code: 'INVALID_TASK', error: checked.error }
  const task = checked.task

  const handoff = await readHandoff(specRoot, task)
  if (handoff === null) {
    return { ok: false, code: 'NO_HANDOFF', error: `任务不存在或 00-交接.json 缺失/损坏：${task}` }
  }
  if (handoff.status !== 'drafting' && handoff.status !== 'rejected') {
    return { ok: false, code: 'WRONG_STATUS', error: `当前状态是 ${handoff.status}，只有 drafting / rejected 能确认封装` }
  }

  const rounds = Array.isArray(handoff.interview) ? handoff.interview.length : 0
  if (rounds === 0) {
    return { ok: false, code: 'NO_INTERVIEW', error: '规格官还没记录过任何提问，不能确认封装' }
  }

  if (handoff.gate?.open === true) {
    return { ok: true, task, rounds, gate_open: true }
  }

  const by = typeof input?.by === 'string' && input.by.trim() ? input.by.trim() : 'user'
  await writeHandoff(specRoot, task, {
    ...handoff,
    gate: { open: true, by, at: Date.now() },
  })
  return { ok: true, task, rounds, gate_open: true }
}
