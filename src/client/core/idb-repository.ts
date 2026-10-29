import { openDB, IDBPDatabase } from 'idb';
import {
  Workspace,
  Task,
  Comment,
  PendingOperation,
  ConflictRecord,
  SynchronizationMetadata,
} from '../../shared/types';
import { DB_NAME, DB_VERSION } from '../../shared/constants';

export class IndexedDBRepository {
  private dbPromise: Promise<IDBPDatabase> | null = null;
  private isAvailable = true;

  constructor() {
    this.ensureInitialized();
  }

  private ensureInitialized(): Promise<IDBPDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDB(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion, newVersion, _transaction) {
          console.info(`[IndexedDB] Upgrading schema from v${oldVersion} to v${newVersion}`);

          if (!db.objectStoreNames.contains('workspaces')) {
            db.createObjectStore('workspaces', { keyPath: 'id' });
          }

          if (!db.objectStoreNames.contains('tasks')) {
            const taskStore = db.createObjectStore('tasks', { keyPath: 'id' });
            taskStore.createIndex('by_workspace', 'workspaceId', { unique: false });
            taskStore.createIndex('by_status', 'status', { unique: false });
          }

          if (!db.objectStoreNames.contains('comments')) {
            const commentStore = db.createObjectStore('comments', { keyPath: 'id' });
            commentStore.createIndex('by_task', 'taskId', { unique: false });
            commentStore.createIndex('by_workspace', 'workspaceId', { unique: false });
          }

          if (!db.objectStoreNames.contains('pending_operations')) {
            const opStore = db.createObjectStore('pending_operations', { keyPath: 'opId' });
            opStore.createIndex('by_workspace', 'workspaceId', { unique: false });
            opStore.createIndex('by_timestamp', 'timestamp', { unique: false });
          }

          if (!db.objectStoreNames.contains('sync_metadata')) {
            db.createObjectStore('sync_metadata', { keyPath: 'workspaceId' });
          }

          if (!db.objectStoreNames.contains('conflicts')) {
            const conflictStore = db.createObjectStore('conflicts', { keyPath: 'conflictId' });
            conflictStore.createIndex('by_workspace', 'workspaceId', { unique: false });
          }
        },
      }).catch((err) => {
        console.error('[IndexedDB] Initialization failed:', err);
        this.isAvailable = false;
        throw err;
      });
    }
    return this.dbPromise;
  }

  public isStorageAvailable(): boolean {
    return this.isAvailable;
  }

  // Workspaces
  public async saveWorkspace(workspace: Workspace): Promise<void> {
    const db = await this.ensureInitialized();
    await db.put('workspaces', workspace);
  }

  public async getWorkspace(workspaceId: string): Promise<Workspace | undefined> {
    const db = await this.ensureInitialized();
    return db.get('workspaces', workspaceId);
  }

  // Tasks
  public async saveTasks(tasks: Task[]): Promise<void> {
    const db = await this.ensureInitialized();
    const tx = db.transaction('tasks', 'readwrite');
    for (const t of tasks) {
      if (t.isDeleted) {
        await tx.store.delete(t.id);
      } else {
        await tx.store.put(t);
      }
    }
    await tx.done;
  }

  public async replaceTasksForWorkspace(workspaceId: string, tasks: Task[]): Promise<void> {
    const db = await this.ensureInitialized();
    const tx = db.transaction('tasks', 'readwrite');
    const index = tx.store.index('by_workspace');
    let cursor = await index.openCursor(workspaceId);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    for (const t of tasks) {
      if (!t.isDeleted) {
        await tx.store.put(t);
      }
    }
    await tx.done;
  }

  public async saveTask(task: Task): Promise<void> {
    const db = await this.ensureInitialized();
    if (task.isDeleted) {
      await db.delete('tasks', task.id);
    } else {
      await db.put('tasks', task);
    }
  }

  public async getTasksByWorkspace(workspaceId: string): Promise<Task[]> {
    const db = await this.ensureInitialized();
    const tx = db.transaction('tasks', 'readonly');
    const index = tx.store.index('by_workspace');
    const tasks = await index.getAll(workspaceId);
    return tasks.filter((t) => !t.isDeleted);
  }

  public async getTask(taskId: string): Promise<Task | undefined> {
    const db = await this.ensureInitialized();
    return db.get('tasks', taskId);
  }

  public async deleteTask(taskId: string): Promise<void> {
    const db = await this.ensureInitialized();
    await db.delete('tasks', taskId);
  }

  // Comments
  public async saveComments(comments: Comment[]): Promise<void> {
    const db = await this.ensureInitialized();
    const tx = db.transaction('comments', 'readwrite');
    for (const c of comments) {
      if (c.isDeleted) {
        await tx.store.delete(c.id);
      } else {
        await tx.store.put(c);
      }
    }
    await tx.done;
  }

  public async replaceCommentsForWorkspace(workspaceId: string, comments: Comment[]): Promise<void> {
    const db = await this.ensureInitialized();
    const tx = db.transaction('comments', 'readwrite');
    const index = tx.store.index('by_workspace');
    let cursor = await index.openCursor(workspaceId);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    for (const c of comments) {
      if (!c.isDeleted) {
        await tx.store.put(c);
      }
    }
    await tx.done;
  }

  public async saveComment(comment: Comment): Promise<void> {
    const db = await this.ensureInitialized();
    if (comment.isDeleted) {
      await db.delete('comments', comment.id);
    } else {
      await db.put('comments', comment);
    }
  }

  public async getCommentsByWorkspace(workspaceId: string): Promise<Comment[]> {
    const db = await this.ensureInitialized();
    const tx = db.transaction('comments', 'readonly');
    const index = tx.store.index('by_workspace');
    const comments = await index.getAll(workspaceId);
    return comments.filter((c) => !c.isDeleted);
  }

  public async deleteComment(commentId: string): Promise<void> {
    const db = await this.ensureInitialized();
    await db.delete('comments', commentId);
  }

  // Pending Operations Queue
  public async savePendingOperation(op: PendingOperation): Promise<void> {
    const db = await this.ensureInitialized();
    await db.put('pending_operations', op);
  }

  public async getPendingOperations(workspaceId: string): Promise<PendingOperation[]> {
    const db = await this.ensureInitialized();
    const tx = db.transaction('pending_operations', 'readonly');
    const index = tx.store.index('by_workspace');
    const ops = await index.getAll(workspaceId);
    return ops.sort((a, b) => a.timestamp - b.timestamp);
  }

  public async removePendingOperation(opId: string): Promise<void> {
    const db = await this.ensureInitialized();
    await db.delete('pending_operations', opId);
  }

  public async clearPendingOperations(workspaceId: string): Promise<void> {
    const db = await this.ensureInitialized();
    const ops = await this.getPendingOperations(workspaceId);
    const tx = db.transaction('pending_operations', 'readwrite');
    for (const op of ops) {
      await tx.store.delete(op.opId);
    }
    await tx.done;
  }

  // Synchronization Metadata
  public async saveSyncMetadata(metadata: SynchronizationMetadata): Promise<void> {
    const db = await this.ensureInitialized();
    await db.put('sync_metadata', metadata);
  }

  public async getSyncMetadata(workspaceId: string): Promise<SynchronizationMetadata | undefined> {
    const db = await this.ensureInitialized();
    return db.get('sync_metadata', workspaceId);
  }

  // Conflicts
  public async saveConflict(conflict: ConflictRecord): Promise<void> {
    const db = await this.ensureInitialized();
    await db.put('conflicts', conflict);
  }

  public async getConflicts(workspaceId: string): Promise<ConflictRecord[]> {
    const db = await this.ensureInitialized();
    const tx = db.transaction('conflicts', 'readonly');
    const index = tx.store.index('by_workspace');
    const conflicts = await index.getAll(workspaceId);
    return conflicts.filter((c) => c.status === 'unresolved');
  }

  public async resolveConflict(conflictId: string): Promise<void> {
    const db = await this.ensureInitialized();
    const conflict = await db.get('conflicts', conflictId);
    if (conflict) {
      conflict.status = 'resolved';
      await db.put('conflicts', conflict);
    }
  }

  public async clearAll(): Promise<void> {
    const db = await this.ensureInitialized();
    const tx = db.transaction(
      ['workspaces', 'tasks', 'comments', 'pending_operations', 'sync_metadata', 'conflicts'],
      'readwrite'
    );
    await Promise.all([
      tx.objectStore('workspaces').clear(),
      tx.objectStore('tasks').clear(),
      tx.objectStore('comments').clear(),
      tx.objectStore('pending_operations').clear(),
      tx.objectStore('sync_metadata').clear(),
      tx.objectStore('conflicts').clear(),
      tx.done,
    ]);
  }
}
