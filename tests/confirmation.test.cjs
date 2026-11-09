const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

// The browser loaders execute observer.js directly, without a module bundler.
// Run its actual pure helpers without starting sockets, timers or game imports.
const source = readFileSync(require.resolve('../src/observer.js'), 'utf8');
const helpers = source.slice(source.indexOf('  function confirmationTemplate('),
  source.indexOf('  // End of browser-independent confirmation helpers.'));
const { confirmationTemplate, matchConfirmationImage, createConfirmationController } = new Function(
  `${helpers}\nreturn { confirmationTemplate, matchConfirmationImage, createConfirmationController };`
)();

function pixels(width, height, background = [19, 32, 48, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let at = 0; at < data.length; at += 4) data.set(background, at);
  return { width, height, data };
}
function sprite() {
  const result = pixels(16, 24, [0, 0, 0, 0]);
  const palette = [[35, 174, 207, 255], [129, 246, 235, 255], [239, 254, 254, 255], [42, 80, 132, 255]];
  for (let y = 0; y < 24; y++) for (let x = 0; x < 16; x++) {
    if (x < (y % 5) || x > 15 - (y % 3)) continue;
    result.data.set(palette[(Math.floor(y / 4) + Math.floor(x / 3)) % 4], (y * 16 + x) * 4);
  }
  return result;
}
function draw(image, source, x0, y0, width, height, flip = false) {
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.floor(x * source.width / width);
    const at = (Math.floor(y * source.height / height) * source.width + (flip ? source.width - 1 - sx : sx)) * 4;
    if (source.data[at + 3]) image.data.set(source.data.subarray(at, at + 4), ((y0 + y) * image.width + x0 + x) * 4);
  }
}
const match = (image, templates, active = () => true) => matchConfirmationImage(image, templates, 4, active, async () => {});

test('finds the target in each option, including scale, reflection and scattered noise', async () => {
  const target = sprite();
  for (let column = 0; column < 4; column++) {
    const image = pixels(208, 64);
    draw(image, target, column * 52 + 13, 7, 24, 36, column % 2 === 1);
    for (let at = 0; at < image.data.length; at += 4 * 79) image.data.set([142, 203, 230, 255], at);
    const result = await match(image, [confirmationTemplate(target)]);
    assert.equal(result.index, column);
    assert.equal(result.confident, true, JSON.stringify(result));
  }
});

test('does not answer an absent or ambiguous target', async () => {
  const target = sprite();
  const image = pixels(208, 64);
  assert.equal((await match(image, [confirmationTemplate(target)])).confident, false);
  draw(image, target, 13, 7, 24, 36);
  draw(image, target, 117, 7, 24, 36);
  assert.equal((await match(image, [confirmationTemplate(target)])).confident, false);
});

test('rejects empty sprites and cancels recognition between chunks', async () => {
  assert.equal(confirmationTemplate(pixels(20, 20, [0, 0, 0, 0])), null);
  assert.equal(await match(pixels(208, 64), [confirmationTemplate(sprite())], () => false), null);
});

function harness(overrides = {}) {
  const socket = {};
  const sent = [];
  let time = 0;
  const deps = {
    now: () => time, enabled: () => true, isSocket: value => value === socket,
    random: () => .5, wait: async milliseconds => { time += milliseconds; },
    templates: () => [{}], decode: async () => ({}),
    match: async () => ({ confident: true, index: 0, score: .95 }),
    yieldTask: async () => {}, log: () => {},
    send: (s, packet) => sent.push({ s, ...packet }), ...overrides
  };
  const controller = createConfirmationController(deps);
  return { ...controller, socket, sent, deps, tick: value => { time = value; },
    packet: { t: 'vq', k: 1, c: 4, n: 'Ice Elemental', i: 'image', s: 45, r: 3 } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('sends a zero-based answer once, waits for vq close and ignores duplicate challenges', async () => {
  const h = harness();
  h.receive(h.socket, h.packet);
  await settle();
  h.receive(h.socket, { ...h.packet, r: 2 });
  await settle();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].a, 0);
  assert.equal(h.sent[0].t, 'va');
  assert.equal(h.state.active, true);
  h.receive(h.socket, { t: 'vq' });
  assert.equal(h.state.active, false);
});

