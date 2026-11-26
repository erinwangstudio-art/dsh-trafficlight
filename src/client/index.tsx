// client/index.tsx — dsh-trafficlight browser half.
//
// Registers a per-session「🚦 订阅」toggle into the official additive slot
// `conversation.session.header.actions` (session header action row, declared
// by dsh-client-ui-conversation — the framework supplies the sessionId). The
// button reads the current subscription state from the host bridge and toggles
// it via POST/DELETE /api/dsh-tl/subscriptions; the macOS overlay picks the
// change up on its next poll.
//
// Note: the session-rail "…" menu (rename/fork/archive) lives in
// dsh-client-ui-workspace and is NOT extensible through any supported slot, so
// the subscription entry is placed in the conversation header instead.
import * as React from 'react'

const NS = 'dsh-trafficlight'

// ── Locale dictionaries ────────────────────────────────────────────────
const zh: Record<string, string> = {
  'section.title': '🚦 红绿灯悬浮窗',
  'section.desc': '配置 macOS 全局悬浮窗的外观和行为',
  'opacity.label': '悬浮窗透明度',
  'minimal.label': '极简模式',
  'minimal.desc': '只显示一个大信号灯，忽略具体会话',
  'breathCount.label': '呼吸次数',
  'breathCount.desc': '每次状态变化时灯放大/缩小的次数',
  'breathCount.unit': ' 次',
  'breathBeat.label': '呼吸速度',
  'breathBeat.desc': '每次放大或回落的持续时间',
  'sound.label': '状态提示音',
  'sound.desc': '会话阻塞或完成时播放系统提示音',
  'soundVolume.label': '提示音量',
  'preview.title': '预览',
  'preview.desc': '实时预览当前参数效果',
  'preview.running': '执行中',
  'preview.blocked': '阻塞',
  'preview.done': '已完成',
  'preview.idle': '空闲',
}

const en: Record<string, string> = {
  'section.title': '🚦 Traffic Light Overlay',
  'section.desc': 'Configure the macOS global floating window appearance and behavior',
  'opacity.label': 'Overlay Opacity',
  'minimal.label': 'Minimal Mode',
  'minimal.desc': 'Show only a single big lamp, ignore individual sessions',
  'breathCount.label': 'Breath Count',
  'breathCount.desc': 'Number of scale pulses per state change',
  'breathCount.unit': '',
  'breathBeat.label': 'Breath Speed',
  'breathBeat.desc': 'Duration of each scale-up / scale-down',
  'sound.label': 'Status Cue Sound',
  'sound.desc': 'Play a system sound when a session becomes blocked or done',
  'soundVolume.label': 'Cue Volume',
  'preview.title': 'Preview',
  'preview.desc': 'Live preview of current parameter effects',
  'preview.running': 'Running',
  'preview.blocked': 'Blocked',
  'preview.done': 'Done',
  'preview.idle': 'Idle',
}

// ── Current subscription set (module-level, shared across header buttons) ──
let subscribedIds = new Set<string>()
let refreshInFlight: Promise<Set<string>> | undefined

interface State { subscribed: boolean; busy: boolean }

async function fetchState(): Promise<Set<string>> {
  const res = await fetch('/api/dsh-tl/state', { cache: 'no-store' })
  if (!res.ok) throw new Error('state ' + res.status)
  const body = (await res.json()) as { ok: boolean; value?: { subscribed?: string[] } }
  const ids = body.ok ? (body.value?.subscribed ?? []) : []
  return new Set(ids)
}

function refresh(): Promise<Set<string>> {
  if (refreshInFlight === undefined) {
    refreshInFlight = fetchState()
      .then((ids) => { subscribedIds = ids; return ids })
      .finally(() => { refreshInFlight = undefined })
  }
  return refreshInFlight
}

async function toggle(sessionId: string, next: boolean): Promise<boolean> {
  try {
    const res = await fetch('/api/dsh-tl/subscriptions' + (next ? '' : '?sessionId=' + encodeURIComponent(sessionId)), {
      method: next ? 'POST' : 'DELETE',
      headers: next ? { 'content-type': 'application/json' } : undefined,
      body: next ? JSON.stringify({ sessionId }) : undefined,
      cache: 'no-store',
    })
    if (!res.ok) return false
    const body = (await res.json()) as { ok: boolean; value?: { subscribed?: string[]; changed?: boolean } }
    if (body.ok) subscribedIds = new Set(body.value?.subscribed ?? [])
    return body.ok !== false
  } catch {
    return false
  }
}

