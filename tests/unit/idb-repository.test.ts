import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IndexedDBRepository } from '../../src/client/core/idb-repository';
import { Task, PendingOperation } from '../../src/shared/types';

describe('IndexedDBRepository & Offline Persistence', () => {
  let repo: IndexedDBRepository;
  const wsId = 'ws-offline-test';

  beforeEach(async () => {
    repo = new IndexedDBRepository();
    await repo.clearAll();
  });

  it('persists tasks and queries by workspace index', async () => {
    const task: Task = {
      id: 'task-idb-1',
      workspaceId: wsId,
      title: 'Persisted in IndexedDB',
      description: 'Durable local cache',
      status: 'in_progress',
      priority: 'high',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: 'user-idb',
      version: 1,
    };

    await repo.saveTask(task);
    const retrieved = await repo.getTasksByWorkspace(wsId);
    expect(retrieved.length).toBe(1);
    expect(retrieved[0].title).toBe('Persisted in IndexedDB');
    expect(retrieved[0].status).toBe('in_progress');
  });

  it('persists durable pending-operation queue', async () => {
    const op: PendingOperation = {
      opId: 'op-offline-1',
      workspaceId: wsId,
      type: 'task.create',
      entityId: 'task-offline-1',
      entityType: 'task',
      payload: { title: 'Queued while offline' },
      timestamp: Date.now(),
      status: 'pending',
      retryCount: 0,
    };

    await repo.savePendingOperation(op);
    const pending = await repo.getPendingOperations(wsId);
    expect(pending.length).toBe(1);
    expect(pending[0].opId).toBe('op-offline-1');
    expect(pending[0].status).toBe('pending');

    // Remove after ack
    await repo.removePendingOperation('op-offline-1');
    const remaining = await repo.getPendingOperations(wsId);
    expect(remaining.length).toBe(0);
  });

  it('saves and updates sync metadata revision', async () => {
    await repo.saveSyncMetadata({
      workspaceId: wsId,
      lastServerRevision: 42,
      lastSyncTimestamp: 1700000000,
    });

    const meta = await repo.getSyncMetadata(wsId);
    expect(meta).toBeDefined();
    expect(meta?.lastServerRevision).toBe(42);
  });
});
