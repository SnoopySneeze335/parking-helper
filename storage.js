export const SAVED_SPOT_KEY = "parkingHelper.savedSpot";

let memoryFallback = null;
let storageAvailable = null;
let lastSuccessfulWriteAt = null;

function reportStorageFailure(action, error) {
  storageAvailable = false;
  console.warn(`[Parking Helper] Could not ${action} saved parking data.`, error);
}

function parseStoredValue(rawValue) {
  if (!rawValue || !rawValue.trim()) return null;
  try {
    const value = JSON.parse(rawValue);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value;
  } catch (error) {
    console.warn("[Parking Helper] Ignoring invalid saved parking data.", error);
    return null;
  }
}

export function load() {
  try {
    const rawValue = window.localStorage.getItem(SAVED_SPOT_KEY);
    storageAvailable = true;
    const value = parseStoredValue(rawValue);
    memoryFallback = value;
    lastSuccessfulWriteAt = value?.lastWriteAt || null;
    return value;
  } catch (error) {
    reportStorageFailure("load", error);
    return memoryFallback;
  }
}

export function save(savedSpot) {
  const lastWriteAt = new Date().toISOString();
  const value = { ...savedSpot, lastWriteAt };
  memoryFallback = value;

  try {
    window.localStorage.setItem(SAVED_SPOT_KEY, JSON.stringify(value));
    storageAvailable = true;
    lastSuccessfulWriteAt = lastWriteAt;
  } catch (error) {
    reportStorageFailure("save", error);
  }
  return value;
}

export function clear() {
  memoryFallback = null;
  try {
    window.localStorage.removeItem(SAVED_SPOT_KEY);
    storageAvailable = true;
    lastSuccessfulWriteAt = new Date().toISOString();
  } catch (error) {
    reportStorageFailure("clear", error);
  }
}

function byteLength(value) {
  if (!value) return 0;
  try {
    return new TextEncoder().encode(value).byteLength;
  } catch {
    return value.length;
  }
}

export function getDebugInfo() {
  let rawValue = null;
  try {
    rawValue = window.localStorage.getItem(SAVED_SPOT_KEY);
    storageAvailable = true;
  } catch (error) {
    reportStorageFailure("inspect", error);
  }

  const parsed = parseStoredValue(rawValue);
  if (parsed?.lastWriteAt) lastSuccessfulWriteAt = parsed.lastWriteAt;
  let prettyValue = "(empty)";
  if (rawValue) {
    try {
      prettyValue = JSON.stringify(JSON.parse(rawValue), null, 2);
    } catch {
      prettyValue = rawValue;
    }
  } else if (storageAvailable === false && memoryFallback) {
    prettyValue = `${JSON.stringify(memoryFallback, null, 2)}\n\n(in-memory fallback; localStorage unavailable)`;
  }

  return {
    available: storageAvailable === true,
    key: SAVED_SPOT_KEY,
    rawValue,
    prettyValue,
    sizeBytes: byteLength(rawValue),
    lastSuccessfulWriteAt,
  };
}