test('manual response, closed connection, deadline and disabled setting cancel an in-flight answer', async () => {
  for (const action of ['manual', 'close', 'expired', 'disabled', 'socket']) {
    let resolve;
    const h = harness({ decode: () => new Promise(done => { resolve = done; }) });
    h.receive(h.socket, h.packet);
    await settle();
    if (action === 'manual') h.answered(h.socket);
    if (action === 'close') h.reset(h.socket);
    if (action === 'expired') h.tick(45000);
    if (action === 'disabled') h.deps.enabled = () => false;
    if (action === 'socket') h.deps.isSocket = () => false;
    resolve({});
    await settle();
    assert.equal(h.sent.length, 0, action);
  }
});

test('replaced challenge invalidates an old async result', async () => {
  const pending = [];
  const h = harness({ decode: () => new Promise(resolve => pending.push(resolve)) });
  h.receive(h.socket, h.packet);
  await settle();
  h.receive(h.socket, { ...h.packet, i: 'new-image' });
  await settle();
  pending[0]({});
  await settle();
  assert.equal(h.sent.length, 0);
  pending[1]({});
  await settle();
  assert.equal(h.sent.length, 1);
});

test('unsupported, unknown, failed and inconclusive challenges remain manual', async () => {
  for (const overrides of [
    { enabled: () => false }, { templates: () => [] },
    { decode: async () => { throw new Error('invalid image'); } },
    { match: async () => ({ confident: false }) }
  ]) {
    const h = harness(overrides);
    h.receive(h.socket, h.packet);
    await settle();
    assert.equal(h.sent.length, 0);
    assert.match(h.state.status, /manual/);
  }
  const h = harness();
  h.receive(h.socket, { ...h.packet, k: 2 });
  await settle();
  assert.equal(h.sent.length, 0);
  assert.match(h.state.status, /manual/);
});

test('unrelated sockets cannot start or dismiss a challenge', async () => {
  const h = harness();
  h.receive({}, h.packet);
  assert.equal(h.state.active, false);
  h.receive(h.socket, h.packet);
  h.reset({});
  assert.equal(h.state.active, true);
  await settle();
  assert.equal(h.sent.length, 1);
});

test('does not send after expiry during matching and does not retry a failed send', async () => {
  let finish;
  const h = harness({ match: () => new Promise(resolve => { finish = resolve; }) });
  h.receive(h.socket, h.packet);
  await settle();
  h.tick(45000);
  finish({ confident: true, index: 1, score: .99 });
  await settle();
  assert.equal(h.sent.length, 0);
  let attempts = 0;
  const failing = harness({ send: () => { attempts++; throw new Error('socket closed'); } });
  failing.receive(failing.socket, failing.packet);
  await settle();
  failing.receive(failing.socket, failing.packet);
  await settle();
  assert.equal(attempts, 1);
  assert.match(failing.state.status, /manual/);
});

test('waits a random 5 to 20 seconds before sending, including both bounds', async () => {
  for (const [random, expected] of [[0, 5000], [.5, 13000], [.999999, 20000]]) {
    let release;
    let delay;
    const h = harness({ random: () => random, wait: milliseconds => {
      delay = milliseconds;
      return new Promise(resolve => { release = resolve; });
    } });
    h.receive(h.socket, h.packet);
    await settle();
    assert.equal(delay, expected);
    assert.equal(h.sent.length, 0);
    h.tick(delay);
    release();
    await settle();
    assert.equal(h.sent.length, 1);
  }
});

test('limits the wait to the remaining deadline and never waits less than 5 seconds', async () => {
  let delay;
  const h = harness({ random: () => .999999, wait: async milliseconds => { delay = milliseconds; } });
  h.receive(h.socket, { ...h.packet, s: 10 });
  await settle();
  assert.equal(delay, 8000);
  assert.equal(h.sent.length, 1);
  const short = harness({ wait: async () => assert.fail('must not schedule a short delay') });
  short.receive(short.socket, { ...short.packet, s: 5 });
  await settle();
  assert.equal(short.sent.length, 0);
  assert.match(short.state.status, /tempo insuficiente/);
});

test('cancels the delayed answer on manual response, closure, replacement, disable or expiry', async () => {
  for (const action of ['manual', 'close', 'replace', 'disabled', 'expired']) {
    let release;
    const h = harness({ wait: () => new Promise(resolve => { release = resolve; }) });
    h.receive(h.socket, h.packet);
    await settle();
    if (action === 'manual') h.answered(h.socket);
    if (action === 'close') h.reset(h.socket);
    if (action === 'replace') h.receive(h.socket, { ...h.packet, i: 'new-image', k: 2 });
    if (action === 'disabled') h.deps.enabled = () => false;
    if (action === 'expired') h.tick(45000);
    release();
    await settle();
    assert.equal(h.sent.length, 0, action);
  }
});
