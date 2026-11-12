import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync('v2/index.html', 'utf8');
const css = readFileSync('src/v2/v2.css', 'utf8');
const main = readFileSync('src/v2/main.ts', 'utf8');

describe('mode switch visibility', () => {
  it('offers the same clearly labeled button after selecting either mode', () => {
    expect(html).toContain('id="change-mode"');
    expect(html).toContain('Change Mode</button>');
    expect(html).not.toContain('id="navigation-back"');
    const choose = main.split('function chooseExperience(')[1].split('\n}')[0];
    expect(choose).toContain('changeMode.hidden=false');
    expect(choose).not.toMatch(/\bstart\(/);
    expect(main).toContain('changeMode.onclick=showModeChoices');
    expect(main).toContain('welcome.hidden=false;changeMode.hidden=true');
  });
  it('is above map overlays, does not cover the Patrol legend, and leaves driving guidance clear', () => {
    expect(css).toMatch(/\.mode-return\{[^}]*right:[^}]*z-index:1110/);
    expect(css).toContain('body[data-experience="patrol"] #map-legend{top:');
    expect(css).toContain('body[data-navigation-driving="true"] .mode-return{display:none!important}');
  });
  it('does not block the first map display with optional data loads', () => {
    expect(main).toContain('deferredMapLayers.splice(0)');
    expect(main).toContain('if(on) deferredMapLayers.push');
    expect(main).toContain('if (tcSet.show) deferredMapLayers.push');
    expect(main).toContain('if (m.checked) deferredMapLayers.push');
  });
});
