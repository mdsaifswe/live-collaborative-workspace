import {
  Workspace,
  Task,
  Comment,
  Presence,
  WorkspaceSnapshot,
} from '../shared/types';
import { ServerWorkspaceEvent } from '../shared/protocol';
import { mergeTaskFields } from '../shared/conflict';

export interface ProcessedOpRecord {
  opId: string;
  entityId: string;
  entityType: 'task' | 'comment';
  version: number;
  revision: number;
  serverTimestamp: number;
}

export interface AuthoritativeStoreOptions {
  seedStarterTasks?: boolean;
}

export class AuthoritativeStore {
  private workspaces: Map<string, Workspace> = new Map();
  private tasks: Map<string, Task> = new Map();
  private comments: Map<string, Comment> = new Map();
  private presences: Map<string, Map<string, Presence>> = new Map(); // workspaceId -> userId -> Presence
  private eventLog: Map<string, ServerWorkspaceEvent[]> = new Map(); // workspaceId -> ServerWorkspaceEvent[]
  private workspaceRevisions: Map<string, number> = new Map(); // workspaceId -> current revision counter
  private processedOps: Map<string, ProcessedOpRecord> = new Map(); // opId -> ProcessedOpRecord
  private readonly options: AuthoritativeStoreOptions;

  constructor(options?: AuthoritativeStoreOptions) {
    this.options = options || {};
    this.seedDefaultWorkspace();
  }

  private seedDefaultWorkspace(seedTasks?: boolean) {
    const defaultWorkspaceId = 'default-workspace';
    const now = Date.now();
    this.workspaces.set(defaultWorkspaceId, {
      id: defaultWorkspaceId,
      name: 'Engineering Sprint Workspace',
      description: 'Collaborative real-time board for cross-functional engineering execution.',
      createdAt: now,
      updatedAt: now,
    });
    this.workspaceRevisions.set(defaultWorkspaceId, 0);
    this.eventLog.set(defaultWorkspaceId, []);

    const shouldSeed = seedTasks ?? (this.options.seedStarterTasks ?? (process.env.SEED_STARTER_TASKS === 'true'));
    if (shouldSeed) {
      this.seedStarterTasks(defaultWorkspaceId);
    }
  }

  public seedStarterTasks(workspaceId = 'default-workspace') {
    const now = Date.now();
    const starterTasks: Omit<Task, 'workspaceId'>[] = [
      {
        id: 'task-starter-1',
        title: 'Architect Distributed State & Conflict Engine',
        description: 'Implement three-way field merge, optimistic queues, and revision checks.',
        status: 'in_progress',
        priority: 'urgent',
        createdAt: now - 3600000,
        updatedAt: now - 3600000,
        createdBy: 'system',
        version: 1,
      },
      {
        id: 'task-starter-2',
        title: 'Benchmark 20 Concurrent WebSocket Clients',
        description: 'Verify p95 latency stays strictly below 200ms under high-frequency updates.',
        status: 'todo',
        priority: 'high',
        createdAt: now - 1800000,
        updatedAt: now - 1800000,
        createdBy: 'system',
        version: 1,
      },
      {
        id: 'task-starter-3',
        title: 'Validate Offline Recovery with IndexedDB',
        description: 'Ensure queued mutations persist across browser restarts and reconcile on reconnect.',
        status: 'done',
        priority: 'medium',
        createdAt: now - 7200000,
        updatedAt: now - 7200000,
        createdBy: 'system',
        version: 1,
      },
    ];

    for (const t of starterTasks) {
      this.tasks.set(t.id, { ...t, workspaceId });
    }
  }

  public getWorkspace(workspaceId: string): Workspace | undefined {
    return this.workspaces.get(workspaceId);
  }

  public getOrCreateWorkspace(workspaceId: string, name?: string): Workspace {
    let ws = this.workspaces.get(workspaceId);
    if (!ws) {
      const now = Date.now();
      ws = {
        id: workspaceId,
        name: name || `Workspace ${workspaceId}`,
        createdAt: now,
        updatedAt: now,
      };
      this.workspaces.set(workspaceId, ws);
      if (!this.workspaceRevisions.has(workspaceId)) {
        this.workspaceRevisions.set(workspaceId, 0);
      }
      if (!this.eventLog.has(workspaceId)) {
        this.eventLog.set(workspaceId, []);
      }
    }
    return ws;
  }

