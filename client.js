/**
 * 看板页的浏览器半边。
 *
 * 两个注册、同一个 id：
 *   sidebar.panellist  id=spec-board  -> 左栏图标
 *   main               key=spec-board -> 中央页面
 * 点图标由 shell 负责切换，不需要自己调 layout.selectPanel。
 *
 * 页面只读：数据来自 GET /api/spec-board；唯一的动作是开一个配好 preset 的新会话。
 */
window.__ModuleLoader__.load({
  id: 'dsh-spec-flow',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const PANEL_ID = 'spec-board'
    const OFFICER = 'spec-officer'
    const EXECUTOR = 'spec-exec'
    const REVIEWER = 'spec-reviewer'
    const FALLBACK_ROOT = ''

    const STATUS_TEXT = {
      drafting: '草稿',
      spec_ready: '待执行',
      executing: '执行中',
      reviewing: '待验收',
      accepted: '已通过',
      rejected: '已打回',
      frozen: '已冻结',
      broken: '坏文件',
    }

    const STATUS_COLOR = {
      drafting: 'var(--dsw-alias-state-idle-primary)',
      spec_ready: 'var(--dsw-alias-brand-primary)',
      executing: 'var(--dsw-alias-state-warn-primary)',
      reviewing: 'var(--dsw-alias-state-warn-primary)',
      accepted: 'var(--dsw-alias-state-success-primary)',
      rejected: 'var(--dsw-alias-state-error-primary)',
      frozen: 'var(--dsw-alias-state-error-primary)',
      broken: 'var(--dsw-alias-state-error-primary)',
    }

    const BUTTON = {
      padding: '3px 10px',
      borderRadius: 6,
      cursor: 'pointer',
      fontSize: 12,
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
    }

    const TH = {
      fontWeight: 500,
      fontSize: 12,
      padding: '6px 8px',
      color: 'var(--dsw-alias-label-secondary)',
      borderBottom: '1px solid var(--dsw-alias-border-l1)',
      whiteSpace: 'nowrap',
    }

    const TD = { padding: '10px 8px', verticalAlign: 'top' }

    /** 左栏图标。ownerProps = { size, active }。 */
    function Icon(props) {
      const size = typeof props?.size === 'number' ? props.size : 18
      const stroke = props?.active === true ? 'var(--dsw-alias-brand-primary)' : 'currentColor'
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        'aria-hidden': true,
        style: { display: 'block' },
      },
      h('path', {
        d: 'M6 3.5h8.2L18 7.3V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z',
        stroke,
        strokeWidth: 1.6,
        strokeLinejoin: 'round',
      }),
      h('path', { d: 'M13.8 3.8V7.6H17.6', stroke, strokeWidth: 1.6, strokeLinejoin: 'round' }),
      h('path', {
        d: 'M11.4 15.4l1.9 1.9 3.3-3.6',
        stroke,
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
    }

    /** 时间显示。 */
    function when(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
      const date = new Date(ms)
      const pad = (n) => String(n).padStart(2, '0')
      return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        /** 开会话。uiWorkspace 按需取，缺了只影响按钮，不影响页面。 */
        function startSession(preset, prompt) {
          const nav = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
          if (!nav || typeof nav.startSession !== 'function') return '会话服务不可用，重开页面再试'
          try {
            nav.startSession(undefined, { agentPreset: preset, prompt, whenDraftExists: 'replace' })
            return null
          } catch (cause) {
            return String(cause?.message ?? cause)
          }
        }

        function Page() {
          const [data, setData] = useState(null)
          const [error, setError] = useState(null)
          const [loading, setLoading] = useState(true)
          const [notice, setNotice] = useState(null)
          const alive = useRef(true)

          const load = useCallback(async () => {
            try {
              const response = await fetch('/spec-flow/board', { headers: { accept: 'application/json' } })
              if (!response.ok) throw new Error(`HTTP ${response.status}`)
              const next = await response.json()
              if (alive.current) {
                setData(next)
                setError(null)
              }
            } catch (cause) {
              if (alive.current) setError(String(cause?.message ?? cause))
            } finally {
              if (alive.current) setLoading(false)
            }
          }, [])

          useEffect(() => {
            alive.current = true
            void load()
            const timer = setInterval(() => { void load() }, 15000)
            return () => {
              alive.current = false
              clearInterval(timer)
            }
          }, [load])

          const open = useCallback((task, preset, prompt) => {
            void task
            setNotice(startSession(preset, prompt))
          }, [])

          const review = useCallback(async (task, decision) => {
            setNotice(null)
            try {
              const response = await fetch('/spec-flow/review', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ task, decision }),
              })
              const result = await response.json().catch(() => ({}))
              if (!response.ok || result.ok !== true) {
                setNotice(result.error || `验收失败：HTTP ${response.status}`)
                return
              }
              await load()
            } catch (cause) {
              setNotice(String(cause?.message ?? cause))
            }
          }, [load])

          const confirmGate = useCallback(async (task) => {
            setNotice(null)
            try {
              const response = await fetch('/spec-flow/confirm', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ task }),
              })
              const result = await response.json().catch(() => ({}))
              if (!response.ok || result.ok !== true) {
                setNotice(result.error || `确认失败：HTTP ${response.status}`)
                return
              }
              await load()
            } catch (cause) {
              setNotice(String(cause?.message ?? cause))
            }
          }, [load])

          const root = (data && data.root) || FALLBACK_ROOT
          const tasks = Array.isArray(data && data.tasks) ? data.tasks : []

          const header = h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 12 } },
            h('h1', { style: { fontSize: 20, margin: 0, fontWeight: 600 } }, '规格看板'),
            h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
              loading ? '读取中…' : `${tasks.length} 个任务`),
            h('button', {
              onClick: () => { setLoading(true); void load() },
              title: '重新读取',
              style: { ...BUTTON, marginLeft: 'auto' },
            }, '刷新'),
            data && data.simpleMode
              ? h('button', {
                onClick: () => open('', 'standard', '极简任务：用单 Agent 快速搞定，不走规格官/执行者流水线。直接说需求。'),
                title: '极简任务直通：单 Agent 快速模式，跳过流水线',
                style: { ...BUTTON, marginLeft: 8 },
              }, '极简直通')
              : null)

          const pathBar = h('div', {
            style: {
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: 12,
              color: 'var(--dsw-alias-label-secondary)',
              background: 'var(--dsw-alias-bg-layer-1)',
              border: '1px solid var(--dsw-alias-border-l1)',
              borderRadius: 6,
              padding: '6px 10px',
              margin: '10px 0 18px',
              wordBreak: 'break-all',
            },
            title: '交付目录由 SPEC_FLOW_ROOT 环境变量或 specRoot 配置决定',
          }, root)

          const noticeBar = notice
            ? h('div', { style: { marginBottom: 12, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } }, notice)
            : null

          const errorBar = error
            ? h('div', {
              style: {
                padding: '10px 12px',
                borderRadius: 6,
                fontSize: 12,
                border: '1px solid var(--dsw-alias-state-error-primary)',
                color: 'var(--dsw-alias-state-error-primary)',
              },
            }, `读不到数据：${error}。DSH 重启后接口才会挂上。`)
            : null

          const emptyBar = !error && !loading && tasks.length === 0
            ? h('div', {
              style: {
                padding: '28px 20px',
                borderRadius: 8,
                textAlign: 'center',
                border: '1px dashed var(--dsw-alias-border-l2)',
                color: 'var(--dsw-alias-label-secondary)',
              },
            }, '还没有任务。开一个规格会话，让它先 spec_start。')
            : null

          const headRow = h('tr', null,
            ['任务', '状态', '验收', 'spec_hash', '更新', '操作'].map((label, index) => h('th', {
              key: label,
              style: { ...TH, textAlign: index === 5 ? 'right' : 'left' },
            }, label)))

          const rows = tasks.map((row) => {
            const canExec = row.status === 'spec_ready' || row.status === 'executing'
            const reviewing = row.status === 'reviewing'
            const now = Date.now()
            const dl = row.deadline_ms
            const overdue = typeof dl === 'number' && dl < now
            const urgent = typeof dl === 'number' && !overdue && (dl - now) < 24 * 3600 * 1000
            const stuck = row.status === 'reviewing' && typeof row.updated_at === 'number' && (now - row.updated_at) > 48 * 3600 * 1000
            const nameCell = h('td', { key: 'name', style: TD },
              h('div', { style: { fontWeight: 500 } }, row.task),
              row.interview_rounds > 0
                ? h('div', {
                  style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' },
                }, `访谈 ${row.interview_rounds} 轮`)
                : null,
              row.deadline
                ? h('div', {
                  style: { fontSize: 11, color: overdue ? 'var(--dsw-alias-state-error-primary)' : urgent ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-secondary)' },
                }, `截止 ${when(row.deadline_ms)}${overdue ? ' · 已逾期' : ''}`)
                : null,
              row.error
                ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-state-error-primary)' } }, row.error)
                : null)
            const statusCell = h('td', { key: 'status', style: { ...TD, whiteSpace: 'nowrap' } },
              h('span', {
                style: { color: STATUS_COLOR[row.status] || 'var(--dsw-alias-label-secondary)' },
              }, STATUS_TEXT[row.status] || row.status),
              stuck
                ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-state-warn-primary)' } }, '滞留 · 待验收超 48h')
                : null)
            const passed = row.acceptance_passed || 0
            const failed = row.acceptance_failed || 0
            const acceptanceCell = h('td', {
              key: 'acceptance',
              style: { ...TD, whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-secondary)' },
            },
            `${passed}/${row.acceptance_total || 0}`,
            failed > 0
              ? h('span', { style: { marginLeft: 6, color: 'var(--dsw-alias-state-error-primary)' } }, `×${failed}`)
              : null)
            const hashCell = h('td', {
              key: 'hash',
              title: row.spec_hash || '未封版',
              style: {
                ...TD,
                fontSize: 11,
                fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
                color: 'var(--dsw-alias-label-secondary)',
              },
            }, row.spec_hash ? String(row.spec_hash).replace('sha256:', '').slice(0, 10) : '—')
            const whenCell = h('td', {
              key: 'when',
              style: { ...TD, whiteSpace: 'nowrap', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
            }, when(row.updated_at))
            const actions = [h('button', {
              key: 'officer',
              onClick: () => open(row.task, OFFICER,
                `继续「${row.task}」：读 ${root}\\${row.task}\\00-交接.json 和 001-003，按规格官流程把剩下的部分补齐。`),
              style: BUTTON,
            }, '开规格会话')]

            if (row.status === 'drafting') {
              if (row.gate_open) {
                actions.push(h('span', {
                  key: 'gate',
                  style: { marginLeft: 8, fontSize: 12, color: 'var(--dsw-alias-state-success-primary)' },
                }, '已确认，等规格官封装'))
              } else {
                const noTalk = (row.interview_rounds || 0) === 0
                actions.push(h('button', {
                  key: 'gate',
                  onClick: () => { void confirmGate(row.task) },
                  disabled: noTalk,
                  title: noTalk ? '规格官还没提问，先跟它把需求聊清楚' : '确认需求已经问清楚，允许它写 001-003',
                  style: {
                    ...BUTTON,
                    marginLeft: 8,
                    opacity: noTalk ? 0.45 : 1,
                    cursor: noTalk ? 'not-allowed' : 'pointer',
                    borderColor: 'var(--dsw-alias-brand-primary)',
                    color: 'var(--dsw-alias-brand-primary)',
                  },
                }, '确认可以封装'))
              }
            } else if (reviewing) {
              actions.push(h('button', {
                key: 'pass',
                onClick: () => { void review(row.task, 'accepted') },
                title: '验收通过：状态改成 accepted',
                style: {
                  ...BUTTON, marginLeft: 8,
                  borderColor: 'var(--dsw-alias-state-success-primary)',
                  color: 'var(--dsw-alias-state-success-primary)',
                },
              }, '通过'))
              actions.push(h('button', {
                key: 'fail',
                onClick: () => { void review(row.task, 'rejected') },
                title: '打回重做：状态改成 rejected，规格官重新封版后才能再执行',
                style: {
                  ...BUTTON, marginLeft: 8,
                  borderColor: 'var(--dsw-alias-state-error-primary)',
                  color: 'var(--dsw-alias-state-error-primary)',
                },
              }, '打回'))
              actions.push(h('button', {
                key: 'reviewer',
                onClick: () => open(row.task, REVIEWER,
                  `审查「${row.task}」：读 ${root}\\${row.task}\\ 下的 001-003、004-result.md、00-交接.json，读执行者写的代码，自己跑一遍关键测试，判定做对没有。做错就写清怎么改；全对就生成一份能双击打开的「傻瓜级验收指南」。`),
                title: '召唤审查官：读需求、读代码、跑测试，判定执行者做对没有',
                style: {
                  ...BUTTON, marginLeft: 8,
                  borderColor: 'var(--dsw-alias-state-warn-primary)',
                  color: 'var(--dsw-alias-state-warn-primary)',
                },
              }, '召唤检察院'))
            } else if (row.status === 'frozen') {
              actions.push(h('span', {
                key: 'frozen',
                style: { marginLeft: 8, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' },
              }, '已冻结 · 见 005-人类介入单.md'))
            } else {
              actions.push(h('button', {
                key: 'exec',
                onClick: () => open(row.task, EXECUTOR,
                  `执行「${row.task}」：先跑 spec_check，通过后按 002-plan 干活，最后用 spec_report 交 004（每条验收都要给 passed/failed）。`),
                disabled: !canExec,
                title: canExec ? '' : '还没封版，执行会话会被 spec_check 拒绝',
                style: {
                  ...BUTTON, marginLeft: 8,
                  opacity: canExec ? 1 : 0.45,
                  cursor: canExec ? 'pointer' : 'not-allowed',
                },
              }, '开执行会话'))
            }

            const actCell = h('td', { key: 'act', style: { ...TD, textAlign: 'right', whiteSpace: 'nowrap' } }, actions)
            return h('tr', {
              key: row.task,
              style: {
                borderBottom: '1px solid var(--dsw-alias-border-l1)',
                ...(overdue ? { borderLeft: '3px solid var(--dsw-alias-state-error-primary)' } : {}),
                ...(urgent ? { borderLeft: '3px solid var(--dsw-alias-state-warn-primary)' } : {}),
              },
            }, [nameCell, statusCell, acceptanceCell, hashCell, whenCell, actCell])
          })

          const table = tasks.length > 0
            ? h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 13 } },
              h('thead', null, headRow),
              h('tbody', null, rows))
            : null

          const pageStyle = {
            height: '100%',
            overflow: 'auto',
            padding: '28px 32px 48px',
            background: 'var(--dsw-alias-bg-base)',
            color: 'var(--dsw-alias-label-primary)',
            fontSize: 14,
            lineHeight: 1.6,
          }

          return h('div', { style: pageStyle },
            h('div', { style: { maxWidth: 1000, margin: '0 auto' } },
              [header, pathBar, noticeBar, errorBar, emptyBar, table]))
        }

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 25,
          label: () => '规格',
        }, Icon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, Page))
      },
    }
  },
})
