// Simple test harness (node). Run with `npm test` after adding script.
const assert = require('assert');
const { getParsedTripUpdates, setCustomFetcher, clearCustomFetcher } = require('../utils/gtfsRealTime');
const { computeProgress, interpolateBetweenCoords, cumulativeDistances } = require('../utils/interpolation');

async function testNormalizationMock() {
  // Mock one TripUpdate entity shape as gtfs-realtime-bindings decoded object
  const sampleEntity = { tripUpdate: {
      trip: { tripId: 'T123', routeId: 'R1', startTime: '12:00:00', startDate: '20251111', originalTripId: 'ORIG123' },
      stopTimeUpdate: [
        { stopId: 'S1', stopSequence: 1, arrival: { time: 1762861200 }, departure: { time: 1762861200 } },
        { stopId: 'S2', stopSequence: 2, arrival: { delay: 60 }, departure: { delay: 60 } }
      ]
    } };

  setCustomFetcher(async () => ({ entities: [sampleEntity], isRealtime: true, fetchedAt: new Date().toISOString() }));
  const { tripUpdates, isRealtime } = await getParsedTripUpdates();
  assert.strictEqual(isRealtime, true);
  assert.strictEqual(tripUpdates.length, 1, 'Should have one normalized tripUpdate');
  const tu = tripUpdates[0];
  assert.deepStrictEqual(tu.trip.tripId, 'T123');
  assert.deepStrictEqual(tu.trip.originalTripId, 'ORIG123');
  assert.ok(Array.isArray(tu.stopTimeUpdates));
  assert.ok(tu.stopTimeUpdates[0].arrivalTimeSecs);
  assert.strictEqual(tu.stopTimeUpdates[1].arrivalDelaySecs, 60);
  clearCustomFetcher();
}

function testInterpolationBasic() {
  const coords = [[0,0],[1,0]]; // 1 unit long east
  const dists = cumulativeDistances(coords);
  // target half-way
  const target = dists[0] + 0.5 * (dists[1] - dists[0]);
  const p = interpolateBetweenCoords(coords, dists[0], dists[1], target);
  assert.deepStrictEqual(p, [0.5, 0]);

  const times = [100, 200];
  const progress = computeProgress(times, 150);
  assert.strictEqual(progress.prevStopIdx, 0);
  assert.strictEqual(progress.nextStopIdx, 1);
  assert(Math.abs(progress.fraction - 0.5) < 1e-9);
}

(async () => {
  try {
    await testNormalizationMock();
    testInterpolationBasic();
    console.log('All realtime tests passed');
  } catch (e) {
    console.error('Realtime tests failed:', e);
    process.exit(1);
  }
})();
