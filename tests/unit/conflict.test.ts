import { describe, it, expect } from 'vitest';
import { mergeTaskFields, createConflictRecord } from '../../src/shared/conflict';
import { Task } from '../../src/shared/types';

describe('Conflict Handling & Deterministic 3-Way Merge', () => {
  const baseTask: Task = {
    id: 't-1',
    workspaceId: 'ws-1',
    title: 'Original Title',
    description: 'Original Description',
    status: 'todo',
    priority: 'medium',
    createdAt: 1000,
    updatedAt: 1000,
    createdBy: 'u1',
    version: 1,
  };

  it('merges non-overlapping concurrent changes cleanly', () => {
    // Current server state: user B updated status to 'in_progress'
    const serverTask: Task = {
      ...baseTask,
      status: 'in_progress',
      version: 2,
    };

    // Client proposed: user A updated description only
    const clientChanges: Partial<Task> = {
      description: 'New Description added while offline',
    };

    const result = mergeTaskFields(baseTask, serverTask, clientChanges);

    expect(result.hasConflict).toBe(false);
    expect(result.conflictingFields.length).toBe(0);
    // Both modifications are retained
    expect(result.merged.status).toBe('in_progress');
    expect(result.merged.description).toBe('New Description added while offline');
  });

  it('detects conflict when both users edit the same field differently', () => {
    // Current server state: user B updated title
    const serverTask: Task = {
      ...baseTask,
      title: 'Server Title Update',
      version: 2,
    };

    // Client proposed: user A also updated title to something else
    const clientChanges: Partial<Task> = {
      title: 'Client Title Update',
    };

    const result = mergeTaskFields(baseTask, serverTask, clientChanges);

    expect(result.hasConflict).toBe(true);
    expect(result.conflictingFields).toContain('title');
    // In conflict, authoritative server value is preserved until resolved
    expect(result.merged.title).toBe('Server Title Update');
  });

  it('creates structured conflict record for inspection', () => {
    const record = createConflictRecord(
      'ws-1',
      'task',
      't-1',
      { title: 'Client Proposed' },
      baseTask
    );

    expect(record.conflictId).toBeDefined();
    expect(record.status).toBe('unresolved');
    expect(record.entityId).toBe('t-1');
  });
});
