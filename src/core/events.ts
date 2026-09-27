import { warnOnce } from '../util/warn.js';

export type Unsubscribe = () => void;

/**
 * A minimal synchronous emitter. Listeners are not sorted; they run in the order they were added.
 * A listener's error has no right to break the gesture: we catch it and warn — otherwise an
 * exception from someone else's callback would leave a region hanging on the screen.
 */
export class Emitter<M extends object> {
  private listeners = new Map<keyof M, Set<(payload: never) => void>>();

  on<K extends keyof M>(name: K, fn: (payload: M[K]) => void): Unsubscribe {
    let set = this.listeners.get(name);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(fn as (payload: never) => void);
    return () => {
      this.off(name, fn);
    };
  }

  off<K extends keyof M>(name: K, fn: (payload: M[K]) => void): void {
    this.listeners.get(name)?.delete(fn as (payload: never) => void);
  }

  emit<K extends keyof M>(name: K, payload: M[K]): void {
    const set = this.listeners.get(name);
    if (set === undefined) return;
    for (const fn of [...set]) {
      try {
        (fn as unknown as (p: M[K]) => void)(payload);
      } catch (error) {
        warnOnce('listener-error', `listener "${String(name)}" threw: ${String(error)}`);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const DOM_EVENT_PREFIX = 'visual-region:';

/**
 * Every event is mirrored as an ordinary CustomEvent on the interaction root, so that a page can
 * listen to us without importing the library. A dispatch error is swallowed — this is an auxiliary
 * channel, and the main one has already done its job.
 */
export function dispatchDomEvent(root: EventTarget, name: string, detail: unknown): void {
  if (typeof CustomEvent !== 'function') return;
  try {
    root.dispatchEvent(new CustomEvent(DOM_EVENT_PREFIX + name, { detail, bubbles: false }));
  } catch {
    /* no CustomEvent, or the root does not accept events — not our problem */
  }
}
