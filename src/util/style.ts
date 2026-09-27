/**
 * The only way this library writes styles is CSSOM property assignments.
 *
 * Why this way and not another:
 *   forbidden: `el.style.cssText = …`, `el.setAttribute('style', …)`, injecting <style>.
 *   allowed: `el.style.setProperty(k, v)`.
 *
 * Keys are in kebab-case, because `setProperty` takes CSS names exactly.
 */
export type StyleValues = Record<string, string>;

export function setStyles(el: HTMLElement, values: StyleValues): void {
  const style = el.style;
  for (const [prop, value] of Object.entries(values)) style.setProperty(prop, value);
}

export function clearStyles(el: HTMLElement, props: readonly string[]): void {
  const style = el.style;
  for (const prop of props) style.removeProperty(prop);
}
