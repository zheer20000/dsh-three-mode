// 看板接口的离线自测：不启动 DSH，用假的 ctx 跑一遍 apply 捕获两个路由。
import fs from 'node:fs/promises'
import path from 'node:path'
import { apply } from './index.js'
import { readHandoff } from './lib/store.js'

const root = path.resolve('_tmp_board')
await fs.rm(root, { recursive: true, force: true })
await fs.mkdir(path.join(root, '任务甲测试'), { recursive: true })
await fs.mkdir(path.join(root, '任务乙测试'), { recursive: true })
await fs.mkdir(path.join(root, '没有交接的目录'), { recursive: true })
await fs.writeFile(path.join(root, '任务甲测试', '00-交接.json'), JSON.stringify({
  task: '任务甲测试',
  status: 'reviewing',
  spec_hash: 'sha256:abcdef0123456789',
  spec_by: 'spec-officer',
  exec_by: 'spec-exec',
  review_by: null,
  acceptance: [
    { id: 'A1', text: 'a', check: 'b', result: 'passed' },
    { id: 'A2', text: 'c', check: 'd', result: 'failed', reason: '没跑通' },
  ],
  assumptions: [{ id: 'S1', text: 'x', state: 'assumed' }],
  non_goals: ['不做 y'],
}), 'utf8')
await fs.writeFile(path.join(root, '任务乙测试', '00-交接.json'), '{ 这不是 JSON', 'utf8')
await fs.mkdir(path.join(root, '任务丙测试'), { recursive: true })
await fs.writeFile(path.join(root, '任务丙测试', '00-交接.json'), JSON.stringify({
  task: '任务丙测试', status: 'drafting', spec_hash: '', spec_by: 'spec-officer',
  exec_by: null, review_by: null, acceptance: [], assumptions: [], non_goals: [],
  interview: [{ round: 1, questions: [{ id: 'Q1.1', question: '给谁用？', my_default: '你自己' }], at: 1 }],
  gate: { open: false, by: null, at: null },
}), 'utf8')
await fs.mkdir(path.join(root, '任务丁测试'), { recursive: true })
await fs.writeFile(path.join(root, '任务丁测试', '00-交接.json'), JSON.stringify({
  task: '任务丁测试', status: 'drafting', spec_hash: '', spec_by: 'spec-officer',
  exec_by: null, review_by: null, acceptance: [], assumptions: [], non_goals: [],
  interview: [], gate: { open: false, by: null, at: null },
}), 'utf8')

const routes = new Map()
const disposers = []
const fakeCtx = {
  on: () => () => {},
  effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return d },
  get: () => undefined,
  inject: (names, callback) => {
    callback({
      effect: fakeCtx.effect,
      webServer: { register: (route) => { routes.set(route.path, route); return () => {} } },
    })
  },
}

apply(fakeCtx, { specRoot: root })

let failed = 0
const expect = (label, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`)
  if (!condition) failed += 1
}

const board = routes.get('/spec-flow/board')
const review = routes.get('/spec-flow/review')
expect('注册了 board 路由', board?.kind === 'exact')
expect('注册了 review 路由', review?.kind === 'exact')

/** 调一次 handler，收集状态码和响应体。 */
async function hit(route, req) {
  const chunks = []
  const res = {
    writeHead(code, headers) { this.code = code; this.headers = headers },
    end(body) { chunks.push(String(body ?? '')) },
  }
  await route.handler(req, res)
  const text = chunks.join('')
  let json
  try { json = JSON.parse(text) } catch { json = undefined }
  return { code: res.code, json, text }
}

const listed = await hit(board, { method: 'GET' })
const names = (listed.json?.tasks ?? []).map((t) => t.task)
const first = (listed.json?.tasks ?? []).find((t) => t.task === '任务甲测试')
console.log(JSON.stringify(first, null, 2))
expect('200', listed.code === 200)
expect('root 原样返回', listed.json?.root === root)
expect('忽略没有交接文件的目录', !names.includes('没有交接的目录'))
expect('坏 JSON 标 broken', listed.json?.tasks.find((t) => t.task === '任务乙测试')?.status === 'broken')
expect('passed 计数', first?.acceptance_passed === 1)
expect('failed 计数', first?.acceptance_failed === 1)
expect('总数', first?.acceptance_total === 2)

expect('GET board POST 405', (await hit(board, { method: 'POST' })).code === 405)
expect('review GET 405', (await hit(review, { method: 'GET' })).code === 405)

const postBody = (value) => ({
  method: 'POST',
  async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(value)) },
})

const badDecision = await hit(review, postBody({ task: '任务甲测试', decision: 'whatever' }))
expect('非法 decision 被拒', badDecision.code === 409 && badDecision.json?.code === 'INVALID_DECISION')

// 默认验收人是 user，与 exec_by 的 spec-exec 不同，所以能过
const accepted = await hit(review, postBody({ task: '任务甲测试', decision: 'accepted' }))
console.log(JSON.stringify(accepted.json))
expect('验收通过', accepted.code === 200 && accepted.json?.status === 'accepted')
const handoff = await readHandoff(root, '任务甲测试')
expect('review_by 落盘', handoff?.review_by === 'user')
expect('状态落盘', handoff?.status === 'accepted')

const again = await hit(review, postBody({ task: '任务甲测试', decision: 'rejected' }))
expect('非 reviewing 不能再验收', again.code === 409 && again.json?.code === 'WRONG_STATUS')

// 确认闸门
const gate = routes.get('/spec-flow/confirm')
expect('注册了 confirm 路由', gate?.kind === 'exact')

const noInterview = await hit(gate, postBody({ task: '任务丁测试' }))
expect('没访谈不能确认', noInterview.code === 409 && noInterview.json?.code === 'NO_INTERVIEW')

const confirmed = await hit(gate, postBody({ task: '任务丙测试' }))
console.log(JSON.stringify(confirmed.json))
expect('确认成功', confirmed.code === 200 && confirmed.json?.gate_open === true)
const done = await readHandoff(root, '任务丙测试')
expect('gate 落盘', done?.gate?.open === true && done?.gate?.by === 'user')

const confirmAgain = await hit(gate, postBody({ task: '任务丙测试' }))
expect('重复确认不报错', confirmAgain.code === 200)

const listedAgain = await hit(board, { method: 'GET' })
const bing = (listedAgain.json?.tasks ?? []).find((t) => t.task === '任务丙测试')
expect('看板带出访谈轮数', bing?.interview_rounds === 1)
expect('看板带出闸门状态', bing?.gate_open === true)

for (const dispose of disposers) dispose()
await fs.rm(root, { recursive: true, force: true })
console.log('\nRESULT:', failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