  public getSnapshot(workspaceId: string): WorkspaceSnapshot {
    const workspace = this.getOrCreateWorkspace(workspaceId);
    const revision = this.workspaceRevisions.get(workspaceId) || 0;

    const tasks = Array.from(this.tasks.values())
      .filter((t) => t.workspaceId === workspaceId && !t.isDeleted);

    const comments = Array.from(this.comments.values())
      .filter((c) => c.workspaceId === workspaceId && !c.isDeleted);

    return {
      workspace,
      tasks,
      comments,
      revision,
      timestamp: Date.now(),
    };
  }

  public getActivePresences(workspaceId: string): Presence[] {
    const wsPresences = this.presences.get(workspaceId);
    if (!wsPresences) return [];
    return Array.from(wsPresences.values());
  }

  public getProcessedOp(opId: string): ProcessedOpRecord | undefined {
    return this.processedOps.get(opId);
  }

  private nextRevision(workspaceId: string): number {
    const current = this.workspaceRevisions.get(workspaceId) || 0;
    const next = current + 1;
    this.workspaceRevisions.set(workspaceId, next);
    return next;
  }

  private appendEvent(workspaceId: string, event: ServerWorkspaceEvent) {
    let log = this.eventLog.get(workspaceId);
    if (!log) {
      log = [];
      this.eventLog.set(workspaceId, log);
    }
    log.push(event);
    // Keep last 10,000 events for catch-up synchronization
    if (log.length > 10000) {
      log.shift();
    }
  }

  public getMissedEvents(workspaceId: string, sinceRevision: number): ServerWorkspaceEvent[] {
    const log = this.eventLog.get(workspaceId) || [];
    return log.filter((e) => e.revision > sinceRevision);
  }

  public getCurrentRevision(workspaceId: string): number {
    return this.workspaceRevisions.get(workspaceId) || 0;
  }

  // --- Task Mutations ---

  public createTask(
    opId: string,
    workspaceId: string,
    taskData: Omit<Task, 'workspaceId' | 'version' | 'createdAt' | 'updatedAt' | 'isDeleted'>,
    actorId: string
  ): { success: true; task: Task; ack: ProcessedOpRecord; event: ServerWorkspaceEvent } | { success: false; code: 'STALE_VERSION' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'DELETED'; reason: string } {
    // Idempotency check: if already processed, return existing ack
    const existing = this.processedOps.get(opId);
    if (existing) {
      const existingTask = this.tasks.get(existing.entityId);
      if (existingTask) {
        return {
          success: true,
          task: existingTask,
          ack: existing,
          event: {
            eventId: `evt-cached-${existing.revision}`,
            workspaceId,
            revision: existing.revision,
            type: 'task.created',
            actorId,
            opId,
            entity: existingTask,
            timestamp: existing.serverTimestamp,
          },
        };
      }
    }

    if (!taskData.id || !taskData.title?.trim()) {
      return { success: false, code: 'VALIDATION_ERROR', reason: 'Task title and ID are required' };
    }

    // Check if task ID already exists
    if (this.tasks.has(taskData.id)) {
      const current = this.tasks.get(taskData.id)!;
      if (!current.isDeleted) {
        return { success: false, code: 'VALIDATION_ERROR', reason: 'Task with this ID already exists' };
      }
    }

    const now = Date.now();
    const revision = this.nextRevision(workspaceId);
    const newTask: Task = {
      ...taskData,
      workspaceId,
      createdAt: now,
      updatedAt: now,
      version: 1,
      isDeleted: false,
    };

    this.tasks.set(newTask.id, newTask);

    const ack: ProcessedOpRecord = {
      opId,
      entityId: newTask.id,
      entityType: 'task',
      version: newTask.version,
      revision,
      serverTimestamp: now,
    };
    this.processedOps.set(opId, ack);

    const event: ServerWorkspaceEvent = {
      eventId: `evt-${revision}-${now}`,
      workspaceId,
      revision,
      type: 'task.created',
      actorId,
      opId,
      entity: newTask,
      timestamp: now,
    };
    this.appendEvent(workspaceId, event);

    return { success: true, task: newTask, ack, event };
  }

