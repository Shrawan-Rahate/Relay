import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const script = readFileSync(new URL('../public/theme.js', import.meta.url), 'utf8');
function boot({ stored = null, dark = false, blocked = false } = {}) {
  const listeners = {};
  const root = { dataset: {}, style: {} };
  const meta = {};
  const storage = { value: stored };
  const media = { matches: dark, addEventListener: (_, callback) => { listeners.system = callback; } };
  const window = {
    matchMedia: () => media,
    localStorage: {
      getItem: () => { if (blocked) throw Error('blocked'); return storage.value; },
      setItem: (_, value) => { if (blocked) throw Error('blocked'); storage.value = value; },
    },
    addEventListener: (_, callback) => { listeners.storage = callback; },
  };
  runInNewContext(script, { window, document: { documentElement: root, querySelector: () => meta } });
  return { window, root, meta, storage, system(dark) { media.matches = dark; listeners.system(); }, sync(value) { storage.value = value; listeners.storage({ key: 'relay-theme' }); } };
}

test('first visit follows the system, including changes, before rendering', () => {
  const app = boot({ dark: true });
  assert.equal(app.root.dataset.theme, 'dark');
  assert.equal(app.root.style.colorScheme, 'dark');
  assert.equal(app.meta.content, '#141519');
  app.system(false);
  assert.equal(app.root.dataset.theme, 'light');
  assert.equal(app.storage.value, null);
});
test('manual toggle persists, survives reload and overrides system changes', () => {
  const app = boot();
  let notifications = 0;
  const unsubscribe = app.window.relayTheme.subscribe(() => notifications++);
  app.window.relayTheme.toggle();
  assert.equal(app.storage.value, 'dark');
  assert.equal(app.window.relayTheme.getSnapshot(), 'dark');
  app.system(true); app.system(false);
  assert.equal(app.root.dataset.theme, 'dark');
  assert.equal(boot({ stored: app.storage.value }).root.dataset.theme, 'dark');
  assert.equal(notifications, 1);
  unsubscribe();
  app.window.relayTheme.toggle();
  assert.equal(app.root.dataset.theme, 'light');
  assert.equal(notifications, 1);
});
test('invalid or blocked storage falls back to system and toggle still works', () => {
  assert.equal(boot({ stored: 'invalid', dark: true }).root.dataset.theme, 'dark');
  const app = boot({ blocked: true });
  app.window.relayTheme.toggle();
  assert.equal(app.root.dataset.theme, 'dark');
});
test('preference changes in another tab update theme; clearing resumes system', () => {
  const app = boot({ stored: 'dark' });
  app.sync('light');
  assert.equal(app.root.dataset.theme, 'light');
  app.sync(null);
  app.system(true);
  assert.equal(app.root.dataset.theme, 'dark');
});

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
function contrast(first, second) {
  const luminance = hex => {
    const [r, g, b] = hex.slice(1).match(/../g).map(channel => {
      const value = parseInt(channel, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return .2126 * r + .7152 * g + .0722 * b;
  };
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
for (const [name, selector] of [['light', ':root'], ['dark', ':root[data-theme="dark"]']]) {
  test(`${name} text and control states meet WCAG contrast thresholds`, () => {
    const block = css.slice(css.indexOf(`${selector} {`)).split('}')[0];
    const colors = Object.fromEntries([...block.matchAll(/--color-([\w-]+):\s*(#[\da-fA-F]{6});/g)].map(match => [match[1], match[2]]));
    const check = (foreground, background, minimum) => assert.ok(
      contrast(colors[foreground], colors[background]) >= minimum,
      `${name}: ${foreground} on ${background} is ${contrast(colors[foreground], colors[background]).toFixed(2)}:1 (requires ${minimum}:1)`,
    );
    for (const surface of ['canvas', 'sidebar', 'surface', 'hover', 'accent-surface']) {
      for (const text of ['text', 'muted', 'link', 'link-hover', 'error']) check(text, surface, 4.5);
      check('focus', surface, 3);
    }
    check('on-primary', 'primary', 4.5);
    check('on-primary', 'primary-hover', 4.5);
    check('on-accent', 'accent', 4.5);
    check('disabled-text', 'disabled-surface', 4.5);
    check('control-border', 'surface', 3);
  });
}
