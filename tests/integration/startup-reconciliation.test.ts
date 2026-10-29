import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import 'fake-indexeddb/auto';
import WebSocket from 'ws';
(globalThis as any).WebSocket = WebSocket;
if (typeof navigator !== 'undefined') {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
}
import { CollaborativeWebSocketServer } from '../../src/server/ws-server';
import { AuthoritativeStore } from '../../src/server/store';
import { SyncOrchestrator } from '../../src/client/core/sync-orchestrator';
import { ConnectionManager } from '../../src/client/core/connection-manager';
import { IndexedDBRepository } from '../../src/client/core/idb-repository';
import { User } from '../../src/shared/types';

describe('Startup & Multi-Origin Workspace Reconciliation (Integration)', () => {
  let server: http.Server;
  let wsServer: CollaborativeWebSocketServer;
  let port: number;

  beforeAll(async () => {
    const app = express();
    server = http.createServer(app);
    wsServer = new CollaborativeWebSocketServer(server, new AuthoritativeStore());
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : 3003;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await wsServer.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('1. fresh browser initializes with full authoritative snapshot without manual purge', async () => {
    const idb = new IndexedDBRepository();
    await idb.clearAll();

    const user: User = { id: 'u-fresh', name: 'Fresh User', color: '#10b981' };
    const cm = new ConnectionManager({ url: `ws://127.0.0.1:${port}` });
    const orchestrator = new SyncOrchestrator(cm, idb, user, 'default-workspace');

    await orchestrator.initialize();

    // Wait for snapshot delivery
    await new Promise<void>((resolve) => {
      const unsub = orchestrator.subscribe((state) => {
        if (state.workspace?.name === 'Engineering Sprint Workspace') {
          unsub();
          resolve();
        }
      });
      setTimeout(resolve, 1500);
    });

    const finalState = orchestrator.getState();
    expect(finalState.workspace?.name).toBe('Engineering Sprint Workspace');
    expect(finalState.tasks.length).toBe(0);

    orchestrator.destroy();
    cm.disconnect();
  });

  it('2. two independent origins (e.g. localhost vs LAN IP) both converge to the same authoritative state', async () => {
    // Client A (Origin 1 / localhost)
    const idbA = new IndexedDBRepository();
    const userA: User = { id: 'u-origin-a', name: 'Origin A', color: '#6366f1' };
    const cmA = new ConnectionManager({ url: `ws://127.0.0.1:${port}` });
    const orchA = new SyncOrchestrator(cmA, idbA, userA, 'default-workspace');
    await orchA.initialize();

    // Client B (Origin 2 / LAN IP simulating separate empty storage)
    const idbB = new IndexedDBRepository();
    const userB: User = { id: 'u-origin-b', name: 'Origin B', color: '#ec4899' };
    const cmB = new ConnectionManager({ url: `ws://127.0.0.1:${port}` });
    const orchB = new SyncOrchestrator(cmB, idbB, userB, 'default-workspace');
    await orchB.initialize();

    // Wait for both to receive full snapshot
    await new Promise((r) => setTimeout(r, 200));

    expect(orchA.getState().workspace?.name).toBe('Engineering Sprint Workspace');
    expect(orchB.getState().workspace?.name).toBe('Engineering Sprint Workspace');
    expect(orchA.getState().tasks.length).toBe(0);
    expect(orchB.getState().tasks.length).toBe(0);

    // Client A creates a new task
    await orchA.createTask({
      id: 'task-cross-origin-1',
      title: 'Cross Origin Synchronized Task',
      description: 'Shared across both hostnames',
      status: 'todo',
      priority: 'high',
      createdBy: userA.id,
    });

    // Wait for real-time propagation to Client B
    await new Promise<void>((resolve) => {
      const unsub = orchB.subscribe((state) => {
        if (state.tasks.some((t) => t.id === 'task-cross-origin-1')) {
          unsub();
          resolve();
        }
      });
      setTimeout(resolve, 1500);
    });

    expect(orchB.getState().tasks.some((t) => t.id === 'task-cross-origin-1')).toBe(true);

    orchA.destroy();
    cmA.disconnect();
    orchB.destroy();
    cmB.disconnect();
  });

  it('3. purging local IndexedDB and cache restores authoritative state without reverting to "Workspace"', async () => {
    const idb = new IndexedDBRepository();
    const user: User = { id: 'u-purge-tester', name: 'Purge Tester', color: '#f59e0b' };
    const cm = new ConnectionManager({ url: `ws://127.0.0.1:${port}` });
    const orchestrator = new SyncOrchestrator(cm, idb, user, 'default-workspace');
    await orchestrator.initialize();

    await new Promise((r) => setTimeout(r, 200));
    expect(orchestrator.getState().workspace?.name).toBe('Engineering Sprint Workspace');

    // Simulate clicking "Purge Local IndexedDB & Cache"
    await orchestrator.clearLocalData();

    // Wait for re-requested snapshot
    await new Promise<void>((resolve) => {
      const unsub = orchestrator.subscribe((state) => {
        if (state.workspace?.name === 'Engineering Sprint Workspace') {
          unsub();
          resolve();
        }
      });
      setTimeout(resolve, 1500);
    });

    const stateAfterPurge = orchestrator.getState();
    expect(stateAfterPurge.workspace?.name).toBe('Engineering Sprint Workspace');
    expect(stateAfterPurge.tasks.length).toBe(1); // includes task-cross-origin-1 from test 2

    orchestrator.destroy();
    cm.disconnect();
  });

  it('4. offline pending changes are preserved and replayed safely upon reconnection', async () => {
    const idb = new IndexedDBRepository();
    const user: User = { id: 'u-offline-preservation', name: 'Offline User', color: '#3b82f6' };
    const cm = new ConnectionManager({ url: `ws://127.0.0.1:${port}` });
    const orchestrator = new SyncOrchestrator(cm, idb, user, 'default-workspace');
    await orchestrator.initialize();
    await new Promise((r) => setTimeout(r, 200));

    // Disconnect connection manager (simulating drop)
    cm.disconnect();

    // Create task offline
    const offlineTaskId = `task-offline-${Date.now()}`;
    await orchestrator.createTask({
      id: offlineTaskId,
      title: 'Preserved Offline Mutation',
      description: 'Must not be lost during reconnection',
      status: 'in_progress',
      priority: 'urgent',
      createdBy: user.id,
    });

    expect(orchestrator.getState().pendingOps.length).toBe(1);

    // Reconnect
    cm.connect();

    // Verify pending op was acknowledged and cleared, while task persisted
    await new Promise<void>((resolve) => {
      const unsub = orchestrator.subscribe((state) => {
        if (state.pendingOps.length === 0 && state.tasks.some((t) => t.id === offlineTaskId)) {
          unsub();
          resolve();
        }
      });
      setTimeout(resolve, 2000);
    });

    const finalState = orchestrator.getState();
    expect(finalState.pendingOps.length).toBe(0);
    const savedTask = finalState.tasks.find((t) => t.id === offlineTaskId);
    expect(savedTask).toBeDefined();
    expect(savedTask?.title).toBe('Preserved Offline Mutation');

    orchestrator.destroy();
    cm.disconnect();
  });

  it('5. optionally seeds starter tasks when seedStarterTasks option is true', () => {
    const seededStore = new AuthoritativeStore({ seedStarterTasks: true });
    const snapshot = seededStore.getSnapshot('default-workspace');
    expect(snapshot.tasks.length).toBe(3);
    expect(snapshot.tasks.map((t) => t.id)).toEqual(
      expect.arrayContaining(['task-starter-1', 'task-starter-2', 'task-starter-3'])
    );
  });
});

