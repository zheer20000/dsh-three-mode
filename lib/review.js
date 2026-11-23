/**
 * 验收动作：reviewing -> accepted | rejected | frozen。
 *   - accepted 写 review_by，review_by ≠ exec_by；通过后自动 git commit。
 *   - rejected 计数，打回超过 MAX_REJECTIONS 次直接冻结 + 生成人类介入单。
 */
import path from 'node:path'
import { commitAccepted } from './git.js'
import {
  canTransition, INTERVENTION_FILE, MAX_REJECTIONS, readHandoff, taskDir,
  validateTask, writeAtomic, writeHandoff,
} from './store.js'

async function writeIntervention(specRoot, task, handoff) {
  const acceptance = Array.isArray(handoff.acceptance) ? handoff.acceptance : []
  const rows = acceptance.map((item) => {
    const id = typeof item?.id === 'string' ? item.id : ''
    const reason = item?.result === 'failed' && typeof item.reason === 'string' && item.reason ? '：' + item.reason : ''
    const state = item?.result === 'passed' ? '✅ 通过'
      : item?.result === 'failed' ? '❌ 未通过' + reason
        : '— 未判定'
    return '| ' + (id || '—') + ' | ' + state + ' |'
  })
  const body = [
    '# 人类介入单：' + task,
    '',
    '> 自动生成于 ' + new Date().toISOString() + '。打回重做超过 ' + MAX_REJECTIONS + ' 次，任务已冻结，停止自动重做。',
    '',
    '## 为什么冻结',
    '- 执行者反复被打回，机器判断到上限，继续自动重做只会烧 Token。',
    '- 需要人直接看代码和 004-result.md，决定下一步：手动修 / 改需求 / 放弃。',
    '',
    '## 当前验收状态',
    '',
    '| 编号 | 结论 |',
    '| --- | --- |',
    ...rows,
    '',
    '- 打回次数：' + (typeof handoff.rejections === 'number' ? handoff.rejections : 0),
    '- 执行者：' + (typeof handoff.exec_by === 'string' ? handoff.exec_by : '未知'),
    '- 最后验收人：' + (typeof handoff.review_by === 'string' ? handoff.review_by : '未知'),
    '',
  ]
  await writeAtomic(path.join(taskDir(specRoot, task), INTERVENTION_FILE), body.join('\n'))
}

export async function reviewTask(specRoot, input) {
  const checked = validateTask(input?.task)
  if (!checked.ok) return { ok: false, code: 'INVALID_TASK', error: checked.error }
  const task = checked.task

  const decision = input?.decision
  if (decision !== 'accepted' && decision !== 'rejected') {
    return { ok: false, code: 'INVALID_DECISION', error: 'decision 只能是 accepted 或 rejected' }
  }

  const handoff = await readHandoff(specRoot, task)
  if (handoff === null) {
    return { ok: false, code: 'NO_HANDOFF', error: '任务不存在或 00-交接.json 缺失/损坏：' + task }
  }
  if (handoff.status !== 'reviewing') {
    return { ok: false, code: 'WRONG_STATUS', error: '当前状态是 ' + handoff.status + '，只有 reviewing 能验收' }
  }

  const reviewBy = typeof input?.reviewBy === 'string' && input.reviewBy.trim() ? input.reviewBy.trim() : 'user'
  const execBy = typeof handoff.exec_by === 'string' ? handoff.exec_by : ''
  if (execBy && reviewBy === execBy) {
    return { ok: false, code: 'SELF_REVIEW', error: '验收人不能等于执行者（都是 ' + execBy + '）' }
  }

  if (decision === 'rejected') {
    const rejections = typeof handoff.rejections === 'number' ? handoff.rejections : 0
    if (rejections >= MAX_REJECTIONS) {
      const frozen = { ...handoff, status: 'frozen', rejections, frozen_at: Date.now(), review_by: reviewBy }
      await writeHandoff(specRoot, task, frozen)
      await writeIntervention(specRoot, task, frozen)
      return { ok: true, task, status: 'frozen', rejections, note: '打回超过 ' + MAX_REJECTIONS + ' 次，已冻结并生成人类介入单' }
    }
    const next = rejections + 1
    await writeHandoff(specRoot, task, { ...handoff, status: 'rejected', rejections: next, review_by: reviewBy })
    return { ok: true, task, status: 'rejected', rejections: next, remaining: MAX_REJECTIONS - next }
  }

  if (!canTransition('reviewing', 'accepted')) {
    return { ok: false, code: 'WRONG_STATUS', error: '状态机不允许 reviewing -> accepted' }
  }
  await writeHandoff(specRoot, task, { ...handoff, status: 'accepted', review_by: reviewBy })
  const git = await commitAccepted(specRoot, task)
  return { ok: true, task, status: 'accepted', review_by: reviewBy, git }
}
