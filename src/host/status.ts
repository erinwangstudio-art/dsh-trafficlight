// host/status.ts — folds the session/event firehose into per-session traffic
// states (idle / running / blocked / done) for the SUBSCRIBED session set,
// and aggregates a single global light + title from that set.
//
// Per-session state derivation:
//   blocked : this session has an open approval request or an unanswered
//             ask_user_question.                          -> RED
//   running : this session has an open turn (turn/start .. turn/end) and is
//             not blocked.                                -> YELLOW
//   done    : no open turn and the session has a known title. -> GREEN
//   idle    : subscribed but nothing has happened yet.    -> lamp dim
//
// The subscription list is authoritative (see subscriptions.ts): sessions the
// user did not subscribe to never appear in the snapshot, even if active.
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { PresentationMode, SessionStatus, TrafficSnapshot, TrafficState } from '../core/types.ts'
import type { SettingsStore } from './settings.ts'
import type { SubscriptionStore } from './subscriptions.ts'
import { maybeStartOverlay } from './overlay-launcher.ts'

interface SessionTrack {
  open: boolean
  /** Stable session title, derived from the session's first user message. */
  sessionTitle: string
  /** id -> blocking headline (approval id or ask:<callId>). Used for `detail`. */
  blocking: Map<string, string>
  /** Last time this session emitted an event we cared about (ms epoch). */
  touchedAt: number
  /** Live Session object (kept for lazy title backfill after hydration). */
  session?: Session
  /** True once the title came from an authoritative source (session/title
   * event, title service, or the session log). False while it is only the
   * live-message fallback — so hydration can later upgrade it. */
  titleAuthoritative: boolean
}

const DEFAULT_TITLE = 'DSH'
/** Fully idle unsubscribed sessions are dropped after this much wall-clock time. */
const IDLE_SWEEP_MS = 10 * 60_000
/** How often to scan for idle sessions. */
const SWEEP_INTERVAL_MS = 60_000

interface SessionEventLike {
  type: string
  seq?: number
  time?: number
  data?: unknown
}

export class StatusMachine {
  private readonly ctx: Context
  private readonly subs: SubscriptionStore
  private readonly settings: SettingsStore
  private readonly sessions = new Map<string, SessionTrack>()
  /** Last heartbeat from the in-page docked panel (0 = never seen). */
  private dockBeatAt = 0
  private version = 0
  private readonly listeners = new Set<() => void>()

  constructor(ctx: Context, subs: SubscriptionStore, settings: SettingsStore) {
    this.ctx = ctx
    this.subs = subs
    this.settings = settings
  }

  /** Subscribe to state changes. Returns a disposer. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  currentVersion(): number {
    return this.version
  }

  // ---- subscription surface (web UI + overlay both go through the bridge) ----

  isSubscribed(sessionId: string): boolean {
    return this.subs.has(sessionId)
  }

  subscribedIds(): string[] {
    return this.subs.list()
  }

  subscribeSession(sessionId: string): boolean {
    const changed = this.subs.add(sessionId)
    if (changed) {
      this.bump()
      // First subscription of a session: make sure the overlay is up.
      void maybeStartOverlay(this.ctx)
    }
    return changed
  }

  unsubscribeSession(sessionId: string): boolean {
    const changed = this.subs.remove(sessionId)
    if (changed) this.bump()
    return changed
  }

  /** Attach to the host's live session event firehose. */
  attach(): () => void {
    const handler = (session: Session, event: SessionEventLike): void => {
      try {
        this.fold(session, event)
      } catch (error) {
        this.warn(`fold rejected: ${String(error)}`)
      }
    }
    let off: () => void = () => undefined
    try {
      off = this.ctx.on('session/event', handler) as unknown as () => void
    } catch (error) {
      this.warn(`session/event subscribe failed: ${String(error)}`)
    }

    const disposedHandler = (session: Session): void => {
      const id = String((session as unknown as { id?: string }).id ?? 'unknown')
      if (this.sessions.delete(id)) this.bump()
    }
    let offDisposed: () => void = () => undefined
    try {
      offDisposed = this.ctx.on('session/disposed', disposedHandler) as unknown as () => void
    } catch (error) {
      this.warn(`session/disposed subscribe failed: ${String(error)}`)
    }

    // Replay already-live sessions. A fresh dsh web process does not emit old
    // session/event entries, so without this the row would stay placeholder
    // until the next user/turn event arrives after a restart.
    try {
      const sessions = this.ctx.sessions?.list?.()
      if (sessions) {
        for (const session of sessions) {
          for (const event of session.events) {
            this.fold(session, event, false)
          }
        }
        this.bump()
      }
    } catch (error) {
      this.warn(`session replay failed: ${String(error)}`)
    }

    // Restore the overlay when the host restarts with persisted subscriptions.
    if (this.subs.list().length > 0) void maybeStartOverlay(this.ctx)

    // Restart-time safety net: if the process came back while docked, give the
    // in-page panel a moment to report in; otherwise restore the floating
    // window so the light cannot stay lost behind a dead dock.
    if (this.settings.mode() === 'docked') {
      const resumedAt = Date.now()
      setTimeout(() => {
        if (this.settings.mode() !== 'docked') return
        if (this.dockBeatAt >= resumedAt) return
        this.warn('docked mode resumed without a client heartbeat — reverting to floating overlay')
        this.settings.setMode('floating')
        this.bump()
      }, 15_000)
    }

    // Prune fully-idle UNSUBSCRIBED sessions so long-running dsh web processes
    // don't leak finished session bookkeeping forever. Subscribed sessions are
    // kept (they render as placeholder rows even before their first event).
    const timer = setInterval(() => {
      try {
        if (this.sweepIdle()) this.bump()
      } catch (error) {
        this.warn(`idle sweep rejected: ${String(error)}`)
      }
    }, SWEEP_INTERVAL_MS)

    return () => {
      clearInterval(timer)
      try {
        off()
      } catch {
        /* ignore */
      }
      try {
        offDisposed()
      } catch {
        /* ignore */
      }
    }
  }

