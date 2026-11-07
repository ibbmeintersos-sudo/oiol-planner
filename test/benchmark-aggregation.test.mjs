import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateRuns } from '../scripts/aggregate-benchmark-runs.mjs';

const makeRun=(runId,score=90,scenarioId='GF-API-001',fingerprint='same-config')=>({
 runId,configFingerprint:fingerprint,summary:{averageScore:score},
 scores:[{scenarioId,score,status:'ready_for_review',blockers:[]}]
});

test('repeat aggregation reports per-scenario median, spread, and three-run gate',()=>{
 const report=aggregateRuns([makeRun('r1',90),makeRun('r2',80),makeRun('r3',100)]);
 assert.equal(report.runCount,3);
 assert.equal(report.repeatedRunGate.met,true);
 assert.equal(report.runAverageScore.median,90);
 assert.equal(report.scenarioResults[0].median,90);
 assert.equal(report.scenarioResults[0].spread,20);
 assert.equal(report.certificationReadyForHumanReview,true);
 assert.equal(report.failureRate,0);
});

test('repeat aggregation refuses to mix configuration fingerprints',()=>{
 assert.throws(()=>aggregateRuns([makeRun('r1',90,'GF-API-001','model-a'),makeRun('r2',90,'GF-API-001','model-b')]),/different configuration fingerprints/);
});

test('repeat aggregation does not certify incomplete scenario coverage or failed runs',()=>{
 const report=aggregateRuns([makeRun('r1',95),makeRun('r2',95),makeRun('r3',50,'GF-API-001')]);
 assert.equal(report.certificationReadyForHumanReview,false);
 assert.equal(report.failureRate,1/3);
});

test('repeat aggregation rejects duplicate run identifiers',()=>{
 assert.throws(()=>aggregateRuns([makeRun('same'),makeRun('same')]),/unique non-empty runId/);
});
