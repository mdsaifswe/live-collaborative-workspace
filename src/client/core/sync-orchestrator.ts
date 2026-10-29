import {
  Workspace,
  Task,
  Comment,
  Presence,
  User,
  PendingOperation,
  ConflictRecord,
  ConnectionState,
} from '../../shared/types';
import {
  ServerEvent,
  ServerWorkspaceEvent,
} from '../../shared/protocol';
import { ConnectionManager } from './connection-manager';
import { IndexedDBRepository } from './idb-repository';
import { createConflictRecord } from '../../shared/conflict';

export interface SyncState {
  workspace: Workspace | null;
  tasks: Task[];
  comments: Comment[];
  presences: Presence[];
  pendingOps: PendingOperation[];
  conflicts: ConflictRecord[];
  connectionState: ConnectionState;
  connectionDetails?: string;
  lastRevision: number;
}

export type StateListener = (state: SyncState) => void;

export interface EventRenderedData {
  opId?: string;
  eventId: string;
  eventType: string;
  entityId: string;
  wsReceiveTime: number;
  renderedTime: number;
  isDomObservable: boolean;
}

export type EventRenderedCallback = (data: EventRenderedData) => void;

export class SyncOrchestrator {
  private cm: ConnectionManager;
  private idb: IndexedDBRepository;
  private currentUser: User;
  private workspaceId: string;

  private state: SyncState = {
    workspace: null,
    tasks: [],
    comments: [],
    presences: [],
    pendingOps: [],
    conflicts: [],
    connectionState: 'disconnected',
    lastRevision: 0,
  };

  private listeners: Set<StateListener> = new Set();
  private eventRenderedListeners: Set<EventRenderedCallback> = new Set();
  // Rollback cache for in-flight operations: opId -> previous entity state
  private rollbackCache: Map<string, { entityType: 'task' | 'comment'; previous: Task | Comment | null }> = new Map();
  // Processed event ID deduplication set
  private processedEventIds: Set<string> = new Set();
  private hasCachedSnapshot = false;

  // IDB write batching queue
  private pendingTasksToSave: Map<string, Task> = new Map();
  private pendingCommentsToSave: Map<string, Comment> = new Map();
  private pendingSyncMetaRevision: number | null = null;
  private idbFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private isFlushingIdb = false;

  constructor(
    cm: ConnectionManager,
    idb: IndexedDBRepository,
    currentUser: User,
    workspaceId: string
  ) {
    this.cm = cm;
    this.idb = idb;
    this.currentUser = currentUser;
    this.workspaceId = workspaceId;

    this.setupListeners();
  }

