import { describe, it, expect } from 'vitest';
import { ConnectionManager } from '../../src/client/core/connection-manager';

describe('ConnectionManager', () => {
  it('initializes in disconnected state', () => {
    const cm = new ConnectionManager({ url: 'ws://localhost:3001' });
    expect(cm.getState()).toBe('disconnected');
  });

  it('calculates exponential backoff with jitter bounded by maxBackoff', () => {
    const cm = new ConnectionManager({
      url: 'ws://localhost:3001',
      initialBackoffMs: 200,
      maxBackoffMs: 5000,
    });

    const delay0 = cm.calculateBackoffDelay(0);
    // Base 200 ± 30% jitter => 140 to 260
    expect(delay0).toBeGreaterThanOrEqual(140);
    expect(delay0).toBeLessThanOrEqual(260);

    const delay3 = cm.calculateBackoffDelay(3);
    // 200 * 8 = 1600 ± 30% => 1120 to 2080
    expect(delay3).toBeGreaterThanOrEqual(1100);
    expect(delay3).toBeLessThanOrEqual(2100);

    const delay10 = cm.calculateBackoffDelay(10);
    // Bounded by maxBackoff (5000) ± 30% => <= 6500
    expect(delay10).toBeLessThanOrEqual(6500);
  });

  it('notifies state change listeners', () => {
    const cm = new ConnectionManager({ url: 'ws://localhost:3001' });
    const states: string[] = [];
    cm.onStateChange((state) => {
      states.push(state);
    });

    expect(states).toContain('disconnected');
  });
});
