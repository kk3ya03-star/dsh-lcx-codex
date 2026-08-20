const STALE_SESSION_CODE = 'LCX_SESSION_GENERATION_STALE'

function sessionIdOf(session) {
  const value = session?.id
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function staleSessionError(sessionId, phase) {
  const error = new Error(`LCX session generation became stale during ${phase}: ${sessionId}`)
  error.code = STALE_SESSION_CODE
  return error
}

/**
 * Track the public DSH session lifecycle without depending on private agent-loop APIs.
 * A lease is intentionally fail-closed when a session service exists but the id is
 * unknown; callers without a session id (or without the optional service) retain
 * the pre-lifecycle behavior.
 */
export function createSessionGenerationTracker(ctx) {
  const sessions = ctx?.get?.('sessions') ?? ctx?.sessions
  const enabled = Boolean(sessions && typeof ctx?.on === 'function')
  const states = new Map()
  const disposers = []

  const created = (session) => {
    const id = sessionIdOf(session)
    if (!id) return
    const previous = states.get(id)
    states.set(id, { generation: (previous?.generation ?? 0) + 1, active: true })
  }
  const disposed = (session) => {
    const id = sessionIdOf(session)
    if (!id) return
    const previous = states.get(id)
    states.set(id, { generation: (previous?.generation ?? 0) + 1, active: false })
  }

  if (enabled) {
    for (const session of sessions.list?.() ?? []) created(session)
    for (const [event, handler] of [['session/created', created], ['session/disposed', disposed]]) {
      const dispose = ctx.on(event, handler)
      if (typeof dispose === 'function') disposers.push(dispose)
    }
  }

  return {
    capture(sessionId) {
      const id = typeof sessionId === 'string' ? sessionId : ''
      if (!enabled || !id) return { assert() {} }
      const captured = states.get(id)
      const generation = captured?.generation ?? 0
      return {
        id,
        generation,
        assert(phase = 'commit') {
          const current = states.get(id)
          if (!current || !current.active || current.generation !== generation) {
            throw staleSessionError(id, phase)
          }
        },
      }
    },
    dispose() {
      while (disposers.length > 0) disposers.pop()?.()
    },
  }
}

export { STALE_SESSION_CODE }
