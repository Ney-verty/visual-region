import { describe, it, expect } from 'vitest';
import { createFollowController } from '../../src/controller/follow.js';
import { createActivation, type ActivationConfig } from '../../src/interaction/activation.js';
import type { Bounds } from '../../src/region/types.js';
import type { ControllerHost, EndCause } from '../../src/controller/types.js';

/*
 * The follow state table (PLAN §2 step 3.1) in full.
 *
 * Why here and not only in smoke: the table has nine rows, and most of them are about what does
 * NOT happen (a mouse release does not end a session, a move between elements does not, a second
 * finger does not). A browser scene proves one row convincingly; this harness proves all of them
 * instantly, because the controller only ever sees an EventTarget and plain event objects.
 *
 * The frame gate falls back to `setTimeout` outside a browser (util/raf.ts), so a frame is
 * awaited through `frame()`. Nothing else about the controller is environment-dependent.
 */

/* activation.ts asks `target instanceof Node` to decide "inside the surface". The node
   environment has EventTarget but no Node, so that check would throw a ReferenceError unless the
   name exists. A one-line stand-in is enough: only the check's existence matters here. */
class FakeNode {}
(globalThis as Record<string, unknown>).Node = FakeNode;

/* touch:'surface' refuses to start while the surface's computed touch-action is not 'none' —
   a real check of a real browser (PLAN step 3.3). Here it is answered by a stand-in. */
const SURFACE_TOUCH_ACTION = 'none';
(globalThis as Record<string, unknown>).getComputedStyle = () => ({
  touchAction: SURFACE_TOUCH_ACTION,
});

/** A recording stand-in for the interaction root: the controller only adds and removes listeners. */
class Recorder {
  private readonly listeners = new Map<string, Set<(event: PointerEvent) => void>>();

  addEventListener(type: string, fn: unknown): void {
    const set = this.listeners.get(type) ?? new Set<(event: PointerEvent) => void>();
    set.add(fn as (event: PointerEvent) => void);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, fn: unknown): void {
    this.listeners.get(type)?.delete(fn as (event: PointerEvent) => void);
  }

  get count(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  emit(type: string, props: Record<string, unknown> = {}): void {
    const event = {
      type,
      isPrimary: true,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 0,
      clientY: 0,
      button: 0,
      relatedTarget: null,
      target: null,
      altKey: false,
      ...props,
    } as unknown as PointerEvent;
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event);
  }
}

type Log = { kind: 'start' } | { kind: 'change'; bounds: Bounds } | { kind: 'end'; cause: EndCause };

const SIZE = { width: 120, height: 60 };
const ALWAYS: ActivationConfig = { kind: 'always', modifier: null, touch: 'off', surface: null };

function harness(config: ActivationConfig = ALWAYS) {
  const root = new Recorder();
  const log: Log[] = [];
  const host: ControllerHost = {
    applyGeometry: (bounds) => log.push({ kind: 'change', bounds: bounds as Bounds }),
    onStart: () => log.push({ kind: 'start' }),
    onFinish: (cause) => log.push({ kind: 'end', cause }),
  };
  const controller = createFollowController(createActivation(config), SIZE);
  controller.attach(root as unknown as EventTarget, host);
  return {
    root,
    log,
    controller,
    move: (props?: Record<string, unknown>) => root.emit('pointermove', props),
  };
}

/** Let the frame gate run (its node fallback is setTimeout(…, 16)). */
const frame = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 40));

const changes = (log: Log[]): Bounds[] =>
  log.filter((e): e is { kind: 'change'; bounds: Bounds } => e.kind === 'change').map((e) => e.bounds);
const last = (log: Log[]): Log | undefined => log[log.length - 1];
const countOf = (log: Log[], kind: Log['kind']): number => log.filter((e) => e.kind === kind).length;

