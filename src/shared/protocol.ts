import { User, Workspace, Task, Comment, Presence } from './types';

export const PROTOCOL_VERSION = 'v1';

// Client to Server Commands
export type ClientCommand =
  | { type: 'workspace.subscribe'; workspaceId: string; user: User; lastRevision?: number }
  | { type: 'workspace.unsubscribe'; workspaceId: string }
  | { type: 'task.create'; opId: string; workspaceId: string; task: Omit<Task, 'workspaceId' | 'version' | 'createdAt' | 'updatedAt' | 'isDeleted'> }
  | { type: 'task.update'; opId: string; workspaceId: string; taskId: string; changes: Partial<Task>; expectedVersion?: number }
  | { type: 'task.delete'; opId: string; workspaceId: string; taskId: string; expectedVersion?: number }
  | { type: 'comment.create'; opId: string; workspaceId: string; comment: Omit<Comment, 'workspaceId' | 'version' | 'createdAt' | 'updatedAt' | 'isDeleted'> }
  | { type: 'comment.update'; opId: string; workspaceId: string; commentId: string; changes: Partial<Comment>; expectedVersion?: number }
  | { type: 'comment.delete'; opId: string; workspaceId: string; commentId: string; expectedVersion?: number }
  | { type: 'presence.update'; workspaceId: string; presence: Partial<Presence> }
  | { type: 'sync.request'; workspaceId: string; sinceRevision: number }
  | { type: 'heartbeat.ping'; clientTime: number };

// Server to Client Events
export interface ServerWorkspaceEvent {
  eventId: string;
  workspaceId: string;
  revision: number;
  type:
    | 'task.created'
    | 'task.updated'
    | 'task.deleted'
    | 'comment.created'
    | 'comment.updated'
    | 'comment.deleted';
  actorId: string;
  opId?: string;
  entity: Task | Comment;
  timestamp: number;
}

export type ServerEvent =
  | {
      type: 'workspace.snapshot';
      workspace: Workspace;
      tasks: Task[];
      comments: Comment[];
      revision: number;
      activePresences: Presence[];
    }
  | {
      type: 'operation.ack';
      opId: string;
      entityId: string;
      entityType: 'task' | 'comment';
      version: number;
      revision: number;
      serverTimestamp: number;
    }
  | {
      type: 'operation.reject';
      opId: string;
      entityId: string;
      entityType: 'task' | 'comment';
      code: 'STALE_VERSION' | 'NOT_FOUND' | 'PERMISSION_DENIED' | 'VALIDATION_ERROR' | 'DELETED';
      reason: string;
      currentServerEntity?: Task | Comment | null;
      revision: number;
    }
  | {
      type: 'workspace.event';
      event: ServerWorkspaceEvent;
    }
  | {
      type: 'presence.sync';
      workspaceId: string;
      presences: Presence[];
    }
  | {
      type: 'sync.complete';
      workspaceId: string;
      revision: number;
      missedEvents: ServerWorkspaceEvent[];
    }
  | {
      type: 'heartbeat.pong';
      clientTime: number;
      serverTime: number;
    }
  | {
      type: 'error';
      code: string;
      message: string;
    };

// Validation helpers
export function validateClientCommand(msg: unknown): { valid: boolean; error?: string; command?: ClientCommand } {
  if (typeof msg !== 'object' || msg === null) {
    return { valid: false, error: 'Command must be a non-null object' };
  }

  const raw = msg as Record<string, unknown>;
  if (typeof raw.type !== 'string') {
    return { valid: false, error: 'Missing or invalid command type' };
  }

  switch (raw.type) {
    case 'workspace.subscribe':
      if (!raw.workspaceId || typeof raw.workspaceId !== 'string') {
        return { valid: false, error: 'workspace.subscribe requires string workspaceId' };
      }
      if (!raw.user || typeof raw.user !== 'object') {
        return { valid: false, error: 'workspace.subscribe requires user object' };
      }
      return { valid: true, command: msg as ClientCommand };

    case 'workspace.unsubscribe':
      if (!raw.workspaceId || typeof raw.workspaceId !== 'string') {
        return { valid: false, error: 'workspace.unsubscribe requires string workspaceId' };
      }
      return { valid: true, command: msg as ClientCommand };

    case 'task.create':
      if (!raw.opId || typeof raw.opId !== 'string') {
        return { valid: false, error: 'task.create requires string opId' };
      }
      if (!raw.workspaceId || typeof raw.workspaceId !== 'string') {
        return { valid: false, error: 'task.create requires string workspaceId' };
      }
      if (!raw.task || typeof raw.task !== 'object') {
        return { valid: false, error: 'task.create requires task object' };
      }
      return { valid: true, command: msg as ClientCommand };

    case 'task.update':
      if (!raw.opId || typeof raw.opId !== 'string') {
        return { valid: false, error: 'task.update requires string opId' };
      }
      if (!raw.taskId || typeof raw.taskId !== 'string') {
        return { valid: false, error: 'task.update requires string taskId' };
      }
      if (!raw.changes || typeof raw.changes !== 'object') {
        return { valid: false, error: 'task.update requires changes object' };
      }
      return { valid: true, command: msg as ClientCommand };

    case 'task.delete':
      if (!raw.opId || typeof raw.opId !== 'string') {
        return { valid: false, error: 'task.delete requires string opId' };
      }
      if (!raw.taskId || typeof raw.taskId !== 'string') {
        return { valid: false, error: 'task.delete requires string taskId' };
      }
      return { valid: true, command: msg as ClientCommand };

    case 'comment.create':
      if (!raw.opId || typeof raw.opId !== 'string') {
        return { valid: false, error: 'comment.create requires string opId' };
      }
      if (!raw.comment || typeof raw.comment !== 'object') {
        return { valid: false, error: 'comment.create requires comment object' };
      }
      return { valid: true, command: msg as ClientCommand };

    case 'comment.update':
      if (!raw.opId || typeof raw.opId !== 'string') {
        return { valid: false, error: 'comment.update requires string opId' };
      }
      if (!raw.commentId || typeof raw.commentId !== 'string') {
        return { valid: false, error: 'comment.update requires string commentId' };
      }
      return { valid: true, command: msg as ClientCommand };

    case 'comment.delete':
      if (!raw.opId || typeof raw.opId !== 'string') {
        return { valid: false, error: 'comment.delete requires string opId' };
      }
      if (!raw.commentId || typeof raw.commentId !== 'string') {
        return { valid: false, error: 'comment.delete requires string commentId' };
      }
      return { valid: true, command: msg as ClientCommand };

    case 'presence.update':
      if (!raw.workspaceId || typeof raw.workspaceId !== 'string') {
        return { valid: false, error: 'presence.update requires workspaceId' };
      }
      return { valid: true, command: msg as ClientCommand };

    case 'sync.request':
      if (!raw.workspaceId || typeof raw.workspaceId !== 'string') {
        return { valid: false, error: 'sync.request requires workspaceId' };
      }
      if (typeof raw.sinceRevision !== 'number') {
        return { valid: false, error: 'sync.request requires numeric sinceRevision' };
      }
      return { valid: true, command: msg as ClientCommand };

    case 'heartbeat.ping':
      return { valid: true, command: msg as ClientCommand };

    default:
      return { valid: false, error: `Unknown command type: ${String(raw.type)}` };
  }
}
