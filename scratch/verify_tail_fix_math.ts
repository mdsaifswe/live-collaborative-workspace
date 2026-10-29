import fs from 'fs';
import path from 'path';

interface Sample {
  opId: string;
  eventId: string;
  eventType: string;
  entityId: string;
  originClientId: string;
  receiverClientId: string;
  calibratedOriginStartTime: number;
  calibratedWsReceiveTime: number;
  calibratedRenderedTime: number;
  wsDeliveryLatencyMs: number;
  renderedLatencyMs: number;
  renderPaintOverheadMs: number;
  isDomObservable: boolean;
  isWarmup: boolean;
}

interface BenchmarkRun {
  config: unknown;
  metrics: {
    renderedLatency: {
      minMs: number;
      avgMs: number;
      p50Ms: number;
      p95Ms: number;
      p99Ms: number;
      maxMs: number;
    };
    transportLatency?: {
      avgMs: number;
      p50Ms: number;
      p95Ms: number;
      p99Ms: number;
    };
    wsDeliveryLatency?: {
      avgMs: number;
      p50Ms: number;
      p95Ms: number;
      p99Ms: number;
    };
    sampleCount: number;
    missingDeliveries: number;
    duplicateDeliveries: number;
    contentDivergences: number;
  };
  samples: Sample[];
}

