const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const source = readFileSync(require.resolve('../src/observer.js'), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

test('Farm Parado targets and casts while the pathfinder map is loading', () => {
  const lineOfSight = between('  function hasAttackLine(', '  function isEliteCreature(');
  const targeting = between('  function ensureHuntTarget(', '  function processStationaryFarm(');
  const farm = between('  function processStationaryFarm(', '  function processFocusTarget(');
  const result = new Function(`
    const sent = [];
    const WebSocket = { OPEN: 1 };
    const gameSocket = { readyState: 1, send: data => sent.push(JSON.parse(data)) };
    const myself = { id: 1, x: 10, y: 10, floor: 0 };
    const entities = new Map([[2, { id: 2, k: 1, x: 12, y: 10 }]]);
    const currentWalls = [];
    const gameWorld = null;
    const playerStats = { cls: 2, autoSpecial: false, specialReady: 0, target: null };
    const stationaryFarm = { className: 'current', types: ['rat'], range: 4, useSkill: true };
    const mod = {
      creaturesNearby: () => [{ id: 2, type: 'rat', name: 'Rat', x: 12, y: 10, distance: 2 }],
      targetCreature: id => { sent.push({ t: 'target', id }); return { ok: true }; },
      useHuntSpecial: target => { sent.push({ t: 'special', x: target.x, y: target.y }); return { ok: true }; }
    };
    const ensureTrainingClass = () => true;
    const isAttackedByAnotherPlayer = () => false;
    let huntTargetSent = null, huntTargetSentAt = 0, stationaryTargetId = null;
    ${lineOfSight}
    ${targeting}
    ${farm}
    processStationaryFarm();
    return { sent, status: stationaryFarm.status };
  `)();
  assert.deepEqual(result.sent, [{ t: 'target', id: 2 }, { t: 'special', x: 12, y: 10 }]);
  assert.match(result.status, /Atacando Rat/);
});

test('an acknowledged target object does not cause repeated target packets', () => {
  const targeting = between('  function ensureHuntTarget(', '  function processStationaryFarm(');
  const result = new Function(`
    const playerStats = { target: { id: 2 } };
    const mod = { targetCreature: () => { throw new Error('target sent again'); } };
    let huntTargetSent = null, huntTargetSentAt = 0;
    ${targeting}
    return ensureHuntTarget({ id: 2 });
  `)();
  assert.equal(result, true);
});

test('Farm Parado leaves game shortcuts available', () => {
  const shortcuts = between('  function blockGameShortcut(', '  window.addEventListener("keydown", blockGameShortcut, true);');
  const result = new Function(`
    const window = { mod: { stationaryFarm: { enabled: true }, hunt: { enabled: false } } };
    const localStorage = { getItem: () => null };
    const gameShortcutCodes = new Set(['KeyX', 'Space', 'Digit1', 'ArrowUp']);
    const isGameShortcut = event => gameShortcutCodes.has(event.code);
    ${shortcuts}
    const blocked = [];
    for (const code of gameShortcutCodes) {
      const event = { code, type: 'keydown', target: {}, composedPath: () => [],
        preventDefault: () => blocked.push(code), stopPropagation() {}, stopImmediatePropagation() {} };
      blockGameShortcut(event);
    }
    return blocked;
  `)();
  assert.deepEqual(result, []);
});
