/**
 * The browser-environment flag. Everything that touches the DOM has to check it:
 * the module must be importable in Node (SSR) without crashing.
 */
export const isBrowser: boolean = typeof window !== 'undefined' && typeof document !== 'undefined';

/** The root element to mount into: <body>, or <html> if there is no body yet. */
export function documentRoot(): HTMLElement | null {
  if (!isBrowser) return null;
  return document.body ?? document.documentElement ?? null;
}

const nullEvents: EventTarget = {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => false,
} as unknown as EventTarget;

/**
 * An EventTarget stub for environments without a DOM. It keeps `Spec` an honest type and means the
 * Node import needs no `if (document)` anywhere.
 */
export function nullTarget(): EventTarget {
  return nullEvents;
}
