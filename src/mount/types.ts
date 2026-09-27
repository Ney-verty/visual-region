export interface MountConfig {
  /** Used only by the legacy method (`fixed`); in the top layer z-index means nothing. */
  zIndex: number;
}

/**
 * A way of placing the layer in the document.
 *
 * `guaranteed` — an honest flag: the top layer gives the full result on any page,
 * legacy `fixed` does not (measured: `body{opacity}`, `html{transform}`,
 * `translate/rotate` on the root break both coverage and geometry). This flag is
 * read by the README and e2e so as not to sell legacy as full support.
 */
export interface Mount {
  readonly kind: string;
  readonly guaranteed: boolean;
  /** Runtime feature detection. No UA strings and no version tables. */
  supported(): boolean;
  /**
   * Creates the layer and places it. May throw — the caller must catch it and
   * move to `unsupported` without touching the page.
   */
  create(config: MountConfig): HTMLElement;
  /** Removes the layer from the top layer (if it is there) and deletes the node. Idempotent. */
  destroy(layer: HTMLElement): void;
}
