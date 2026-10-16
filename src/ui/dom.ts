export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function qs<T extends Element = HTMLElement>(root: ParentNode, sel: string): T {
  const r = root.querySelector(sel);
  if (!r) throw new Error(`missing ${sel}`);
  return r as T;
}

export function show(e: HTMLElement, on: boolean) {
  e.classList.toggle('hidden', !on);
}

/** Move keyboard focus to the first focusable element in a container. */
export function focusFirst(root: HTMLElement) {
  const f = root.querySelector<HTMLElement>('button:not([disabled]), [tabindex="0"], input, select');
  f?.focus({ preventScroll: true });
}

/** Arrow-key navigation within a vertical list of buttons. */
export function arrowNav(root: HTMLElement, selector = 'button') {
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...root.querySelectorAll<HTMLElement>(selector)].filter((b) => !(b as HTMLButtonElement).disabled && b.offsetParent !== null);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  });
}