describe('a session is born from the right, not from a press', () => {
  it('an accepted move opens it: start, then the geometry on the next frame', async () => {
    const { move, log } = harness();
    move({ clientX: 400, clientY: 300 });
    expect(log).toEqual([{ kind: 'start' }]); // at most one write per frame — not in the handler
    await frame();
    expect(changes(log)).toEqual([{ x: 340, y: 270, width: 120, height: 60 }]);
  });

  it('the region is centred on the pointer', async () => {
    const { move, log } = harness();
    move({ clientX: 10.5, clientY: 20.25 });
    await frame();
    expect(changes(log)[0]).toEqual({ x: -49.5, y: -9.75, width: 120, height: 60 });
  });

  it('five moves inside one frame give exactly one write, and the last point wins', async () => {
    const { move, log } = harness();
    for (let i = 0; i < 5; i++) move({ clientX: 100 + i, clientY: 100 });
    await frame();
    expect(changes(log)).toHaveLength(1);
    expect(changes(log)[0]?.x).toBe(104 - SIZE.width / 2);
  });

  it('a second accepted move gives change, not a second start', async () => {
    const { move, log } = harness();
    move({ clientX: 100, clientY: 100 });
    await frame();
    move({ clientX: 200, clientY: 100 });
    await frame();
    expect(countOf(log, 'start')).toBe(1);
    expect(changes(log)).toHaveLength(2);
  });

  it('a move that fails the policy opens nothing at all', async () => {
    // activation:'modifier' without the modifier held — the default configuration.
    const { move, log } = harness({ kind: 'modifier', modifier: 'alt', touch: 'off', surface: null });
    move({ clientX: 100, clientY: 100, altKey: false });
    await frame();
    expect(log).toEqual([]);
  });
});

describe('the right is checked on every event, not once at the start', () => {
  const byModifier: ActivationConfig = { kind: 'modifier', modifier: 'alt', touch: 'off', surface: null };

  it('losing the right ends the session — normally, not as a cancel', async () => {
    const { move, log } = harness(byModifier);
    move({ clientX: 100, clientY: 100, altKey: true });
    await frame();
    move({ clientX: 140, clientY: 100, altKey: false });
    expect(last(log)).toEqual({ kind: 'end', cause: 'ineligible' });
  });

  it('holding it again starts a NEW session, not a continuation of the old one', async () => {
    const { move, log } = harness(byModifier);
    move({ clientX: 100, clientY: 100, altKey: true });
    await frame();
    move({ clientX: 140, clientY: 100, altKey: false });
    move({ clientX: 160, clientY: 100, altKey: true });
    await frame();
    expect(countOf(log, 'start')).toBe(2);
  });

  it('leaving the allowed surface ends the session (activation:element)', async () => {
    let onSurface = true;
    const surface = {
      contains: () => onSurface,
    } as unknown as HTMLElement;
    const { move, log } = harness({ kind: 'element', modifier: null, touch: 'off', surface });
    move({ clientX: 100, clientY: 100, target: new FakeNode() });
    await frame();
    onSurface = false;
    move({ clientX: 200, clientY: 100, target: new FakeNode() });
    expect(last(log)).toEqual({ kind: 'end', cause: 'ineligible' });
  });

  it('the last motion is played out before the end, as in drag', async () => {
    // Otherwise the geometry at the moment of the end would lag a frame behind the pointer.
    const { move, root, log } = harness();
    move({ clientX: 100, clientY: 100 });
    await frame();
    move({ clientX: 400, clientY: 100 }); // pending, will not reach the DOM on its own
    root.emit('pointerout', { relatedTarget: null });
    expect(changes(log)[changes(log).length - 1]?.x).toBe(400 - SIZE.width / 2);
    expect(last(log)).toEqual({ kind: 'end', cause: 'pointerout' });
  });
});

