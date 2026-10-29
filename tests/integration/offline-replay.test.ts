import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import WebSocket from 'ws';
import { CollaborativeWebSocketServer } from '../../src/server/ws-server';
import { AuthoritativeStore } from '../../src/server/store';
import { ClientCommand, ServerEvent } from '../../src/shared/protocol';

describe('Offline Reconnection & Safe Operation Replay (Integration)', () => {
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
        port = typeof addr === 'object' && addr ? addr.port : 3004;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await wsServer.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('reconnects with lastRevision, receives missed events and safely replays queued operations', async () => {
    const wsId = 'ws-offline-replay';

    // 1. Initial connection
    let clientSocket = new WebSocket(`ws://localhost:${port}`);
    const clientEvents: ServerEvent[] = [];
    clientSocket.on('message', (m) => clientEvents.push(JSON.parse(m.toString())));

    await new Promise((r) => clientSocket.on('open', r));

    clientSocket.send(
      JSON.stringify({
        type: 'workspace.subscribe',
        workspaceId: wsId,
        user: { id: 'u-charlie', name: 'Charlie', color: '#8b5cf6' },
      } as ClientCommand)
    );

    await new Promise((r) => setTimeout(r, 100));
    const snap = clientEvents.find((e) => e.type === 'workspace.snapshot');
    expect(snap).toBeDefined();
    const lastRev = (snap as { revision: number }).revision;

    // 2. Client loses connection (simulated network failure)
    clientSocket.terminate();

    // 3. While client was disconnected, another user created a task on server
    const store = wsServer.getStore();
    store.createTask(
      'op-while-disconnected',
      wsId,
      {
        id: 'task-missed-1',
        title: 'Task Created While Charlie Was Offline',
        description: 'Server moved forward in sequence',
        status: 'todo',
        priority: 'high',
        createdBy: 'u-dave',
      },
      'u-dave'
    );

    // 4. Client locally queued a pending task while offline
    const queuedOp: ClientCommand = {
      type: 'task.create',
      opId: 'op-charlie-offline-create',
      workspaceId: wsId,
      task: {
        id: 'task-charlie-offline',
        title: 'Charlie Offline Task',
        description: 'Queued locally in IDB',
        status: 'in_progress',
        priority: 'medium',
        createdBy: 'u-charlie',
      },
    };

    // 5. Client reconnects, sends workspace.subscribe with lastRevision
    const reconnectedEvents: ServerEvent[] = [];
    clientSocket = new WebSocket(`ws://localhost:${port}`);
    clientSocket.on('message', (m) => reconnectedEvents.push(JSON.parse(m.toString())));
    await new Promise((r) => clientSocket.on('open', r));

    clientSocket.send(
      JSON.stringify({
        type: 'workspace.subscribe',
        workspaceId: wsId,
        user: { id: 'u-charlie', name: 'Charlie', color: '#8b5cf6' },
        lastRevision: lastRev,
      } as ClientCommand)
    );

    // Wait for sync.complete or missed events
    await new Promise((r) => setTimeout(r, 150));

    // Client verifies it received sync.complete with missed event
    const syncComplete = reconnectedEvents.find((e) => e.type === 'sync.complete');
    expect(syncComplete).toBeDefined();
    if (syncComplete && syncComplete.type === 'sync.complete') {
      expect(syncComplete.missedEvents.length).toBeGreaterThan(0);
      expect(syncComplete.missedEvents[0].entity.id).toBe('task-missed-1');
    }

    // 6. Client replays the queued operation
    clientSocket.send(JSON.stringify(queuedOp));

    await new Promise((r) => setTimeout(r, 150));

    // Charlie receives operation.ack for the queued op
    const ack = reconnectedEvents.find(
      (e) => e.type === 'operation.ack' && e.opId === 'op-charlie-offline-create'
    );
    expect(ack).toBeDefined();

    // 7. Replay test idempotency: sending the same op again returns cached ack and does not duplicate
    clientSocket.send(JSON.stringify(queuedOp));
    await new Promise((r) => setTimeout(r, 150));

    const finalSnapshot = store.getSnapshot(wsId);
    const matchingTasks = finalSnapshot.tasks.filter((t) => t.id === 'task-charlie-offline');
    expect(matchingTasks.length).toBe(1); // No duplicates!

    clientSocket.close();
  });
});
