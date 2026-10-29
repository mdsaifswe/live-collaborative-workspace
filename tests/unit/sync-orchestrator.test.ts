import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { SyncOrchestrator } from '../../src/client/core/sync-orchestrator';
import { ConnectionManager } from '../../src/client/core/connection-manager';
import { IndexedDBRepository } from '../../src/client/core/idb-repository';
import { User } from '../../src/shared/types';

describe('SyncOrchestrator & Optimistic Updates', () => {
  let cm: ConnectionManager;
  let idb: IndexedDBRepository;
  let orchestrator: SyncOrchestrator;

  const testUser: User = {
    id: 'user-sync-test',
    name: 'Sync Tester',
    color: '#3b82f6',
  };
  const wsId = 'ws-sync-unit';

  beforeEach(async () => {
    cm = new ConnectionManager({ url: 'ws://localhost:3001' });
    idb = new IndexedDBRepository();
    await idb.clearAll();

    orchestrator = new SyncOrchestrator(cm, idb, testUser, wsId);
    await orchestrator.initialize();
  });

  it('immediately applies optimistic task creation and queues in pendingOps', async () => {
    const opId = await orchestrator.createTask({
      id: 'task-opt-1',
      title: 'Optimistic Task',
      description: 'Instant local feedback',
      status: 'todo',
      priority: 'high',
      createdBy: testUser.id,
    });

    const state = orchestrator.getState();
    expect(state.tasks.length).toBe(1);
    expect(state.tasks[0].id).toBe('task-opt-1');
    expect(state.tasks[0].title).toBe('Optimistic Task');
    expect(state.pendingOps.length).toBe(1);
    expect(state.pendingOps[0].opId).toBe(opId);

    // Also persisted to IndexedDB
    const persistedOps = await idb.getPendingOperations(wsId);
    expect(persistedOps.length).toBe(1);
    expect(persistedOps[0].opId).toBe(opId);
  });

  it('updates task optimistically and records pending op', async () => {
    await orchestrator.createTask({
      id: 'task-opt-2',
      title: 'Initial Title',
      description: 'Desc',
      status: 'todo',
      priority: 'low',
      createdBy: testUser.id,
    });

    await orchestrator.updateTask('task-opt-2', {
      title: 'Updated Title Optimistically',
      status: 'in_progress',
    });

    const state = orchestrator.getState();
    const task = state.tasks.find((t) => t.id === 'task-opt-2');
    expect(task?.title).toBe('Updated Title Optimistically');
    expect(task?.status).toBe('in_progress');
  });
});
