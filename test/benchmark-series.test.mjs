import test from 'node:test';
import assert from 'node:assert/strict';
import { runBenchmarkSeries } from '../scripts/run-benchmark-series.mjs';

test('benchmark series requires at least three repetitions', async () => {
  await assert.rejects(() => runBenchmarkSeries({ runs: 2 }), /integer from 3 to 5/);
});

test('benchmark series requires explicit live-call authorization before doing work', async () => {
  const previousOptIn = process.env.OIOL_BENCHMARK_ALLOW_LIVE;
  const previousKey = process.env.OIOL_API_KEY;
  const previousProvider = process.env.OIOL_PROVIDER;
  try {
    delete process.env.OIOL_BENCHMARK_ALLOW_LIVE;
    delete process.env.OIOL_API_KEY;
    process.env.OIOL_PROVIDER = 'openai-compatible';
    await assert.rejects(() => runBenchmarkSeries({ runs: 3, outDir: 'benchmarks/results/should-not-exist' }), /Set OIOL_BENCHMARK_ALLOW_LIVE=1/);
  } finally {
    if (previousOptIn === undefined) delete process.env.OIOL_BENCHMARK_ALLOW_LIVE; else process.env.OIOL_BENCHMARK_ALLOW_LIVE = previousOptIn;
    if (previousKey === undefined) delete process.env.OIOL_API_KEY; else process.env.OIOL_API_KEY = previousKey;
    if (previousProvider === undefined) delete process.env.OIOL_PROVIDER; else process.env.OIOL_PROVIDER = previousProvider;
  }
});