  private setupListeners() {
    this.cm.onStateChange((cState, details) => {
      this.state.connectionState = cState;
      this.state.connectionDetails = details;

      if (cState === 'connected') {
        // Resubscribe to workspace
        this.cm.send({
          type: 'workspace.subscribe',
          workspaceId: this.workspaceId,
          user: this.currentUser,
          lastRevision: this.hasCachedSnapshot ? this.state.lastRevision : undefined,
        });
      }

      this.notify();
    });

    this.cm.onMessage((event) => {
      this.handleServerMessage(event);
    });
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  public onEventRendered(listener: EventRenderedCallback): () => void {
    this.eventRenderedListeners.add(listener);
    return () => this.eventRenderedListeners.delete(listener);
  }

  public destroy(): void {
    if (this.idbFlushTimer) {
      clearTimeout(this.idbFlushTimer);
      this.idbFlushTimer = null;
    }
    this.flushPendingIdbWrites().catch(() => {});
    this.listeners.clear();
    this.eventRenderedListeners.clear();
  }

  private queueTaskSave(task: Task) {
    this.pendingTasksToSave.set(task.id, task);
    this.scheduleIdbFlush();
  }

  private queueCommentSave(comment: Comment) {
    this.pendingCommentsToSave.set(comment.id, comment);
    this.scheduleIdbFlush();
  }

  private queueSyncMeta(revision: number) {
    if (this.pendingSyncMetaRevision === null || revision > this.pendingSyncMetaRevision) {
      this.pendingSyncMetaRevision = revision;
    }
    this.scheduleIdbFlush();
  }

  private scheduleIdbFlush() {
    if (this.idbFlushTimer !== null) return;
    this.idbFlushTimer = setTimeout(() => {
      this.idbFlushTimer = null;
      this.flushPendingIdbWrites().catch((err) => console.warn('[SyncOrchestrator] Flush error:', err));
    }, 16);
  }

  public async flushPendingIdbWrites(): Promise<void> {
    if (this.isFlushingIdb) {
      this.scheduleIdbFlush();
      return;
    }

    if (
      this.pendingTasksToSave.size === 0 &&
      this.pendingCommentsToSave.size === 0 &&
      this.pendingSyncMetaRevision === null
    ) {
      return;
    }

    this.isFlushingIdb = true;

    // Snapshot items to flush
    const tasks = Array.from(this.pendingTasksToSave.values());
    this.pendingTasksToSave.clear();

    const comments = Array.from(this.pendingCommentsToSave.values());
    this.pendingCommentsToSave.clear();

    const metaRevision = this.pendingSyncMetaRevision;
    this.pendingSyncMetaRevision = null;

    try {
      if (tasks.length > 0) {
        await this.idb.saveTasks(tasks);
      }
      if (comments.length > 0) {
        await this.idb.saveComments(comments);
      }
      if (metaRevision !== null) {
        await this.idb.saveSyncMetadata({
          workspaceId: this.workspaceId,
          lastServerRevision: metaRevision,
          lastSyncTimestamp: Date.now(),
        });
      }
    } catch (err) {
      console.warn('[SyncOrchestrator] Background IDB flush failed:', err);
    } finally {
      this.isFlushingIdb = false;
      if (
        this.pendingTasksToSave.size > 0 ||
        this.pendingCommentsToSave.size > 0 ||
        this.pendingSyncMetaRevision !== null
      ) {
        this.scheduleIdbFlush();
      }
    }
  }

  public getState(): SyncState {
    return {
      ...this.state,
      tasks: [...this.state.tasks],
      comments: [...this.state.comments],
      presences: [...this.state.presences],
      pendingOps: [...this.state.pendingOps],
      conflicts: [...this.state.conflicts],
    };
  }

  private notify() {
    const current = this.getState();
    this.listeners.forEach((l) => l(current));
  }

  /**
   * Initializes local state from IndexedDB first for instant UI, then triggers connection
   */
  public async initialize(): Promise<void> {
    try {
      const cachedWorkspace = await this.idb.getWorkspace(this.workspaceId);
      const cachedTasks = await this.idb.getTasksByWorkspace(this.workspaceId);
      const cachedComments = await this.idb.getCommentsByWorkspace(this.workspaceId);
      const cachedPendingOps = await this.idb.getPendingOperations(this.workspaceId);
      const cachedConflicts = await this.idb.getConflicts(this.workspaceId);
      const syncMeta = await this.idb.getSyncMetadata(this.workspaceId);

      if (cachedWorkspace && syncMeta) {
        this.hasCachedSnapshot = true;
        this.state.workspace = cachedWorkspace;
        this.state.tasks = cachedTasks;
        this.state.comments = cachedComments;
        this.state.lastRevision = syncMeta.lastServerRevision;
      } else {
        this.hasCachedSnapshot = false;
        this.state.workspace = null;
        this.state.tasks = [];
        this.state.comments = [];
        this.state.lastRevision = 0;
      }
      this.state.pendingOps = cachedPendingOps;
      this.state.conflicts = cachedConflicts;

      this.notify();
    } catch (err) {
      console.warn('[SyncOrchestrator] Failed loading cached state from IndexedDB:', err);
    }

    // Connect to WebSocket
    this.cm.connect();
  }

  private async handleServerMessage(event: ServerEvent) {
    switch (event.type) {
      case 'workspace.snapshot': {
        this.hasCachedSnapshot = true;
        this.state.workspace = event.workspace;
        this.state.tasks = event.tasks;
        this.state.comments = event.comments;
        this.state.lastRevision = event.revision;
        this.state.presences = event.activePresences;

        // Persist snapshot to IndexedDB
        await this.idb.saveWorkspace(event.workspace);
        await this.idb.replaceTasksForWorkspace(this.workspaceId, event.tasks);
        await this.idb.replaceCommentsForWorkspace(this.workspaceId, event.comments);
        await this.idb.saveSyncMetadata({
          workspaceId: this.workspaceId,
          lastServerRevision: event.revision,
          lastSyncTimestamp: Date.now(),
        });

        // Replay any pending local operations
        await this.replayPendingOperations();
        this.notify();
        break;
      }

      case 'operation.ack': {
        const { opId, entityId, entityType, version, revision } = event;
        this.rollbackCache.delete(opId);

        // Update local entity authoritative revision and version
        if (entityType === 'task') {
          const idx = this.state.tasks.findIndex((t) => t.id === entityId);
          if (idx !== -1) {
            this.state.tasks[idx] = {
              ...this.state.tasks[idx],
              version,
            };
            this.queueTaskSave(this.state.tasks[idx]);
          }
        } else if (entityType === 'comment') {
          const idx = this.state.comments.findIndex((c) => c.id === entityId);
          if (idx !== -1) {
            this.state.comments[idx] = {
              ...this.state.comments[idx],
              version,
            };
            this.queueCommentSave(this.state.comments[idx]);
          }
        }

        // Remove from pending ops
        this.state.pendingOps = this.state.pendingOps.filter((o) => o.opId !== opId);
        this.idb.removePendingOperation(opId).catch((err) => console.warn('[IDB] removePending:', err));

        if (revision > this.state.lastRevision) {
          this.state.lastRevision = revision;
          this.queueSyncMeta(revision);
        }

        this.notify();
        break;
      }

      case 'operation.reject': {
        const { opId, entityId, entityType, code, reason, currentServerEntity } = event;
        const cached = this.rollbackCache.get(opId);
        this.rollbackCache.delete(opId);

        if (code === 'STALE_VERSION' && currentServerEntity) {
          // Record conflict
          const conflict = createConflictRecord(
            this.workspaceId,
            entityType,
            entityId,
            (cached?.previous || {}) as Partial<Task>,
            currentServerEntity
          );
          this.state.conflicts.push(conflict);
          await this.idb.saveConflict(conflict);

          // Update local entity to current authoritative server entity
          if (entityType === 'task') {
            const idx = this.state.tasks.findIndex((t) => t.id === entityId);
            if (idx !== -1) {
              this.state.tasks[idx] = currentServerEntity as Task;
              await this.idb.saveTask(this.state.tasks[idx]);
            }
          }
        } else if (cached) {
          // Revert optimistic changes
          if (entityType === 'task') {
            if (cached.previous) {
              const idx = this.state.tasks.findIndex((t) => t.id === entityId);
              if (idx !== -1) {
                this.state.tasks[idx] = cached.previous as Task;
                await this.idb.saveTask(this.state.tasks[idx]);
              }
            } else {
              // Was a create op that failed: delete optimistic item
              this.state.tasks = this.state.tasks.filter((t) => t.id !== entityId);
              await this.idb.deleteTask(entityId);
            }
          } else if (entityType === 'comment') {
            if (cached.previous) {
              const idx = this.state.comments.findIndex((c) => c.id === entityId);
              if (idx !== -1) {
                this.state.comments[idx] = cached.previous as Comment;
                await this.idb.saveComment(this.state.comments[idx]);
              }
            } else {
              this.state.comments = this.state.comments.filter((c) => c.id !== entityId);
              await this.idb.deleteComment(entityId);
            }
          }
        }

        // Remove rejected op from pending
        this.state.pendingOps = this.state.pendingOps.filter((o) => o.opId !== opId);
        await this.idb.removePendingOperation(opId);

        console.warn(`[SyncOrchestrator] Operation rejected [${code}]: ${reason}`);
        this.notify();
        break;
      }

      case 'workspace.event': {
        const wsReceiveTime = typeof performance !== 'undefined' ? performance.timeOrigin + performance.now() : Date.now();
        this.applyWorkspaceEvent(event.event, wsReceiveTime);
        break;
      }

      case 'sync.complete': {
        for (const missed of event.missedEvents) {
          this.applyWorkspaceEvent(missed);
        }
        this.state.lastRevision = event.revision;
        this.queueSyncMeta(event.revision);
        this.replayPendingOperations().catch((err) => console.warn('[Sync] replay:', err));
        this.notify();
        break;
      }

      case 'presence.sync': {
        this.state.presences = event.presences;
        this.notify();
        break;
      }
    }
  }

  private applyWorkspaceEvent(event: ServerWorkspaceEvent, wsReceiveTime?: number) {
    if (this.processedEventIds.has(event.eventId)) return;
    this.processedEventIds.add(event.eventId);

    if (event.revision > this.state.lastRevision) {
      this.state.lastRevision = event.revision;
      this.queueSyncMeta(event.revision);
    }

    switch (event.type) {
      case 'task.created': {
        const task = event.entity as Task;
        const existingIdx = this.state.tasks.findIndex((t) => t.id === task.id);
        if (existingIdx !== -1) {
          this.state.tasks[existingIdx] = task;
        } else {
          this.state.tasks.unshift(task);
        }
        this.queueTaskSave(task);
        break;
      }

      case 'task.updated': {
        const task = event.entity as Task;
        const idx = this.state.tasks.findIndex((t) => t.id === task.id);
        if (idx !== -1) {
          this.state.tasks[idx] = task;
        } else {
          this.state.tasks.push(task);
        }
        this.queueTaskSave(task);
        break;
      }

      case 'task.deleted': {
        const task = event.entity as Task;
        this.state.tasks = this.state.tasks.filter((t) => t.id !== task.id);
        this.queueTaskSave({ ...task, isDeleted: true });
        break;
      }

      case 'comment.created': {
        const comment = event.entity as Comment;
        const existingIdx = this.state.comments.findIndex((c) => c.id === comment.id);
        if (existingIdx !== -1) {
          this.state.comments[existingIdx] = comment;
        } else {
          this.state.comments.push(comment);
        }
        this.queueCommentSave(comment);
        break;
      }

      case 'comment.updated': {
        const comment = event.entity as Comment;
        const idx = this.state.comments.findIndex((c) => c.id === comment.id);
        if (idx !== -1) {
          this.state.comments[idx] = comment;
        } else {
          this.state.comments.push(comment);
        }
        this.queueCommentSave(comment);
        break;
      }

      case 'comment.deleted': {
        const comment = event.entity as Comment;
        this.state.comments = this.state.comments.filter((c) => c.id !== comment.id);
        this.queueCommentSave({ ...comment, isDeleted: true });
        break;
      }
    }

    this.notify();

    // Schedule post-paint observable verification
    if (typeof window !== 'undefined') {
      let fired = false;
      const measureDelivery = () => {
        if (fired) return;
        fired = true;
        const renderedTime = performance.timeOrigin + performance.now();
        const isDomObservable = !!(
          document.querySelector(`[data-task-id="${event.entity.id}"]`) ||
          document.querySelector(`[data-comment-id="${event.entity.id}"]`) ||
          (event.type.startsWith('comment.') &&
            document.querySelector(`[data-task-id="${(event.entity as Comment).taskId}"]`))
        );
        const data: EventRenderedData = {
          opId: event.opId,
          eventId: event.eventId,
          eventType: event.type,
          entityId: event.entity.id,
          wsReceiveTime: wsReceiveTime || renderedTime,
          renderedTime,
          isDomObservable,
        };

        this.eventRenderedListeners.forEach((listener) => listener(data));

        if (typeof window !== 'undefined') {
          const win = window as unknown as {
            __collab_deliveries?: EventRenderedData[];
            __collab_on_delivery?: (d: EventRenderedData) => void;
          };
          if (!win.__collab_deliveries) {
            win.__collab_deliveries = [];
          }
          win.__collab_deliveries.push(data);

          if (typeof win.__collab_on_delivery === 'function') {
            try {
              win.__collab_on_delivery(data);
            } catch {
              // Ignored
            }
          }
        }
      };

      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
          measureDelivery();
        });
      }
      if (typeof MessageChannel !== 'undefined') {
        const channel = new MessageChannel();
        channel.port2.onmessage = () => {
          channel.port1.close();
          channel.port2.close();
          measureDelivery();
        };
        channel.port1.postMessage(null);
      }
      setTimeout(measureDelivery, 40);
    }
  }

  // --- Safe Mutation API (Optimistic + Durable Queue) ---

  public async createTask(
    taskData: Omit<Task, 'workspaceId' | 'version' | 'createdAt' | 'updatedAt' | 'isDeleted'>,
    customOpId?: string
  ): Promise<string> {
    const opId = customOpId || `op-t-create-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();

    const optimisticTask: Task = {
      ...taskData,
      workspaceId: this.workspaceId,
      createdAt: now,
      updatedAt: now,
      version: 0, // 0 denotes optimistic unconfirmed version
      isDeleted: false,
    };

    // 1. Rollback cache
    this.rollbackCache.set(opId, { entityType: 'task', previous: null });

    // 2. Optimistic UI update
    this.state.tasks.unshift(optimisticTask);

    // 3. Durable queue in IndexedDB
    const pendingOp: PendingOperation = {
      opId,
      workspaceId: this.workspaceId,
      type: 'task.create',
      entityId: optimisticTask.id,
      entityType: 'task',
      payload: optimisticTask,
      timestamp: now,
      status: 'pending',
      retryCount: 0,
    };
    this.state.pendingOps.push(pendingOp);

    // Send network message immediately
    this.cm.send({
      type: 'task.create',
      opId,
      workspaceId: this.workspaceId,
      task: optimisticTask,
    });

    // Asynchronous background persistence
    this.idb.savePendingOperation(pendingOp).catch((err) => console.warn('[IDB] savePendingOp:', err));
    this.queueTaskSave(optimisticTask);

    this.notify();
    return opId;
  }

  public async updateTask(
    taskId: string,
    changes: Partial<Task>,
    customOpId?: string
  ): Promise<string> {
    const opId = customOpId || `op-t-update-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const current = this.state.tasks.find((t) => t.id === taskId);
    if (!current) throw new Error('Task not found');

    const expectedVersion = current.version;
    this.rollbackCache.set(opId, { entityType: 'task', previous: { ...current } });

    // Optimistic UI update
    const updated: Task = {
      ...current,
      ...changes,
      updatedAt: Date.now(),
    };
    const idx = this.state.tasks.findIndex((t) => t.id === taskId);
    this.state.tasks[idx] = updated;

    const pendingOp: PendingOperation = {
      opId,
      workspaceId: this.workspaceId,
      type: 'task.update',
      entityId: taskId,
      entityType: 'task',
      payload: changes,
      expectedVersion,
      timestamp: Date.now(),
      status: 'pending',
      retryCount: 0,
    };
    this.state.pendingOps.push(pendingOp);

    // Send network message immediately
    this.cm.send({
      type: 'task.update',
      opId,
      workspaceId: this.workspaceId,
      taskId,
      changes,
      expectedVersion,
    });

    // Asynchronous background persistence
    this.idb.savePendingOperation(pendingOp).catch((err) => console.warn('[IDB] savePendingOp:', err));
    this.queueTaskSave(updated);

    this.notify();
    return opId;
  }

  public async deleteTask(taskId: string): Promise<string> {
    const opId = `op-t-delete-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const current = this.state.tasks.find((t) => t.id === taskId);
    if (!current) throw new Error('Task not found');

    const expectedVersion = current.version;
    this.rollbackCache.set(opId, { entityType: 'task', previous: { ...current } });

    // Optimistic deletion
    this.state.tasks = this.state.tasks.filter((t) => t.id !== taskId);

    const pendingOp: PendingOperation = {
      opId,
      workspaceId: this.workspaceId,
      type: 'task.delete',
      entityId: taskId,
      entityType: 'task',
      payload: null,
      expectedVersion,
      timestamp: Date.now(),
      status: 'pending',
      retryCount: 0,
    };
    this.state.pendingOps.push(pendingOp);

    // Send network message immediately
    this.cm.send({
      type: 'task.delete',
      opId,
      workspaceId: this.workspaceId,
      taskId,
      expectedVersion,
    });

    // Asynchronous background persistence
    this.idb.savePendingOperation(pendingOp).catch((err) => console.warn('[IDB] savePendingOp:', err));
    this.queueTaskSave({ ...current, isDeleted: true });

    this.notify();
    return opId;
  }

  public async createComment(
    taskId: string,
    content: string,
    customOpId?: string
  ): Promise<string> {
    const opId = customOpId || `op-c-create-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const commentId = `comment-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();

    const optimisticComment: Comment = {
      id: commentId,
      workspaceId: this.workspaceId,
      taskId,
      content,
      authorId: this.currentUser.id,
      authorName: this.currentUser.name,
      createdAt: now,
      updatedAt: now,
      version: 0,
      isDeleted: false,
    };

    this.rollbackCache.set(opId, { entityType: 'comment', previous: null });
    this.state.comments.push(optimisticComment);

    const pendingOp: PendingOperation = {
      opId,
      workspaceId: this.workspaceId,
      type: 'comment.create',
      entityId: commentId,
      entityType: 'comment',
      payload: optimisticComment,
      timestamp: now,
      status: 'pending',
      retryCount: 0,
    };
    this.state.pendingOps.push(pendingOp);

    // Send network message immediately
    this.cm.send({
      type: 'comment.create',
      opId,
      workspaceId: this.workspaceId,
      comment: optimisticComment,
    });

    // Asynchronous background persistence
    this.idb.savePendingOperation(pendingOp).catch((err) => console.warn('[IDB] savePendingOp:', err));
    this.queueCommentSave(optimisticComment);

    this.notify();
    return opId;
  }

  public async deleteComment(commentId: string): Promise<string> {
    const opId = `op-c-delete-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const current = this.state.comments.find((c) => c.id === commentId);
    if (!current) throw new Error('Comment not found');

    const expectedVersion = current.version;
    this.rollbackCache.set(opId, { entityType: 'comment', previous: { ...current } });

    this.state.comments = this.state.comments.filter((c) => c.id !== commentId);

    const pendingOp: PendingOperation = {
      opId,
      workspaceId: this.workspaceId,
      type: 'comment.delete',
      entityId: commentId,
      entityType: 'comment',
      payload: null,
      expectedVersion,
      timestamp: Date.now(),
      status: 'pending',
      retryCount: 0,
    };
    this.state.pendingOps.push(pendingOp);

    // Send network message immediately
    this.cm.send({
      type: 'comment.delete',
      opId,
      workspaceId: this.workspaceId,
      commentId,
      expectedVersion,
    });

    // Asynchronous background persistence
    this.idb.savePendingOperation(pendingOp).catch((err) => console.warn('[IDB] savePendingOp:', err));
    this.queueCommentSave({ ...current, isDeleted: true });

    this.notify();
    return opId;
  }

  public updatePresence(activeTaskId?: string) {
    this.cm.send({
      type: 'presence.update',
      workspaceId: this.workspaceId,
      presence: {
        activeTaskId,
        lastSeen: Date.now(),
      },
    });
  }

  public async resolveConflict(conflictId: string, resolution: 'client' | 'server') {
    const conflict = this.state.conflicts.find((c) => c.conflictId === conflictId);
    if (!conflict) return;

    if (resolution === 'client') {
      if (conflict.entityType === 'task') {
        const currentTask = this.state.tasks.find((t) => t.id === conflict.entityId);
        if (currentTask) {
          await this.updateTask(conflict.entityId, conflict.clientValue as Partial<Task>);
        }
      }
    }

    this.state.conflicts = this.state.conflicts.filter((c) => c.conflictId !== conflictId);
    await this.idb.resolveConflict(conflictId);
    this.notify();
  }

  private async replayPendingOperations() {
    if (this.state.pendingOps.length === 0) return;
    console.info(`[SyncOrchestrator] Replaying ${this.state.pendingOps.length} pending operations`);

    for (const op of this.state.pendingOps) {
      if (op.type === 'task.create') {
        this.cm.send({
          type: 'task.create',
          opId: op.opId,
          workspaceId: op.workspaceId,
          task: op.payload as Task,
        });
      } else if (op.type === 'task.update') {
        this.cm.send({
          type: 'task.update',
          opId: op.opId,
          workspaceId: op.workspaceId,
          taskId: op.entityId,
          changes: op.payload as Partial<Task>,
          expectedVersion: op.expectedVersion,
        });
      } else if (op.type === 'task.delete') {
        this.cm.send({
          type: 'task.delete',
          opId: op.opId,
          workspaceId: op.workspaceId,
          taskId: op.entityId,
          expectedVersion: op.expectedVersion,
        });
      } else if (op.type === 'comment.create') {
        this.cm.send({
          type: 'comment.create',
          opId: op.opId,
          workspaceId: op.workspaceId,
          comment: op.payload as Comment,
        });
      } else if (op.type === 'comment.delete') {
        this.cm.send({
          type: 'comment.delete',
          opId: op.opId,
          workspaceId: op.workspaceId,
          commentId: op.entityId,
          expectedVersion: op.expectedVersion,
        });
      }
    }
  }

  public async clearLocalData() {
    if (this.idbFlushTimer) {
      clearTimeout(this.idbFlushTimer);
      this.idbFlushTimer = null;
    }
    this.pendingTasksToSave.clear();
    this.pendingCommentsToSave.clear();
    this.pendingSyncMetaRevision = null;

    await this.idb.clearAll();
    this.hasCachedSnapshot = false;
    this.state.lastRevision = 0;
    this.state.workspace = null;
    this.state.tasks = [];
    this.state.comments = [];
    this.state.pendingOps = [];
    this.state.conflicts = [];
    this.notify();

    if (this.cm.getState() === 'connected') {
      this.cm.send({
        type: 'workspace.subscribe',
        workspaceId: this.workspaceId,
        user: this.currentUser,
      });
    }
  }
}
