/**
 * HISAPP — MULTI-TAB & CROSS-WINDOW LIVE SYNC
 * ─────────────────────────────────────────────────────────────────
 * Coordinates data changes across multiple open tabs or windows using
 * the standard BroadcastChannel API. When a visit is saved or settled in
 * one tab, all other open tabs refresh immediately without network roundtrips.
 */

type CrossTabMessage =
  | { type: 'DATA_CHANGED'; phone?: string; timestamp: number }
  | { type: 'SESSION_CHANGED'; phone?: string | null; timestamp: number };

type CrossTabListener = (msg: CrossTabMessage) => void;

class CrossTabSync {
  private channel: BroadcastChannel | null = null;
  private listeners = new Set<CrossTabListener>();

  constructor() {
    if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel('hisapp_tab_sync');
        this.channel.onmessage = (event) => {
          const data = event.data as CrossTabMessage;
          if (data && data.type) {
            this.notify(data);
          }
        };
      } catch (err) {
        console.warn('BroadcastChannel initialization note:', err);
      }
    }
  }

  /** Broadcast that data was added or modified locally */
  notifyDataChanged(phone?: string): void {
    if (!this.channel) return;
    try {
      this.channel.postMessage({
        type: 'DATA_CHANGED',
        phone,
        timestamp: Date.now(),
      });
    } catch {
      // ignore
    }
  }

  /** Broadcast that user signed in or signed out */
  notifySessionChanged(phone?: string | null): void {
    if (!this.channel) return;
    try {
      this.channel.postMessage({
        type: 'SESSION_CHANGED',
        phone,
        timestamp: Date.now(),
      });
    } catch {
      // ignore
    }
  }

  /** Subscribe to cross-tab updates */
  subscribe(listener: CrossTabListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(msg: CrossTabMessage): void {
    this.listeners.forEach((listener) => {
      try {
        listener(msg);
      } catch {
        // ignore
      }
    });
  }
}

export const crossTabSync = new CrossTabSync();
