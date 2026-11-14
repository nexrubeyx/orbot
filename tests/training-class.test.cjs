const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const source = readFileSync(require.resolve('../src/observer.js'), 'utf8');
const helper = source.slice(source.indexOf('  function ensureTrainingClass('), source.indexOf('  function finishTrainingElite('));

function harness(random = .5) {
  return new Function('random', `
    let now = 0;
    let trainingClassSwitch = null;
    let trainingSkillPendingUntil = 0;
    const playerStats = { cls: 2, specialReady: 0 };
    const myself = {};
    const huntState = { trainingClass: 'mage', trainingCooldownClass: 'distance', trainingUseSkill: true, trainingSwitchDuringCooldown: true };
    const classIds = { melee: 0, distance: 1, mage: 2 };
    const sent = [];
    const Date = { now: () => now };
    const Math = { random: () => random };
    const sendTrainingClass = desired => { sent.push({ at: now, desired }); return true; };
    ${helper}
    return {
      ensureTrainingClass,
      desiredTrainingClass,
      sent,
      setTime: value => { now = value; },
      setClass: value => { playerStats.cls = value; },
      setCooldown: value => { playerStats.specialReady = value; },
      setSkillPendingUntil: value => { trainingSkillPendingUntil = value; },
      setSkillEnabled: value => { huntState.trainingUseSkill = value; },
      setSwitchEnabled: value => { huntState.trainingSwitchDuringCooldown = value; }
    };
  `)(random);
}

test('waits 1 to 2 seconds for each class change and returns to the configured training class', () => {
  for (const [random, delay] of [[0, 1000], [.5, 1500], [1, 2000]]) {
    const h = harness(random);
    assert.equal(h.ensureTrainingClass('distance'), false);
    h.setTime(delay - 1);
    assert.equal(h.ensureTrainingClass('distance'), false);
    assert.deepEqual(h.sent, []);
    h.setTime(delay);
    assert.equal(h.ensureTrainingClass('distance'), false);
    assert.deepEqual(h.sent, [{ at: delay, desired: 1 }]);

    h.setClass(1);
    assert.equal(h.ensureTrainingClass('distance'), true);
    h.setTime(delay + 100);
    assert.equal(h.ensureTrainingClass('mage'), false);
    h.setTime(delay + 100 + delay);
    assert.equal(h.ensureTrainingClass('mage'), false);
    assert.deepEqual(h.sent.at(-1), { at: delay + 100 + delay, desired: 2 });
  }
});

test('uses the cooldown class while the skill recharges and returns for the next cast', () => {
  const h = harness(0);
  assert.equal(h.desiredTrainingClass(), 'mage');
  h.setSkillPendingUntil(1000);
  assert.equal(h.desiredTrainingClass(), 'distance');
  h.setCooldown(5);
  h.setTime(1000);
  assert.equal(h.desiredTrainingClass(), 'distance');
  h.ensureTrainingClass(h.desiredTrainingClass());
  h.setTime(2000);
  h.ensureTrainingClass(h.desiredTrainingClass());
  assert.deepEqual(h.sent, [{ at: 2000, desired: 1 }]);
  h.setClass(1);
  h.setCooldown(0);
  assert.equal(h.desiredTrainingClass(), 'mage');
  h.ensureTrainingClass(h.desiredTrainingClass());
  h.setTime(3000);
  h.ensureTrainingClass(h.desiredTrainingClass());
  assert.deepEqual(h.sent.at(-1), { at: 3000, desired: 2 });
});

test('leaves the training class unchanged when skill or cooldown switch is disabled', () => {
  const h = harness();
  h.setCooldown(5);
  h.setSkillEnabled(false);
  assert.equal(h.desiredTrainingClass(), 'mage');
  h.setSkillEnabled(true);
  h.setSwitchEnabled(false);
  assert.equal(h.desiredTrainingClass(), 'mage');
});

test('cancels a pending change when the desired class changes', () => {
  const h = harness(0);
  h.ensureTrainingClass('distance');
  h.setTime(500);
  assert.equal(h.ensureTrainingClass('melee'), false);
  h.setTime(1000);
  h.ensureTrainingClass('melee');
  assert.deepEqual(h.sent, []);
  h.setTime(1500);
  h.ensureTrainingClass('melee');
  assert.deepEqual(h.sent, [{ at: 1500, desired: 0 }]);
});
