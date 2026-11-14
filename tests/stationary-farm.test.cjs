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
    const classIds = { melee: 0, distance: 1, mage: 2 };
    const stationaryFarm = { className: 'current', range: 4, useSkill: true };
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

test('a player between the character and creature does not block an attack', () => {
  for (const path of ['../src/observer.js', '../../client/android/app/src/main/assets/bot.js']) {
    const script = readFileSync(require.resolve(path), 'utf8');
    const lineOfSight = script.slice(script.indexOf('  function hasAttackLine('), script.indexOf('  function isEliteCreature('));
    const canAttack = new Function(`
      const myself = { id: 1, x: 10, y: 10, floor: 0 };
      const target = { id: 3, x: 12, y: 10 };
      const entities = new Map([
        [2, { id: 2, k: 0, x: 11, y: 10, f: 0 }],
        [3, { id: 3, k: 1, x: 12, y: 10, f: 0 }]
      ]);
      const currentWalls = [];
      const gameWorld = { isWalkable: () => true };
      ${lineOfSight}
      const throughPlayer = hasAttackLine(myself.x, myself.y, target);
      entities.set(2, { id: 2, k: 1, x: 11, y: 10, f: 0 });
      const throughCreature = hasAttackLine(myself.x, myself.y, target);
      entities.delete(2);
      currentWalls.push([11, 10]);
      const throughWall = hasAttackLine(myself.x, myself.y, target);
      return { throughPlayer, throughCreature, throughWall };
    `)();
    assert.deepEqual(canAttack, { throughPlayer: true, throughCreature: false, throughWall: false }, path);
  }
});

test('hunt keeps an in-range creature when a player blocks the walking route', () => {
  for (const path of ['../src/observer.js', '../../client/android/app/src/main/assets/bot.js']) {
    const script = readFileSync(require.resolve(path), 'utf8');
    const pathDistance = script.slice(script.indexOf('  const creaturePathDistanceCache = new Map();'), script.indexOf('  function creaturesWithinPathRadius('));
    const lineOfSight = script.slice(script.indexOf('  function hasAttackLine('), script.indexOf('  function isEliteCreature('));
    const result = new Function(`
      const myself = { id: 1, x: 10, y: 10, floor: 0, cls: 2 };
      const playerStats = { cls: 2 };
      const huntState = { training: false, attackRange: 4 };
      const target = { id: 3, x: 12, y: 10 };
      const entities = new Map([
        [2, { id: 2, k: 0, x: 11, y: 10, f: 0 }],
        [3, { id: 3, k: 1, x: 12, y: 10, f: 0 }]
      ]);
      const currentWalls = [];
      const gameWorld = { isWalkable: () => true, findPath: () => null };
      ${lineOfSight}
      ${pathDistance}
      const withPlayer = creaturePathDistance(target);
      currentWalls.push([11, 10]);
      const withWall = creaturePathDistance(target);
      return { withPlayer, withWall };
    `)();
    assert.equal(result.withPlayer, 2, path);
    assert.equal(result.withWall, Infinity, path);
  }
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

test('Farm Parado starts without a configured creature list', () => {
  const start = between('  mod.startStationaryFarm =', '  mod.stopStationaryFarm =');
  const result = new Function(`
    const myself = { dead: false };
    const huntState = { enabled: false, lureEnabled: false, resumeAfterReturn: false };
    const focusState = { enabled: false };
    const stationaryFarm = { enabled: false };
    const mod = { waypointRecording: { enabled: false } };
    const cityTripInProgress = () => false;
    const waypointTravel = null, initialHuntTravel = null;
    let stationaryTargetId = null;
    ${start}
    return { outcome: mod.startStationaryFarm(), enabled: stationaryFarm.enabled };
  `)();
  assert.deepEqual(result, { outcome: { ok: true }, enabled: true });
});

test('Farm Parado waits for melee range before selecting a target or using a skill', () => {
  const farm = between('  function processStationaryFarm(', '  function processFocusTarget(');
  const result = new Function(`
    const WebSocket = { OPEN: 1 };
    const sent = [];
    const gameSocket = { readyState: 1, send: data => sent.push(JSON.parse(data)) };
    const myself = { x: 10, y: 10, floor: 0 };
    const playerStats = { cls: 0, target: null };
    const classIds = { melee: 0 };
    const stationaryFarm = { className: 'current', range: 4, useSkill: true };
    let distance = 2;
    const mod = {
      creaturesNearby: range => [{ id: 2, type: 'rat', name: 'Rat', distance }].filter(c => c.distance <= range),
      useHuntSpecial: () => { sent.push({ t: 'special' }); return { ok: true }; }
    };
    const ensureTrainingClass = () => true;
    const isAttackedByAnotherPlayer = () => false;
    const hasAttackLine = () => true;
    const ensureHuntTarget = target => { sent.push({ t: 'target', id: target.id }); return true; };
    let stationaryTargetId = null;
    ${farm}
    processStationaryFarm();
    const waitingStatus = stationaryFarm.status;
    distance = 1;
    processStationaryFarm();
    return { sent, waitingStatus, attackingStatus: stationaryFarm.status };
  `)();
  assert.deepEqual(result.sent, [{ t: 'target', id: 2 }, { t: 'special' }]);
  assert.match(result.waitingStatus, /até 1 tile/);
  assert.match(result.attackingStatus, /Atacando Rat/);
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
