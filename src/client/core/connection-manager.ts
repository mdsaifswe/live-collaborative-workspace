import { ConnectionState } from '../../shared/types';
import { ClientCommand, ServerEvent } from '../../shared/protocol';
import {
  INITIAL_RECONNECT_DELAY_MS,
  MAX_RECONNECT_DELAY_MS,
  MAX_RECONNECT_ATTEMPTS,
  JITTER_FACTOR,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
} from '../../shared/constants';

export type StateChangeCallback = (state: ConnectionState, details?: string) => void;
export type MessageCallback = (event: ServerEvent) => void;

export interface ConnectionManagerOptions {
  url: string;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  maxAttempts?: number;
}

export class ConnectionManager {
  private url: string;
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isExplicitlyClosed = false;
  private lastActivityTime = Date.now();

  private stateListeners: Set<StateChangeCallback> = new Set();
  private messageListeners: Set<MessageCallback> = new Set();

  private initialBackoff: number;
  private maxBackoff: number;
  private maxAttempts: number;

  constructor(options: ConnectionManagerOptions) {
    this.url = options.url;
    this.initialBackoff = options.initialBackoffMs || INITIAL_RECONNECT_DELAY_MS;
    this.maxBackoff = options.maxBackoffMs || MAX_RECONNECT_DELAY_MS;
    this.maxAttempts = options.maxAttempts || MAX_RECONNECT_ATTEMPTS;

    this.setupWindowListeners();
  }

  private setupWindowListeners() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.info('[ConnectionManager] Browser transitioned ONLINE');
        if (this.state === 'offline' || this.state === 'disconnected') {
          this.reconnectAttempts = 0;
          this.connect();
        }
      });

      window.addEventListener('offline', () => {
        console.warn('[ConnectionManager] Browser transitioned OFFLINE');
        this.setState('offline', 'Network unavailable');
        this.cleanupSocket();
      });
    }
  }

  public getState(): ConnectionState {
    return this.state;
  }

  public onStateChange(listener: StateChangeCallback): () => void {
    this.stateListeners.add(listener);
    // Notify immediate initial state
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  public onMessage(listener: MessageCallback): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  private setState(newState: ConnectionState, details?: string) {
    if (this.state !== newState) {
      this.state = newState;
      this.stateListeners.forEach((cb) => cb(newState, details));
    }
  }

  public connect() {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.setState('offline', 'Cannot connect while offline');
      return;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isExplicitlyClosed = false;
    this.setState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    try {
      this.ws = new WebSocket(this.url);
      this.setupSocketHandlers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'WebSocket constructor failed';
      this.setState('error', msg);
      this.scheduleReconnect();
    }
  }

  private setupSocketHandlers() {
    if (!this.ws) return;

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState('connected');
      this.startHeartbeat();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.lastActivityTime = Date.now();
      try {
        const parsed: ServerEvent = JSON.parse(event.data);
        this.messageListeners.forEach((cb) => cb(parsed));
      } catch (err) {
        console.error('[ConnectionManager] Failed to parse incoming WebSocket message:', err);
      }
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.cleanupSocket();
      if (!this.isExplicitlyClosed) {
        this.setState('disconnected', `Closed: code=${event.code}`);
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (err: Event) => {
      console.warn('[ConnectionManager] Socket error event:', err);
      // Socket onclose will handle reconnect
    };
  }

  private startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    const interval = DEFAULT_HEARTBEAT_INTERVAL_MS + Math.floor(Math.random() * 5000);
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        if (Date.now() - this.lastActivityTime < DEFAULT_HEARTBEAT_INTERVAL_MS) {
          return;
        }
        this.send({
          type: 'heartbeat.ping',
          clientTime: Date.now(),
        });
      }
    }, interval);
  }

  public calculateBackoffDelay(attempt: number): number {
    const exponential = Math.min(this.maxBackoff, this.initialBackoff * Math.pow(2, attempt));
    const jitter = exponential * JITTER_FACTOR * (Math.random() * 2 - 1);
    return Math.max(this.initialBackoff, Math.round(exponential + jitter));
  }

  private scheduleReconnect() {
    if (this.isExplicitlyClosed) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.setState('offline', 'Network is offline');
      return;
    }

    if (this.reconnectAttempts >= this.maxAttempts) {
      this.setState('error', `Exceeded maximum reconnection attempts (${this.maxAttempts})`);
      return;
    }

    const delay = this.calculateBackoffDelay(this.reconnectAttempts);
    this.reconnectAttempts++;
    this.setState('reconnecting', `Attempt ${this.reconnectAttempts} in ${delay}ms`);

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  public send(command: ClientCommand): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.lastActivityTime = Date.now();
    this.ws.send(JSON.stringify(command));
    return true;
  }

  private cleanupSocket() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      try {
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch {
        // Ignored
      }
      this.ws = null;
    }
  }

  public disconnect() {
    this.isExplicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanupSocket();
    this.setState('disconnected', 'Manually disconnected');
  }

  public setSyncing(isSyncing: boolean) {
    if (isSyncing) {
      this.setState('syncing');
    } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.setState('connected');
    }
  }
}
