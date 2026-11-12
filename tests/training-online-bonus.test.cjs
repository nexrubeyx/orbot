const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const source = readFileSync(require.resolve('../src/observer.js'), 'utf8');
const helper = source.slice(source.indexOf('  function maybeActivateOnlineTraining()'), source.indexOf('  mod.setTrainingEliteOptions ='));

function harness() {
  return new Function(`
    let now = 0;
    let nextOnlineTrainingAttemptAt = 0;
    const sent = [], logs = [];
    const huntState = { enabled: true, training: true, trainingOnlineBonusEnabled: true };
    const myself = { dead: false };
    const playerStats = { online: { on: false, free: 179, paid: 0, stamina: 1000 } };
    const NativeWebSocket = { OPEN: 1 };
    const gameSocket = { readyState: 1, send: packet => sent.push(JSON.parse(packet)) };
    const mod = { log: (...args) => logs.push(args) };
    const Date = { now: () => now };
    ${helper}
    return { maybeActivateOnlineTraining, huntState, myself, playerStats, gameSocket, sent, logs,
      setTime: value => { now = value; } };
  `)();
}

test('activates the online bonus only from three minutes and does not repeat pending requests', () => {
  const h = harness();
  h.maybeActivateOnlineTraining();
  assert.deepEqual(h.sent, []);
  h.playerStats.online.free = 180;
  h.maybeActivateOnlineTraining();
  assert.deepEqual(h.sent, [{ t: 'online', on: true }]);
  h.setTime(29_999);
  h.maybeActivateOnlineTraining();
  assert.equal(h.sent.length, 1);
  h.playerStats.online.on = true;
  h.setTime(30_000);
  h.maybeActivateOnlineTraining();
  assert.equal(h.sent.length, 1);
});

test('uses existing paid time but waits for stamina, active training and connection', () => {
  const h = harness();
  h.playerStats.online = { on: false, free: 60, paid: 120, stamina: 0 };
  h.maybeActivateOnlineTraining();
  h.playerStats.online.stamina = 179;
  h.maybeActivateOnlineTraining();
  h.playerStats.online.stamina = 180;
  h.huntState.training = false;
  h.maybeActivateOnlineTraining();
  h.huntState.training = true;
  h.huntState.trainingOnlineBonusEnabled = false;
  h.maybeActivateOnlineTraining();
  h.huntState.trainingOnlineBonusEnabled = true;
  h.myself.dead = true;
  h.maybeActivateOnlineTraining();
  h.myself.dead = false;
  h.gameSocket.readyState = 0;
  h.maybeActivateOnlineTraining();
  assert.deepEqual(h.sent, []);
  h.gameSocket.readyState = 1;
  h.maybeActivateOnlineTraining();
  assert.deepEqual(h.sent, [{ t: 'online', on: true }]);
});
