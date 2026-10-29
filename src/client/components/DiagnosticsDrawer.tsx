import React from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { X, RefreshCw, Trash2, Database, Activity, Check } from 'lucide-react';

interface DiagnosticsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DiagnosticsDrawer: React.FC<DiagnosticsDrawerProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    connectionState,
    connectionDetails,
    lastRevision,
    pendingOps,
    conflicts,
    currentUser,
    clearLocalData,
    reconnect,
  } = useWorkspace();

  const [purgeStatus, setPurgeStatus] = React.useState<'idle' | 'purging' | 'success'>('idle');
  const [reconnectStatus, setReconnectStatus] = React.useState<'idle' | 'reconnecting' | 'success'>('idle');

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handlePurge = async () => {
    if (purgeStatus === 'purging') return;
    try {
      setPurgeStatus('purging');
      await clearLocalData({ resetServer: true });
      setPurgeStatus('success');
      setTimeout(() => setPurgeStatus('idle'), 3000);
    } catch (err) {
      console.error('[DiagnosticsDrawer] Purge failed:', err);
      setPurgeStatus('idle');
    }
  };

  const handleReconnect = () => {
    setReconnectStatus('reconnecting');
    reconnect();
    setTimeout(() => {
      setReconnectStatus('success');
      setTimeout(() => setReconnectStatus('idle'), 2000);
    }, 400);
  };

  return (
    <aside
      className="modal-backdrop"
      style={{ justifyContent: 'flex-end', padding: 0 }}
      role="complementary"
      aria-label="Developer diagnostics console"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-content"
        style={{
          width: '450px',
          height: '100vh',
          maxHeight: '100vh',
          borderRadius: 0,
          display: 'flex',
          flexDirection: 'column',
          borderLeft: '1px solid var(--border-subtle)',
        }}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={18} color="var(--accent-primary)" />
            <h2 style={{ fontSize: '1.1rem' }}>Diagnostics & State</h2>
          </div>
          <button
            onClick={onClose}
            className="btn btn-secondary"
            style={{ padding: '0.3rem', borderRadius: '50%' }}
            aria-label="Close diagnostics console"
          >
            <X size={16} />
          </button>
        </div>

        <div className="modal-body" style={{ flex: 1, overflowY: 'auto' }}>
          {/* Metadata */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              padding: '0.85rem',
              background: 'rgba(255, 255, 255, 0.02)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.825rem',
            }}
          >
            <div>
              <strong>Current User:</strong> {currentUser.name} (<code>{currentUser.id}</code>)
            </div>
            <div>
              <strong>Connection State:</strong> <code>{connectionState}</code>
            </div>
            {connectionDetails && (
              <div>
                <strong>Details:</strong> {connectionDetails}
              </div>
            )}
            <div>
              <strong>Server Sequence / Revision:</strong> <code>{lastRevision}</code>
            </div>
            <div>
              <strong>Unresolved Conflicts:</strong> {conflicts.length}
            </div>
            <div>
              <strong>Pending In-Flight Ops:</strong> {pendingOps.length}
            </div>
          </div>

          {/* Pending Ops Queue */}
          <section style={{ marginTop: '1rem' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>
              Pending Operation Queue ({pendingOps.length})
            </h3>
            {pendingOps.length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                Queue empty. All operations synchronized.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {pendingOps.map((op) => (
                  <div
                    key={op.opId}
                    style={{
                      padding: '0.5rem',
                      borderRadius: 'var(--radius-sm)',
                      background: 'rgba(245, 158, 11, 0.08)',
                      border: '1px solid rgba(245, 158, 11, 0.25)',
                      fontSize: '0.75rem',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    <div>
                      <strong>{op.type}</strong> ({op.status})
                    </div>
                    <div style={{ color: 'var(--text-dim)' }}>ID: {op.opId}</div>
                    <div style={{ color: 'var(--text-dim)' }}>Entity: {op.entityId}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Actions */}
          <section style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600 }}>Simulation Controls</h3>
            <button
              onClick={handleReconnect}
              className="btn btn-secondary"
              id="btn-force-reconnect"
              disabled={reconnectStatus === 'reconnecting'}
            >
              <RefreshCw size={14} className={reconnectStatus === 'reconnecting' ? 'spin' : ''} />
              <span>
                {reconnectStatus === 'reconnecting'
                  ? 'Reconnecting...'
                  : reconnectStatus === 'success'
                  ? 'Reconnected ✓'
                  : 'Force Reconnect'}
              </span>
            </button>

            <button
              onClick={handlePurge}
              className="btn btn-danger"
              id="btn-purge-idb"
              disabled={purgeStatus === 'purging'}
            >
              {purgeStatus === 'purging' ? (
                <>
                  <RefreshCw size={14} className="spin" />
                  <span>Purging IndexedDB & Cache...</span>
                </>
              ) : purgeStatus === 'success' ? (
                <>
                  <Check size={14} />
                  <span>Purged Successfully!</span>
                </>
              ) : (
                <>
                  <Trash2 size={14} />
                  <span>Purge Local IndexedDB & Cache</span>
                </>
              )}
            </button>

            {purgeStatus === 'success' && (
              <div
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--state-connected)',
                  background: 'rgba(16, 185, 129, 0.1)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                <Check size={12} />
                <span>IndexedDB, local cache & board data wiped clean.</span>
              </div>
            )}
          </section>
        </div>

        <div className="modal-footer" style={{ fontSize: '0.75rem', color: 'var(--text-dim)', justifyContent: 'center' }}>
          <Database size={12} style={{ marginRight: '0.3rem' }} /> IndexedDB Store Active
        </div>
      </div>
    </aside>
  );
};