// ── API helpers ────────────────────────────────────────────────────────
const OPACITY_MIN = 0.1
const OPACITY_MAX = 1
const OPACITY_STEP = 0.01
const BREATH_COUNT_MIN = 1
const BREATH_COUNT_MAX = 6
const BREATH_BEAT_MIN = 0.1
const BREATH_BEAT_MAX = 1.0
const BREATH_BEAT_STEP = 0.05
const SOUND_VOLUME_MIN = 0
const SOUND_VOLUME_MAX = 1
const SOUND_VOLUME_STEP = 0.05

async function fetchOpacity(): Promise<number> {
  try {
    const res = await fetch('/api/dsh-tl/opacity', { cache: 'no-store' })
    if (!res.ok) return OPACITY_MAX
    const body = (await res.json()) as { ok: boolean; value?: { opacity?: number } }
    if (body.ok && body.value && typeof body.value.opacity === 'number') return body.value.opacity
  } catch { /* ignore */ }
  return OPACITY_MAX
}

async function saveOpacity(opacity: number): Promise<void> {
  try {
    await fetch('/api/dsh-tl/opacity', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ opacity }), cache: 'no-store',
    })
  } catch { /* ignore */ }
}

async function fetchMinimalMode(): Promise<boolean> {
  try {
    const res = await fetch('/api/dsh-tl/minimal', { cache: 'no-store' })
    if (!res.ok) return false
    const body = (await res.json()) as { ok: boolean; value?: { minimalMode?: boolean } }
    if (body.ok && body.value && typeof body.value.minimalMode === 'boolean') return body.value.minimalMode
  } catch { /* ignore */ }
  return false
}

async function saveMinimalMode(minimalMode: boolean): Promise<void> {
  try {
    await fetch('/api/dsh-tl/minimal', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ minimalMode }), cache: 'no-store',
    })
  } catch { /* ignore */ }
}

async function fetchBreath(): Promise<{ count: number; beat: number }> {
  try {
    const res = await fetch('/api/dsh-tl/breath', { cache: 'no-store' })
    if (!res.ok) return { count: 3, beat: 0.35 }
    const body = (await res.json()) as { ok: boolean; value?: { breathCount?: number; breathBeat?: number } }
    if (body.ok && body.value) {
      return {
        count: typeof body.value.breathCount === 'number' ? body.value.breathCount : 3,
        beat: typeof body.value.breathBeat === 'number' ? body.value.breathBeat : 0.35,
      }
    }
  } catch { /* ignore */ }
  return { count: 3, beat: 0.35 }
}

async function saveBreath(count: number, beat: number): Promise<void> {
  try {
    await fetch('/api/dsh-tl/breath', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ breathCount: count, breathBeat: beat }), cache: 'no-store',
    })
  } catch { /* ignore */ }
}

async function fetchSound(): Promise<{ enabled: boolean; volume: number }> {
  try {
    const res = await fetch('/api/dsh-tl/sound', { cache: 'no-store' })
    if (!res.ok) return { enabled: true, volume: 0.6 }
    const body = (await res.json()) as { ok: boolean; value?: { soundEnabled?: unknown; soundVolume?: unknown } }
    if (body.ok && body.value) {
      return {
        enabled: body.value.soundEnabled === true,
        volume: typeof body.value.soundVolume === 'number' ? body.value.soundVolume : 0.6,
      }
    }
  } catch { /* ignore */ }
  return { enabled: true, volume: 0.6 }
}

async function saveSound(enabled: boolean, volume: number): Promise<void> {
  try {
    await fetch('/api/dsh-tl/sound', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ soundEnabled: enabled, soundVolume: volume }), cache: 'no-store',
    })
  } catch { /* ignore */ }
}

// ── Shared UI primitives ───────────────────────────────────────────────

