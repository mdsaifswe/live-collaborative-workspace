import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import {
  Task,
  Comment,
  Presence,
  User,
  PendingOperation,
  ConflictRecord,
  ConnectionState,
  Workspace,
  TaskStatus,
  TaskPriority,
} from '../../shared/types';
import { SyncOrchestrator } from '../core/sync-orchestrator';
import { ConnectionManager } from '../core/connection-manager';
import { IndexedDBRepository } from '../core/idb-repository';
import { SERVER_PORT } from '../../shared/constants';

export interface TaskFilterState {
  searchQuery: string;
  statusFilter: TaskStatus | 'all';
  priorityFilter: TaskPriority | 'all';
}

interface WorkspaceContextValue {
  workspace: Workspace | null;
  tasks: Task[];
  filteredTasks: Task[];
  comments: Comment[];
  presences: Presence[];
  pendingOps: PendingOperation[];
  conflicts: ConflictRecord[];
  connectionState: ConnectionState;
  connectionDetails?: string;
  lastRevision: number;
  currentUser: User;
  filters: TaskFilterState;
  setFilters: React.Dispatch<React.SetStateAction<TaskFilterState>>;
  createTask: (task: Omit<Task, 'workspaceId' | 'version' | 'createdAt' | 'updatedAt' | 'isDeleted'>) => Promise<string>;
  updateTask: (taskId: string, changes: Partial<Task>) => Promise<string>;
  deleteTask: (taskId: string) => Promise<string>;
  createComment: (taskId: string, content: string) => Promise<string>;
  deleteComment: (commentId: string) => Promise<string>;
  resolveConflict: (conflictId: string, resolution: 'client' | 'server') => Promise<void>;
  updatePresence: (activeTaskId?: string) => void;
  clearLocalData: (options?: { resetServer?: boolean }) => Promise<void>;
  reconnect: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

// Deterministic or stored test user
function getOrCreateUser(): User {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('collab_user') : null;
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      // Ignored
    }
  }

  const colors = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#3b82f6', '#8b5cf6'];
  const names = ['Alex', 'Taylor', 'Jordan', 'Sam', 'Morgan', 'Casey'];
  const randIdx = Math.floor(Math.random() * names.length);
  const user: User = {
    id: `usr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    name: names[randIdx],
    color: colors[randIdx],
  };

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('collab_user', JSON.stringify(user));
  }
  return user;
}

export const WorkspaceProvider: React.FC<{
  children: React.ReactNode;
  workspaceId?: string;
  serverUrl?: string;
}> = ({ children, workspaceId: propWorkspaceId, serverUrl: propServerUrl }) => {
  const [currentUser] = useState<User>(getOrCreateUser);

  const getSearchParam = (key: string): string | null => {
    if (typeof window === 'undefined') return null;
    try {
      return new URLSearchParams(window.location.search).get(key);
    } catch {
      return null;
    }
  };

  const effectiveWorkspaceId =
    getSearchParam('workspaceId') ||
    (typeof window !== 'undefined' && (window as unknown as { __COLLAB_WS_ID__?: string }).__COLLAB_WS_ID__) ||
    propWorkspaceId ||
    'default-workspace';

  const effectiveServerUrl =
    getSearchParam('wsUrl') ||
    (typeof window !== 'undefined' && (window as unknown as { __COLLAB_WS_URL__?: string }).__COLLAB_WS_URL__) ||
    propServerUrl ||
    `ws://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:${SERVER_PORT}`;

  const [orchestrator, setOrchestrator] = useState<SyncOrchestrator | null>(null);
  const [cm, setCm] = useState<ConnectionManager | null>(null);

  const [state, setState] = useState<{
    workspace: Workspace | null;
    tasks: Task[];
    comments: Comment[];
    presences: Presence[];
    pendingOps: PendingOperation[];
    conflicts: ConflictRecord[];
    connectionState: ConnectionState;
    connectionDetails?: string;
    lastRevision: number;
  }>({
    workspace: null,
    tasks: [],
    comments: [],
    presences: [],
    pendingOps: [],
    conflicts: [],
    connectionState: 'connecting',
    lastRevision: 0,
  });

  const [filters, setFilters] = useState<TaskFilterState>({
    searchQuery: '',
    statusFilter: 'all',
    priorityFilter: 'all',
  });

  useEffect(() => {
    const connectionMgr = new ConnectionManager({ url: effectiveServerUrl });
    const idbRepo = new IndexedDBRepository();
    const syncOrch = new SyncOrchestrator(connectionMgr, idbRepo, currentUser, effectiveWorkspaceId);

    setCm(connectionMgr);
    setOrchestrator(syncOrch);

    const unsubscribe = syncOrch.subscribe((updated) => {
      setState(updated);
    });

    if (typeof window !== 'undefined') {
      (window as unknown as { __collab_bench?: unknown }).__collab_bench = {
        syncOrchestrator: syncOrch,
        connectionManager: connectionMgr,
        submitTaskCreate: async (
          task: Omit<Task, 'workspaceId' | 'version' | 'createdAt' | 'updatedAt' | 'isDeleted'>,
          customOpId?: string
        ) => {
          const startMonoTime = performance.timeOrigin + performance.now();
          const opId = await syncOrch.createTask(task, customOpId);
          return { opId, startMonoTime };
        },
        submitTaskUpdate: async (
          taskId: string,
          changes: Partial<Task>,
          customOpId?: string
        ) => {
          const startMonoTime = performance.timeOrigin + performance.now();
          const opId = await syncOrch.updateTask(taskId, changes, customOpId);
          return { opId, startMonoTime };
        },
        submitCommentCreate: async (
          taskId: string,
          content: string,
          customOpId?: string
        ) => {
          const startMonoTime = performance.timeOrigin + performance.now();
          const opId = await syncOrch.createComment(taskId, content, customOpId);
          return { opId, startMonoTime };
        },
        getState: () => syncOrch.getState(),
      };
    }

    syncOrch.initialize();

    return () => {
      if (typeof window !== 'undefined') {
        delete (window as unknown as { __collab_bench?: unknown }).__collab_bench;
      }
      unsubscribe();
      syncOrch.destroy();
      connectionMgr.disconnect();
    };
  }, [effectiveWorkspaceId, effectiveServerUrl, currentUser]);

  const filteredTasks = useMemo(() => {
    return state.tasks.filter((task) => {
      if (task.isDeleted) return false;
      if (filters.statusFilter !== 'all' && task.status !== filters.statusFilter) return false;
      if (filters.priorityFilter !== 'all' && task.priority !== filters.priorityFilter) return false;
      if (filters.searchQuery.trim()) {
        const query = filters.searchQuery.toLowerCase();
        const matchesTitle = task.title.toLowerCase().includes(query);
        const matchesDesc = task.description.toLowerCase().includes(query);
        if (!matchesTitle && !matchesDesc) return false;
      }
      return true;
    });
  }, [state.tasks, filters]);

  const createTask = useCallback(async (
    task: Omit<Task, 'workspaceId' | 'version' | 'createdAt' | 'updatedAt' | 'isDeleted'>
  ) => {
    if (!orchestrator) throw new Error('Not initialized');
    return orchestrator.createTask(task);
  }, [orchestrator]);

  const updateTask = useCallback(async (taskId: string, changes: Partial<Task>) => {
    if (!orchestrator) throw new Error('Not initialized');
    return orchestrator.updateTask(taskId, changes);
  }, [orchestrator]);

  const deleteTask = useCallback(async (taskId: string) => {
    if (!orchestrator) throw new Error('Not initialized');
    return orchestrator.deleteTask(taskId);
  }, [orchestrator]);

  const createComment = useCallback(async (taskId: string, content: string) => {
    if (!orchestrator) throw new Error('Not initialized');
    return orchestrator.createComment(taskId, content);
  }, [orchestrator]);

  const deleteComment = useCallback(async (commentId: string) => {
    if (!orchestrator) throw new Error('Not initialized');
    return orchestrator.deleteComment(commentId);
  }, [orchestrator]);

  const resolveConflict = useCallback(async (conflictId: string, res: 'server' | 'client') => {
    if (!orchestrator) throw new Error('Not initialized');
    return orchestrator.resolveConflict(conflictId, res);
  }, [orchestrator]);

  const updatePresence = useCallback((activeTaskId?: string) => {
    if (orchestrator) orchestrator.updatePresence(activeTaskId);
  }, [orchestrator]);

  const clearLocalData = useCallback(async (options?: { resetServer?: boolean }) => {
    if (!orchestrator) return;
    if (options?.resetServer) {
      try {
        const httpUrl = effectiveServerUrl.replace(/^ws(s)?:\/\//, 'http$1://');
        await fetch(`${httpUrl}/api/test/reset`, { method: 'POST' });
      } catch (err) {
        console.warn('[WorkspaceContext] Server reset request failed:', err);
      }
    }
    await orchestrator.clearLocalData();
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem('collab_user');
      } catch {
        // Ignore
      }
    }
  }, [orchestrator, effectiveServerUrl]);

  const reconnect = useCallback(() => {
    if (cm) cm.connect();
  }, [cm]);

  const value = useMemo<WorkspaceContextValue>(() => ({
    workspace: state.workspace,
    tasks: state.tasks,
    filteredTasks,
    comments: state.comments,
    presences: state.presences,
    pendingOps: state.pendingOps,
    conflicts: state.conflicts,
    connectionState: state.connectionState,
    connectionDetails: state.connectionDetails,
    lastRevision: state.lastRevision,
    currentUser,
    filters,
    setFilters,
    createTask,
    updateTask,
    deleteTask,
    createComment,
    deleteComment,
    resolveConflict,
    updatePresence,
    clearLocalData,
    reconnect,
  }), [
    state,
    filteredTasks,
    currentUser,
    filters,
    createTask,
    updateTask,
    deleteTask,
    createComment,
    deleteComment,
    resolveConflict,
    updatePresence,
    clearLocalData,
    reconnect,
  ]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}
