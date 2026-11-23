/**
 * 按会话的 preset 挂载工具。
 *
 * 关键点：工具不是全局注册的。它被注册在某个 Agent 自己的作用域里，所以
 * 一个用 standard 预设开的会话，工具表里根本不存在 spec_write。
 *
 * preset 的判定优先用 agentPresets.composedPreset(agent.ctx)，拿不到时退回
 * session header 里记录的预设 id。
 */

/** 从上下文里安全地拿一个可选服务。 */
function service(ctx, name) {
  try {
    const get = ctx.get
    const value = typeof get === 'function' ? Reflect.apply(get, ctx, [name]) : undefined
    return value === undefined || value === null ? undefined : value
  } catch {
    return undefined
  }
}

/**
 * @param {object} ctx Cordis 上下文
 * @param {{tools: {officer: any[], executor: any[], reviewer?: any[]}, presets: {officer: string, executor: string, reviewer?: string}, models?: Record<string, {provider: string, model: string, reasoningEffort?: string}>}} options
 */
export function attachTools(ctx, options) {
  const { tools, presets, models } = options
  /** @type {Map<object, {role: string, fiber: any}>} */
  const attached = new Map()

  const roleOf = (agent) => {
    const registry = service(ctx, 'agentPresets')
    let id
    try {
      id = registry?.composedPreset?.(agent.ctx)
    } catch {
      id = undefined
    }
    if (typeof id !== 'string' || id === '') id = agent?.session?.header?.agentPreset
    if (id === presets.officer) return 'officer'
    if (id === presets.executor) return 'executor'
    if (id === presets.reviewer) return 'reviewer'
    return undefined
  }

  /** 按角色绑定模型：会话创建时强制绑定一次，用户后续手动切换优先。 */
  const bindModel = (agent) => {
    const role = roleOf(agent)
    const selection = role ? models?.[role] : undefined
    if (!selection) return
    try {
      if (typeof agent?.model?.select === 'function') agent.model.select(selection)
    } catch {
      /* 模型服务不可用时静默跳过，不影响工具挂载 */
    }
  }

  const detach = (agent) => {
    const entry = attached.get(agent)
    if (!entry) return
    attached.delete(agent)
    try {
      entry.fiber?.dispose?.()
    } catch {
      /* 已经被上层释放 */
    }
  }

  const attach = async (agent) => {
    const role = roleOf(agent)
    if (!role) {
      detach(agent)
      return
    }
    const current = attached.get(agent)
    if (current && current.role === role) return
    detach(agent)
    const defs = tools[role] ?? []
    let fiber
    try {
      fiber = agent.ctx.plugin({
        inject: ['tools'],
        apply(scoped) {
          for (const definition of defs) {
            scoped.effect(() => scoped.tools.register(definition), `dsh-spec-flow:${definition.name}`)
          }
        },
      })
    } catch {
      return
    }
    attached.set(agent, { role, fiber })
    await fiber
  }

  const reconcile = async () => {
    const agents = service(ctx, 'agents')
    for (const agent of agents?.list?.() ?? []) {
      await attach(agent)
    }
  }

  ctx.on('agent/created', ({ agent }) => {
    bindModel(agent)
    void attach(agent)
    return undefined
  })
  ctx.on('agent/disposed', ({ agent }) => {
    detach(agent)
    return undefined
  })
  ctx.on('session/event', (_session, event) => {
    if (event?.type === 'agent-preset/selected') void reconcile()
    return undefined
  })
  ctx.effect(() => () => {
    for (const agent of [...attached.keys()]) detach(agent)
  }, 'dsh-spec-flow: attached tools')

  void reconcile()
}
