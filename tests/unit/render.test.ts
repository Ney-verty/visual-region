import { describe, it, expect } from 'vitest';
import { blendRenderer } from '../../src/render/blend.js';
import { invertEffect } from '../../src/effect/invert.js';
import type { Effect } from '../../src/effect/types.js';

/*
 * The renderer contract at its cheapest level: exactly which CSS properties it writes for a
 * given effect, and that it writes the colour it is handed — no validation, no default.
 */

function fakeLayer(): { layer: HTMLElement; values: Map<string, string> } {
  const values = new Map<string, string>();
  const layer = {
    style: {
      setProperty(name: string, value: string): void {
        values.set(name, value);
      },
      removeProperty(name: string): void {
        values.delete(name);
      },
    },
  } as unknown as HTMLElement;
  return { layer, values };
}

describe('blendRenderer', () => {
  it('the default white effect writes exactly the three expected properties', () => {
    const { layer, values } = fakeLayer();
    blendRenderer.apply(layer, invertEffect);

    expect(Object.fromEntries(values)).toEqual({
      'background-color': '#ffffff',
      'mix-blend-mode': 'difference',
      opacity: '1',
    });
  });

  it('writes the operand colour it is given, without a default of its own', () => {
    const { layer, values } = fakeLayer();
    const magenta: Effect = { ...invertEffect, color: '#ff00ff' };
    blendRenderer.apply(layer, magenta);

    expect(Object.fromEntries(values)).toEqual({
      'background-color': '#ff00ff',
      'mix-blend-mode': 'difference',
      opacity: '1',
    });
  });

  it('clear removes exactly the same three properties', () => {
    const { layer, values } = fakeLayer();
    blendRenderer.apply(layer, invertEffect);
    blendRenderer.clear(layer);

    expect(values.size).toBe(0);
  });
});
