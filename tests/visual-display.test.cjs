const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const source = readFileSync(require.resolve('../src/panel.js'), 'utf8');
const start = source.indexOf('  const worldLabel = value => {');
const end = source.indexOf('  let visualHooksState', start);
assert.ok(start >= 0 && end > start);
const helper = source.slice(start, end);

function transform(visual, value, nick = 'Drow') {
  return new Function('visual', 'nick', 'value', `
    const window = { mod: { myself: { nick } } };
    ${helper}
    return worldLabel(value);
  `)(visual, nick, value);
}

test('changes the own world label while preserving the guild tag', () => {
  const visual = { mode: 'custom', name: 'Outro Nome', levelEnabled: true, level: 500 };
  assert.equal(transform(visual, '[VTK] Drow Lv.222'), '[VTK] Outro Nome Lv.500');
  assert.equal(transform(visual, 'Drow Lv.222'), 'Outro Nome Lv.500');
  assert.equal(transform(visual, '[VTK] Alice Lv.222'), null);
});

test('hides the label and allows changing only the displayed level', () => {
  assert.equal(transform({ mode: 'hidden', levelEnabled: false }, '[VTK] Drow Lv.222'), 'Lv.222');
  assert.equal(transform({ mode: 'hidden', levelEnabled: true, level: 500 }, '[VTK] Drow Lv.222'), 'Lv.500');
  assert.equal(transform({ mode: 'original', levelEnabled: true, level: 123 }, '[VTK] Drow Lv.222'), '[VTK] Drow Lv.123');
  assert.equal(transform({ mode: 'original', levelEnabled: false }, '[VTK] Drow Lv.222'), null);
});
