const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const source = readFileSync(require.resolve('../src/observer.js'), 'utf8');
const helper = source.slice(source.indexOf('  function ensureTrainingWeapon('), source.indexOf('  function sendTrainingClass('));

function harness(random = .5) {
  return new Function('random', `
    let now = 0;
    let trainingWeaponSwitch = null;
    const playerStats = { cls: 0 };
    const myself = {};
    const mod = { inventory: { known: true, equip: { sword: 10 }, bag: [20, 30] } };
    const sent = [];
    const WebSocket = { OPEN: 1 };
    const gameSocket = { readyState: 1, send: packet => sent.push({ at: now, packet: JSON.parse(packet) }) };
    const Date = { now: () => now };
    const Math = { random: () => random };
    ${helper}
    return {
      ensureTrainingWeapon,
      sent,
      setTime: value => { now = value; },
      equip: value => { mod.inventory.equip.sword = value; }
    };
  `)(random);
}

test('waits 1.2 to 2.2 seconds before equipping each training weapon', () => {
  for (const [random, delay] of [[0, 1200], [.5, 1700], [1, 2200]]) {
    const h = harness(random);
    assert.equal(h.ensureTrainingWeapon('10'), true);
    assert.equal(h.ensureTrainingWeapon('20'), false);
    h.setTime(delay - 1);
    h.ensureTrainingWeapon('20');
    assert.deepEqual(h.sent, []);
    h.setTime(delay);
    h.ensureTrainingWeapon('20');
    assert.deepEqual(h.sent, [{ at: delay, packet: { t: 'equip', i: 0 } }]);
    h.equip(20);
    assert.equal(h.ensureTrainingWeapon('20'), true);
    h.setTime(delay + 100);
    h.ensureTrainingWeapon('30');
    h.setTime(delay + 100 + delay);
    h.ensureTrainingWeapon('30');
    assert.deepEqual(h.sent.at(-1), { at: delay + 100 + delay, packet: { t: 'equip', i: 1 } });
  }
});

test('cancels a pending weapon change when the selected weapon changes', () => {
  const h = harness(0);
  h.ensureTrainingWeapon('20');
  h.setTime(600);
  h.ensureTrainingWeapon('30');
  h.setTime(1200);
  h.ensureTrainingWeapon('30');
  assert.deepEqual(h.sent, []);
  h.setTime(1800);
  h.ensureTrainingWeapon('30');
  assert.deepEqual(h.sent, [{ at: 1800, packet: { t: 'equip', i: 1 } }]);
});