  /** Drop unsubscribed sessions with no open turn and no blocking item after
   * the idle TTL. Subscribed sessions are kept as placeholder rows. */
  private sweepIdle(): boolean {
    const now = Date.now()
    let removed = false
    for (const [id, track] of this.sessions) {
      if (
        !track.open &&
        track.blocking.size === 0 &&
        !this.subs.has(id) &&
        now - track.touchedAt > IDLE_SWEEP_MS
      ) {
        this.sessions.delete(id)
        removed = true
      }
    }
    return removed
  }

  /** Resolve the current snapshot over the subscribed set. */
  snapshot(): TrafficSnapshot {
    const rows: SessionStatus[] = []
    let anyBlock = false
    let anyRunning = false
    let anyDone = false
    let firstTitle = ''

    for (const id of this.subs.list()) {
      const t = this.sessions.get(id)
      const cachedTitle = this.subs.title(id)
      if (t === undefined) {
        rows.push({
          sessionId: id,
          title: cachedTitle ?? placeholderTitle(id),
          state: cachedTitle !== undefined ? 'done' : 'idle',
          detail: '',
        })
        continue
      }
      const resolvedTitle = t.titleAuthoritative && t.sessionTitle !== DEFAULT_TITLE
        ? t.sessionTitle
        : (cachedTitle ?? (t.sessionTitle !== DEFAULT_TITLE ? t.sessionTitle : placeholderTitle(id)))
      if (resolvedTitle !== placeholderTitle(id)) this.subs.setTitle(id, resolvedTitle)
      const row: SessionStatus = {
        sessionId: id,
        title: resolvedTitle,
        state: 'idle',
        detail: '',
      }
      if (t.blocking.size > 0) {
        row.state = 'blocked'
        row.detail = t.blocking.values().next().value ?? ''
        anyBlock = true
      } else if (t.open) {
        row.state = 'running'
        anyRunning = true
      } else if (resolvedTitle !== placeholderTitle(id)) {
        row.state = 'done'
        anyDone = true
      }
      if (firstTitle === '' && row.title !== '') firstTitle = row.title
      rows.push(row)
    }

    let state: TrafficState
    if (anyBlock) state = 'blocked'
    else if (anyRunning) state = 'running'
    else if (rows.length > 0 && anyDone) state = 'done'
    else if (rows.length > 0) state = 'idle'
    else state = 'idle'

    return {
      state,
      title: firstTitle || DEFAULT_TITLE,
      sessions: rows,
      subscribed: this.subs.list(),
      opacity: this.settings.opacity(),
      minimalMode: this.settings.minimalMode(),
      breathCount: this.settings.breathCount(),
      breathBeat: this.settings.breathBeat(),
      mode: this.settings.mode(),
      soundEnabled: this.settings.soundEnabled(),
      soundVolume: this.settings.soundVolume(),
      dockHealthy: Date.now() - this.dockBeatAt < 15_000,
      updatedAt: Date.now(),
    }
  }

  /** Overlay window opacity setting. Mutating it bumps the version and
   *  notifies listeners so the standalone bridge / SSE push the new value. */
  setOpacity(value: unknown): number {
    const accepted = this.settings.setOpacity(value)
    this.bump()
    return accepted
  }

  /** Overlay minimal (single-lamp) mode setting. Mutating it bumps + notifies. */
  setMinimalMode(value: unknown): boolean {
    const accepted = this.settings.setMinimalMode(value)
    this.bump()
    return accepted
  }

