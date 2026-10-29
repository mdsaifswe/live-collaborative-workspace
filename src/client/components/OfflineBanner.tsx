import React from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { WifiOff, RefreshCw } from 'lucide-react';

export const OfflineBanner: React.FC = () => {
  const { connectionState, pendingOps, reconnect } = useWorkspace();

  if (connectionState === 'connected') return null;

  const isOffline = connectionState === 'offline';
  const isReconnecting = connectionState === 'reconnecting';

  return (
    <aside
      className="offline-banner"
      role="alert"
      aria-live="assertive"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <WifiOff size={18} aria-hidden="true" />
        <span>
          {isOffline
            ? 'Network is offline. Changes are saved to IndexedDB and will synchronize upon reconnect.'
            : isReconnecting
            ? 'Reconnecting to collaboration server...'
            : `Connection interrupted (${connectionState}). Working locally.`}
        </span>
        {pendingOps.length > 0 && (
          <span className="pending-counter-badge">
            {pendingOps.length} pending mutation{pendingOps.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <button
        onClick={reconnect}
        className="btn btn-secondary"
        style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', backgroundColor: 'rgba(0,0,0,0.2)' }}
        aria-label="Retry connection now"
      >
        <RefreshCw size={14} />
        <span>Reconnect</span>
      </button>
    </aside>
  );
};
