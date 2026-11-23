// v1.1 新逻辑自测：deadline、打回熔断、冻结、git 提交、看板按紧急度排序。
import fs from 'node:fs/promises'
import path from 'node:path'
import { createTools } from './lib/tools.js'
import { reviewTask } from './lib/review.js'
import { readHandoff, writeHandoff, INTERVENTION_FILE } from './lib/store.js'
import { listTasks } from './lib/board.js'
import { commitAccepted } from './lib/git.js'

const root = path.resolve('_tmp_v11')
await fs.rm(root, { recursive: true, force: true })
await fs.mkdir(root, { recursive: true })

const { officer, executor } = createTools(root)
const by = (list, name) => list.find((t) => t.name === name)
const call = async (tool, args) => tool.execute(args, {})

let failed = 0
const expect = (label, condition) => {
  console.log((condition ? 'PASS' : 'FAIL') + '  ' + label)
  if (!condition) failed += 1
}

// 1. deadline 落盘
const created = await call(by(officer, 'spec_start'), { task: '熔断测试任务', deadline: '2026-11-25T18:00:00+08:00' })
expect('spec_start 带 deadline 建任务', created.ok === true)
let h = await readHandoff(root, '熔断测试任务')
expect('deadline 落盘为 ISO', typeof h.deadline === 'string' && h.deadline.startsWith('2026-11-25'))

// 准备 reviewing 状态任务
const T = '熔断测试任务'
await call(by(officer, 'spec_ask'), { task: T, questions: [{ question: '给谁用？', my_default: '自己' }] })
await fs.writeFile(path.join(root, T, '001-requirements.md'), '# 需求\n')
await fs.writeFile(path.join(root, T, '002-plan.md'), '# 计划\n')
await fs.writeFile(path.join(root, T, '003-materials.md'), '# 材料\n')
await writeHandoff(root, T, {
  ...(await readHandoff(root, T)),
  spec_hash: 'sha256:xxx', status: 'reviewing', exec_by: 'spec-exec',
  acceptance: [{ id: 'A1', text: 'a', check: 'b', result: 'passed' }],
})

// 2. 打回熔断：1、2、3 次 rejected，第 4 次 frozen
let r
for (let i = 1; i <= 3; i++) {
  r = await reviewTask(root, { task: T, decision: 'rejected' })
  expect('第 ' + i + ' 次打回 rejected', r.ok === true && r.status === 'rejected' && r.rejections === i)
  await writeHandoff(root, T, { ...(await readHandoff(root, T)), status: 'reviewing' })
}
r = await reviewTask(root, { task: T, decision: 'rejected' })
expect('第 4 次打回 frozen', r.ok === true && r.status === 'frozen')

h = await readHandoff(root, T)
expect('冻结后状态 frozen', h.status === 'frozen')
const note = await fs.readFile(path.join(root, T, INTERVENTION_FILE), 'utf8').catch(() => null)
expect('生成人类介入单', typeof note === 'string' && note.includes('人类介入单'))

// 3. frozen 阻断跳转
const checkFrozen = await call(by(executor, 'spec_check'), { task: T })
expect('frozen 后 spec_check 被拒', checkFrozen.ok === false)
const content = ['# 结果', '', '## 给人类的验收摘要', '', '全部做完，双击验收指南能看到完整结果，每一项都验证过没有遗留问题可以直接交付。'].join('\n')
const reportFrozen = await call(by(executor, 'spec_report'), { task: T, content, results: [{ id: 'A1', result: 'passed' }] })
expect('frozen 后 spec_report 被拒', reportFrozen.ok === false)

// 4. 看板按紧急度排序
await call(by(officer, 'spec_start'), { task: '紧急任务甲', deadline: '2026-11-23T00:00:00+08:00' })
await call(by(officer, 'spec_start'), { task: '不紧急任务乙', deadline: '2026-12-31T00:00:00+08:00' })
await call(by(officer, 'spec_start'), { task: '无截止任务丙' })
const board = await listTasks(root)
const names = board.tasks.map((t) => t.task)
const ai = names.indexOf('紧急任务甲')
const bi = names.indexOf('不紧急任务乙')
const ci = names.indexOf('无截止任务丙')
expect('最紧急排最前', ai < bi && ai < ci)
expect('无截止排最后', ci > ai && ci > bi)

// 5. git 提交
const gitRoot = path.resolve('_tmp_v11_git')
await fs.rm(gitRoot, { recursive: true, force: true })
await fs.mkdir(path.join(gitRoot, '某任务'), { recursive: true })
await fs.writeFile(path.join(gitRoot, '某任务', '00-交接.json'), JSON.stringify({ task: '某任务', status: 'accepted' }), 'utf8')
const g = await commitAccepted(gitRoot, '某任务')
expect('git commit 成功', g.ok === true)
const hasGit = await fs.stat(path.join(gitRoot, '.git')).then(() => true).catch(() => false)
expect('.git 已生成', hasGit === true)

await fs.rm(root, { recursive: true, force: true })
await fs.rm(gitRoot, { recursive: true, force: true })
console.log('\nRESULT:', failed === 0 ? 'ALL PASS' : (failed + ' FAILED'))
process.exit(failed === 0 ? 0 : 1)