  setSoundEnabled(value: unknown): boolean {
    const accepted = this.settings.setSoundEnabled(value)
    this.bump()
    return accepted
  }

  setSoundVolume(value: unknown): number {
    const accepted = this.settings.setSoundVolume(value)
    this.bump()
    return accepted
  }

  /** Breathing beats per state change. Mutating it bumps + notifies. */
  setBreathCount(value: unknown): number {
    const accepted = this.settings.setBreathCount(value)
    this.bump()
    return accepted
  }

  /** Breathing beat width (seconds). Mutating it bumps + notifies. */
  setBreathBeat(value: unknown): number {
    const accepted = this.settings.setBreathBeat(value)
    this.bump()
    return accepted
  }

  /**
   * Presentation mode. When docking, a safety net reverts to the floating
   * panel if the in-page panel never reports in (stale client bundle, slot not
   * mounted), so the light cannot get lost behind a dead dock.
   */
  setMode(value: unknown): PresentationMode {
    const accepted = this.settings.setMode(value)
    this.bump()
    if (accepted === 'docked') {
      const started = Date.now()
      setTimeout(() => {
        if (this.settings.mode() !== 'docked') return
        if (this.dockBeatAt >= started) return
        this.warn('docked panel did not report in — reverting to floating overlay')
        this.settings.setMode('floating')
        this.bump()
      }, 12_000)
    }
    return accepted
  }

  /** Heartbeat from the in-page docked panel; proves the sidebar twin renders. */
  noteDockBeat(): void {
    this.dockBeatAt = Date.now()
  }

  private fold(session: Session, event: SessionEventLike, notify = true): void {
    const id = String((session as unknown as { id?: string }).id ?? 'unknown')
    let t = this.sessions.get(id)
    if (t === undefined) {
      t = {
        open: false,
        sessionTitle: DEFAULT_TITLE,
        blocking: new Map(),
        touchedAt: Date.now(),
        session,
        titleAuthoritative: false,
      }
      this.sessions.set(id, t)
    } else {
      t.touchedAt = Date.now()
      t.session = session
    }
    // dsh hydrates persisted session logs asynchronously after boot; the
    // attach() replay can run before the log is in memory, so the title may
    // still be unset. Backfill the authoritative title from whatever the
    // session object now knows, and keep retrying until it succeeds.
    if (!t.titleAuthoritative || event.type === 'session/title') {
      this.backfillTitle(t)
    }
    const data = (event.data ?? {}) as Record<string, unknown>
    const type = event.type

    switch (type) {
      case 'session/title': {
        // Authoritative session title (what the conversation header shows):
        // appended by user rename ("user" source) or the automatic title
        // provider / fallback. Latest-wins, mirroring dsh-session-title's
        // foldSessionTitle. Overrides any first-message fallback below.
        const txt = String(data.title ?? '').trim()
        if (txt !== '') {
          t.sessionTitle = txt
          t.titleAuthoritative = true
        }
        break
      }
      case 'user/message': {
        const txt = extractUserTitle(data)
        // Pre-title fallback: before any `session/title` event exists the
        // header shows the first user message; mirror that. A later
        // session/title event overrides this.
        if (txt !== undefined && txt !== '' && t.sessionTitle === DEFAULT_TITLE) {
          t.sessionTitle = txt
          t.titleAuthoritative = false // upgradeable once the log hydrates
        }
        // A fresh user message usually opens a turn; mark open so the light
        // goes yellow instantly even before turn/start arrives.
        t.open = true
        break
      }
      case 'turn/start': {
        t.open = true
        t.blocking.clear()
        break
      }
      case 'approval/asked': {
        const aid = String(data.id ?? 'approval:' + (event.seq ?? ''))
        const toolName = String(data.toolName ?? '操作')
        t.blocking.set(aid, `DSH 需要批准: ${toolName}`)
        break
      }
      case 'approval/decided': {
        const aid = String(data.id ?? '')
        if (aid !== '') t.blocking.delete(aid)
        break
      }
      case 'tool/call': {
        const name = String(data.name ?? '')
        if (isAskUserQuestion(name)) {
          const callId = String(data.callId ?? 'ask:' + (event.seq ?? ''))
          const q = firstQuestion(parseArgs(data.arguments))
          t.blocking.set('ask:' + callId, q !== undefined ? q : 'DSH 向你提问中')
        }
        break
      }
      case 'tool/result': {
        const message = (data.message ?? {}) as Record<string, unknown>
        const source = (message.source ?? {}) as Record<string, unknown>
        const content = Array.isArray(message.content)
          ? (message.content[0] as Record<string, unknown> | undefined)
          : undefined
        const raw = source.callId ?? content?.toolCallId ?? message.callId
        const callId = raw === undefined ? undefined : String(raw)
        if (callId !== undefined) t.blocking.delete('ask:' + callId)
        break
      }
      case 'turn/end': {
        t.open = false
        t.blocking.clear()
        break
      }
      default:
        return
    }
    if (notify) this.bump()
  }

