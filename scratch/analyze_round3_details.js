import fs from 'fs';

const data = JSON.parse(fs.readFileSync('evidence/fresh_performance_audit_20261027/round3/browser-benchmark-20-clients.json', 'utf-8'));
const samples = data.samples.filter(s => !s.isWarmup);
samples.sort((a, b) => b.renderedLatencyMs - a.renderedLatencyMs);

console.log('Total non-warmup samples in Round 3:', samples.length);
console.log('Top 30 slowest samples in Round 3:');
samples.slice(0, 30).forEach((s, idx) => {
  console.log(
    `#${idx + 1}: rendered=${s.renderedLatencyMs.toFixed(1)}ms | ` +
    `ws=${s.wsDeliveryLatencyMs.toFixed(1)}ms | ` +
    `paint=${s.renderPaintOverheadMs.toFixed(1)}ms | ` +
    `op=${s.opId} (${s.eventType}) | ` +
    `origin=${s.originClientId} -> receiver=${s.receiverClientId} | ` +
    `start=${s.calibratedOriginStartTime.toFixed(1)} | ` +
    `wsRecv=${s.calibratedWsReceiveTime.toFixed(1)} | ` +
    `rendered=${s.calibratedRenderedTime.toFixed(1)}`
  );
});

// Group samples by operation ID
const opGroups = {};
samples.forEach(s => {
  if (!opGroups[s.opId]) {
    opGroups[s.opId] = [];
  }
  opGroups[s.opId].push(s);
});

console.log('\nOperations with samples > 200ms:');
for (const [opId, opSamples] of Object.entries(opGroups)) {
  const slow = opSamples.filter(s => s.renderedLatencyMs > 200);
  if (slow.length > 0) {
    const latencies = opSamples.map(s => s.renderedLatencyMs).sort((a, b) => a - b);
    const wsLatencies = opSamples.map(s => s.wsDeliveryLatencyMs).sort((a, b) => a - b);
    console.log(`Op ${opId} (${slow[0].eventType}, origin: ${slow[0].originClientId}): ${slow.length}/${opSamples.length} receivers > 200ms.`);
    console.log(`   Rendered min=${latencies[0].toFixed(1)}ms, median=${latencies[Math.floor(latencies.length/2)].toFixed(1)}ms, max=${latencies[latencies.length-1].toFixed(1)}ms`);
    console.log(`   WS Delivery min=${wsLatencies[0].toFixed(1)}ms, median=${wsLatencies[Math.floor(wsLatencies.length/2)].toFixed(1)}ms, max=${wsLatencies[wsLatencies.length-1].toFixed(1)}ms`);
    console.log(`   Slow receivers:`, slow.map(s => `${s.receiverClientId} (rendered=${s.renderedLatencyMs.toFixed(1)}ms, ws=${s.wsDeliveryLatencyMs.toFixed(1)}ms)`).join(', '));
  }
}