describe('what does NOT end a session', () => {
  it('a mouse release does not: a click on a link while following must not close the region', async () => {
    const { move, root, log } = harness();
    move({ clientX: 100, clientY: 100 });
    await frame();
    root.emit('pointerup', { pointerType: 'mouse' });
    root.emit('pointerdown', { pointerType: 'mouse' });
    await frame();
    expect(countOf(log, 'end')).toBe(0);
  });

  it('a transition between elements does not: only a null relatedTarget means leaving', async () => {
    const { move, root, log } = harness();
    move({ clientX: 100, clientY: 100 });
    await frame();
    root.emit('pointerout', { relatedTarget: new FakeNode() });
    expect(countOf(log, 'end')).toBe(0);
  });

  it('a second finger neither moves nor closes the session', async () => {
    const { move, root, log } = harness();
    move({ clientX: 100, clientY: 100 });
    await frame();
    move({ pointerId: 2, isPrimary: false, clientX: 900, clientY: 900 });
    root.emit('pointerout', { pointerId: 2, isPrimary: false, relatedTarget: null });
    root.emit('pointerup', { pointerId: 2, isPrimary: false, pointerType: 'touch' });
    await frame();
    expect(changes(log)).toHaveLength(1);
    expect(countOf(log, 'end')).toBe(0);
  });

  it('an ending with no session open does nothing at all', async () => {
    const { root, log } = harness();
    for (const type of ['pointerout', 'pointerup', 'pointercancel', 'blur']) root.emit(type);
    await frame();
    expect(log).toEqual([]);
  });
});

describe('every ending in the table', () => {
  const endings: Array<[string, Record<string, unknown>, EndCause]> = [
    ['leaving the document', { relatedTarget: null }, 'pointerout'],
    ['a touch release (the contact ended)', { pointerType: 'touch' }, 'pointerup'],
    ['a cancelled pointer', { pointerType: 'touch' }, 'pointercancel'],
    ['a lost focus', {}, 'blur'],
  ];

  for (const [name, props, cause] of endings) {
    it(`${name} → ${cause}`, async () => {
      const { move, root, log } = harness();
      move({ clientX: 100, clientY: 100 });
      await frame();
      root.emit(cause === 'blur' ? 'blur' : cause, props);
      expect(last(log)).toEqual({ kind: 'end', cause });
    });
  }

  it('only a cancellation may take a persistent region away — the vocabulary stays closed', () => {
    // The public union of `cancel.reason` is pointercancel | blur | visibility. `ineligible`,
    // `pointerout` and `pointerup` are normal ends and must never reach it (core/types.ts).
    const cancels: EndCause[] = ['pointercancel', 'blur', 'visibility'];
    const normals: EndCause[] = ['pointerup', 'pointerout', 'ineligible'];
    expect(cancels.filter((c) => normals.includes(c))).toEqual([]);
  });
});

describe('touch is a contact, with its own beginning and end (step 3.3)', () => {
  const touchConfig: ActivationConfig = {
    kind: 'always',
    modifier: null,
    touch: 'surface',
    surface: { contains: () => true } as unknown as HTMLElement,
  };

  it('a touch move opens the session and the release closes it normally', async () => {
    const { move, root, log } = harness(touchConfig);
    move({ pointerType: 'touch', clientX: 400, clientY: 300, target: new FakeNode() });
    await frame();
    expect(countOf(log, 'start')).toBe(1);
    root.emit('pointerup', { pointerType: 'touch' });
    expect(last(log)).toEqual({ kind: 'end', cause: 'pointerup' });
  });

  it('a touch move is refused while the surface is not prepared for it', () => {
    // The existing v0.1 contract is untouched: without `touch-action: none` the browser claims
    // the gesture, so we refuse to start rather than end up with a pointercancel.
    (globalThis as Record<string, unknown>).getComputedStyle = () => ({ touchAction: 'auto' });
    try {
      const { move, log } = harness({ ...touchConfig, touch: 'off' });
      move({ pointerType: 'touch', clientX: 400, clientY: 300, target: new FakeNode() });
      expect(log).toEqual([]);
    } finally {
      (globalThis as Record<string, unknown>).getComputedStyle = () => ({
        touchAction: SURFACE_TOUCH_ACTION,
      });
    }
  });
});

describe('detach', () => {
  it('removes every listener and reports nothing', async () => {
    const { move, root, log, controller } = harness();
    move({ clientX: 100, clientY: 100 });
    await frame();
    const before = log.length;
    controller.detach();
    expect(root.count).toBe(0);
    move({ clientX: 300, clientY: 100 });
    root.emit('pointerout', { relatedTarget: null });
    await frame();
    expect(log).toHaveLength(before);
  });

  it('is idempotent', () => {
    const { controller } = harness();
    controller.detach();
    expect(() => controller.detach()).not.toThrow();
  });
});
