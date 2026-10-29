import React from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { ConnectionStatus } from './ConnectionStatus';
import { CollaboratorList } from './CollaboratorList';
import { Layers, Plus, Terminal } from 'lucide-react';

interface WorkspaceHeaderProps {
  onOpenCreateTask: () => void;
  onToggleDiagnostics: () => void;
}

export const WorkspaceHeader: React.FC<WorkspaceHeaderProps> = ({
  onOpenCreateTask,
  onToggleDiagnostics,
}) => {
  const {
    workspace,
    connectionState,
    connectionDetails,
    presences,
    currentUser,
    reconnect,
  } = useWorkspace();

  return (
    <header className="workspace-header">
      <div className="brand-section">
        <div className="brand-logo" aria-hidden="true">
          <Layers size={22} />
        </div>
        <div className="workspace-title-group">
          <h1>{workspace?.name || 'Collaborative Workspace'}</h1>
          <span className="workspace-subtitle">
            Real-time synchronized board • IDB durable
          </span>
        </div>
      </div>

      <div className="header-actions">
        <CollaboratorList presences={presences} currentUser={currentUser} />

        <ConnectionStatus
          state={connectionState}
          details={connectionDetails}
          onReconnect={reconnect}
        />

        <button
          onClick={onToggleDiagnostics}
          className="btn btn-secondary"
          title="Open Diagnostics Console"
          aria-label="Toggle Diagnostics Console"
        >
          <Terminal size={16} />
          <span style={{ display: 'none' }}>Console</span>
        </button>

        <button
          onClick={onOpenCreateTask}
          className="btn btn-primary"
          id="btn-new-task"
          aria-label="Create new task"
        >
          <Plus size={16} />
          <span>New Task</span>
        </button>
      </div>
    </header>
  );
};
