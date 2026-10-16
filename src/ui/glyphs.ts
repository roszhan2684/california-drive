// Kenney "Input Prompts" (CC0, https://kenney.nl/assets/input-prompts): keyboard and Xbox-style glyphs.
// The SVGs are single-colour, so they are drawn as CSS masks and take the surrounding text colour.
import { keyLabel, type Action, type KeyBindings } from '../input/bindings.ts';
import type { InputSource } from '../input/input.ts';
import { esc } from './dom.ts';

// absolute: a relative url() inside a CSS custom property would resolve against the stylesheet's folder
const base = () => new URL(`${import.meta.env.BASE_URL}media/kenney/input-prompts/`, document.baseURI).href;

const SPECIAL: Record<string, string> = {
  ArrowUp: 'arrow_up', ArrowDown: 'arrow_down', ArrowLeft: 'arrow_left', ArrowRight: 'arrow_right',
  Space: 'space', Escape: 'escape', Tab: 'tab', Enter: 'enter', Backspace: 'backspace',
  ShiftLeft: 'shift', ShiftRight: 'shift', ControlLeft: 'ctrl', ControlRight: 'ctrl', AltLeft: 'alt', AltRight: 'alt',
};

/** Glyph file for a KeyboardEvent.code, or null when the pack has none (falls back to a <kbd>). */
export function keyFile(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return `keyboard_${code.slice(3).toLowerCase()}.svg`;
  if (/^Digit[0-9]$/.test(code)) return `keyboard_${code.slice(5)}.svg`;
  if (/^F([1-9]|1[0-2])$/.test(code)) return `keyboard_${code.toLowerCase()}.svg`;
  return SPECIAL[code] ? `keyboard_${SPECIAL[code]}.svg` : null;
}

/** Standard-mapping gamepad glyphs (Xbox layout), matching `PAD` in bindings.ts. */
const PAD_FILES: Partial<Record<Action, string>> = {
  throttle: 'xbox_rt', brake: 'xbox_lt', steerLeft: 'xbox_stick_l', steerRight: 'xbox_stick_l', handbrake: 'xbox_button_a',
  camera: 'xbox_button_y', lookBack: 'xbox_button_x', reset: 'xbox_button_b', gearDown: 'xbox_lb', gearUp: 'xbox_rb',
  pause: 'xbox_button_menu', photo: 'xbox_button_view', horn: 'xbox_stick_l_press', headlights: 'xbox_dpad_up', wipers: 'xbox_dpad_down',
  indicatorLeft: 'xbox_dpad_left', indicatorRight: 'xbox_dpad_right', activity: 'xbox_stick_r_press',
};

export function glyph(file: string, label: string): string {
  return `<i class="glyph" style="--g:url('${base()}${file}')" role="img" aria-label="${esc(label)}"></i>`;
}

/** HTML for the first binding of an action on the given device. */
export function actionGlyph(action: Action, keys: KeyBindings, source: InputSource): string {
  if (source === 'gamepad' && PAD_FILES[action]) return glyph(`${PAD_FILES[action]}.svg`, action);
  const code = keys[action]?.[0];
  if (!code) return '';
  const f = keyFile(code);
  return f ? glyph(f, keyLabel(code)) : `<kbd>${esc(keyLabel(code))}</kbd>`;
}

/** Glyphs for several actions in a row (e.g. W A S D), de-duplicated for shared pad inputs. */
export function actionGlyphs(actions: Action[], keys: KeyBindings, source: InputSource): string {
  const seen = new Set<string>();
  return actions.map((a) => actionGlyph(a, keys, source)).filter((h) => (seen.has(h) ? false : (seen.add(h), true))).join('');
}
