/**
 * Shared mic gain settings for sender audio processing.
 */

const STORAGE_KEY = 'sender-mic-gain';
const DEFAULT_GAIN = 1.2;
const MIN_GAIN = 0.0;
const MAX_GAIN = 3.0;

let cachedGain = null;

function clampGain(value) {
    return Math.min(MAX_GAIN, Math.max(MIN_GAIN, value));
}

function loadStoredGain() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === null) return DEFAULT_GAIN;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return DEFAULT_GAIN;
        return clampGain(parsed);
    } catch (err) {
        return DEFAULT_GAIN;
    }
}

export function getMicGain() {
    if (cachedGain === null) {
        cachedGain = loadStoredGain();
    }
    return cachedGain;
}

export function setMicGain(value) {
    const parsed = Number(value);
    const clamped = Number.isFinite(parsed) ? clampGain(parsed) : DEFAULT_GAIN;
    cachedGain = clamped;
    try {
        localStorage.setItem(STORAGE_KEY, String(clamped));
    } catch (err) {
        // Ignore storage failures (private mode, quota, etc.)
    }
    return clamped;
}

export function getMicGainStorageKey() {
    return STORAGE_KEY;
}
