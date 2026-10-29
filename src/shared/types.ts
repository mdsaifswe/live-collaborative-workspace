export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface User {
  id: string;
  name: string;
  avatarUrl?: string;
  color: string;
}

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceMember {
  userId: string;
  role: 'owner' | 'editor' | 'viewer';
  joinedAt: number;
}

export interface Task {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId?: string;
  dueDate?: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  version: number; // Entity revision for optimistic concurrency control
  isDeleted?: boolean; // Tombstone for deterministic deletion
}

export interface Comment {
  id: string;
  workspaceId: string;
  taskId: string;
  content: string;
  authorId: string;
  authorName: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  isDeleted?: boolean;
}

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'offline'
  | 'syncing'
  | 'error';

export interface PendingOperation<T = unknown> {
  opId: string;
  workspaceId: string;
  type: string;
  entityId: string;
  entityType: 'task' | 'comment';
  payload: T;
  expectedVersion?: number;
  timestamp: number;
  status: 'pending' | 'in-flight' | 'acknowledged' | 'rejected';
  retryCount: number;
  error?: string;
}

export interface ConflictRecord {
  conflictId: string;
  workspaceId: string;
  entityType: 'task' | 'comment';
  entityId: string;
  clientValue: Partial<Task> | Partial<Comment>;
  serverValue: Task | Comment;
  detectedAt: number;
  status: 'unresolved' | 'resolved';
  resolutionStrategy?: 'client-wins' | 'server-wins' | 'merged';
}

export interface Presence {
  userId: string;
  userName: string;
  userColor: string;
  activeTaskId?: string;
  lastSeen: number;
  statusText?: string;
}

export interface WorkspaceSnapshot {
  workspace: Workspace;
  tasks: Task[];
  comments: Comment[];
  revision: number; // Workspace sequence / revision number
  timestamp: number;
}

export interface SynchronizationMetadata {
  workspaceId: string;
  lastServerRevision: number;
  lastSyncTimestamp: number;
}
