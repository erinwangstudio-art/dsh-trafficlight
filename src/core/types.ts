// core/types.ts — wire types shared between the host bridge and any client
// (native macOS overlay, in-page widget, mock bridge).
//
// Since the subscription redesign the snapshot carries a LIST of subscribed
// sessions, each with its own light state — the overlay renders one row per
// session instead of a single global light.

/** The four logical states of a traffic light. */
export type TrafficState = 'idle' | 'running' | 'blocked' | 'done'

/** Presentation of the light: floating macOS panel or docked in the DSH sidebar. */
export type PresentationMode = 'floating' | 'docked'

/** Per-session status row shown in the overlay. */
export interface SessionStatus {
  /** Stable dsh session id. */
  sessionId: string
  /**
   * Stable session title (derived from the session's first user message and
   * kept constant for the whole session). Placeholder for a subscribed but
   * not-yet-seen session.
   */
  title: string
  /** This session's own light state. */
  state: TrafficState
  /**
   * Transient, state-specific hint (e.g. the approval tool name or the asked
   * question while blocked). Empty otherwise.
   */
  detail?: string
}

/** A point-in-time snapshot of the subscribed session set. */
export interface TrafficSnapshot {
  /**
   * Aggregated light across the subscription set:
   * blocked if any subscribed session is blocked, else running if any is
   * running, else done if every subscribed session has finished, else idle
   * (no subscriptions or nothing started yet).
   */
  state: TrafficState
  /** Aggregated priority title (first non-idle subscribed session). */
  title: string
  /** Subscribed session statuses, in subscription order. */
  sessions: SessionStatus[]
  /** Current subscription ids (lets web UI render the toggle state). */
  subscribed: string[]
  /** User-facing overlay opacity (0.1..1). The native overlay applies this to the panel. */
  opacity: number
  /** Whether the overlay should run in minimal single-lamp mode. */
  minimalMode: boolean
  /** Breathing beats per state change (1..N). Consumed by the overlay lamps. */
  breathCount: number
  /** Breathing beat width in seconds (one scale-sweep). Consumed by the overlay lamps. */
  breathBeat: number
  /** Where the light lives: the macOS floating panel, or docked inside the DSH sidebar. */
  mode: PresentationMode
  /** Whether status cue sounds are enabled. */
  soundEnabled: boolean
  /** Cue sound volume (0..1). */
  soundVolume: number
  /** True while the in-page docked panel is reporting in (heartbeat < 15 s old). */
  dockHealthy: boolean
  /** Epoch milliseconds when this snapshot was produced. */
  updatedAt: number
}

/** Envelope for JSON routes (mirrors the panel system's ok/error convention). */
export type Envelope<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }