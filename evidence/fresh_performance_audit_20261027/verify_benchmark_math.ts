import fs from 'fs';
import path from 'path';

interface SampleRecord {
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

interface BenchmarkJson {
  timestamp: string;
  metrics: {
    renderedLatency: {
      p50Ms: number;
      p95Ms: number;
      p99Ms: number;
      minMs: number;
      maxMs: number;
      avgMs: number;
    };
    transportLatency?: {
      p50Ms: number;
      p95Ms: number;
      p99Ms: number;
      avgMs: number;
    };
    wsDeliveryLatency?: {
      p50Ms: number;
      p95Ms: number;
      p99Ms: number;
      avgMs: number;
    };
    renderPaintOverhead: {
      avgMs: number;
    };
    reliability: {
      missingDeliveries: number;
      duplicateDeliveries: number;
      rejectedOperations: number;
      failedHandlers: number;
      contentDivergences: number;
      authoritativeRevision: number;
    };
    passed: boolean;
  };
  samples: SampleRecord[];
}

function computeStats(values: number[]) {
  if (values.length === 0) {
    return { count: 0, min: 0, max: 0, avg: 0, p50_floor: 0, p95_floor: 0, p99_floor: 0, p50_nearestRank: 0, p95_nearestRank: 0, p99_nearestRank: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const min = sorted[0];
  const max = sorted[n - 1];
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const avg = sum / n;

  // Benchmark convention (0-indexed floor): Math.min(n - 1, Math.floor(pct / 100 * n))
  const p50_floor = sorted[Math.min(n - 1, Math.floor(0.50 * n))];
  const p95_floor = sorted[Math.min(n - 1, Math.floor(0.95 * n))];
  const p99_floor = sorted[Math.min(n - 1, Math.floor(0.99 * n))];

  // Nearest-rank convention: ceil(P * N) - 1 (for 0-indexed)
  const getNearestRank = (pct: number) => {
    const rank = Math.ceil((pct / 100) * n);
    const index = Math.max(0, Math.min(n - 1, rank - 1));
    return sorted[index];
  };

  const p50_nearestRank = getNearestRank(50);
  const p95_nearestRank = getNearestRank(95);
  const p99_nearestRank = getNearestRank(99);

  return {
    count: n,
    min,
    max,
    avg,
    p50_floor,
    p95_floor,
    p99_floor,
    p50_nearestRank,
    p95_nearestRank,
    p99_nearestRank,
  };
}

function analyzeRound(roundPath: string, roundName: string) {
  const content = fs.readFileSync(roundPath, 'utf-8');
  const data: BenchmarkJson = JSON.parse(content);

  const rawSamples = data.samples || [];
  const measuredSamples = rawSamples.filter((s) => !s.isWarmup);

  // 1. Validation checks
  let invalidCount = 0;
  const pairSet = new Set<string>();
  let duplicatePairCount = 0;

  for (const s of measuredSamples) {
    if (
      typeof s.renderedLatencyMs !== 'number' ||
      isNaN(s.renderedLatencyMs) ||
      !isFinite(s.renderedLatencyMs) ||
      s.renderedLatencyMs < 0 ||
      typeof s.wsDeliveryLatencyMs !== 'number' ||
      isNaN(s.wsDeliveryLatencyMs) ||
      !isFinite(s.wsDeliveryLatencyMs) ||
      s.wsDeliveryLatencyMs < 0
    ) {
      invalidCount++;
    }

    const pairKey = `${s.opId}::${s.receiverClientId}`;
    if (pairSet.has(pairKey)) {
      duplicatePairCount++;
    } else {
      pairSet.add(pairKey);
    }
  }

  const renderedValues = measuredSamples.map((s) => s.renderedLatencyMs);
  const wsValues = measuredSamples.map((s) => s.wsDeliveryLatencyMs);
  const overheadValues = measuredSamples.map((s) => s.renderPaintOverheadMs);

  const renderedStats = computeStats(renderedValues);
  const wsStats = computeStats(wsValues);
  const overheadStats = computeStats(overheadValues);

  return {
    roundName,
    reportedMetrics: data.metrics,
    validation: {
      totalSamples: rawSamples.length,
      measuredSamplesCount: measuredSamples.length,
      invalidCount,
      duplicatePairCount,
      uniqueRecipientPairs: pairSet.size,
    },
    independentCalculations: {
      renderedLatency: renderedStats,
      wsDeliveryLatency: wsStats,
      renderPaintOverhead: overheadStats,
    },
    discrepancyChecks: {
      p50RenderedMatch: Math.abs(renderedStats.p50_floor - data.metrics.renderedLatency.p50Ms) < 0.01,
      p95RenderedMatch: Math.abs(renderedStats.p95_floor - data.metrics.renderedLatency.p95Ms) < 0.01,
      p99RenderedMatch: Math.abs(renderedStats.p99_floor - data.metrics.renderedLatency.p99Ms) < 0.01,
      p50WsMatch: Math.abs(wsStats.p50_floor - ((data.metrics.transportLatency || data.metrics.wsDeliveryLatency)?.p50Ms ?? 0)) < 0.01,
      p95WsMatch: Math.abs(wsStats.p95_floor - ((data.metrics.transportLatency || data.metrics.wsDeliveryLatency)?.p95Ms ?? 0)) < 0.01,
    },
    samples: measuredSamples,
  };
}

const round1Path = path.resolve('evidence/fresh_performance_audit_20261027/round1/browser-benchmark-20-clients.json');
const round2Path = path.resolve('evidence/fresh_performance_audit_20261027/round2/browser-benchmark-20-clients.json');
const round3Path = path.resolve('evidence/fresh_performance_audit_20261027/round3/browser-benchmark-20-clients.json');

const r1 = analyzeRound(round1Path, 'Round 1');
const r2 = analyzeRound(round2Path, 'Round 2');
const r3 = analyzeRound(round3Path, 'Round 3');

// Combined multi-round analysis
const allRendered = [...r1.samples, ...r2.samples, ...r3.samples].map((s) => s.renderedLatencyMs);
const allWs = [...r1.samples, ...r2.samples, ...r3.samples].map((s) => s.wsDeliveryLatencyMs);
const combinedRenderedStats = computeStats(allRendered);
const combinedWsStats = computeStats(allWs);

const finalReport = {
  timestamp: new Date().toISOString(),
  rounds: [
    { name: r1.roundName, validation: r1.validation, reported: r1.reportedMetrics, recalculated: r1.independentCalculations, discrepancies: r1.discrepancyChecks },
    { name: r2.roundName, validation: r2.validation, reported: r2.reportedMetrics, recalculated: r2.independentCalculations, discrepancies: r2.discrepancyChecks },
    { name: r3.roundName, validation: r3.validation, reported: r3.reportedMetrics, recalculated: r3.independentCalculations, discrepancies: r3.discrepancyChecks },
  ],
  combined: {
    totalValidSamples: allRendered.length,
    renderedLatency: combinedRenderedStats,
    wsDeliveryLatency: combinedWsStats,
  },
};

const outJson = path.resolve('evidence/fresh_performance_audit_20261027/independent_verification_report.json');
fs.writeFileSync(outJson, JSON.stringify(finalReport, null, 2), 'utf-8');
console.log('Successfully generated independent verification report at:', outJson);
console.log(JSON.stringify(finalReport, null, 2));
