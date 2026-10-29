import fs from 'fs';

function inspectOutliers(file, label) {
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const samples = data.samples.filter(s => !s.isWarmup);
  samples.sort((a, b) => b.renderedLatencyMs - a.renderedLatencyMs);
  console.log(`\n=================== ${label} ===================`);
  console.log(`Total non-warmup samples: ${samples.length}`);
  console.log(`Top 25 slowest samples:`);
  samples.slice(0, 25).forEach((s, idx) => {
    console.log(
      `#${idx + 1}: rendered=${s.renderedLatencyMs.toFixed(1)}ms ` +
      `ws=${s.wsDeliveryLatencyMs.toFixed(1)}ms ` +
      `paint=${s.renderPaintOverheadMs.toFixed(1)}ms ` +
      `op=${s.opId} ` +
      `type=${s.eventType} ` +
      `origin=${s.originClientId} ` +
      `receiver=${s.receiverClientId} ` +
      `originStart=${s.calibratedOriginStartTime.toFixed(1)} ` +
      `wsRecv=${s.calibratedWsReceiveTime.toFixed(1)} ` +
      `rendered=${s.calibratedRenderedTime.toFixed(1)}`
    );
  });

  // Check clustering by receiverClientId
  const byReceiver = {};
  const byOrigin = {};
  const byOp = {};
  samples.slice(0, 25).forEach(s => {
    byReceiver[s.receiverClientId] = (byReceiver[s.receiverClientId] || 0) + 1;
    byOrigin[s.originClientId] = (byOrigin[s.originClientId] || 0) + 1;
    byOp[s.opId] = (byOp[s.opId] || 0) + 1;
  });
  console.log('Slowest 25 clustered by Receiver:', JSON.stringify(byReceiver));
  console.log('Slowest 25 clustered by Origin:', JSON.stringify(byOrigin));
  console.log('Slowest 25 clustered by OpId:', JSON.stringify(byOp));
}

inspectOutliers('evidence/fresh_performance_audit_20261027/round3/browser-benchmark-20-clients.json', 'ROUND 3');
inspectOutliers('evidence/fresh_performance_audit_20261027/round1/browser-benchmark-20-clients.json', 'ROUND 1');
inspectOutliers('evidence/fresh_performance_audit_20261027/round2/browser-benchmark-20-clients.json', 'ROUND 2');
