// 离线自测：不碰真实 SPEC_ROOT，全部在 _tmp_specflow 下跑。
import fs from 'node:fs/promises'
import path from 'node:path'
import { createTools } from './lib/tools.js'
import { readHandoff, specHash, writeHandoff } from './lib/store.js'
import { reviewTask } from './lib/review.js'
import { openGate } from './lib/gate.js'

const root = path.resolve('_tmp_specflow')
await fs.rm(root, { recursive: true, force: true })
await fs.mkdir(root, { recursive: true })

const { officer, executor } = createTools(root)
const by = (list, name) => list.find((tool) => tool.name === name)
const call = async (tool, args) => tool.execute(args, {})
const log = (label, value) => console.log(`\n### ${label}\n${JSON.stringify(value, null, 2)}`)

let failed = 0
const expect = (label, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`)
  if (!condition) failed += 1
}

// 1. 任务名校验
log('bad task short', await call(by(officer, 'spec_start'), { task: '短名' }))
log('bad task space', await call(by(officer, 'spec_start'), { task: '有 空格的任务名字' }))

// 2. 建任务
const created = await call(by(officer, 'spec_start'), { task: '会话看板插件第一版' })
log('create', created)
expect('create ok', created.ok === true)

const again = await call(by(officer, 'spec_start'), { task: '会话看板插件第一版' })
expect('duplicate rejected', again.ok === false)

// 2.5 闸门：没访谈不能确认，没确认不能写
const T0 = '会话看板插件第一版'
const blockedWrite = await call(by(officer, 'spec_write'), { task: T0, file: 'requirements', content: '# x\n' })
log('write before gate', blockedWrite)
expect('gate 关闭时写文件被拒', blockedWrite.ok === false)

const noRounds = await openGate(root, { task: T0 })
expect('没访谈不能确认', noRounds.ok === false && noRounds.code === 'NO_INTERVIEW')

const asked = await call(by(officer, 'spec_ask'), {
  task: T0,
  questions: [{ question: '这东西给谁用？', my_default: '只给你自己用' }],
})
log('ask', asked)
expect('spec_ask 记录一轮', asked.ok === true && asked.rounds === 1)

const stillBlocked = await call(by(officer, 'spec_write'), { task: T0, file: 'requirements', content: '# x\n' })
expect('有访谈但没确认仍然写不了', stillBlocked.ok === false)

const opened = await openGate(root, { task: T0 })
expect('人点确认后闸门打开', opened.ok === true && opened.gate_open === true)

// 3. 还没写文件时 lint 应该失败
const early = await call(by(officer, 'spec_lint'), { task: '会话看板插件第一版' })
log('lint before write', early)
expect('lint before write fails', early.ok === false)

// 4. 写三件套
for (const [file, body] of [
  ['requirements', '# 需求\n\n要一个看板。\n\n## 验收标准\n\nA1 …\n'],
  ['plan', '# 计划\n\n| T1 | 做一件事 | 看输出 |\n'],
  ['materials', '# 材料\n\n- cordis.patch.yml 只读\n'],
]) {
  const written = await call(by(officer, 'spec_write'), { task: '会话看板插件第一版', file, content: body })
  expect(`write ${file}`, written.ok === true)
}
const wrongFile = await call(by(officer, 'spec_write'), { task: '会话看板插件第一版', file: 'result', content: 'x' })
expect('write result rejected', wrongFile.ok === false)

// 5. 登记验收 / 假设 / 非目标
const declared = await call(by(officer, 'spec_declare'), {
  task: '会话看板插件第一版',
  acceptance: [{ text: '点图标能打开页面', check: '点左栏图标，中央出现看板且标题正确' }],
  assumptions: [{ text: '只装 desktop profile', state: 'assumed' }],
  non_goals: ['不做自动串联会话'],
})
log('declare', declared)
expect('declare lint ok', declared.lint?.ok === true)

// 6. 坏数据被 lint 抓到
const bad = await call(by(officer, 'spec_declare'), {
  task: '会话看板插件第一版',
  acceptance: [{ text: '没有判定方式' }],
  assumptions: [{ text: '没标注' }],
  non_goals: [],
})
log('lint bad', bad.lint)
expect('lint catches 3 problems', bad.lint?.issues?.length >= 3)

// 恢复
await call(by(officer, 'spec_declare'), {
  task: '会话看板插件第一版',
  acceptance: [{ text: '点图标能打开页面', check: '点左栏图标，中央出现看板且标题正确' }],
  assumptions: [{ text: '只装 desktop profile', state: 'assumed' }],
  non_goals: ['不做自动串联会话'],
})

// 7. 封版
const finished = await call(by(officer, 'spec_finish'), { task: '会话看板插件第一版' })
log('finish', finished)
expect('finish ok', finished.ok === true && finished.status === 'spec_ready')
const handoff = await readHandoff(root, '会话看板插件第一版')
expect('hash recorded', /^sha256:[0-9a-f]{64}$/.test(handoff.spec_hash))

// 8. 执行者检查通过
const checked = await call(by(executor, 'spec_check'), { task: '会话看板插件第一版' })
log('check', { ok: checked.ok, status: checked.status, files: checked.files })
expect('check ok', checked.ok === true)

// 9. 改 001 后被拒绝
await call(by(officer, 'spec_write'), { task: '会话看板插件第一版', file: 'requirements', content: '# 需求改过\n\n多了一行。\n' })
const changed = await call(by(executor, 'spec_check'), { task: '会话看板插件第一版' })
log('check after edit', changed)
expect('hash mismatch rejected', changed.ok === false && changed.reason === 'spec_changed')

// 10. 交结果：必须先有人类可读的摘要，再逐条给 results
const T = '会话看板插件第一版'
const RESULT_OK = `# 结果：会话看板

## 给人类的验收摘要

**一句话结论**：按钮能用，点了会打开看板。

**它到底做了什么**：在看板上加了一个按钮，点开中央面板能看到任务列表和状态。

**你怎么自己验证**：打开 交付目录\\会话看板插件第一版\\004-result.md，能看到这份摘要和三行结论。

**没做成的部分**：没有

## 逐条验收对照

| A1 | ✅ | 点图标看到了列表 |
`

const noSummary = await call(by(executor, 'spec_report'), {
  task: T, content: '# 结果\n\n| A1 | ✅ |\n', results: [{ id: 'A1', result: 'passed' }],
})
log('report without summary', { ok: noSummary.ok, error: noSummary.error })
expect('缺人类摘要被拒', noSummary.ok === false && typeof noSummary.template === 'string')

const thinSummary = await call(by(executor, 'spec_report'), {
  task: T, content: '# 结果\n\n## 给人类的验收摘要\n\n做完了\n', results: [{ id: 'A1', result: 'passed' }],
})
expect('摘要太空被拒', thinSummary.ok === false)

const noResults = await call(by(executor, 'spec_report'), { task: T, content: RESULT_OK })
log('report without results', noResults)
expect('缺 results 被拒', noResults.ok === false)

const emptyResults = await call(by(executor, 'spec_report'), { task: T, content: RESULT_OK, results: [] })
log('report empty results', { ok: emptyResults.ok, missing: emptyResults.missing })
expect('空数组被拒且列出缺失', emptyResults.ok === false && Array.isArray(emptyResults.missing) && emptyResults.missing.length === 1)

const badReason = await call(by(executor, 'spec_report'), { task: T, content: RESULT_OK, results: [{ id: 'A1', result: 'failed' }] })
expect('failed 无 reason 被拒', badReason.ok === false)

const badId = await call(by(executor, 'spec_report'), { task: T, content: RESULT_OK, results: [{ id: 'A9', result: 'passed' }] })
expect('未知 id 被拒', badId.ok === false)

const reported = await call(by(executor, 'spec_report'), {
  task: T,
  content: RESULT_OK,
  results: [{ id: 'A1', result: 'passed' }],
})
log('report', reported)
expect('report ok', reported.ok === true && reported.status === 'reviewing' && reported.passed === 1)

const hReported = await readHandoff(root, T)
expect('结果写进交接', hReported.acceptance[0].result === 'passed')

// 11. 验收规则
const selfReview = await reviewTask(root, { task: T, decision: 'accepted', reviewBy: 'spec-exec' })
expect('自己验收被拒', selfReview.ok === false && selfReview.code === 'SELF_REVIEW')

const acceptedReview = await reviewTask(root, { task: T, decision: 'accepted' })
expect('验收通过', acceptedReview.ok === true && acceptedReview.status === 'accepted')

const twice = await reviewTask(root, { task: T, decision: 'rejected' })
expect('非 reviewing 不能再验收', twice.ok === false && twice.code === 'WRONG_STATUS')

// 12. 打回后重新封版
await writeHandoff(root, T, { ...(await readHandoff(root, T)), status: 'reviewing' })
const rejectedReview = await reviewTask(root, { task: T, decision: 'rejected' })
expect('打回', rejectedReview.ok === true && rejectedReview.status === 'rejected')

const reseal = await call(by(officer, 'spec_finish'), { task: T })
log('reseal', { ok: reseal.ok, status: reseal.status })
expect('退回后能重新封版', reseal.ok === true && reseal.status === 'spec_ready')

const hResealed = await readHandoff(root, T)
expect('重新封版清空旧结果', hResealed.acceptance.every((a) => a.result === undefined))
expect('hash 已更新', hResealed.spec_hash !== hReported.spec_hash)

const finalLint = await call(by(officer, 'spec_lint'), { task: T })
log('final lint', { ok: finalLint.ok, issues: finalLint.issues })
expect('重新封版后 lint 通过', finalLint.ok === true)

const output = await call(by(officer, 'spec_read'), { task: '会话看板插件第一版', file: 'result' })
expect('read result', output.ok === true)
console.log('\nRESULT:', failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
