/**
 * HISAPP — PERSISTENT STORAGE & FAIL-SAFE PROTECTION
 * ─────────────────────────────────────────────────────────────────
 * Requests explicit persistent storage permissions from the browser
 * so the Operating System / Browser (iOS Safari / Android Chrome)
 * NEVER evicts or clears IndexedDB records when device memory is low.
 */

export interface StorageHealth {
  isPersisted: boolean;
  usageBytes: number;
  quotaBytes: number;
  usagePercent: number;
}

/**
 * Request durable storage persistence from the browser
 */
export async function ensurePersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.persist) {
    return false;
  }
  try {
    const isAlreadyPersisted = await navigator.storage.persisted();
    if (isAlreadyPersisted) {
      return true;
    }
    const granted = await navigator.storage.persist();
    return granted;
  } catch (err) {
    console.warn('Persistent storage request note:', err);
    return false;
  }
}

/**
 * Check if the browser guarantees persistent storage
 */
export async function isStoragePersisted(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.persisted) {
    return false;
  }
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

/**
 * Inspect storage health, quota usage, and eviction safety
 */
export async function getStorageHealth(): Promise<StorageHealth> {
  const isPersisted = await isStoragePersisted();
  let usageBytes = 0;
  let quotaBytes = 0;

  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      usageBytes = estimate.usage || 0;
      quotaBytes = estimate.quota || 0;
    } catch {
      // ignore
    }
  }

  const usagePercent = quotaBytes > 0 ? (usageBytes / quotaBytes) * 100 : 0;

  return {
    isPersisted,
    usageBytes,
    quotaBytes,
    usagePercent,
  };
}
