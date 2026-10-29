import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { AuthoritativeStore } from './store';
import {
  validateClientCommand,
  ClientCommand,
  ServerEvent,
} from '../shared/protocol';
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  MAX_PAYLOAD_BYTES,
} from '../shared/constants';
import { User, Presence } from '../shared/types';

export interface ClientSession {
  socket: WebSocket;
  id: string;
  user?: User;
  workspaceId?: string;
  isAlive: boolean;
  subscribedAt?: number;
  lastActivityTime?: number;
}

export class CollaborativeWebSocketServer {
  private wss: WebSocketServer;
  private store: AuthoritativeStore;
  private clients: Map<WebSocket, ClientSession> = new Map();
  private workspaceSubscriptions: Map<string, Set<WebSocket>> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(server: http.Server, store?: AuthoritativeStore) {
    this.store = store || new AuthoritativeStore();
    this.wss = new WebSocketServer({
      server,
      maxPayload: MAX_PAYLOAD_BYTES,
    });

    this.setupListeners();
    this.startHeartbeat();
  }

  public getStore(): AuthoritativeStore {
    return this.store;
  }

  public broadcastSnapshot(workspaceId: string) {
    const snapshot = this.store.getSnapshot(workspaceId);
    const presences = this.store.getActivePresences(workspaceId);
    this.broadcastToWorkspace(workspaceId, {
      type: 'workspace.snapshot',
      workspace: snapshot.workspace,
      tasks: snapshot.tasks,
      comments: snapshot.comments,
      revision: snapshot.revision,
      activePresences: presences,
    });
  }

