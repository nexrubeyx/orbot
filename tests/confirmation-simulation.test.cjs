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
  const monsters = ['A', 'B', 'C', 'D'].map((name, index) => ({ name, anims: [[index]] }));
  const assets = { c8: {}, monsters, entities: { monsters: monsters.map((_, index) => [index * 10, 0, 10, 10]) } };
  const canvas = {
    getContext: () => ({ fillRect() {}, drawImage() {} }),
    toDataURL: () => 'data:image/png;base64,dGVzdA=='
  };
  const mod = { log() {} };
  let shownPacket;
  let closed = false;
  const ui = {
    abrirConfirma: packet => { shownPacket = packet; },
    fecharConfirma: () => { closed = true; }
  };
  new Function('createConfirmationController', 'confirmationDependencies', 'monsterAssets', 'document', 'Math', 'mod', 'confirmation', 'ui', 'setTimeout', `
    let confirmationSimulationGeneration = 0;
    let clientCaptchaSimulation = null;
    const loadClientConfirmationUi = async () => ui;
    ${simulator}
  `)(createConfirmationController, deps, assets, { createElement: () => canvas },
    Object.assign(Object.create(Math), { random: () => 0 }), mod,
    { state: { active: false } }, ui, () => 0);

  assert.deepEqual(await mod.simulateMonsterConfirmation(), { ok: true });
  assert.equal(shownPacket.t, 'vq');
  assert.equal(shownPacket.k, 1);
  assert.equal(shownPacket.c, 4);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(mod.confirmationSimulation.answer, 0);
  assert.equal(mod.confirmationSimulation.expected, 0);
  assert.ok(['A', 'B', 'C', 'D'].includes(mod.confirmationSimulation.name));
  assert.equal(sentToGame, false);
  assert.equal(closed, true);
});