function computePercentiles(values: number[]) {
  if (values.length === 0) return { min: 0, max: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0, p999: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;

  const getP = (p: number) => {
    const idx = Math.min(n - 1, Math.floor((p / 100) * n));
    return sorted[idx];
  };

  return {
    count: n,
    min: sorted[0],
    mean,
    p50: getP(50),
    p90: getP(90),
    p95: getP(95),
    p99: getP(99),
    p999: getP(99.9),
    max: sorted[n - 1],
  };
}

const preRounds = [
  { name: 'Pre-Fix Round 1', path: 'evidence/fresh_performance_audit_20261027/round1/browser-benchmark-20-clients.json' },
  { name: 'Pre-Fix Round 2', path: 'evidence/fresh_performance_audit_20261027/round2/browser-benchmark-20-clients.json' },
  { name: 'Pre-Fix Round 3', path: 'evidence/fresh_performance_audit_20261027/round3/browser-benchmark-20-clients.json' },
];

const postRounds = [
  { name: 'Post-Fix Round 1', path: 'evidence/performance_tail_latency_fix_20261027/round1/browser-benchmark-20-clients.json' },
  { name: 'Post-Fix Round 2', path: 'evidence/performance_tail_latency_fix_20261027/round2/browser-benchmark-20-clients.json' },
  { name: 'Post-Fix Round 3', path: 'evidence/performance_tail_latency_fix_20261027/round3/browser-benchmark-20-clients.json' },
  { name: 'Post-Fix Round 4', path: 'evidence/performance_tail_latency_fix_20261027/round4/browser-benchmark-20-clients.json' },
];

function analyzeRounds(roundList: typeof preRounds) {
  const allRendered: number[] = [];
  const allWs: number[] = [];
  const allSamples: Sample[] = [];
  let totalMissing = 0;
  let totalDupes = 0;
  let totalDivs = 0;

  const roundSummaries = roundList.map((r) => {
    const raw = JSON.parse(fs.readFileSync(r.path, 'utf8')) as BenchmarkRun;
    const valid = raw.samples.filter((s) => !s.isWarmup);
    const renderedVals = valid.map((s) => s.renderedLatencyMs);
    const wsVals = valid.map((s) => s.wsDeliveryLatencyMs);

    allRendered.push(...renderedVals);
    allWs.push(...wsVals);
    allSamples.push(...valid);
    totalMissing += raw.metrics.missingDeliveries || 0;
    totalDupes += raw.metrics.duplicateDeliveries || 0;
    totalDivs += raw.metrics.contentDivergences || 0;

    return {
      name: r.name,
      rendered: computePercentiles(renderedVals),
      ws: computePercentiles(wsVals),
      samples: valid.length,
      missing: raw.metrics.missingDeliveries || 0,
      duplicates: raw.metrics.duplicateDeliveries || 0,
      divergences: raw.metrics.contentDivergences || 0,
    };
  });

  return {
    rounds: roundSummaries,
    combinedRendered: computePercentiles(allRendered),
    combinedWs: computePercentiles(allWs),
    totalSamples: allSamples.length,
    totalMissing,
    totalDupes,
    totalDivs,
    allSamples,
  };
}

const preAnalysis = analyzeRounds(preRounds);
const postAnalysis = analyzeRounds(postRounds);

console.log('='.repeat(80));
console.log('BEFORE-AND-AFTER INDEPENDENT TAIL LATENCY VERIFICATION');
console.log('='.repeat(80));

console.log('\n--- PRE-FIX BENCHMARK ROUNDS ---');
preAnalysis.rounds.forEach((r) => {
  console.log(`${r.name}:`);
  console.log(`  Rendered p50: ${r.rendered.p50.toFixed(2)} ms | p95: ${r.rendered.p95.toFixed(2)} ms | p99: ${r.rendered.p99.toFixed(2)} ms | Max: ${r.rendered.max.toFixed(2)} ms`);
  console.log(`  WS p50:       ${r.ws.p50.toFixed(2)} ms | p95: ${r.ws.p95.toFixed(2)} ms | p99: ${r.ws.p99.toFixed(2)} ms | Max: ${r.ws.max.toFixed(2)} ms`);
  console.log(`  Samples: ${r.samples} | Missing: ${r.missing} | Dupes: ${r.duplicates} | Divs: ${r.divergences}`);
});
console.log(`Pre-Fix Combined (${preAnalysis.totalSamples} samples):`);
console.log(`  Rendered p50: ${preAnalysis.combinedRendered.p50.toFixed(2)} ms | p95: ${preAnalysis.combinedRendered.p95.toFixed(2)} ms | p99: ${preAnalysis.combinedRendered.p99.toFixed(2)} ms | Max: ${preAnalysis.combinedRendered.max.toFixed(2)} ms`);
console.log(`  WS p50:       ${preAnalysis.combinedWs.p50.toFixed(2)} ms | p95: ${preAnalysis.combinedWs.p95.toFixed(2)} ms | p99: ${preAnalysis.combinedWs.p99.toFixed(2)} ms | Max: ${preAnalysis.combinedWs.max.toFixed(2)} ms`);

console.log('\n--- POST-FIX BENCHMARK ROUNDS ---');
postAnalysis.rounds.forEach((r) => {
  console.log(`${r.name}:`);
  console.log(`  Rendered p50: ${r.rendered.p50.toFixed(2)} ms | p95: ${r.rendered.p95.toFixed(2)} ms | p99: ${r.rendered.p99.toFixed(2)} ms | Max: ${r.rendered.max.toFixed(2)} ms`);
  console.log(`  WS p50:       ${r.ws.p50.toFixed(2)} ms | p95: ${r.ws.p95.toFixed(2)} ms | p99: ${r.ws.p99.toFixed(2)} ms | Max: ${r.ws.max.toFixed(2)} ms`);
  console.log(`  Samples: ${r.samples} | Missing: ${r.missing} | Dupes: ${r.duplicates} | Divs: ${r.divergences}`);
});
console.log(`Post-Fix Combined (${postAnalysis.totalSamples} samples):`);
console.log(`  Rendered p50: ${postAnalysis.combinedRendered.p50.toFixed(2)} ms | p95: ${postAnalysis.combinedRendered.p95.toFixed(2)} ms | p99: ${postAnalysis.combinedRendered.p99.toFixed(2)} ms | Max: ${postAnalysis.combinedRendered.max.toFixed(2)} ms`);
console.log(`  WS p50:       ${postAnalysis.combinedWs.p50.toFixed(2)} ms | p95: ${postAnalysis.combinedWs.p95.toFixed(2)} ms | p99: ${postAnalysis.combinedWs.p99.toFixed(2)} ms | Max: ${postAnalysis.combinedWs.max.toFixed(2)} ms`);

console.log('\n--- SLOWEST 30 OBSERVATIONS POST-FIX (ACROSS ALL 4 ROUNDS) ---');
const sortedSlowestPost = [...postAnalysis.allSamples].sort((a, b) => b.renderedLatencyMs - a.renderedLatencyMs).slice(0, 30);
console.log('Rank | Op ID | Type | Origin -> Receiver | Rendered (ms) | WS Delivery (ms) | Render Overhead (ms)');
sortedSlowestPost.forEach((s, idx) => {
  console.log(
    `${(idx + 1).toString().padStart(2)}   | ${s.opId} | ${s.eventType.padEnd(12)} | ${s.originClientId} -> ${s.receiverClientId} | ${s.renderedLatencyMs.toFixed(2).padStart(8)} ms | ${s.wsDeliveryLatencyMs.toFixed(2).padStart(8)} ms | ${s.renderPaintOverheadMs.toFixed(2).padStart(8)} ms`
  );
});

// Save complete summary JSON for evidence
const summaryOut = {
  timestamp: new Date().toISOString(),
  preFix: {
    rounds: preAnalysis.rounds,
    combinedRendered: preAnalysis.combinedRendered,
    combinedWs: preAnalysis.combinedWs,
    totalSamples: preAnalysis.totalSamples,
  },
  postFix: {
    rounds: postAnalysis.rounds,
    combinedRendered: postAnalysis.combinedRendered,
    combinedWs: postAnalysis.combinedWs,
    totalSamples: postAnalysis.totalSamples,
    slowest30: sortedSlowestPost,
  },
};

fs.writeFileSync(
  'evidence/performance_tail_latency_fix_20261027/tail_latency_verification_summary.json',
  JSON.stringify(summaryOut, null, 2)
);
console.log('\n[Evidence] Saved verification summary to evidence/performance_tail_latency_fix_20261027/tail_latency_verification_summary.json');
