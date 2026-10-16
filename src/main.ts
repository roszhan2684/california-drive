import './ui/styles.css';
import { Game } from './game/game.ts';

function webgl2Available(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

if (!webgl2Available()) {
  ui.innerHTML = `<section class="screen loading"><h2>WebGL2 is required</h2><p class="sub">California Drive needs a browser with WebGL2 enabled (recent Chrome, Edge, Firefox or Safari).</p></section>`;
} else {
  new Game(canvas, ui);
}
