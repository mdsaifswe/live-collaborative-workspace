import { Task, Comment, ConflictRecord } from './types';

export interface FieldMergeResult<T> {
  merged: T;
  hasConflict: boolean;
  conflictingFields: string[];
}

/**
 * Three-way field level merge for Tasks.
 * base: common ancestor before divergent edits
 * current: authoritative server state
 * proposed: client's optimistic changes
 */
export function mergeTaskFields(
  base: Task | null,
  current: Task,
  proposed: Partial<Task>
): FieldMergeResult<Task> {
  const merged: Task = { ...current };
  const conflictingFields: string[] = [];

  const candidateFields: (keyof Task)[] = [
    'title',
    'description',
    'status',
    'priority',
    'assigneeId',
    'dueDate',
  ];

  for (const field of candidateFields) {
    if (proposed[field] === undefined) {
      continue;
    }

    const baseVal = base ? base[field] : undefined;
    const currentVal = current[field];
    const proposedVal = proposed[field];

    // If proposed didn't change this field relative to base, keep current
    if (base && baseVal === proposedVal) {
      continue;
    }

    // If current didn't change relative to base, apply proposed safely
    if (base && baseVal === currentVal) {
      (merged as unknown as Record<string, unknown>)[field] = proposedVal;
      continue;
    }

    // If both changed to the EXACT same value, clean merge
    if (currentVal === proposedVal) {
      continue;
    }

    // Both changed to different values -> field conflict
    conflictingFields.push(field);
    // Default server authoritative for conflicting fields until resolved
    (merged as unknown as Record<string, unknown>)[field] = currentVal;
  }

  return {
    merged,
    hasConflict: conflictingFields.length > 0,
    conflictingFields,
  };
}

/**
 * Creates a structured ConflictRecord when concurrent modifications overlap
 */
export function createConflictRecord(
  workspaceId: string,
  entityType: 'task' | 'comment',
  entityId: string,
  clientValue: Partial<Task> | Partial<Comment>,
  serverValue: Task | Comment
): ConflictRecord {
  return {
    conflictId: `conflict-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    workspaceId,
    entityType,
    entityId,
    clientValue,
    serverValue,
    detectedAt: Date.now(),
    status: 'unresolved',
  };
}
