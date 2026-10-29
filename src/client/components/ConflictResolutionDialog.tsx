import React from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { AlertTriangle, Check, ArrowRight } from 'lucide-react';
import { Task } from '../../shared/types';

export const ConflictResolutionDialog: React.FC = () => {
  const { conflicts, resolveConflict } = useWorkspace();

  if (conflicts.length === 0) return null;

  const activeConflict = conflicts[0];
  const clientVal = activeConflict.clientValue as Partial<Task>;
  const serverVal = activeConflict.serverValue as Task;

  return (
    <div
      className="modal-backdrop"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="conflict-dialog-title"
      aria-describedby="conflict-dialog-desc"
    >
      <div className="modal-content" style={{ maxWidth: '680px', border: '1px solid #f59e0b' }}>
        <div className="modal-header" style={{ borderBottomColor: 'rgba(245, 158, 11, 0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#f59e0b' }}>
            <AlertTriangle size={20} />
            <h2 id="conflict-dialog-title" style={{ fontSize: '1.15rem' }}>
              Concurrent Modification Conflict
            </h2>
          </div>
        </div>

        <div className="modal-body">
          <p id="conflict-dialog-desc" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Another collaborator modified this task while your update was in-flight. Choose which version you would like to keep.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '1rem',
              marginTop: '0.5rem',
            }}
          >
            {/* Server Authoritative */}
            <div
              style={{
                padding: '1rem',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
              }}
            >
              <div
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  color: '#10b981',
                  marginBottom: '0.5rem',
                  textTransform: 'uppercase',
                }}
              >
                Server Version (v{serverVal.version})
              </div>
              <h4 style={{ fontSize: '0.95rem', marginBottom: '0.3rem' }}>{serverVal.title}</h4>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {serverVal.description || 'No description'}
              </p>
              <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                Status: <strong>{serverVal.status}</strong> • Priority: <strong>{serverVal.priority}</strong>
              </div>
            </div>

            {/* Client Proposed */}
            <div
              style={{
                padding: '1rem',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(99, 102, 241, 0.08)',
                border: '1px solid rgba(99, 102, 241, 0.25)',
              }}
            >
              <div
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  color: 'var(--accent-primary)',
                  marginBottom: '0.5rem',
                  textTransform: 'uppercase',
                }}
              >
                Your Proposed Version
              </div>
              <h4 style={{ fontSize: '0.95rem', marginBottom: '0.3rem' }}>
                {clientVal.title || serverVal.title}
              </h4>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {clientVal.description ?? serverVal.description ?? 'No description'}
              </p>
              <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                Status: <strong>{clientVal.status || serverVal.status}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button
            onClick={() => resolveConflict(activeConflict.conflictId, 'server')}
            className="btn btn-secondary"
            id="btn-keep-server"
          >
            <Check size={14} />
            <span>Accept Server Version</span>
          </button>
          <button
            onClick={() => resolveConflict(activeConflict.conflictId, 'client')}
            className="btn btn-primary"
            id="btn-overwrite-client"
          >
            <ArrowRight size={14} />
            <span>Overwrite with My Changes</span>
          </button>
        </div>
      </div>
    </div>
  );
};