  public updateTask(
    opId: string,
    workspaceId: string,
    taskId: string,
    changes: Partial<Task>,
    expectedVersion: number | undefined,
    actorId: string
  ): { success: true; task: Task; ack: ProcessedOpRecord; event: ServerWorkspaceEvent } | { success: false; code: 'STALE_VERSION' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'DELETED'; reason: string; currentServerEntity?: Task } {
    const existingOp = this.processedOps.get(opId);
    if (existingOp) {
      const task = this.tasks.get(taskId);
      if (task) {
        return {
          success: true,
          task,
          ack: existingOp,
          event: {
            eventId: `evt-cached-${existingOp.revision}`,
            workspaceId,
            revision: existingOp.revision,
            type: 'task.updated',
            actorId,
            opId,
            entity: task,
            timestamp: existingOp.serverTimestamp,
          },
        };
      }
    }

    const current = this.tasks.get(taskId);
    if (!current) {
      return { success: false, code: 'NOT_FOUND', reason: 'Task does not exist' };
    }

    if (current.isDeleted) {
      return { success: false, code: 'DELETED', reason: 'Cannot update a deleted task', currentServerEntity: current };
    }

    // Version concurrency check:
    if (expectedVersion !== undefined && expectedVersion < current.version) {
      // Perform 3-way merge attempt
      const mergeResult = mergeTaskFields(null, current, changes);
      if (mergeResult.hasConflict) {
        return {
          success: false,
          code: 'STALE_VERSION',
          reason: `Concurrent conflict on fields: ${mergeResult.conflictingFields.join(', ')}`,
          currentServerEntity: current,
        };
      }
      // Non-conflicting fields safely merged!
      changes = mergeResult.merged;
    }

    const now = Date.now();
    const revision = this.nextRevision(workspaceId);
    const updatedTask: Task = {
      ...current,
      ...changes,
      id: current.id,
      workspaceId: current.workspaceId,
      createdAt: current.createdAt,
      updatedAt: now,
      version: current.version + 1,
    };

    this.tasks.set(taskId, updatedTask);

    const ack: ProcessedOpRecord = {
      opId,
      entityId: taskId,
      entityType: 'task',
      version: updatedTask.version,
      revision,
      serverTimestamp: now,
    };
    this.processedOps.set(opId, ack);

    const event: ServerWorkspaceEvent = {
      eventId: `evt-${revision}-${now}`,
      workspaceId,
      revision,
      type: 'task.updated',
      actorId,
      opId,
      entity: updatedTask,
      timestamp: now,
    };
    this.appendEvent(workspaceId, event);

    return { success: true, task: updatedTask, ack, event };
  }

  public deleteTask(
    opId: string,
    workspaceId: string,
    taskId: string,
    _expectedVersion: number | undefined,
    actorId: string
  ): { success: true; task: Task; ack: ProcessedOpRecord; event: ServerWorkspaceEvent } | { success: false; code: 'STALE_VERSION' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'DELETED'; reason: string; currentServerEntity?: Task } {
    const existingOp = this.processedOps.get(opId);
    if (existingOp) {
      const task = this.tasks.get(taskId);
      if (task) {
        return {
          success: true,
          task,
          ack: existingOp,
          event: {
            eventId: `evt-cached-${existingOp.revision}`,
            workspaceId,
            revision: existingOp.revision,
            type: 'task.deleted',
            actorId,
            opId,
            entity: task,
            timestamp: existingOp.serverTimestamp,
          },
        };
      }
    }

    const current = this.tasks.get(taskId);
    if (!current) {
      return { success: false, code: 'NOT_FOUND', reason: 'Task does not exist' };
    }

    if (current.isDeleted) {
      return { success: false, code: 'DELETED', reason: 'Task is already deleted', currentServerEntity: current };
    }

    const now = Date.now();
    const revision = this.nextRevision(workspaceId);
    const deletedTask: Task = {
      ...current,
      isDeleted: true,
      updatedAt: now,
      version: current.version + 1,
    };

    this.tasks.set(taskId, deletedTask);

    const ack: ProcessedOpRecord = {
      opId,
      entityId: taskId,
      entityType: 'task',
      version: deletedTask.version,
      revision,
      serverTimestamp: now,
    };
    this.processedOps.set(opId, ack);

    const event: ServerWorkspaceEvent = {
      eventId: `evt-${revision}-${now}`,
      workspaceId,
      revision,
      type: 'task.deleted',
      actorId,
      opId,
      entity: deletedTask,
      timestamp: now,
    };
    this.appendEvent(workspaceId, event);

    return { success: true, task: deletedTask, ack, event };
  }

