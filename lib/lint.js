/**
 * spec_lint：只查形式，不查内容。
 *
 * v1 的五条规则：
 *   files_present    001/002/003 都在且非空
 *   acceptance_check 每条验收都有可执行的 check（判定方式）
 *   assumption_state 每条假设都标了 confirmed 或 assumed
 *   non_goals        非目标至少一条且非空
 *   hash_current     交接里的 spec_hash 与当前三件套一致（drafting 阶段允许为空）
 *
 * 这里不判断"验收标准是否真的可测"，那需要人。这里只判断它有没有写判定方式。
 */
import path from 'node:path'
import { readHandoff, readText, specHash, SPEC_FILES, taskDir } from './store.js'

/** 构造一条问题。 */
function issue(rule, message) {
  return { rule, message }
}

/** 非空字符串。 */
function isText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * 跑五条规则。
 * @param {string} specRoot
 * @param {string} task
 * @returns {Promise<{ok: boolean, issues: Array<{rule: string, message: string}>, counts: Record<string, number>}>}
 */
export async function lint(specRoot, task) {
  const issues = []
  const counts = { files: 0, acceptance: 0, assumptions: 0, non_goals: 0 }

  // 1. 三件套齐全且非空
  for (const [, name] of SPEC_FILES) {
    const text = await readText(path.join(taskDir(specRoot, task), name))
    if (text === null) {
      issues.push(issue('files_present', `缺少 ${name}`))
      continue
    }
    if (text.trim().length === 0) {
      issues.push(issue('files_present', `${name} 是空文件`))
      continue
    }
    counts.files += 1
  }

  const handoff = await readHandoff(specRoot, task)
  if (handoff === null) {
    issues.push(issue('files_present', '缺少或损坏 00-交接.json'))
    return { ok: false, issues, counts }
  }

  // 2. 验收条目
  const acceptance = Array.isArray(handoff.acceptance) ? handoff.acceptance : []
  counts.acceptance = acceptance.length
  if (acceptance.length === 0) {
    issues.push(issue('acceptance_check', '没有验收条目'))
  }
  acceptance.forEach((item, index) => {
    const label = isText(item?.id) ? item.id : `#${index + 1}`
    if (!isText(item?.text)) issues.push(issue('acceptance_check', `验收 ${label} 缺少 text`))
    if (!isText(item?.check) || item.check.trim().length < 4) {
      issues.push(issue('acceptance_check', `验收 ${label} 缺少判定方式（check），换个人照着做无法判定过/不过`))
    }
  })

  // 3. 假设标注
  const assumptions = Array.isArray(handoff.assumptions) ? handoff.assumptions : []
  counts.assumptions = assumptions.length
  assumptions.forEach((item, index) => {
    const label = isText(item?.id) ? item.id : `#${index + 1}`
    if (item?.state !== 'confirmed' && item?.state !== 'assumed') {
      issues.push(issue('assumption_state', `假设 ${label} 没有标注 confirmed 或 assumed`))
    }
    if (!isText(item?.text)) issues.push(issue('assumption_state', `假设 ${label} 缺少 text`))
  })

  // 4. 非目标
  const nonGoals = Array.isArray(handoff.non_goals) ? handoff.non_goals : []
  counts.non_goals = nonGoals.filter(isText).length
  if (counts.non_goals === 0) {
    issues.push(issue('non_goals', '非目标为空；不写非目标，执行方就会顺手加功能'))
  }
  nonGoals.forEach((text, index) => {
    if (!isText(text)) issues.push(issue('non_goals', `非目标第 ${index + 1} 条为空`))
  })

  // 5. hash 一致。未封版（drafting）和已退回（rejected）不比对：
  //    这两种状态下 001-003 允许被改，hash 由 spec_finish 重新算。
  const current = await specHash(specRoot, task)
  const declared = typeof handoff.spec_hash === 'string' ? handoff.spec_hash : ''
  const sealed = handoff.status === 'spec_ready' || handoff.status === 'executing'
    || handoff.status === 'reviewing' || handoff.status === 'accepted'
  if (sealed && declared !== current.hash) {
    issues.push(issue('hash_current', `交接里的 spec_hash 与当前 001-003 不一致（交接 ${declared || '空'}，当前 ${current.hash}）`))
  }

  return { ok: issues.length === 0, issues, counts }
}
