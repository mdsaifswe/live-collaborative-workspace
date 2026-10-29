import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import WebSocket from 'ws';
import { CollaborativeWebSocketServer } from '../../src/server/ws-server';
import { AuthoritativeStore } from '../../src/server/store';
import { ClientCommand, ServerEvent } from '../../src/shared/protocol';

describe('Workspace Isolation Security (Integration)', () => {
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

  function createClient(name: string, wsId: string): Promise<{
    ws: WebSocket;
    events: ServerEvent[];
    send: (cmd: ClientCommand) => void;
  }> {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}`);
      const events: ServerEvent[] = [];

      ws.on('message', (raw) => {
        try {
          events.push(JSON.parse(raw.toString()));
        } catch {
          // Ignore
        }
      });

      ws.on('open', () => {
        const send = (cmd: ClientCommand) => ws.send(JSON.stringify(cmd));
        send({
          type: 'workspace.subscribe',
          workspaceId: wsId,
          user: { id: `u-${name}`, name, color: '#00ff00' },
        });
        resolve({ ws, events, send });
      });
    });
  }

  it('prevents workspace A events from leaking to workspace B', async () => {
    const clientA = await createClient('Alice', 'workspace-A');
    const clientB = await createClient('Bob', 'workspace-B');

    // Wait a brief moment for both to subscribe
    await new Promise((r) => setTimeout(r, 100));

    // Client A creates a confidential task in workspace A
    clientA.send({
      type: 'task.create',
      opId: 'op-isolated-1',
      workspaceId: 'workspace-A',
      task: {
        id: 'task-confidential',
        title: 'Confidential Workspace A Strategy',
        description: 'Should never leak to Workspace B',
        status: 'todo',
        priority: 'urgent',
        createdBy: 'u-Alice',
      },
    });

    // Wait 200ms
    await new Promise((r) => setTimeout(r, 200));

    // Verify client B in workspace B received NO events about task-confidential
    const leakedEvent = clientB.events.find(
      (e) =>
        e.type === 'workspace.event' &&
        e.event.entity.id === 'task-confidential'
    );
    expect(leakedEvent).toBeUndefined();

    // Verify client A DID receive its ack and event
    const ackA = clientA.events.find(
      (e) => e.type === 'operation.ack' && e.opId === 'op-isolated-1'
    );
    expect(ackA).toBeDefined();

    clientA.ws.close();
    clientB.ws.close();
  });
});
