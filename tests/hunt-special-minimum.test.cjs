const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const source = readFileSync(require.resolve('../src/observer.js'), 'utf8');
const special = source.slice(
  source.indexOf('  let lastSpecialBlocked ='),
  source.indexOf('  function processAutoLoot(')
);

function trySpecial({ enabled = true, minimum = 2, nearby = 1, targetInRange = true }) {
  return new Function('options', `
    const huntState = { useSpecial: true, specialMinimumEnabled: options.enabled,
      specialMinimumCount: options.minimum };
    const myself = { x: 10, y: 10 };
    const calls = [];
    const mod = {
      creaturesNearby: () => Array.from({ length: options.nearby }, (_, id) => ({ id })),
      useHuntSpecial: () => { calls.push('special'); return { ok: true }; },
      log: () => {}
    };
    const hasAttackLine = () => true;
    const isAttackedByAnotherPlayer = () => false;
    ${special}
    useSpecialForNearbyMobs({ distance: options.targetInRange ? 1 : 5 }, 4);
    return calls;
  `)({ enabled, minimum, nearby, targetInRange });
}

test('hunt special can be used with one creature when minimum is disabled', () => {
  assert.deepEqual(trySpecial({ enabled: false, nearby: 1 }), ['special']);
});

test('hunt special waits for the configured creature count', () => {
  assert.deepEqual(trySpecial({ minimum: 3, nearby: 2 }), []);
  assert.deepEqual(trySpecial({ minimum: 3, nearby: 3 }), ['special']);
});

test('hunt special still requires a target in attack range', () => {
  assert.deepEqual(trySpecial({ enabled: false, targetInRange: false }), []);
});
