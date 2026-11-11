const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const source = readFileSync(require.resolve('../src/observer.js'), 'utf8');
const helpers = source.slice(source.indexOf('  function confirmationTemplate('),
  source.indexOf('  // End of browser-independent confirmation helpers.'));
const createConfirmationController = new Function(`${helpers}\nreturn createConfirmationController;`)();
const simulator = source.slice(source.indexOf('  mod.simulateMonsterConfirmation ='),
  source.indexOf('  if (!window.__fantasyModErrorHooks)'));

test('simulated monster challenge stays local and uses the confirmation controller', async () => {
  let sentToGame = false;
  const deps = {
    enabled: () => true,
    now: () => 0,
    random: () => 0,
    wait: async () => {},
    templates: () => [{}],
    decode: async () => ({}),
    match: async () => ({ confident: true, index: 0, score: .95 }),
    yieldTask: async () => {},
    isSocket: () => false,
    send: () => { sentToGame = true; },
    log: () => {}
  };
  const packet = { t: 'vq', k: 1, c: 4, n: 'A', i: 'dGVzdA==', s: 45, r: 3,
    q: { key: 'monster', params: { name: 'A' } } };
  const mod = { log() {} };
  let shownPacket;
  let closed = false;
  const ui = {
    abrirConfirma: packet => { shownPacket = packet; },
    fecharConfirma: () => { closed = true; }
  };
  const i18n = { t: value => value, tMsg: () => 'A', tMonster: value => value };
  new Function('createConfirmationController', 'confirmationDependencies', 'mod', 'confirmation', 'ui', 'i18n', 'packet', 'setTimeout', `
    let confirmationSimulationGeneration = 0;
    let clientCaptchaSimulation = null;
    let lastMonsterConfirmationPacket = packet;
    const readCaptchaLog = async id => id === 42 ? { packet } : null;
    const readCaptchaLogs = async () => [{ packet }];
    const loadClientConfirmationUi = async () => [ui, i18n];
    ${simulator}
  `)(createConfirmationController, deps, mod, { state: { active: false } }, ui, i18n, packet, () => 0);

  assert.deepEqual(await mod.simulateMonsterConfirmation(), { ok: true });
  assert.deepEqual(shownPacket, packet);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(mod.confirmationSimulation.answer, 0);
  assert.equal(mod.confirmationSimulation.name, 'A');
  assert.equal(sentToGame, false);
  assert.equal(closed, true);

  assert.deepEqual(await mod.simulateMonsterConfirmation(42), { ok: true });
  assert.deepEqual(shownPacket, packet);
  assert.equal(sentToGame, false);
});
