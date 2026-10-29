# Performance Benchmark Report: 20 Concurrent Clients

## Workload Specification
- **Concurrent Clients**: 20 independent WebSocket sessions
- **Total Operations**: 120 (including 20 warm-up operations)
- **Workload Mix**: 50% task creation, 25% status/field update, 25% comment creation
- **Mutation Interval**: 25 ms (~26.0 operations/sec)
- **Environment**: win32 (x64) / Node.js v24.19.0
- **Timestamp**: 2026-10-29T00:28:37.051Z

## Benchmark Results

| Metric | Measured Value | Requirement / Target | Status |
|---|---|---|---|
| **p95 Cross-Client Latency** | **4.54 ms** | **< 200.00 ms** | **PASS** |
| p50 Latency (Median) | 2.19 ms | — | Recorded |
| p99 Latency | 5.04 ms | — | Recorded |
| Min Latency | 0.88 ms | — | Recorded |
| Max Latency | 5.23 ms | — | Recorded |
| Average Latency | 2.39 ms | — | Recorded |
| Total Cross-Client Samples | 1900 | > 1,000 | PASS |
| Failed / Rejected Operations | 0 | 0 | PASS |
| State Convergence Divergences | 0 | 0 | PASS |
| Authoritative Revisions | 120 | Matching across all 20 peers | PASS |

## State Convergence Audit
- Authoritative Task Count: `40`
- Authoritative Comment Count: `40`
- All 20 connected client in-memory stores converged with 0 missing updates and 0 duplicate entities.