  // --- Comment Mutations ---

  public createComment(
    opId: string,
    workspaceId: string,
    commentData: Omit<Comment, 'workspaceId' | 'version' | 'createdAt' | 'updatedAt' | 'isDeleted'>,
    actorId: string
  ): { success: true; comment: Comment; ack: ProcessedOpRecord; event: ServerWorkspaceEvent } | { success: false; code: 'STALE_VERSION' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'DELETED'; reason: string } {
    const existing = this.processedOps.get(opId);
    if (existing) {
      const existingComment = this.comments.get(existing.entityId);
      if (existingComment) {
        return {
          success: true,
          comment: existingComment,
          ack: existing,
          event: {
            eventId: `evt-cached-${existing.revision}`,
            workspaceId,
            revision: existing.revision,
            type: 'comment.created',
            actorId,
            opId,
            entity: existingComment,
            timestamp: existing.serverTimestamp,
          },
        };
      }
    }

    if (!commentData.id || !commentData.content?.trim()) {
      return { success: false, code: 'VALIDATION_ERROR', reason: 'Comment content and ID are required' };
    }

    const task = this.tasks.get(commentData.taskId);
    if (!task || task.isDeleted) {
      return { success: false, code: 'NOT_FOUND', reason: 'Cannot add comment to a non-existent or deleted task' };
    }

    const now = Date.now();
    const revision = this.nextRevision(workspaceId);
    const newComment: Comment = {
      ...commentData,
      workspaceId,
      createdAt: now,
      updatedAt: now,
      version: 1,
      isDeleted: false,
    };

    this.comments.set(newComment.id, newComment);

    const ack: ProcessedOpRecord = {
      opId,
      entityId: newComment.id,
      entityType: 'comment',
      version: newComment.version,
      revision,
      serverTimestamp: now,
    };
    this.processedOps.set(opId, ack);

    const event: ServerWorkspaceEvent = {
      eventId: `evt-${revision}-${now}`,
      workspaceId,
      revision,
      type: 'comment.created',
      actorId,
      opId,
      entity: newComment,
      timestamp: now,
    };
    this.appendEvent(workspaceId, event);

    return { success: true, comment: newComment, ack, event };
  }

