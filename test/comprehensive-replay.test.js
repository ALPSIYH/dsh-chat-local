import test from 'node:test';
import assert from 'node:assert/strict';
import { dependentVariables, dispersion, runSegments } from '../lib/experiment.js';
import { deriveRelationships, effectiveAppraisals, revocableAppraisal } from '../lib/relationship.js';

test('250 delivery histories count received injections once and exclude foreign-room receipts', () => {
  let seed = 0x19a7;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor(seed / 2 ** 32 * n); };
  for (let history = 0; history < 250; history++) {
    const events = [], expected = [], roomId = 'observed-room';
    const append = (type, payload, room = roomId) => events.push({ id: `e${events.length}`, tick: events.length,
      at: events.length + 1, type, payload, provenance: { roomId: room } });
    for (let turn = 0; turn < 20; turn++) {
      const deliveryId = `d${turn}`, chars = random(601), reached = random(2) === 1;
      append('injection.cost', { deliveryId, digestChars: chars });
      append('delivery.settled', { deliveryId, status: 'delivered' }, 'another-room');
      append('delivery.settled', { deliveryId, status: 'sent' });
      if (reached) {
        expected.push(chars);
        for (const status of ['delivered', 'working', 'replied']) append('delivery.settled', { deliveryId, status });
      } else if (random(2)) append('delivery.settled', { deliveryId, status: 'failed' });
    }
    for (let i = events.length - 1; i > 0; i--) {
      const j = random(i + 1); [events[i], events[j]] = [events[j], events[i]];
    }
    const result = dependentVariables({ events, roomId });
    assert.equal(result.injectedTurns, expected.length, `history ${history}`);
    assert.equal(result.unreachedInjections, 20 - expected.length);
    assert.equal(result.injectedDigestCharsTotal, expected.reduce((a, b) => a + b, 0));
    assert.equal(result.injectedDigestCharsMean, expected.length ? expected.reduce((a, b) => a + b, 0) / expected.length : null);
  }
});

// An append-only personal history has no event-count ceiling. This exceeds the
// engine's argument-count limit without requiring a large on-disk fixture.
test('long-lived history replays beyond the JavaScript argument-count limit', async t => {
  const count = 150_000, roomId = 'long-lived';
  const events = Array.from({ length: count }, (_, i) => ({
    id: `event-${i}`, at: i + 1, tick: i, provenance: { roomId },
    type: i === 0 ? 'run.manifest' : 'message.created',
    payload: i === 0 ? { arm: 'persistent', configHash: 'recorded-config',
      models: { a: { provider: 'p', model: 'm' } }, initialStateVersion: 16, startedAtTick: 0 } : {}
  }));
  await t.test('run segmentation retains the complete horizon', () => {
    const segments = runSegments(events, roomId);
    assert.equal(segments.length, 1);
    assert.equal(segments[0].events.length, count);
    assert.equal(segments[0].tickEnd, count - 1);
  });
  await t.test('dependent variables retain the complete horizon', () => {
    const values = dependentVariables({ events, roomId });
    assert.equal(values.tickEnd, count - 1);
    assert.equal(values.injectedTurns, 0);
    assert.equal(values.reviewRejectionRate, null);
  });
  await t.test('relationship and appraisal readers accept the same history', () => {
    assert.ok(deriveRelationships({ events, roomId }));
    assert.deepEqual(effectiveAppraisals(events, roomId), {});
    assert.equal(revocableAppraisal(events, roomId, 'a', 'b'), null);
  });
  await t.test('dispersion computes extrema without a variadic call', () => {
    const statistics = dispersion(events.map(event => event.tick));
    assert.equal(statistics.n, count);
    assert.equal(statistics.min, 0);
    assert.equal(statistics.max, count - 1);
    assert.equal(statistics.mean, (count - 1) / 2);
    assert.ok(Math.abs(statistics.variance - count * (count + 1) / 12) < 1e-5);
  });
});
