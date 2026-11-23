/**
 * dsh-spec-flow 的 Host 半边。
 *
 * 做三件事：
 *   1. 按会话 preset 挂载 spec_* 工具（规格官 6 个、执行者 3 个）；
 *   2. 给看板页提供只读接口 GET /spec-flow/board；
 *   3. 提供验收接口 POST /spec-flow/review（accepted / rejected）。
 *
 * 不做的事：不改 profile、不装插件、不自动开会话。
 */
import { attachTools } from './lib/attach.js'
import { listTasks } from './lib/board.js'
import { openGate } from './lib/gate.js'
import { reviewTask } from './lib/review.js'
import { SPEC_ROOT } from './lib/store.js'
import { createTools } from './lib/tools.js'

export const name = 'dsh-spec-flow'

/** 三个接口都放在同一前缀下，避开 /api 的 RPC 网关。 */
const BOARD_ROUTE = '/spec-flow/board'
const REVIEW_ROUTE = '/spec-flow/review'
const CONFIRM_ROUTE = '/spec-flow/confirm'
const BODY_LIMIT = 64 * 1024

/** 单个模型选择归一化：provider/model 必填，reasoningEffort 可选。 */
function normalizeModel(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  const provider = typeof raw.provider === 'string' && raw.provider.trim() ? raw.provider.trim() : undefined
  const model = typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : undefined
  if (!provider || !model) return undefined
  const selection = { provider, model }
  const effort = typeof raw.reasoningEffort === 'string' && raw.reasoningEffort.trim() ? raw.reasoningEffort.trim() : undefined
  if (effort) selection.reasoningEffort = effort
  return selection
}

/** 各角色默认模型：规格官最强、执行者编码、审查官最便宜的 flash。 */
const DEFAULT_MODELS = {
  officer: { provider: 'deepseek-account', model: 'deepseek-v4-pro' },
  executor: { provider: 'deepseek-account', model: 'deepseek-v4-pro' },
  reviewer: { provider: 'deepseek-account', model: 'deepseek-flash' },
}

/** 配置归一化。 */
function normalize(raw) {
  const config = raw && typeof raw === 'object' ? raw : {}
  const specRoot = typeof config.specRoot === 'string' && config.specRoot.trim() ? config.specRoot.trim() : SPEC_ROOT
  const officer = typeof config.officerPreset === 'string' && config.officerPreset.trim() ? config.officerPreset.trim() : 'spec-officer'
  const executor = typeof config.executorPreset === 'string' && config.executorPreset.trim() ? config.executorPreset.trim() : 'spec-exec'
  const reviewer = typeof config.reviewerPreset === 'string' && config.reviewerPreset.trim() ? config.reviewerPreset.trim() : 'spec-reviewer'
  const reviewBy = typeof config.reviewBy === 'string' && config.reviewBy.trim() ? config.reviewBy.trim() : 'user'
  const cfgModels = config.models && typeof config.models === 'object' ? config.models : {}
  const models = {
    officer: normalizeModel(cfgModels.officer) ?? DEFAULT_MODELS.officer,
    executor: normalizeModel(cfgModels.executor) ?? DEFAULT_MODELS.executor,
    reviewer: normalizeModel(cfgModels.reviewer) ?? DEFAULT_MODELS.reviewer,
  }
  const simpleMode = config.simpleMode === true
  return { specRoot, officer, executor, reviewer, reviewBy, models, simpleMode }
}

/** 写 JSON 响应。 */
function json(res, code, value) {
  const body = JSON.stringify(value)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** 读 JSON 请求体，超限就拒。 */
async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > BODY_LIMIT) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {unknown} rawConfig
 */
export function apply(ctx, rawConfig) {
  const config = normalize(rawConfig)

  attachTools(ctx, {
    tools: createTools(config.specRoot),
    presets: { officer: config.officer, executor: config.executor, reviewer: config.reviewer },
    models: config.models,
  })

  ctx.inject(['webServer'], (scoped) => {
    scoped.effect(() => scoped.webServer.register({
      kind: 'exact',
      path: BOARD_ROUTE,
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET', 'content-type': 'text/plain; charset=utf-8' })
          res.end('method not allowed')
          return
        }
        try {
          json(res, 200, { ...(await listTasks(config.specRoot)), simpleMode: config.simpleMode })
        } catch (error) {
          json(res, 500, { root: config.specRoot, tasks: [], error: String(error?.message ?? error) })
        }
      },
    }), 'dsh-spec-flow: spec board api')

    /** 一个 POST 接口的通用壳：读 JSON、调 handler、按 ok 决定状态码。 */
    const postRoute = (routePath, handle) => {
      scoped.effect(() => scoped.webServer.register({
        kind: 'exact',
        path: routePath,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' })
            res.end('method not allowed')
            return
          }
          let body
          try {
            body = await readJson(req)
          } catch (error) {
            json(res, 400, { ok: false, code: 'BAD_BODY', error: String(error?.message ?? error) })
            return
          }
          try {
            const result = await handle(body)
            json(res, result.ok ? 200 : 409, result)
          } catch (error) {
            json(res, 500, { ok: false, code: 'INTERNAL', error: String(error?.message ?? error) })
          }
        },
      }), `dsh-spec-flow: ${routePath}`)
    }

    postRoute(REVIEW_ROUTE, (body) => reviewTask(config.specRoot, { ...body, reviewBy: config.reviewBy }))
    postRoute(CONFIRM_ROUTE, (body) => openGate(config.specRoot, { ...body, by: config.reviewBy }))
  })
}