  public updateComment(
    opId: string,
    workspaceId: string,
    commentId: string,
    changes: Partial<Comment>,
    expectedVersion: number | undefined,
    actorId: string
  ): { success: true; comment: Comment; ack: ProcessedOpRecord; event: ServerWorkspaceEvent } | { success: false; code: 'STALE_VERSION' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'DELETED'; reason: string; currentServerEntity?: Comment } {
    const existingOp = this.processedOps.get(opId);
    if (existingOp) {
      const comment = this.comments.get(commentId);
      if (comment) {
        return {
          success: true,
          comment,
          ack: existingOp,
          event: {
            eventId: `evt-cached-${existingOp.revision}`,
            workspaceId,
            revision: existingOp.revision,
            type: 'comment.updated',
            actorId,
            opId,
            entity: comment,
            timestamp: existingOp.serverTimestamp,
          },
        };
      }
    }

    const current = this.comments.get(commentId);
    if (!current) {
      return { success: false, code: 'NOT_FOUND', reason: 'Comment does not exist' };
    }
    if (current.isDeleted) {
      return { success: false, code: 'DELETED', reason: 'Comment has been deleted', currentServerEntity: current };
    }

    if (expectedVersion !== undefined && expectedVersion < current.version) {
      return {
        success: false,
        code: 'STALE_VERSION',
        reason: 'Comment was updated concurrently by another user',
        currentServerEntity: current,
      };
    }

    const now = Date.now();
    const revision = this.nextRevision(workspaceId);
    const updatedComment: Comment = {
      ...current,
      ...changes,
      id: current.id,
      workspaceId: current.workspaceId,
      taskId: current.taskId,
      authorId: current.authorId,
      createdAt: current.createdAt,
      updatedAt: now,
      version: current.version + 1,
    };

    this.comments.set(commentId, updatedComment);

    const ack: ProcessedOpRecord = {
      opId,
      entityId: commentId,
      entityType: 'comment',
      version: updatedComment.version,
      revision,
      serverTimestamp: now,
    };
    this.processedOps.set(opId, ack);

    const event: ServerWorkspaceEvent = {
      eventId: `evt-${revision}-${now}`,
      workspaceId,
      revision,
      type: 'comment.updated',
      actorId,
      opId,
      entity: updatedComment,
      timestamp: now,
    };
    this.appendEvent(workspaceId, event);

    return { success: true, comment: updatedComment, ack, event };
  }

  public deleteComment(
    opId: string,
    workspaceId: string,
    commentId: string,
    _expectedVersion: number | undefined,
    actorId: string
  ): { success: true; comment: Comment; ack: ProcessedOpRecord; event: ServerWorkspaceEvent } | { success: false; code: 'STALE_VERSION' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'DELETED'; reason: string; currentServerEntity?: Comment } {
    const existingOp = this.processedOps.get(opId);
    if (existingOp) {
      const comment = this.comments.get(commentId);
      if (comment) {
        return {
          success: true,
          comment,
          ack: existingOp,
          event: {
            eventId: `evt-cached-${existingOp.revision}`,
            workspaceId,
            revision: existingOp.revision,
            type: 'comment.deleted',
            actorId,
            opId,
            entity: comment,
            timestamp: existingOp.serverTimestamp,
          },
        };
      }
    }

    const current = this.comments.get(commentId);
    if (!current) {
      return { success: false, code: 'NOT_FOUND', reason: 'Comment does not exist' };
    }
    if (current.isDeleted) {
      return { success: false, code: 'DELETED', reason: 'Comment already deleted', currentServerEntity: current };
    }

    const now = Date.now();
    const revision = this.nextRevision(workspaceId);
    const deletedComment: Comment = {
      ...current,
      isDeleted: true,
      updatedAt: now,
      version: current.version + 1,
    };

    this.comments.set(commentId, deletedComment);

    const ack: ProcessedOpRecord = {
      opId,
      entityId: commentId,
      entityType: 'comment',
      version: deletedComment.version,
      revision,
      serverTimestamp: now,
    };
    this.processedOps.set(opId, ack);

    const event: ServerWorkspaceEvent = {
      eventId: `evt-${revision}-${now}`,
      workspaceId,
      revision,
      type: 'comment.deleted',
      actorId,
      opId,
      entity: deletedComment,
      timestamp: now,
    };
    this.appendEvent(workspaceId, event);

    return { success: true, comment: deletedComment, ack, event };
  }

  // --- Presence ---

  public updatePresence(workspaceId: string, presence: Presence) {
    let wsPresences = this.presences.get(workspaceId);
    if (!wsPresences) {
      wsPresences = new Map();
      this.presences.set(workspaceId, wsPresences);
    }
    wsPresences.set(presence.userId, presence);
  }

  public removePresence(workspaceId: string, userId: string) {
    const wsPresences = this.presences.get(workspaceId);
    if (wsPresences) {
      wsPresences.delete(userId);
    }
  }

  public clearAll() {
    this.workspaces.clear();
    this.tasks.clear();
    this.comments.clear();
    this.presences.clear();
    this.eventLog.clear();
    this.workspaceRevisions.clear();
    this.processedOps.clear();
    this.seedDefaultWorkspace();
  }
}
