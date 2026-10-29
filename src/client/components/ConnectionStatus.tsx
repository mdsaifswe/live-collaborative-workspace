import React from 'react';
import { ConnectionState } from '../../shared/types';

interface ConnectionStatusProps {
  state: ConnectionState;
  details?: string;
  onReconnect?: () => void;
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  state,
  details,
  onReconnect,
}) => {
  const getLabel = () => {
    switch (state) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'reconnecting':
        return 'Reconnecting...';
      case 'syncing':
        return 'Syncing...';
      case 'offline':
        return 'Offline';
      case 'error':
        return 'Error';
      case 'disconnected':
        return 'Disconnected';
      default:
        return state;
    }
  };

  return (
    <div
      className="connection-badge"
      title={details || `Status: ${state}`}
      role="status"
      aria-live="polite"
    >
      <span className={`status-dot ${state}`} aria-hidden="true" />
      <span>{getLabel()}</span>
      {(state === 'disconnected' || state === 'error') && onReconnect && (
        <button
          onClick={onReconnect}
          className="btn btn-secondary"
          style={{ padding: '0.15rem 0.5rem', fontSize: '0.7rem', marginLeft: '0.3rem' }}
          aria-label="Retry connection"
        >
          Retry
        </button>
      )}
    </div>
  );
};