/** CSS variable-based label colors matching DeepSeek theme. */
const LABEL_STYLE: React.CSSProperties = { fontSize: 12.5, color: 'var(--dsw-alias-label-primary)', whiteSpace: 'nowrap', flexShrink: 0 }
const LABEL_SECONDARY: React.CSSProperties = { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' }

/** Fixed-width value badge so all sliders align on the right edge. */
const VALUE_WIDTH = 44

function SettingsRow({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={LABEL_STYLE}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>{children}</div>
      </div>
      {hint && <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary, rgba(0,0,0,0.4))' }}>{hint}</div>}
    </div>
  )
}

/** Styled checkbox matching DeepSeek theme (accentColor picks up brand blue). */
function StyledCheckbox({ checked, disabled, onChange, label }: {
  checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void; label: string
}): React.JSX.Element {
  return (
    <input type="checkbox" aria-label={label} checked={checked} disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      style={{
        width: 16, height: 16, cursor: disabled ? 'default' : 'pointer',
        accentColor: 'var(--dsw-alias-brand-primary, #3964fe)',
      }} />
  )
}

// ── Subscribe button (conversation header) ─────────────────────────────

function SubscribeAction(_props: Record<string, unknown>): React.JSX.Element {
  const sessionId = String(_props.sessionId ?? '')
  const [state, setState] = React.useState<State>({ subscribed: false, busy: false })

  React.useEffect(() => {
    let alive = true
    // Poll: the subscription can also change from the floating overlay's row
    // buttons or the docked sidebar panel, so refresh the chip periodically.
    const sync = (): void => {
      void refresh().then(() => {
        if (alive) setState((s) => ({ ...s, subscribed: subscribedIds.has(sessionId) }))
      })
    }
    sync()
    const timer = setInterval(sync, 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [sessionId])

  const onClick = async (): Promise<void> => {
    if (state.busy || sessionId === '') return
    setState((s) => ({ ...s, busy: true }))
    const ok = await toggle(sessionId, !state.subscribed)
    if (ok) setState((s) => ({ ...s, subscribed: !s.subscribed }))
    setState((s) => ({ ...s, busy: false }))
  }

  const active = state.subscribed
  return (
    <button type="button" onClick={() => void onClick()}
      title={active ? '取消红绿灯订阅（悬浮窗将移除该会话）' : '添加红绿灯订阅（悬浮窗跟踪该会话状态）'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, height: 22, padding: '0 8px', borderRadius: 6,
        border: '1px solid ' + (active ? '#5b8cff' : 'rgba(128,128,128,0.45)'),
        background: active ? 'rgba(91,140,255,0.14)' : 'transparent',
        color: active ? '#5b8cff' : 'currentColor',
        fontSize: 11, lineHeight: 1, cursor: state.busy ? 'wait' : 'pointer',
        opacity: state.busy ? 0.6 : 1, whiteSpace: 'nowrap',
      }}>
      <span style={{ fontSize: 12 }}>🚦</span>
      <span>{active ? '已订阅' : '订阅'}</span>
    </button>
  )
}

// ── Preview lamp (CSS animation) ──────────────────────────────────────

function PreviewLamp({ color, breathCount, breathBeat, opacity }: {
  color: string; breathCount: number; breathBeat: number; opacity: number
}): React.JSX.Element {
  const totalDuration = breathCount * breathBeat * 2
  // Build keyframes: for each beat, scale up then back.
  const keyframeParts: string[] = []
  for (let i = 0; i < breathCount; i++) {
    const pctUp = ((i * 2 + 1) / (breathCount * 2)) * 100
    const pctDown = ((i * 2 + 2) / (breathCount * 2)) * 100
    keyframeParts.push(`${pctUp.toFixed(1)}% { transform: scale(1.35); }`)
    keyframeParts.push(`${pctDown.toFixed(1)}% { transform: scale(1); }`)
  }
  const keyframeName = `tl-breathe-${breathCount}-${Math.round(breathBeat * 100)}`
  const keyframeCSS = `@keyframes ${keyframeName} { ${keyframeParts.join(' ')} }`

  return (
    <>
      <style>{keyframeCSS}</style>
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        background: color, opacity,
        boxShadow: `0 0 ${12 * opacity}px ${color}`,
        animation: `${keyframeName} ${totalDuration}s ease-in-out infinite`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }} />
    </>
  )
}

