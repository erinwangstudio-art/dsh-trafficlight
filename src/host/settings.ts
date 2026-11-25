// host/settings.ts — persisted user-configurable settings for the traffic
// light. Today only the overlay opacity lives here; the store keeps the value
// in a small JSON file so it survives dsh web restarts (same convention as
// subscriptions.ts).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { PresentationMode } from '../core/types.ts'

/** Default overlay opacity. Full value matches the current look; lower = more transparent. */
export const DEFAULT_OPACITY = 1

/** Inclusive range the settings card exposes (kept in sync with the slider). */
export const OPACITY_MIN = 0.1
export const OPACITY_MAX = 1

/** Breathing: how many up-and-down beats per state change (1..6). */
export const DEFAULT_BREATH_COUNT = 3
export const BREATH_COUNT_MIN = 1
export const BREATH_COUNT_MAX = 6
/** Breathing: width of one beat (seconds) — the scale-up (and scale-down) travel time. */
export const DEFAULT_BREATH_BEAT = 0.35
export const BREATH_BEAT_MIN = 0.1
export const BREATH_BEAT_MAX = 1.0

/** Status cue sound. Default on at a moderate volume. */
export const DEFAULT_SOUND_ENABLED = true
export const DEFAULT_SOUND_VOLUME = 0.6
export const SOUND_VOLUME_MIN = 0
export const SOUND_VOLUME_MAX = 1

/** Where the traffic light lives: the floating macOS panel or the DSH sidebar. */
export const DEFAULT_MODE: PresentationMode = 'floating'
export const MODES: PresentationMode[] = ['floating', 'docked']

/** Clamp a raw mode to the supported set. */
export function clampMode(value: unknown, fallback: PresentationMode = DEFAULT_MODE): PresentationMode {
  return value === 'docked' || value === 'floating' ? value : fallback
}

/** Resolve the persistence file. Override with DSH_TL_SETTINGS_FILE; otherwise
 *  the dsh storage convention `~/.dsh/storages/<name>.json`. */
export function defaultSettingsFile(): string {
  if (process.env.DSH_TL_SETTINGS_FILE) return process.env.DSH_TL_SETTINGS_FILE
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'storages', 'dsh-trafficlight-settings.json')
}

/** Clamp a raw value into [OPACITY_MIN, OPACITY_MAX] (fall back to default). */
export function clampOpacity(value: unknown, fallback = DEFAULT_OPACITY): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, Math.round(value * 100) / 100))
}

/** Clamp breath count to an integer in [BREATH_COUNT_MIN, BREATH_COUNT_MAX]. */
export function clampBreathCount(value: unknown, fallback = DEFAULT_BREATH_COUNT): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const n = Math.round(value)
  return Math.min(BREATH_COUNT_MAX, Math.max(BREATH_COUNT_MIN, n))
}

/** Clamp breath beat width to [BREATH_BEAT_MIN, BREATH_BEAT_MAX] with 2-decimals. */
export function clampBreathBeat(value: unknown, fallback = DEFAULT_BREATH_BEAT): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.round(Math.min(BREATH_BEAT_MAX, Math.max(BREATH_BEAT_MIN, value)) * 100) / 100
}

export class SettingsStore {
  private opacityValue: number = DEFAULT_OPACITY
  private minimalValue = false
  private breathCountValue: number = DEFAULT_BREATH_COUNT
  private breathBeatValue: number = DEFAULT_BREATH_BEAT
  private modeValue: PresentationMode = DEFAULT_MODE
  private soundEnabledValue = DEFAULT_SOUND_ENABLED
  private soundVolumeValue: number = DEFAULT_SOUND_VOLUME
  private readonly file: string
  private readonly ctx: Context
  private saveTimer: ReturnType<typeof setTimeout> | undefined

  constructor(ctx: Context, file: string) {
    this.ctx = ctx
    this.file = file
    this.load()
  }

  opacity(): number {
    return this.opacityValue
  }

  /** Whether the overlay should run in minimal (single-lamp) mode. */
  minimalMode(): boolean {
    return this.minimalValue
  }

  /** Breathing beats per state change (1..6). */
  breathCount(): number {
    return this.breathCountValue
  }

  /** Breathing beat width in seconds (0.1..1). */
  breathBeat(): number {
    return this.breathBeatValue
  }

  /** Presentation mode: 'floating' (macOS panel) or 'docked' (in-page sidebar). */
  mode(): PresentationMode {
    return this.modeValue
  }

  soundEnabled(): boolean {
    return this.soundEnabledValue
  }

  soundVolume(): number {
    return this.soundVolumeValue
  }

  setSoundEnabled(value: unknown): boolean {
    this.soundEnabledValue = value === true
    this.scheduleSave()
    return this.soundEnabledValue
  }

  setSoundVolume(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return this.soundVolumeValue
    this.soundVolumeValue = Math.min(SOUND_VOLUME_MAX, Math.max(SOUND_VOLUME_MIN, Math.round(value * 100) / 100))
    this.scheduleSave()
    return this.soundVolumeValue
  }

  /** Set the presentation mode and persist. Returns the accepted value. */
  setMode(value: unknown): PresentationMode {
    this.modeValue = clampMode(value)
    this.scheduleSave()
    return this.modeValue
  }

  /** Set opacity and persist. Returns the clamped, accepted value. */
  setOpacity(value: unknown): number {
    this.opacityValue = clampOpacity(value)
    this.scheduleSave()
    return this.opacityValue
  }

  /** Set minimal mode and persist. Returns the accepted value. */
  setMinimalMode(value: unknown): boolean {
    this.minimalValue = value === true
    this.scheduleSave()
    return this.minimalValue
  }

  /** Set breath count and persist. Returns the accepted value. */
  setBreathCount(value: unknown): number {
    this.breathCountValue = clampBreathCount(value)
    this.scheduleSave()
    return this.breathCountValue
  }

  /** Set breath beat width and persist. Returns the accepted value. */
  setBreathBeat(value: unknown): number {
    this.breathBeatValue = clampBreathBeat(value)
    this.scheduleSave()
    return this.breathBeatValue
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (typeof parsed === 'object' && parsed !== null) {
        const obj = parsed as Record<string, unknown>
        if (obj.opacity !== undefined) this.opacityValue = clampOpacity(obj.opacity)
        if (obj.minimalMode !== undefined) this.minimalValue = obj.minimalMode === true
        if (obj.breathCount !== undefined) this.breathCountValue = clampBreathCount(obj.breathCount)
        if (obj.breathBeat !== undefined) this.breathBeatValue = clampBreathBeat(obj.breathBeat)
        if (obj.mode !== undefined) this.modeValue = clampMode(obj.mode)
        if (obj.soundEnabled !== undefined) this.soundEnabledValue = obj.soundEnabled === true
        if (obj.soundVolume !== undefined) this.setSoundVolume(obj.soundVolume)
      }
    } catch {
      // First run / corrupt file → defaults.
    }
  }

  /** Debounced atomic write, same burst-friendly pattern as subscriptions. */
  private scheduleSave(): void {
    if (this.saveTimer !== undefined) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.save(), 300)
  }

  private save(): void {
    this.saveTimer = undefined
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = this.file + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(
        {
          opacity: this.opacityValue,
          minimalMode: this.minimalValue,
          breathCount: this.breathCountValue,
          breathBeat: this.breathBeatValue,
          mode: this.modeValue,
          soundEnabled: this.soundEnabledValue,
          soundVolume: this.soundVolumeValue,
        }, null, 2), 'utf8')
      fs.renameSync(tmp, this.file)
    } catch (error) {
      this.warn(`settings persist failed: ${String(error)}`)
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