  /**
   * Seed a session's authoritative title once its log is (or becomes)
   * available. Precedence mirrors the GUI header:
   *   1. ctx.sessionTitle service fold (canonical session/title reducer);
   *   2. last `session/title` event in the session log;
   *   3. first user message from the log (pre-title fallback).
   */
  private backfillTitle(t: SessionTrack): void {
    try {
      const svc = (this.ctx as unknown as { sessionTitle?: { get(s: Session): { title?: string } | undefined } })
        .sessionTitle
      const fromService = svc?.get?.(t.session as Session)?.title
      if (typeof fromService === 'string' && fromService.trim() !== '') {
        t.sessionTitle = fromService
        t.titleAuthoritative = true
        this.subs.setTitle(String(t.session.id ?? ''), fromService.trim())
        return
      }
    } catch {
      /* service unavailable — fall through to log scan */
    }
    const events = (t.session as unknown as { events?: SessionEventLike[] } | undefined)?.events
    if (events === undefined) return
    // Latest session/title event wins (same fold as dsh-session-title).
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const e = events[i]
      if (e.type === 'session/title') {
        const txt = String((e.data as Record<string, unknown> | undefined)?.title ?? '').trim()
        if (txt !== '') {
          t.sessionTitle = txt
          t.titleAuthoritative = true
          this.subs.setTitle(String(t.session.id ?? ''), txt)
          return
        }
      }
    }
    // Pre-title fallback from the log: first user message.
    for (const e of events) {
      if (e.type !== 'user/message') continue
      const txt = extractUserTitle((e.data ?? {}) as Record<string, unknown>)
      if (txt !== undefined && txt !== '') {
        t.sessionTitle = txt
        t.titleAuthoritative = true
        this.subs.setTitle(String(t.session.id ?? ''), txt)
        return
      }
    }
  }

  private bump(): void {
    this.version += 1
    for (const fn of this.listeners) {
      try {
        fn()
      } catch {
        /* contained */
      }
    }
  }

  private warn(message: string): void {
    try {
      this.ctx.logger?.warn?.(`[dsh-trafficlight] ${message}`)
    } catch {
      /* ignore */
    }
  }
}

/** Placeholder row label for a subscribed session we have not seen yet. */
export function placeholderTitle(sessionId: string): string {
  // DSH ids are prefixed "session-", so slicing the first 8 chars makes every
  // placeholder identical ("会话 session-"). Use the distinctive tail instead.
  return `会话 ${sessionId.slice(-8)}`
}

// ---- payload helpers (permissively typed) ----

function isAskUserQuestion(name: string): boolean {
  const base = name.split('.').pop() ?? ''
  return base === 'ask_user_question'
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') return {}
  try {
    const p = JSON.parse(raw) as unknown
    return typeof p === 'object' && p !== null ? (p as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function firstQuestion(args: Record<string, unknown>): string | undefined {
  const qs = args.questions
  if (Array.isArray(qs)) {
    const first = qs[0]
    if (first !== null && typeof first === 'object') {
      const qv = (first as Record<string, unknown>).question
      if (typeof qv === 'string' && qv !== '') return qv.slice(0, 140)
    }
  }
  if (typeof args.question === 'string' && args.question !== '') return args.question.slice(0, 140)
  return undefined
}

/** Best-effort extraction of a user prompt as the task title. */
function extractUserTitle(data: Record<string, unknown>): string | undefined {
  const msg = (data.message ?? data) as Record<string, unknown>
  // `user/message` also carries plugin context/system-reminder/skill catalogs.
  // Only treat a real user-authored message as the session title source; absent
  // `source` is tolerated as a legacy/forward-compatible fallback.
  const source = (msg.source ?? data.source) as Record<string, unknown> | undefined
  if (source !== undefined && typeof source.kind === 'string' && source.kind !== 'user') {
    return undefined
  }
  const content = msg.content
  if (Array.isArray(content)) {
    for (const block of content) {
      const b = block as Record<string, unknown>
      if (typeof b.text === 'string' && b.text.trim() !== '') return b.text.trim().slice(0, 140)
      if (typeof b.content === 'string' && b.content.trim() !== '') return b.content.trim().slice(0, 140)
    }
  }
  if (typeof msg.text === 'string' && msg.text.trim() !== '') return msg.text.trim().slice(0, 140)
  if (typeof data.text === 'string' && data.text.trim() !== '') return data.text.trim().slice(0, 140)
  return undefined
}