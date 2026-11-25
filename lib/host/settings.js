// host/settings.ts — persisted user-configurable settings for the traffic
// light. Today only the overlay opacity lives here; the store keeps the value
// in a small JSON file so it survives dsh web restarts (same convention as
// subscriptions.ts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/** Default overlay opacity. Full value matches the current look; lower = more transparent. */
export const DEFAULT_OPACITY = 1;
/** Inclusive range the settings card exposes (kept in sync with the slider). */
export const OPACITY_MIN = 0.1;
export const OPACITY_MAX = 1;
/** Breathing: how many up-and-down beats per state change (1..6). */
export const DEFAULT_BREATH_COUNT = 3;
export const BREATH_COUNT_MIN = 1;
export const BREATH_COUNT_MAX = 6;
/** Breathing: width of one beat (seconds) — the scale-up (and scale-down) travel time. */
export const DEFAULT_BREATH_BEAT = 0.35;
export const BREATH_BEAT_MIN = 0.1;
export const BREATH_BEAT_MAX = 1.0;
export const DEFAULT_SOUND_ENABLED = true;
export const DEFAULT_SOUND_VOLUME = 0.6;
export const SOUND_VOLUME_MIN = 0;
export const SOUND_VOLUME_MAX = 1;
/** Where the traffic light lives: the floating macOS panel or docked in the DSH sidebar. */
export const DEFAULT_MODE = 'floating';
export const MODES = ['floating', 'docked'];
/** Clamp a raw mode to the supported set. */
export function clampMode(value, fallback = DEFAULT_MODE) {
    return MODES.includes(value) ? value : fallback;
}
/** Resolve the persistence file. Override with DSH_TL_SETTINGS_FILE; otherwise
 *  the dsh storage convention `~/.dsh/storages/<name>.json`. */
