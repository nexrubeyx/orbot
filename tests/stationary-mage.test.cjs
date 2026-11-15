const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const source = readFileSync(require.resolve('../src/observer.js'), 'utf8');
const special = source.slice(source.indexOf('  mod.useHuntSpecial ='), source.indexOf('  Object.defineProperty(mod, "monsterCatalog"'));
const focus = source.slice(source.indexOf('  function processFocusTarget()'), source.indexOf('  let trainingCityTrip ='));

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

test('Focar casts manual Mage special at the selected creature', () => {
  const result = new Function(`
    const sent = [];
    const WebSocket = { OPEN: 1 };
    const gameSocket = { readyState: 1, send: packet => sent.push(JSON.parse(packet)) };
    const playerStats = { cls: 2, autoSpecial: false, specialReady: 0, target: 7 };
    const myself = { x: 40, y: 50, floor: 0 };
    const entities = new Map();
    const focusState = { useSkill: true, followTarget: false };
    const mod = { creaturesNearby: () => [{ id: 7, name: 'Rat', x: 42, y: 51, distance: 2 }] };
    const hasAttackLine = () => true;
    const moveTowardAttackRange = () => { throw new Error('unexpected movement'); };
    let specialReadyAt = 0;
    let nextFocusMoveAt = 0;
    ${special}
    ${focus}
    processFocusTarget();
    return { sent, status: focusState.status };
  `)();
  assert.deepEqual(result.sent, [{ t: 'special', x: 42, y: 51 }]);
  assert.match(result.status, /Focando Rat/);
});