// ── TrafficLightSection (settings.section component) ───────────────────

function TrafficLightSection({ t }: { t?: (key: string) => string }): React.JSX.Element {
  const tl = (key: string): string => {
    const translated = t?.(key)
    return translated && translated !== key ? translated : (zh[key] ?? key)
  }

  const [opacity, setOpacity] = React.useState(OPACITY_MAX)
  const [minimal, setMinimal] = React.useState(false)
  const [breathCount, setBreathCount] = React.useState(3)
  const [breathBeat, setBreathBeat] = React.useState(0.35)
  const [soundEnabled, setSoundEnabled] = React.useState(true)
  const [soundVolume, setSoundVolume] = React.useState(0.6)
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    let alive = true
    void Promise.all([fetchOpacity(), fetchMinimalMode(), fetchBreath(), fetchSound()]).then(([o, m, b, s]) => {
      if (alive) { setOpacity(o); setMinimal(m); setBreathCount(b.count); setBreathBeat(b.beat); setSoundEnabled(s.enabled); setSoundVolume(s.volume); setReady(true) }
    })
    return () => { alive = false }
  }, [])

  const onOpacityChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const v = Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, Number(e.target.value) || OPACITY_MIN))
    setOpacity(v); void saveOpacity(v)
  }
  const onMinimalChange = (v: boolean): void => { setMinimal(v); void saveMinimalMode(v) }
  const onSoundEnabledChange = (v: boolean): void => { setSoundEnabled(v); void saveSound(v, soundVolume) }
  const onSoundVolumeChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const v = Math.min(SOUND_VOLUME_MAX, Math.max(SOUND_VOLUME_MIN, Math.round(Number(e.target.value) * 100) / 100))
    setSoundVolume(v); void saveSound(soundEnabled, v)
  }
  const onBreathCountChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const v = Math.min(BREATH_COUNT_MAX, Math.max(BREATH_COUNT_MIN, Math.round(Number(e.target.value) || 1)))
    setBreathCount(v); void saveBreath(v, breathBeat)
  }
  const onBreathBeatChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const v = Math.min(BREATH_BEAT_MAX, Math.max(BREATH_BEAT_MIN, Math.round(Number(e.target.value) * 100) / 100))
    setBreathBeat(v); void saveBreath(breathCount, v)
  }

  const beatMs = Math.round(breathBeat * 1000)

  // Color palette for preview lamps — using DeepSeek theme state colors
  const lampColors = [
    { label: tl('preview.blocked'), color: 'var(--dsw-alias-state-error-primary, #ef4444)' },
    { label: tl('preview.running'), color: 'var(--dsw-alias-state-warn-primary, #eab308)' },
    { label: tl('preview.done'), color: 'var(--dsw-alias-state-success-primary, #22c55e)' },
    { label: tl('preview.idle'), color: 'var(--dsw-alias-label-tertiary, #9ca3af)' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      {/* Section header */}
      <div style={{
        padding: '16px 20px 12px',
        borderBottom: '1px solid var(--dsw-alias-border-subtle, rgba(0,0,0,0.06))',
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', marginBottom: 2 }}>
          {tl('section.title')}
        </div>
        <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>
          {tl('section.desc')}
        </div>
      </div>

      {/* Settings controls */}
      <div style={{ padding: '8px 20px 16px' }}>
        <SettingsRow label={tl('opacity.label')}>
          <input aria-label={tl('opacity.label')} type="range"
            min={OPACITY_MIN} max={OPACITY_MAX} step={OPACITY_STEP} value={opacity}
            disabled={!ready} onChange={onOpacityChange} style={{ flex: 1, minWidth: 0 }} />
          <span style={{ ...LABEL_SECONDARY, width: VALUE_WIDTH, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            {opacity.toFixed(2)}
          </span>
        </SettingsRow>
        <SettingsRow label={tl('minimal.label')} hint={tl('minimal.desc')}>
          <div style={{ flex: 1 }} />
          <StyledCheckbox checked={minimal} disabled={!ready} onChange={onMinimalChange} label={tl('minimal.label')} />
        </SettingsRow>
        <SettingsRow label={tl('sound.label')} hint={tl('sound.desc')}>
          <div style={{ flex: 1 }} />
          <StyledCheckbox checked={soundEnabled} disabled={!ready} onChange={onSoundEnabledChange} label={tl('sound.label')} />
        </SettingsRow>
        <SettingsRow label={tl('soundVolume.label')}>
          <input aria-label={tl('soundVolume.label')} type="range"
            min={SOUND_VOLUME_MIN} max={SOUND_VOLUME_MAX} step={SOUND_VOLUME_STEP} value={soundVolume}
            disabled={!ready || !soundEnabled} onChange={onSoundVolumeChange} style={{ flex: 1, minWidth: 0 }} />
          <span style={{ ...LABEL_SECONDARY, width: VALUE_WIDTH, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            {Math.round(soundVolume * 100)}%
          </span>
        </SettingsRow>
        <SettingsRow label={tl('breathCount.label')} hint={tl('breathCount.desc')}>
          <input aria-label={tl('breathCount.label')} type="range"
            min={BREATH_COUNT_MIN} max={BREATH_COUNT_MAX} step={1} value={breathCount}
            disabled={!ready} onChange={onBreathCountChange} style={{ flex: 1, minWidth: 0 }} />
          <span style={{ ...LABEL_SECONDARY, width: VALUE_WIDTH, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            {breathCount}{tl('breathCount.unit') ?? ' 次'}
          </span>
        </SettingsRow>
        <SettingsRow label={tl('breathBeat.label')} hint={tl('breathBeat.desc')}>
          <input aria-label={tl('breathBeat.label')} type="range"
            min={BREATH_BEAT_MIN} max={BREATH_BEAT_MAX} step={BREATH_BEAT_STEP} value={breathBeat}
            disabled={!ready} onChange={onBreathBeatChange} style={{ flex: 1, minWidth: 0 }} />
          <span style={{ ...LABEL_SECONDARY, width: VALUE_WIDTH, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            {beatMs}ms
          </span>
        </SettingsRow>
      </div>

      {/* Preview section */}
      <div style={{
        padding: '12px 20px 16px',
        borderTop: '1px solid var(--dsw-alias-border-subtle, rgba(0,0,0,0.06))',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', marginBottom: 2 }}>
          {tl('preview.title')}
        </div>
        <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginBottom: 12 }}>
          {tl('preview.desc')}
        </div>

        {/* Preview: minimal mode single lamp */}
        {minimal && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px',
            borderRadius: 12, background: 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.04))',
            marginBottom: 12,
          }}>
            <PreviewLamp color="var(--dsw-alias-state-warn-primary, #eab308)" breathCount={breathCount} breathBeat={breathBeat} opacity={opacity} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }}>
                极简模式
              </div>
              <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-secondary)' }}>
                单灯 · 透明度 {opacity.toFixed(2)} · {breathCount}次 · {beatMs}ms
              </div>
            </div>
          </div>
        )}

        {/* Preview: full mode all lamps */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px',
          borderRadius: 12, background: 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.04))',
        }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            {lampColors.map((lamp) => (
              <div key={lamp.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <PreviewLamp color={lamp.color} breathCount={breathCount} breathBeat={breathBeat} opacity={opacity} />
                <span style={{ fontSize: 10, color: 'var(--dsw-alias-label-tertiary)' }}>
                  {lamp.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Plugin entry ───────────────────────────────────────────────────────

/** The entry apply(). */

// ── Docked sidebar panel ───────────────────────────────────────────────
interface DockRow { sessionId: string; title: string; state: string }
interface DockSnapshot { mode?: string; sessions?: DockRow[] }

const DOCK_COLORS: Record<string, string> = {
  blocked: '#ff453a', running: '#ffd60a', done: '#30d158', idle: '#8e8e93',
}
const DOCK_LABELS: Record<string, string> = {
  blocked: '等待处理', running: '执行中', done: '已完成', idle: '空闲',
}
const DOCK_POLL_MS = 1000

function postDock(path: string, body?: unknown): void {
  void fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }).catch(() => {})
}

/**
 * In-page twin of the macOS floating panel, mounted in the official
 * `sidebar.footer.action` slot. While the floating panel is active it renders
 * a persistent dashed drop target instead, so the workspace list ends above
 * the dock area and nothing overlaps.
 */
function DockedPanel(): React.JSX.Element | null {
  const [snapshot, setSnapshot] = React.useState<DockSnapshot | null>(null)

  React.useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = (): void => {
      fetch('/api/dsh-tl/state', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() as Promise<{ ok?: boolean; value?: DockSnapshot }> : null))
        .then((body) => {
          if (!alive) return
          setSnapshot(body?.ok ? body.value ?? null : null)
          if (body?.ok && body.value?.mode === 'docked') {
            // Prove the sidebar twin is alive; the host reverts to the floating
            // panel if this heartbeat never arrives.
            void fetch('/api/dsh-tl/dockbeat', { method: 'POST' }).catch(() => {})
          }
        })
        .catch(() => {})
      if (alive) timer = setTimeout(tick, DOCK_POLL_MS)
    }
    tick()
    return () => {
      alive = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])

  if (snapshot === null) return null

  if (snapshot.mode !== 'docked') {
    return (
      <div style={{
        width: '100%', boxSizing: 'border-box', margin: '2px 4px 6px', padding: '0 8px', height: 64,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        border: '1.5px dashed var(--dsw-alias-border-default, rgba(200,200,200,0.32))',
        borderRadius: 10, fontSize: 11,
        color: 'var(--dsw-alias-label-tertiary, rgba(255,255,255,0.5))',
        userSelect: 'none',
      }}>
        🚦 拖到这里固定
      </div>
    )
  }

  const rows = Array.isArray(snapshot.sessions) ? snapshot.sessions : []
  const focusRow = (sessionId: string): void => postDock('/api/dsh-tl/focus', { sessionId })
  const unsubscribeRow = (sessionId: string): void => {
    void fetch('/api/dsh-tl/subscriptions?sessionId=' + encodeURIComponent(sessionId), { method: 'DELETE' }).catch(() => {})
  }
  const undock = (): void => postDock('/api/dsh-tl/mode', { mode: 'floating' })

  return (
    <div style={{
      width: '100%', boxSizing: 'border-box', padding: '0 4px 6px', marginTop: 4,
      borderTop: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.18))',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 2px 4px' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #e6e6e6)' }}>🚦 任务状态</span>
        <span style={{ flex: 1 }} />
        <button onClick={undock} title="把红绿灯放回 macOS 悬浮窗" style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 6,
          border: '1px solid var(--dsw-alias-border-default, rgba(128,128,128,0.35))',
          background: 'transparent', color: 'var(--dsw-alias-label-secondary, rgba(255,255,255,0.7))', cursor: 'pointer',
        }}>悬浮窗</button>
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary, rgba(255,255,255,0.5))', padding: '2px 2px 6px' }}>
          在会话标题栏点击 🚦 订阅，这里会显示任务状态
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: '30vh', overflowY: 'auto' }}>
          {rows.map((row) => {
            const color = DOCK_COLORS[row.state] ?? DOCK_COLORS.idle
            return (
              <div key={row.sessionId} onClick={() => focusRow(row.sessionId)} title="跳转到该会话"
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6, cursor: 'pointer' }}
                onMouseEnter={(event) => { event.currentTarget.style.background = 'rgba(127,127,127,0.14)' }}
                onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent' }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', background: color, flex: 'none',
                  boxShadow: row.state === 'running' ? `0 0 6px ${color}` : 'none',
                }} />
                <span style={{
                  fontSize: 12, color: 'var(--dsw-alias-label-primary, #e6e6e6)', flex: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{row.title || row.sessionId}</span>
                <span style={{ fontSize: 10, color, flex: 'none' }}>{DOCK_LABELS[row.state] ?? DOCK_LABELS.idle}</span>
                <button onClick={(event) => { event.stopPropagation(); unsubscribeRow(row.sessionId) }} title="取消订阅" style={{
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  color: 'var(--dsw-alias-label-tertiary, rgba(255,255,255,0.4))', fontSize: 12, lineHeight: 1, padding: '0 2px',
                }}>✕</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function apply(ctx: { effect(fn: () => () => void, name: string): void }): void {
  ctx.effect(() => {
    const disposers: Array<() => void> = []
    const slotsService = (ctx as unknown as {
      slots?: { inject?(k: string, cb: () => () => void): () => void; register?(o: unknown, c: unknown): () => void }
    }).slots
    const localeService = (ctx as unknown as {
      locale?: { register?(ns: string, dicts: Record<string, Record<string, string>>): void; bind?(ns: string): (key: string) => string }
    }).locale

    // Register locale dictionaries if available.
    if (localeService !== undefined && typeof localeService.register === 'function') {
      try { localeService.register(NS, { zh, en }) } catch { /* ignore */ }
    }
    const t = localeService !== undefined && typeof localeService.bind === 'function'
      ? localeService.bind(NS)
      : (key: string): string => zh[key] ?? key

    const openFocusedSession = (sessionId: string): void => {
      if (sessionId === '') return
      try {
        const get = (ctx as unknown as { get?(name: string): unknown }).get
        const root = ctx as unknown as {
          uiWorkspace?: { openSession?(id: string): void }
          sessions?: { open?(id: string): void }
        }
        const workspace = (typeof get === 'function' ? get.call(ctx, 'uiWorkspace') : root.uiWorkspace) as { openSession?(id: string): void } | undefined
        if (workspace !== undefined && typeof workspace.openSession === 'function') {
          workspace.openSession(sessionId)
          return
        }
        const sessions = (typeof get === 'function' ? get.call(ctx, 'sessions') : root.sessions) as { open?(id: string): void } | undefined
        sessions?.open?.(sessionId)
      } catch (error) {
        console.warn('[dsh-trafficlight] could not open session', error)
      }
    }
    const focusTimer = setInterval(() => {
      void fetch('/api/dsh-tl/focus', { cache: 'no-store' })
        .then((res) => res.ok ? res.json() as Promise<{ ok?: boolean; value?: { sessionId?: unknown } }> : null)
        .then((body) => {
          const sessionId = body?.ok ? body.value?.sessionId : null
          if (typeof sessionId === 'string' && sessionId !== '') openFocusedSession(sessionId)
        })
        .catch(() => {})
    }, 800)

    if (slotsService !== undefined && typeof slotsService.inject === 'function' && typeof slotsService.register === 'function') {
      const register = (slot: string, id: string, order: number, component: React.JSXElementConstructor<Record<string, unknown>>, extra?: Record<string, unknown>): void => {
        try {
          disposers.push(
            slotsService.inject!(slot, () =>
              slotsService.register!(
                { name: slot, id: NS + '-' + id, order, registrant: NS, locale: NS, ...extra } as unknown as never,
                component as never,
              ) as () => void,
            ),
          )
        } catch (e) {
          console.error(`[dsh-trafficlight] slot inject failed: ${slot}`, e)
        }
      }

      // Per-session「🚦 订阅」toggle in the conversation header.
      register('conversation.session.header.actions', 'subscribe', 1000, SubscribeAction as unknown as React.ComponentType<Record<string, unknown>>)

      // Sidebar footer: persistent drop target / docked panel.
      register('sidebar.footer.action', 'docked', 40, DockedPanel as unknown as React.ComponentType<Record<string, unknown>>)

      // 红绿灯独立设置分区 — pass `t` via inject so the section can translate.
      register('settings.section', 'trafficlight', 50, TrafficLightSection as unknown as React.ComponentType<Record<string, unknown>>, {
        label: () => t('section.title'),
        inject: () => ({ t }),
      })
    } else {
      console.warn('[dsh-trafficlight] slots service unavailable — header action / settings card not mounted')
    }
    return () => {
      clearInterval(focusTimer)
      for (const dispose of disposers) { try { dispose() } catch { /* ignore */ } }
    }
  }, NS + ': slot registration')
}

export const name = NS

/** Required services: the slot registry + locale (optional, for i18n). */
export const inject = ['slots', 'locale']