export function defaultSettingsFile() {
    if (process.env.DSH_TL_SETTINGS_FILE)
        return process.env.DSH_TL_SETTINGS_FILE;
    const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
    return path.join(home, 'storages', 'dsh-trafficlight-settings.json');
}
/** Clamp a raw value into [OPACITY_MIN, OPACITY_MAX] (fall back to default). */
export function clampOpacity(value, fallback = DEFAULT_OPACITY) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return fallback;
    return Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, Math.round(value * 100) / 100));
}
/** Clamp breath count to an integer in [BREATH_COUNT_MIN, BREATH_COUNT_MAX]. */
export function clampBreathCount(value, fallback = DEFAULT_BREATH_COUNT) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return fallback;
    const n = Math.round(value);
    return Math.min(BREATH_COUNT_MAX, Math.max(BREATH_COUNT_MIN, n));
}
/** Clamp breath beat width to [BREATH_BEAT_MIN, BREATH_BEAT_MAX] with 2-decimals. */
export function clampBreathBeat(value, fallback = DEFAULT_BREATH_BEAT) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return fallback;
    return Math.round(Math.min(BREATH_BEAT_MAX, Math.max(BREATH_BEAT_MIN, value)) * 100) / 100;
}
export class SettingsStore {
    opacityValue = DEFAULT_OPACITY;
    minimalValue = false;
    breathCountValue = DEFAULT_BREATH_COUNT;
    breathBeatValue = DEFAULT_BREATH_BEAT;
    modeValue = DEFAULT_MODE;
    soundEnabledValue = DEFAULT_SOUND_ENABLED;
    soundVolumeValue = DEFAULT_SOUND_VOLUME;
    file;
    ctx;
    saveTimer;
    constructor(ctx, file) {
        this.ctx = ctx;
        this.file = file;
        this.load();
    }
    opacity() {
        return this.opacityValue;
    }
    /** Whether the overlay should run in minimal (single-lamp) mode. */
    minimalMode() {
        return this.minimalValue;
    }
    /** Breathing beats per state change (1..6). */
    breathCount() {
        return this.breathCountValue;
    }
    /** Breathing beat width in seconds (0.1..1). */
    breathBeat() {
        return this.breathBeatValue;
    }
    /** Presentation mode: 'floating' (macOS panel) or 'docked' (in-page sidebar). */
    mode() {
        return this.modeValue;
    }
    soundEnabled() {
        return this.soundEnabledValue;
    }
    soundVolume() {
        return this.soundVolumeValue;
    }
    setSoundEnabled(value) {
        this.soundEnabledValue = value === true;
        this.scheduleSave();
        return this.soundEnabledValue;
    }
    setSoundVolume(value) {
        if (typeof value !== 'number' || !Number.isFinite(value))
            return this.soundVolumeValue;
        this.soundVolumeValue = Math.min(SOUND_VOLUME_MAX, Math.max(SOUND_VOLUME_MIN, Math.round(value * 100) / 100));
        this.scheduleSave();
        return this.soundVolumeValue;
    }
    /** Set the presentation mode and persist. Returns the accepted value. */
    setMode(value) {
        this.modeValue = clampMode(value);
        this.scheduleSave();
        return this.modeValue;
    }
    /** Set opacity and persist. Returns the clamped, accepted value. */
    setOpacity(value) {
        this.opacityValue = clampOpacity(value);
        this.scheduleSave();
        return this.opacityValue;
    }
    /** Set minimal mode and persist. Returns the accepted value. */
    setMinimalMode(value) {
        this.minimalValue = value === true;
        this.scheduleSave();
        return this.minimalValue;
    }
    /** Set breath count and persist. Returns the accepted value. */
    setBreathCount(value) {
        this.breathCountValue = clampBreathCount(value);
        this.scheduleSave();
        return this.breathCountValue;
    }
    /** Set breath beat width and persist. Returns the accepted value. */
    setBreathBeat(value) {
        this.breathBeatValue = clampBreathBeat(value);
        this.scheduleSave();
        return this.breathBeatValue;
    }
    load() {
        try {
            const raw = fs.readFileSync(this.file, 'utf8');
            const parsed = JSON.parse(raw);
            if (typeof parsed === 'object' && parsed !== null) {
                const obj = parsed;
                if (obj.opacity !== undefined)
                    this.opacityValue = clampOpacity(obj.opacity);
                if (obj.minimalMode !== undefined)
                    this.minimalValue = obj.minimalMode === true;
                if (obj.breathCount !== undefined)
                    this.breathCountValue = clampBreathCount(obj.breathCount);
                if (obj.breathBeat !== undefined)
                    this.breathBeatValue = clampBreathBeat(obj.breathBeat);
                if (obj.mode !== undefined)
                    this.modeValue = clampMode(obj.mode);
                if (obj.soundEnabled !== undefined)
                    this.soundEnabledValue = obj.soundEnabled === true;
                if (obj.soundVolume !== undefined)
                    this.setSoundVolume(obj.soundVolume);
            }
        }
        catch {
            // First run / corrupt file → defaults.
        }
    }
    /** Debounced atomic write, same burst-friendly pattern as subscriptions. */
    scheduleSave() {
        if (this.saveTimer !== undefined)
            clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.save(), 300);
    }
    save() {
        this.saveTimer = undefined;
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            const tmp = this.file + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify({
                opacity: this.opacityValue,
                minimalMode: this.minimalValue,
                breathCount: this.breathCountValue,
                breathBeat: this.breathBeatValue,
                mode: this.modeValue,
                soundEnabled: this.soundEnabledValue,
                soundVolume: this.soundVolumeValue,
            }, null, 2), 'utf8');
            fs.renameSync(tmp, this.file);
        }
        catch (error) {
            this.warn(`settings persist failed: ${String(error)}`);
        }
    }
    warn(message) {
        try {
            this.ctx.logger?.warn?.(`[dsh-trafficlight] ${message}`);
        }
        catch {
            /* ignore */
        }
    }
}
