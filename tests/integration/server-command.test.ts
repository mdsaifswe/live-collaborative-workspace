import { describe, it, expect, beforeEach } from 'vitest';
import { AuthoritativeStore } from '../../src/server/store';

describe('AuthoritativeStore & Command Handling', () => {
  let store: AuthoritativeStore;
  const wsId = 'test-ws';

  beforeEach(() => {
    store = new AuthoritativeStore();
    store.getOrCreateWorkspace(wsId, 'Test Workspace');
  });

  it('creates task, assigns version 1 and increments workspace revision', () => {
    const res = store.createTask(
      'op-task-1',
      wsId,
      {
        id: 't-100',
        title: 'Distributed Testing',
        description: 'Implement full test coverage',
        status: 'todo',
        priority: 'high',
        createdBy: 'user-1',
      },
      'user-1'
    );

    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.task.version).toBe(1);
    expect(res.task.isDeleted).toBe(false);
    expect(res.ack.revision).toBeGreaterThan(0);
    expect(res.event.type).toBe('task.created');
  });

  it('is idempotent: duplicate opId returns previous ack without re-executing', () => {
    const res1 = store.createTask(
      'op-idempotent-1',
      wsId,
      {
        id: 't-idem',
        title: 'Idempotency Check',
        description: 'Verify opId dedup',
        status: 'todo',
        priority: 'low',
        createdBy: 'user-1',
      },
      'user-1'
    );
    expect(res1.success).toBe(true);

    const res2 = store.createTask(
      'op-idempotent-1', // same opId
      wsId,
      {
        id: 't-idem',
        title: 'Idempotency Check',
        description: 'Verify opId dedup',
        status: 'todo',
        priority: 'low',
        createdBy: 'user-1',
      },
      'user-1'
    );
    expect(res2.success).toBe(true);
    if (res1.success && res2.success) {
      expect(res2.ack.revision).toBe(res1.ack.revision);
      expect(res2.ack.serverTimestamp).toBe(res1.ack.serverTimestamp);
    }
  });

  it('updates task with version concurrency check and increments version', () => {
    store.createTask(
      'op-create',
      wsId,
      {
        id: 't-concurrency',
        title: 'Initial',
        description: 'Initial Desc',
        status: 'todo',
        priority: 'medium',
        createdBy: 'user-1',
      },
      'user-1'
    );

    const updateRes = store.updateTask(
      'op-update-1',
      wsId,
      't-concurrency',
      { status: 'in_progress' },
      1, // expected version
      'user-1'
    );

    expect(updateRes.success).toBe(true);
    if (!updateRes.success) return;
    expect(updateRes.task.version).toBe(2);
    expect(updateRes.task.status).toBe('in_progress');
  });

  it('rejects update if entity is deleted', () => {
    store.createTask(
      'op-create-del',
      wsId,
      {
        id: 't-del',
        title: 'To Be Deleted',
        description: '',
        status: 'todo',
        priority: 'low',
        createdBy: 'user-1',
      },
      'user-1'
    );

    store.deleteTask('op-del-1', wsId, 't-del', 1, 'user-1');

    const updateAttempt = store.updateTask(
      'op-update-after-del',
      wsId,
      't-del',
      { title: 'Revive attempt' },
      1,
      'user-2'
    );

    expect(updateAttempt.success).toBe(false);
    if (!updateAttempt.success) {
      expect(updateAttempt.code).toBe('DELETED');
    }
  });

  it('creates and retrieves comments attached to tasks', () => {
    store.createTask(
      'op-create-t',
      wsId,
      {
        id: 't-parent',
        title: 'Parent Task',
        description: 'Desc',
        status: 'todo',
        priority: 'medium',
        createdBy: 'user-1',
      },
      'user-1'
    );

    const commentRes = store.createComment(
      'op-c-1',
      wsId,
      {
        id: 'c-100',
        taskId: 't-parent',
        content: 'Reviewing implementation now',
        authorId: 'user-2',
        authorName: 'Bob',
      },
      'user-2'
    );

    expect(commentRes.success).toBe(true);
    if (!commentRes.success) return;
    expect(commentRes.comment.content).toBe('Reviewing implementation now');
    expect(commentRes.comment.version).toBe(1);

    const snap = store.getSnapshot(wsId);
    expect(snap.comments.length).toBe(1);
    expect(snap.comments[0].id).toBe('c-100');
  });

  it('tracks missed events for reconnecting clients', () => {
    const revBefore = store.getCurrentRevision(wsId);

    store.createTask(
      'op-missed-1',
      wsId,
      {
        id: 't-m1',
        title: 'Missed Task 1',
        description: '',
        status: 'todo',
        priority: 'low',
        createdBy: 'user-1',
      },
      'user-1'
    );

    store.createTask(
      'op-missed-2',
      wsId,
      {
        id: 't-m2',
        title: 'Missed Task 2',
        description: '',
        status: 'todo',
        priority: 'low',
        createdBy: 'user-1',
      },
      'user-1'
    );

    const missed = store.getMissedEvents(wsId, revBefore);
    expect(missed.length).toBe(2);
    expect(missed[0].type).toBe('task.created');
    expect(missed[1].type).toBe('task.created');
  });
});