  private setupListeners() {
    this.wss.on('connection', (ws: WebSocket, req) => {
      if (req && req.socket && typeof req.socket.setNoDelay === 'function') {
        req.socket.setNoDelay(true);
      }
      const rawSocket = (ws as unknown as { _socket?: { setNoDelay?: (noDelay?: boolean) => void } })._socket;
      if (rawSocket && typeof rawSocket.setNoDelay === 'function') {
        rawSocket.setNoDelay(true);
      }

      const sessionId = `client-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const session: ClientSession = {
        socket: ws,
        id: sessionId,
        isAlive: true,
        lastActivityTime: Date.now(),
      };
      this.clients.set(ws, session);

      ws.on('pong', () => {
        session.isAlive = true;
        session.lastActivityTime = Date.now();
      });

      ws.on('message', (raw: Buffer | string) => {
        session.isAlive = true;
        session.lastActivityTime = Date.now();
        this.handleMessage(ws, raw.toString());
      });

      ws.on('close', () => {
        this.handleDisconnect(ws);
      });

      ws.on('error', (err) => {
        console.error(`WebSocket client error [${sessionId}]:`, err.message);
        this.handleDisconnect(ws);
      });
    });
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      this.clients.forEach((session, ws) => {
        if (!session.isAlive) {
          console.warn(`Terminating dead socket [${session.id}]`);
          ws.terminate();
          this.handleDisconnect(ws);
          return;
        }
        // Active connections need no redundant ping frames
        if (session.lastActivityTime && now - session.lastActivityTime < DEFAULT_HEARTBEAT_INTERVAL_MS) {
          session.isAlive = true;
          return;
        }
        session.isAlive = false;
        try {
          ws.ping();
        } catch {
          ws.terminate();
        }
      });
    }, DEFAULT_HEARTBEAT_INTERVAL_MS);
  }

  private send(ws: WebSocket, event: ServerEvent) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  private broadcastToWorkspace(workspaceId: string, event: ServerEvent, excludeSocket?: WebSocket) {
    const subscribers = this.workspaceSubscriptions.get(workspaceId);
    if (!subscribers) return;

    const payload = JSON.stringify(event);
    subscribers.forEach((clientSocket) => {
      if (clientSocket !== excludeSocket && clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(payload);
      }
    });
  }

  private handleDisconnect(ws: WebSocket) {
    const session = this.clients.get(ws);
    if (!session) return;

    if (session.workspaceId && session.user) {
      const wsSubs = this.workspaceSubscriptions.get(session.workspaceId);
      if (wsSubs) {
        wsSubs.delete(ws);
        if (wsSubs.size === 0) {
          this.workspaceSubscriptions.delete(session.workspaceId);
        }
      }

      this.store.removePresence(session.workspaceId, session.user.id);
      const activePresences = this.store.getActivePresences(session.workspaceId);
      this.broadcastToWorkspace(session.workspaceId, {
        type: 'presence.sync',
        workspaceId: session.workspaceId,
        presences: activePresences,
      });
    }

    this.clients.delete(ws);
  }

  private handleMessage(ws: WebSocket, raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.send(ws, {
        type: 'error',
        code: 'INVALID_JSON',
        message: 'Message could not be parsed as valid JSON',
      });
      return;
    }

    const { valid, error, command } = validateClientCommand(parsed);
    if (!valid || !command) {
      this.send(ws, {
        type: 'error',
        code: 'VALIDATION_ERROR',
        message: error || 'Command validation failed',
      });
      return;
    }

    const session = this.clients.get(ws);
    if (!session) return;

    this.processCommand(ws, session, command);
  }

  private processCommand(ws: WebSocket, session: ClientSession, command: ClientCommand) {
    switch (command.type) {
      case 'workspace.subscribe': {
        const { workspaceId, user, lastRevision } = command;
        session.user = user;
        session.workspaceId = workspaceId;
        session.subscribedAt = Date.now();

        let subs = this.workspaceSubscriptions.get(workspaceId);
        if (!subs) {
          subs = new Set();
          this.workspaceSubscriptions.set(workspaceId, subs);
        }
        subs.add(ws);

        // Update presence
        const presence: Presence = {
          userId: user.id,
          userName: user.name,
          userColor: user.color,
          lastSeen: Date.now(),
        };
        this.store.updatePresence(workspaceId, presence);

        // If client already had a revision and requested catch-up
        if (lastRevision !== undefined && lastRevision >= 0) {
          const missedEvents = this.store.getMissedEvents(workspaceId, lastRevision);
          const currentRev = this.store.getCurrentRevision(workspaceId);
          // If missed events are available in window, or client is already up to date on mutated state
          if (missedEvents.length > 0 || (lastRevision === currentRev && currentRev > 0)) {
            this.send(ws, {
              type: 'sync.complete',
              workspaceId,
              revision: currentRev,
              missedEvents,
            });
            // Also broadcast presence update
            this.broadcastToWorkspace(workspaceId, {
              type: 'presence.sync',
              workspaceId,
              presences: this.store.getActivePresences(workspaceId),
            });
            return;
          }
        }

        // Full snapshot
        const snapshot = this.store.getSnapshot(workspaceId);
        const presences = this.store.getActivePresences(workspaceId);
        this.send(ws, {
          type: 'workspace.snapshot',
          workspace: snapshot.workspace,
          tasks: snapshot.tasks,
          comments: snapshot.comments,
          revision: snapshot.revision,
          activePresences: presences,
        });

        // Broadcast presence to peers
        this.broadcastToWorkspace(
          workspaceId,
          {
            type: 'presence.sync',
            workspaceId,
            presences,
          },
          ws
        );
        break;
      }

      case 'workspace.unsubscribe': {
        this.handleDisconnect(ws);
        break;
      }

      case 'task.create': {
        const actorId = session.user?.id || 'anonymous';
        const result = this.store.createTask(command.opId, command.workspaceId, command.task, actorId);
        if (result.success) {
          this.send(ws, {
            type: 'operation.ack',
            opId: command.opId,
            entityId: result.ack.entityId,
            entityType: 'task',
            version: result.ack.version,
            revision: result.ack.revision,
            serverTimestamp: result.ack.serverTimestamp,
          });
          this.broadcastToWorkspace(
            command.workspaceId,
            {
              type: 'workspace.event',
              event: result.event,
            },
            ws
          );
        } else {
          this.send(ws, {
            type: 'operation.reject',
            opId: command.opId,
            entityId: command.task.id,
            entityType: 'task',
            code: result.code,
            reason: result.reason,
            revision: this.store.getCurrentRevision(command.workspaceId),
          });
        }
        break;
      }

      case 'task.update': {
        const actorId = session.user?.id || 'anonymous';
        const result = this.store.updateTask(
          command.opId,
          command.workspaceId,
          command.taskId,
          command.changes,
          command.expectedVersion,
          actorId
        );
        if (result.success) {
          this.send(ws, {
            type: 'operation.ack',
            opId: command.opId,
            entityId: result.ack.entityId,
            entityType: 'task',
            version: result.ack.version,
            revision: result.ack.revision,
            serverTimestamp: result.ack.serverTimestamp,
          });
          this.broadcastToWorkspace(
            command.workspaceId,
            {
              type: 'workspace.event',
              event: result.event,
            },
            ws
          );
        } else {
          this.send(ws, {
            type: 'operation.reject',
            opId: command.opId,
            entityId: command.taskId,
            entityType: 'task',
            code: result.code,
            reason: result.reason,
            currentServerEntity: result.currentServerEntity,
            revision: this.store.getCurrentRevision(command.workspaceId),
          });
        }
        break;
      }

      case 'task.delete': {
        const actorId = session.user?.id || 'anonymous';
        const result = this.store.deleteTask(
          command.opId,
          command.workspaceId,
          command.taskId,
          command.expectedVersion,
          actorId
        );
        if (result.success) {
          this.send(ws, {
            type: 'operation.ack',
            opId: command.opId,
            entityId: result.ack.entityId,
            entityType: 'task',
            version: result.ack.version,
            revision: result.ack.revision,
            serverTimestamp: result.ack.serverTimestamp,
          });
          this.broadcastToWorkspace(
            command.workspaceId,
            {
              type: 'workspace.event',
              event: result.event,
            },
            ws
          );
        } else {
          this.send(ws, {
            type: 'operation.reject',
            opId: command.opId,
            entityId: command.taskId,
            entityType: 'task',
            code: result.code,
            reason: result.reason,
            currentServerEntity: result.currentServerEntity,
            revision: this.store.getCurrentRevision(command.workspaceId),
          });
        }
        break;
      }

      case 'comment.create': {
        const actorId = session.user?.id || 'anonymous';
        const result = this.store.createComment(command.opId, command.workspaceId, command.comment, actorId);
        if (result.success) {
          this.send(ws, {
            type: 'operation.ack',
            opId: command.opId,
            entityId: result.ack.entityId,
            entityType: 'comment',
            version: result.ack.version,
            revision: result.ack.revision,
            serverTimestamp: result.ack.serverTimestamp,
          });
          this.broadcastToWorkspace(
            command.workspaceId,
            {
              type: 'workspace.event',
              event: result.event,
            },
            ws
          );
        } else {
          this.send(ws, {
            type: 'operation.reject',
            opId: command.opId,
            entityId: command.comment.id,
            entityType: 'comment',
            code: result.code,
            reason: result.reason,
            revision: this.store.getCurrentRevision(command.workspaceId),
          });
        }
        break;
      }

      case 'comment.update': {
        const actorId = session.user?.id || 'anonymous';
        const result = this.store.updateComment(
          command.opId,
          command.workspaceId,
          command.commentId,
          command.changes,
          command.expectedVersion,
          actorId
        );
        if (result.success) {
          this.send(ws, {
            type: 'operation.ack',
            opId: command.opId,
            entityId: result.ack.entityId,
            entityType: 'comment',
            version: result.ack.version,
            revision: result.ack.revision,
            serverTimestamp: result.ack.serverTimestamp,
          });
          this.broadcastToWorkspace(
            command.workspaceId,
            {
              type: 'workspace.event',
              event: result.event,
            },
            ws
          );
        } else {
          this.send(ws, {
            type: 'operation.reject',
            opId: command.opId,
            entityId: command.commentId,
            entityType: 'comment',
            code: result.code,
            reason: result.reason,
            currentServerEntity: result.currentServerEntity,
            revision: this.store.getCurrentRevision(command.workspaceId),
          });
        }
        break;
      }

      case 'comment.delete': {
        const actorId = session.user?.id || 'anonymous';
        const result = this.store.deleteComment(
          command.opId,
          command.workspaceId,
          command.commentId,
          command.expectedVersion,
          actorId
        );
        if (result.success) {
          this.send(ws, {
            type: 'operation.ack',
            opId: command.opId,
            entityId: result.ack.entityId,
            entityType: 'comment',
            version: result.ack.version,
            revision: result.ack.revision,
            serverTimestamp: result.ack.serverTimestamp,
          });
          this.broadcastToWorkspace(
            command.workspaceId,
            {
              type: 'workspace.event',
              event: result.event,
            },
            ws
          );
        } else {
          this.send(ws, {
            type: 'operation.reject',
            opId: command.opId,
            entityId: command.commentId,
            entityType: 'comment',
            code: result.code,
            reason: result.reason,
            currentServerEntity: result.currentServerEntity,
            revision: this.store.getCurrentRevision(command.workspaceId),
          });
        }
        break;
      }

      case 'presence.update': {
        if (!session.user) return;
        const presence: Presence = {
          userId: session.user.id,
          userName: session.user.name,
          userColor: session.user.color,
          lastSeen: Date.now(),
          ...command.presence,
        };
        this.store.updatePresence(command.workspaceId, presence);
        this.broadcastToWorkspace(command.workspaceId, {
          type: 'presence.sync',
          workspaceId: command.workspaceId,
          presences: this.store.getActivePresences(command.workspaceId),
        });
        break;
      }

      case 'sync.request': {
        const missedEvents = this.store.getMissedEvents(command.workspaceId, command.sinceRevision);
        const currentRev = this.store.getCurrentRevision(command.workspaceId);
        this.send(ws, {
          type: 'sync.complete',
          workspaceId: command.workspaceId,
          revision: currentRev,
          missedEvents,
        });
        break;
      }

      case 'heartbeat.ping': {
        this.send(ws, {
          type: 'heartbeat.pong',
          clientTime: command.clientTime,
          serverTime: Date.now(),
        });
        break;
      }
    }
  }

  public close(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.clients.forEach((_session, ws) => {
      try {
        ws.terminate();
      } catch {
        // Ignored
      }
    });
    this.clients.clear();
    this.workspaceSubscriptions.clear();
    return new Promise((resolve) => {
      this.wss.close(() => resolve());
    });
  }
}
