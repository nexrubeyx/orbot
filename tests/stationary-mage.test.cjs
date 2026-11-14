const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const source = readFileSync(require.resolve('../src/observer.js'), 'utf8');
const special = source.slice(source.indexOf('  mod.useHuntSpecial ='), source.indexOf('  Object.defineProperty(mod, "monsterCatalog"'));

function harness() {
  return new Function(`
    const sent = [];
    const WebSocket = { OPEN: 1 };
    const gameSocket = { readyState: 1, send: packet => sent.push(JSON.parse(packet)) };
    const playerStats = { cls: 2, autoSpecial: false, specialReady: 0 };
    const mod = {};
    let specialReadyAt = 0;
    ${special}
    return { mod, sent, playerStats };
  `)();
}

test('manual Mage special targets the creature tile in Farm Parado', () => {
  const h = harness();
  assert.equal(h.mod.useHuntSpecial({ x: 42, y: 51 }).ok, true);
  assert.deepEqual(h.sent, [{ t: 'special', x: 42, y: 51 }]);
});

test('manual Mage special does not cast without a target position', () => {
  const h = harness();
  assert.equal(h.mod.useHuntSpecial().ok, false);
  assert.deepEqual(h.sent, []);
});

test('Mage auto special uses the normal packet', () => {
  const h = harness();
  h.playerStats.autoSpecial = true;
  assert.equal(h.mod.useHuntSpecial({ x: 42, y: 51 }).ok, true);
  assert.deepEqual(h.sent, [{ t: 'special' }]);
});
