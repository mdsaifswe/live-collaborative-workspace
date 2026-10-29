# Real Browser Performance Benchmark Report (20 Concurrent Browsers)

## 1. Workload & Test Harness Specification
- **Concurrent Clients**: 20 independent Chromium browser contexts & pages
- **Timing Methodology**: Monotonic clock calibrated across all 20 browser contexts relative to controller clock with quantifiable uncertainty ($\pm 1.00$ ms)
- **Rendered Latency Definition**: From origin client submission timestamp to receiving client observable rendered DOM state (confirmed via double `requestAnimationFrame` and element selector inspection)
- **Separated Transport Latency**: Monotonic duration until receiving client WebSocket message handler parses frame
- **Workload**: 50% task creation, 25% status/description update, 25% comment creation
- **Sample Requirement**: At least 1,000 valid cross-client non-warmup samples
- **Environment**: win32 (x64) / Node.js v24.19.0 / Chromium Playwright
- **Timestamp**: 2026-10-27T09:40:18.130Z

## 2. Benchmark Measurement Results

| Metric Category | Metric | Measured Value | Requirement / Target | Status |
|---|---|---|---|---|
| **Rendered Latency** | **p95 Rendered Update Latency** | **66.30 ms** | **< 200.00 ms** | **PASS** |
| Rendered Latency | p50 Rendered Latency (Median) | 17.40 ms | — | Recorded |
| Rendered Latency | p99 Rendered Latency | 91.40 ms | — | Recorded |
| Rendered Latency | Min Rendered Latency | 2.60 ms | — | Recorded |
| Rendered Latency | Max Rendered Latency | 146.20 ms | — | Recorded |
| Rendered Latency | Average Rendered Latency | 25.65 ms | — | Recorded |
| **Transport Latency** | p50 WebSocket Delivery Latency | 15.10 ms | Separate Metric | Recorded |
| Transport Latency | p95 WebSocket Delivery Latency | 63.60 ms | Separate Metric | Recorded |
| Transport Latency | p99 WebSocket Delivery Latency | 88.80 ms | Separate Metric | Recorded |
| Transport Latency | Average WebSocket Delivery | 23.23 ms | Separate Metric | Recorded |
| **Render Overhead** | Average React Render & Paint | 2.42 ms | — | Recorded |
| **Sample Count** | Measured Cross-Client Samples | **1064** | $\ge 1,000$ | **PASS** |
| **Reliability** | Missing Expected Deliveries | **0** | 0 | **PASS** |
| Reliability | Duplicate Deliveries | **0** | 0 | **PASS** |
| Reliability | Rejected Operations | **0** | 0 | **PASS** |
| Reliability | Failed Frame Handlers | **0** | 0 | **PASS** |
| **Correctness** | Content-Level State Divergences | **0** | 0 | **PASS** |

## 3. Deep Content-Level Convergence Audit
- **Authoritative Server Revision**: `66`
- **Authoritative Task Count**: `22`
- **Authoritative Comment Count**: `22`
- All 20 independently connected browser pages were audited:
  - 100% matched normalized task IDs, titles, descriptions, statuses, priorities, and version revisions.
  - 100% matched normalized comment IDs, contents, and authors.
  - Zero orphan tasks or comments detected.

## 4. Baseline vs Browser-Rendered Latency Comparison

| Benchmark Type | Test Setup | Sample Count | p50 Latency | p95 Latency | p99 Latency | Max Latency |
|---|---|---|---|---|---|---|
| Historical Baseline | Node.js WebSocket transport | 1,900 | 1.27 ms | 3.84 ms | 8.71 ms | 9.20 ms |
| **Real Browser Benchmark** | **20 Headless Chromium Browsers (DOM Rendered)** | **1064** | **17.40 ms** | **66.30 ms** | **91.40 ms** | **146.20 ms** |

