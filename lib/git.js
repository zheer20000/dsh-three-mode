/**
 * 验收通过后自动 git 提交任务目录，保留历史版本。
 * 单仓库放在 SPEC_ROOT 下，只提交该任务名目录；首次自动 init 并写本地 user。
 * 尽力而为：git 缺失或失败不影响验收结果，错误原样返回。
 */
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const TIMEOUT = 15000

function run(args) {
  return execFileP('git', args, { timeout: TIMEOUT, windowsHide: true })
}

async function ensureRepo(specRoot) {
  try {
    const { stdout } = await run(['-C', specRoot, 'rev-parse', '--show-toplevel'])
    const top = (stdout || '').trim()
    if (top && path.resolve(top).toLowerCase() === path.resolve(specRoot).toLowerCase()) return
  } catch {
    /* 不是仓库 */
  }
  await run(['-C', specRoot, 'init'])
  await run(['-C', specRoot, 'config', 'user.email', 'spec-flow@local'])
  await run(['-C', specRoot, 'config', 'user.name', 'spec-flow'])
}

export async function commitAccepted(specRoot, task) {
  try {
    await ensureRepo(specRoot)
    await run(['-C', specRoot, 'add', '--', task])
    const { stdout } = await run(['-C', specRoot, 'commit', '-m', '任务 ' + task + ' 验收通过', '--allow-empty'])
    const lines = (stdout || '').trim().split('\n').filter(Boolean)
    return { ok: true, message: lines.slice(0, 3).join(' | ') }
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) }
  }
}
