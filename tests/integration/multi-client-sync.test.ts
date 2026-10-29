import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import WebSocket from 'ws';
import { CollaborativeWebSocketServer } from '../../src/server/ws-server';
import { AuthoritativeStore } from '../../src/server/store';
import { ClientCommand, ServerEvent } from '../../src/shared/protocol';

describe('Multi-Client Real-Time Synchronization (Integration)', () => {
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
        port = typeof addr === 'object' && addr ? addr.port : 3002;
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
    waitForEvent: (predicate: (e: ServerEvent) => boolean, timeoutMs?: number) => Promise<ServerEvent>;
  }> {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}`);
      const events: ServerEvent[] = [];

      ws.on('message', (raw) => {
        try {
          const parsed = JSON.parse(raw.toString());
          events.push(parsed);
        } catch {
          // Ignore
        }
      });

      ws.on('open', () => {
        const send = (cmd: ClientCommand) => ws.send(JSON.stringify(cmd));
        const waitForEvent = (
          predicate: (e: ServerEvent) => boolean,
          timeoutMs = 5000
        ): Promise<ServerEvent> => {
          return new Promise((res, rej) => {
            const existing = events.find(predicate);
            if (existing) return res(existing);

            const timer = setTimeout(() => {
              ws.off('message', onMsg);
              rej(new Error(`Timed out waiting for event matching predicate after ${timeoutMs}ms`));
            }, timeoutMs);

            const onMsg = () => {
              const matched = events.find(predicate);
              if (matched) {
                clearTimeout(timer);
                ws.off('message', onMsg);
                res(matched);
              }
            };
            ws.on('message', onMsg);
          });
        };

        // Subscribe to workspace
        send({
          type: 'workspace.subscribe',
          workspaceId: wsId,
          user: { id: `u-${name}`, name, color: '#ff0000' },
        });

        resolve({ ws, events, send, waitForEvent });
      });
    });
  }

  it('synchronizes task creation in real time to other connected clients', async () => {
    const wsId = 'ws-multi-sync-1';
    const clientA = await createClient('Alice', wsId);
    const clientB = await createClient('Bob', wsId);

    // Wait for both to receive initial snapshots
    await clientA.waitForEvent((e) => e.type === 'workspace.snapshot');
    await clientB.waitForEvent((e) => e.type === 'workspace.snapshot');

    // Alice creates a task
    clientA.send({
      type: 'task.create',
      opId: 'op-sync-task-1',
      workspaceId: wsId,
      task: {
        id: 'task-sync-1',
        title: 'Real-time synchronized task',
        description: 'Observed by Bob without refresh',
        status: 'todo',
        priority: 'high',
        createdBy: 'u-Alice',
      },
    });

    // Alice gets operation.ack
    const ack = await clientA.waitForEvent(
      (e) => e.type === 'operation.ack' && e.opId === 'op-sync-task-1'
    );
    expect(ack.type).toBe('operation.ack');

    // Bob receives workspace.event with task.created
    const eventForBob = await clientB.waitForEvent(
      (e) => e.type === 'workspace.event' && e.event.type === 'task.created' && e.event.entity.id === 'task-sync-1'
    );
    expect(eventForBob.type).toBe('workspace.event');
    if (eventForBob.type === 'workspace.event') {
      expect(eventForBob.event.entity.id).toBe('task-sync-1');
      expect((eventForBob.event.entity as { title: string }).title).toBe('Real-time synchronized task');
    }

    clientA.ws.close();
    clientB.ws.close();
  });

  it('synchronizes task status updates in real time', async () => {
    const wsId = 'ws-multi-sync-2';
    const clientA = await createClient('Alice', wsId);
    const clientB = await createClient('Bob', wsId);

    await clientA.waitForEvent((e) => e.type === 'workspace.snapshot');
    await clientB.waitForEvent((e) => e.type === 'workspace.snapshot');

    // Create initial task
    clientA.send({
      type: 'task.create',
      opId: 'op-sync-task-2',
      workspaceId: wsId,
      task: {
        id: 'task-sync-2',
        title: 'Task for status update',
        description: '',
        status: 'todo',
        priority: 'medium',
        createdBy: 'u-Alice',
      },
    });
    await clientA.waitForEvent((e) => e.type === 'operation.ack' && e.opId === 'op-sync-task-2');

    // Bob updates task status to 'done'
    clientB.send({
      type: 'task.update',
      opId: 'op-sync-update-2',
      workspaceId: wsId,
      taskId: 'task-sync-2',
      changes: { status: 'done' },
      expectedVersion: 1,
    });

    // Alice observes the update in real time
    const eventForAlice = await clientA.waitForEvent(
      (e) =>
        e.type === 'workspace.event' &&
        e.event.type === 'task.updated' &&
        e.event.entity.id === 'task-sync-2' &&
        (e.event.entity as { status: string }).status === 'done'
    );
    expect(eventForAlice.type).toBe('workspace.event');

    clientA.ws.close();
    clientB.ws.close();
  });

  it('synchronizes comments across clients without refreshing', async () => {
    const wsId = 'ws-multi-sync-3';
    const clientA = await createClient('Alice', wsId);
    const clientB = await createClient('Bob', wsId);

    await clientA.waitForEvent((e) => e.type === 'workspace.snapshot');
    await clientB.waitForEvent((e) => e.type === 'workspace.snapshot');

    // Create task
    clientA.send({
      type: 'task.create',
      opId: 'op-c-task',
      workspaceId: wsId,
      task: {
        id: 'task-for-comments',
        title: 'Discussion Task',
        description: '',
        status: 'todo',
        priority: 'medium',
        createdBy: 'u-Alice',
      },
    });
    await clientA.waitForEvent((e) => e.type === 'operation.ack' && e.opId === 'op-c-task');

    // Bob posts comment
    clientB.send({
      type: 'comment.create',
      opId: 'op-comment-sync-1',
      workspaceId: wsId,
      comment: {
        id: 'c-sync-1',
        taskId: 'task-for-comments',
        content: 'Reviewing code now',
        authorId: 'u-Bob',
        authorName: 'Bob',
      },
    });

    // Alice receives comment event in real time
    const commentEvt = await clientA.waitForEvent(
      (e) =>
        e.type === 'workspace.event' &&
        e.event.type === 'comment.created' &&
        e.event.entity.id === 'c-sync-1'
    );
    expect(commentEvt.type).toBe('workspace.event');

    clientA.ws.close();
    clientB.ws.close();
  });
});
