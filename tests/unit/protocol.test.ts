import { describe, it, expect } from 'vitest';
import { validateClientCommand } from '../../src/shared/protocol';

describe('Protocol Validation', () => {
  it('rejects non-object messages', () => {
    expect(validateClientCommand(null).valid).toBe(false);
    expect(validateClientCommand('string').valid).toBe(false);
    expect(validateClientCommand(123).valid).toBe(false);
  });

  it('rejects commands without a type', () => {
    const res = validateClientCommand({ workspaceId: 'ws-1' });
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Missing or invalid command type');
  });

  it('rejects unknown command types', () => {
    const res = validateClientCommand({ type: 'unknown.action' });
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Unknown command type');
  });

  it('validates workspace.subscribe correctly', () => {
    const invalid = validateClientCommand({ type: 'workspace.subscribe' });
    expect(invalid.valid).toBe(false);

    const valid = validateClientCommand({
      type: 'workspace.subscribe',
      workspaceId: 'ws-test',
      user: { id: 'u1', name: 'Alice', color: '#ff0000' },
    });
    expect(valid.valid).toBe(true);
    expect(valid.command?.type).toBe('workspace.subscribe');
  });

  it('validates task.create correctly', () => {
    const valid = validateClientCommand({
      type: 'task.create',
      opId: 'op-1',
      workspaceId: 'ws-test',
      task: {
        id: 't-1',
        title: 'New Task',
        description: 'Details',
        status: 'todo',
        priority: 'medium',
        createdBy: 'u1',
      },
    });
    expect(valid.valid).toBe(true);
  });

  it('validates task.update requiring opId and taskId', () => {
    const missingTaskId = validateClientCommand({
      type: 'task.update',
      opId: 'op-2',
      changes: { title: 'Updated' },
    });
    expect(missingTaskId.valid).toBe(false);

    const valid = validateClientCommand({
      type: 'task.update',
      opId: 'op-2',
      workspaceId: 'ws-test',
      taskId: 't-1',
      changes: { title: 'Updated' },
      expectedVersion: 1,
    });
    expect(valid.valid).toBe(true);
  });
});
