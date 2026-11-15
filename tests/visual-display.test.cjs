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

function resourceDisplay(visual, data) {
  return new Function('visual', 'data', `
    ${helper}
    return { hud: visualHudData(data), worldHp: visualWorldHpPercent() };
  `)(visual, data);
}

test('changes the own world label while preserving the guild tag', () => {
  const visual = { mode: 'custom', name: 'Outro Nome', levelEnabled: true, level: 500 };
  assert.equal(transform(visual, '[VTK] Drow Lv.222'), '[VTK] Outro Nome Lv.500');
  assert.equal(transform(visual, 'Drow Lv.222'), 'Outro Nome Lv.500');
  assert.equal(transform(visual, '[VTK] Alice Lv.222'), null);
});

test('hides the label and allows changing only the displayed level', () => {
  assert.equal(transform({ mode: 'hidden', levelEnabled: false }, '[VTK] Drow Lv.222'), '[VTK] Lv.222');
  assert.equal(transform({ mode: 'hidden', levelEnabled: true, level: 500 }, '[VTK] Drow Lv.222'), '[VTK] Lv.500');
  assert.equal(transform({ mode: 'original', levelEnabled: true, level: 123 }, '[VTK] Drow Lv.222'), '[VTK] Drow Lv.123');
  assert.equal(transform({ mode: 'original', levelEnabled: false }, '[VTK] Drow Lv.222'), null);
});

test('replaces or hides the guild tag above the own character', () => {
  assert.equal(transform({ mode: 'original', guildMode: 'custom', guildName: 'NOVA', levelEnabled: false }, '[VTK] Drow Lv.222'), '[NOVA] Drow Lv.222');
  assert.equal(transform({ mode: 'original', guildMode: 'custom', guildName: 'NOVA', levelEnabled: false }, 'Drow Lv.222'), '[NOVA] Drow Lv.222');
  assert.equal(transform({ mode: 'custom', name: 'Herói', guildMode: 'custom', guildName: 'NOVA', levelEnabled: true, level: 500 }, '[VTK] Drow Lv.222'), '[NOVA] Herói Lv.500');
  assert.equal(transform({ mode: 'original', guildMode: 'hidden', levelEnabled: false }, '[VTK] Drow Lv.222'), 'Drow Lv.222');
  assert.equal(transform({ mode: 'hidden', guildMode: 'hidden', levelEnabled: false }, '[VTK] Drow Lv.222'), 'Lv.222');
});

test('shows selected life and mana quantities without changing real stats', () => {
  const real = { visivel: true, nome: 'Drow', nivel: 222, hp: 3450, maxHp: 3450, mp: 2920, maxMp: 2920, xp: .73 };
  const selected = resourceDisplay({
    mode: 'original', levelEnabled: false, xpEnabled: false,
    hpMode: 'values', hpCurrent: 500, hpMax: 1000,
    mpMode: 'values', mpCurrent: 200, mpMax: 800
  }, real);
  assert.equal(selected.hud.hp, 500);
  assert.equal(selected.hud.maxHp, 1000);
  assert.equal(selected.hud.mp, 200);
  assert.equal(selected.hud.maxMp, 800);
  assert.equal(selected.worldHp, 50);
  assert.equal(real.hp, 3450);
  assert.equal(real.mp, 2920);
});

test('keeps percentage mode for life and mana', () => {
  const selected = resourceDisplay({
    mode: 'original', levelEnabled: false, xpEnabled: false,
    hpMode: 'percent', hpPercent: 25, mpMode: 'percent', mpPercent: 50
  }, { hp: 3450, maxHp: 3450, mp: 2920, maxMp: 2920 });
  assert.equal(selected.hud.hp, 863);
  assert.equal(selected.hud.mp, 1460);
  assert.equal(selected.worldHp, 25);
});

test('master switch restores every real visual value', () => {
  const real = { nome: 'Drow', nivel: 222, hp: 3450, maxHp: 3450, mp: 2920, maxMp: 2920, xp: .73 };
  const visual = {
    enabled: false, mode: 'custom', name: 'Outro', guildMode: 'custom', guildName: 'FAKE',
    levelEnabled: true, level: 500, xpEnabled: true, xp: 100,
    hpMode: 'values', hpCurrent: 1, hpMax: 9999,
    mpMode: 'values', mpCurrent: 1, mpMax: 9999
  };
  assert.equal(transform(visual, '[VTK] Drow Lv.222'), null);
  const selected = resourceDisplay(visual, real);
  assert.equal(selected.hud, real);
  assert.equal(selected.worldHp, null);
});
