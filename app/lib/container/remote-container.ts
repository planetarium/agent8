import type {
  Container,
  FileSystem,
  FileSystemTree,
  FileSystemWatcher,
  Unsubscribe,
  ContainerProcess,
  PathWatcherEvent,
  ShellSession,
  ConnectionStateListener,
} from './interfaces';
import type { ITerminal, IDisposable } from '~/types/terminal';
import { withResolvers } from '~/utils/promises';
import { cleanTerminalOutput, isNonTerminatingCommand } from '~/utils/shell';
import type {
  BufferEncoding,
  ContainerRequest,
  ContainerResponse,
  EventListeners,
  EventListenerMap,
  ProcessResponse,
  SpawnOptions,
  ShellOptions,
  ExecutionResult,
  WatchPathsOptions,
  WatchResponse,
} from '~/lib/shared/agent8-container-protocol/src';
import { v4 } from 'uuid';
import { createScopedLogger } from '~/utils/logger';
import { debounce } from '~/utils/debounce';
import { WebsocketBuilder, Websocket, RingQueue, ExponentialBackoff } from 'websocket-ts';
import { toast } from 'react-toastify';
import { ERROR_NAMES } from '~/utils/constants';
import { isAbortError, NoneError } from '~/utils/errors';

// Constants for OSC parsing
const OSC_PATTERNS = {
  createWaitCodeRegex: (waitCode: string) => new RegExp(`\\x1b\\]654;${waitCode}=?((-?\\d+):(\\d+))?\\x07`, 'g'),
  EXIT_CODE_REGEX: /\x1b\]654;exit=?((-?\d+):(\d+))?\x07/g,
  ALL_OSC_REGEX: /\x1b\]654;([^\x07=]+)=?((-?\d+):(\d+))?\x07/g,
};

// Buffer size configuration
const BUFFER_CONFIG = {
  MAX_GLOBAL_SIZE: 20000,
  TRUNCATED_GLOBAL_SIZE: 10000,
  MAX_LOCAL_SIZE: 10000,
  TRUNCATED_LOCAL_SIZE: 5000,
};

const STREAM_READ_IDLE_TIMEOUT_MS = 3000;

const ROUTER_DOMAIN = 'agent8.verse8.net';
const CONTAINER_AGENT_PROTOCOL = 'agent8-container-v1';
const TERMINAL_REATTACH_PROMPT_DELAY_MS = 100;
const MAX_TRANSFER_SIZE = 10 * 1024 * 1024; // 10MB - WebSocket transfer size limit
const logger = createScopedLogger('remote-container');

// Connection state enum
enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  FAILED = 'failed',
}

// Connection configuration interface
interface ConnectionConfig {
  maxReconnectAttempts: number;
  initialReconnectDelay: number;
  maxReconnectDelay: number;
  heartbeatInterval: number;
  heartbeatTimeout: number;
  queueCapacity: number;
}

function base64ToUint8Array(base64: string) {
  if (typeof Buffer !== 'undefined') {
    try {
      const result = new Uint8Array(Buffer.from(base64, 'base64'));

      return result;
    } catch {
      return new Uint8Array(0);
    }
  } else {
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);

      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      return bytes;
    } catch {
      return new Uint8Array(0);
    }
  }
}

/**
 * Class to manage remote WebSocket connection and communication with auto-reconnect
 */
class RemoteContainerConnection {
  private _ws: Websocket | null = null;
  private _state: ConnectionState = ConnectionState.DISCONNECTED;
  private _requestMap = new Map<
    string,
    { resolve: (value: any) => void; reject: (reason: any) => void; timestamp: number }
  >();
  private _connectionPromise: Promise<void> | null = null;
  private _heartbeatInterval: NodeJS.Timeout | null = null;
  private _heartbeatTimeout: NodeJS.Timeout | null = null;
  private _stateListeners = new Set<(state: ConnectionState, prev: ConnectionState) => void>();
  private _listeners: EventListeners = {
    port: new Set(),
    'server-ready': new Set(),
    'preview-message': new Set(),
    error: new Set(),
    'file-change': new Set(),
  };
  private _processListeners = new Map<string, Set<(data: any) => void>>();
  private _config: ConnectionConfig;

  private _reconnectAttempts: number = 0;
  private _maxAttemptsReached: boolean = false;
  private _networkStateListener: ((event: Event) => void) | null = null;

  // Fields for tracking state transitions
  private _stateChangeHistory: Array<{
    source: string;
    from: ConnectionState;
    to: ConnectionState;
    timestamp: number;
  }> = [];
  private _stateChangeFrequency = new Map<string, number>();

  constructor(
    private _serverUrl: string,
    private _token: string,
    config?: Partial<ConnectionConfig>,
  ) {
    this._config = {
      maxReconnectAttempts: 5,
      initialReconnectDelay: 1000,
      maxReconnectDelay: 30000,
      heartbeatInterval: 5000,
      heartbeatTimeout: 10000,
      queueCapacity: 50,
      ...config,
    };

    this._setupNetworkStateListener();
  }

  private _getWebSocketUrl(): string {
    const protocol = this._serverUrl.startsWith('https') ? 'wss' : 'ws';
    const baseUrl = this._serverUrl.replace(/^https?/, protocol);

    return baseUrl;
  }

  private _initializeWebSocket(): void {
    this._ws = new WebsocketBuilder(this._getWebSocketUrl())
      .withBuffer(new RingQueue(this._config.queueCapacity))
      .withBackoff(
        new ExponentialBackoff(
          this._config.initialReconnectDelay,
          4, // 4 doublings for 5 total attempts: 1s → 2s → 4s → 8s → 16s
        ),
      )
      .withProtocols([CONTAINER_AGENT_PROTOCOL])
      .onOpen((_ws, _ev) => this._handleOpen())
      .onClose((_ws, ev) => this._handleClose(ev))
      .onError((_ws, ev) => this._handleError(ev))
      .onMessage((_ws, ev) => this._handleMessage(ev.data))
      .onRetry((ws, _ev) => this._handleRetry(ws))
      .onReconnect((_ws, _ev) => this._handleReconnect())
      .build();
  }

  private _setState(newState: ConnectionState, source: string = 'unknown'): void {
    const prevState = this._state;

    if (prevState !== newState) {
      this._state = newState;

      const timestamp = Date.now();

      // Record state transition history
      this._stateChangeHistory.push({
        source,
        from: prevState,
        to: newState,
        timestamp,
      });

      // Clean up old history (keep only last 5 minutes)
      const fiveMinutesAgo = timestamp - 5 * 60 * 1000;
      this._stateChangeHistory = this._stateChangeHistory.filter((entry) => entry.timestamp > fiveMinutesAgo);

      // Analyze frequency
      this._analyzeStateChangeFrequency(source, timestamp);

      logger.info(`🔄 Connection state: ${prevState} → ${newState} (source: ${source})`);

      // Additional logging for frequent transition detection
      if (source === 'network-offline' || source === 'network-online' || source === 'heartbeat-timeout') {
        logger.warn(`⚠️  Frequent state change detected: ${source}`);
      }

      this._stateListeners.forEach((listener) => {
        try {
          listener(newState, prevState);
        } catch (error) {
          logger.error(`State listener error (source: ${source}):`, error);
        }
      });
    }
  }

  private _analyzeStateChangeFrequency(source: string, timestamp: number): void {
    const oneMinuteAgo = timestamp - 60 * 1000;

    // Calculate state transitions from the same source in the last minute
    const recentChanges = this._stateChangeHistory.filter(
      (entry) => entry.source === source && entry.timestamp > oneMinuteAgo,
    );

    if (recentChanges.length > 3) {
      logger.warn(`🚨 Excessive state changes detected!`);
      logger.warn(`📊 Source: ${source}, Count: ${recentChanges.length} in last minute`);
      logger.warn(
        `📝 Recent changes:`,
        recentChanges.map((entry) => `${entry.from} → ${entry.to} (${new Date(entry.timestamp).toLocaleTimeString()})`),
      );
    }

    // Analyze network state change patterns
    if (source === 'network-offline' || source === 'network-online') {
      const networkChanges = this._stateChangeHistory.filter(
        (entry) =>
          (entry.source === 'network-offline' || entry.source === 'network-online') && entry.timestamp > oneMinuteAgo,
      );

      if (networkChanges.length > 5) {
        logger.error(`🌐 Network instability detected! ${networkChanges.length} network state changes in last minute`);
        logger.error(
          `📊 Network change pattern:`,
          networkChanges.map((entry) => `${entry.source} at ${new Date(entry.timestamp).toLocaleTimeString()}`),
        );
      }
    }

    // Analyze heartbeat timeout patterns
    if (source === 'heartbeat-timeout') {
      const heartbeatTimeouts = this._stateChangeHistory.filter(
        (entry) => entry.source === 'heartbeat-timeout' && entry.timestamp > oneMinuteAgo,
      );

      if (heartbeatTimeouts.length > 2) {
        logger.error(`💓 Heartbeat timeout pattern detected! ${heartbeatTimeouts.length} timeouts in last minute`);
        logger.error(`📊 This may indicate server issues or unstable network connection`);
      }
    }
  }

  // Public method to query state transition history
  getStateChangeHistory(): Array<{
    source: string;
    from: ConnectionState;
    to: ConnectionState;
    timestamp: number;
  }> {
    return [...this._stateChangeHistory];
  }

  // Public method to query state transition statistics
  getStateChangeStats(): {
    totalChanges: number;
    sourceBreakdown: Record<string, number>;
    recentChanges: number;
  } {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const recentChanges = this._stateChangeHistory.filter((entry) => entry.timestamp > oneMinuteAgo);

    const sourceBreakdown: Record<string, number> = {};
    this._stateChangeHistory.forEach((entry) => {
      sourceBreakdown[entry.source] = (sourceBreakdown[entry.source] || 0) + 1;
    });

    return {
      totalChanges: this._stateChangeHistory.length,
      sourceBreakdown,
      recentChanges: recentChanges.length,
    };
  }

  private _handleOpen(): void {
    logger.info('📡 Container WebSocket connected');
    this._setState(ConnectionState.CONNECTED, 'websocket-open');
    this._startHeartbeat();

    this._reconnectAttempts = 0;
    this._maxAttemptsReached = false;

    // Send authentication token if available
    if (this._token) {
      this.sendRequest({
        id: 'auth-' + v4(),
        operation: {
          type: 'auth',
          token: this._token,
        },
      }).catch((error) => {
        logger.error('Authentication failed:', error);
      });
    }
  }

  private _handleClose(event: CloseEvent): void {
    logger.warn(`📡 Container WebSocket closed: ${event.code} - ${event.reason}`);

    // Don't change state if we've already reached max attempts (keep FAILED state)
    if (!this._maxAttemptsReached && this._state !== ConnectionState.FAILED) {
      this._setState(ConnectionState.DISCONNECTED, 'websocket-close');
    }

    this._stopHeartbeat();
    this._rejectPendingRequests('Connection closed');
  }

  private _handleError(event: Event): void {
    logger.error('📡 Container WebSocket error:', event);

    if (this._state === ConnectionState.CONNECTING) {
      this._setState(ConnectionState.FAILED, 'websocket-error');
    }
  }

  private _handleRetry(ws: Websocket): void {
    this._reconnectAttempts++;
    logger.info(
      `🔄 Container WebSocket retrying connection... (attempt ${this._reconnectAttempts}/${this._config.maxReconnectAttempts})`,
    );

    if (this._reconnectAttempts >= this._config.maxReconnectAttempts) {
      logger.error(
        `❌ Maximum reconnection attempts (${this._config.maxReconnectAttempts}) reached. Stopping reconnection.`,
      );
      this._maxAttemptsReached = true;
      this._setState(ConnectionState.FAILED, 'max-retries-reached');

      ws.close(3002, 'Maximum reconnection attempts reached');

      if (this._ws === ws) {
        this._ws = null;
        this._rejectPendingRequests('Maximum reconnection attempts reached');
        this._notifyError(new Error(`Connection failed after ${this._config.maxReconnectAttempts} attempts`));
      }

      return;
    }

    this._setState(ConnectionState.RECONNECTING, 'websocket-retry');
  }

  private _handleReconnect(): void {
    logger.info('✅ Container WebSocket reconnected successfully');
    this._setState(ConnectionState.CONNECTED, 'websocket-reconnect');
    this._startHeartbeat();

    this._reconnectAttempts = 0;
    this._maxAttemptsReached = false;
  }

  private _handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      if (message.id && this._requestMap.has(message.id)) {
        const { resolve, reject } = this._requestMap.get(message.id)!;
        this._requestMap.delete(message.id);

        if (message.success) {
          resolve(message);
        } else {
          reject(new Error(message.error?.message || 'Error processing request'));
        }
      } else {
        // Handle other message types (events, process data, etc.)
        this._handleEventMessage(message);
      }
    } catch (error) {
      logger.error('Failed to parse container message:', error);
    }
  }

  private _handleEventMessage(message: any): void {
    // Handle server events
    if (message.event) {
      switch (message.event) {
        case 'file-change':
          this._listeners['file-change'].forEach((listener) =>
            listener(message.data.watcherId, message.data.eventType, message.data.filename, message.data.buffer),
          );
          break;

        case 'error':
          this._notifyError(new Error(message.data?.message || 'Unknown error'));
          break;

        case 'process':
          {
            const { pid, data, stream } = message.data;
            const channel = `process:${pid}`;
            const listeners = this._processListeners.get(channel);

            if (listeners) {
              listeners.forEach((listener) => listener({ data, stream }));
            }
          }
          break;
      }
      return;
    }

    // Handle data type messages
    if (message.data?.data?.type) {
      const { data } = message.data.data;

      switch (message.data.data.type) {
        case 'port':
          this._listeners.port.forEach((listener) => listener(data.port, data.type, data.url));
          break;

        case 'server-ready':
          this._listeners['server-ready'].forEach((listener) => listener(data.port, data.url));
          break;

        case 'preview-message':
          this._listeners['preview-message'].forEach((listener) => listener(message.data));
          break;
      }

      return;
    }

    // Handle process messages
    if (message.type === 'process' && message.pid) {
      const channel = `process:${message.pid}`;
      const listeners = this._processListeners.get(channel);

      if (listeners) {
        listeners.forEach((listener) => listener(message));
      }
    } else if (message.type && this._listeners[message.type as keyof EventListeners]) {
      const listeners = this._listeners[message.type as keyof EventListeners];

      for (const listener of listeners) {
        try {
          (listener as any)(message);
        } catch (error) {
          logger.error('Event listener error:', error);
        }
      }
    }
  }

  private _startHeartbeat(): void {
    this._stopHeartbeat();
    this._heartbeatInterval = setInterval(async () => {
      await this._sendHeartbeat();
    }, this._config.heartbeatInterval);
  }

  private _stopHeartbeat(): void {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }

    if (this._heartbeatTimeout) {
      clearTimeout(this._heartbeatTimeout);
      this._heartbeatTimeout = null;
    }
  }

  private async _sendHeartbeat(): Promise<void> {
    if (this._state === ConnectionState.CONNECTED) {
      if (this._heartbeatTimeout) {
        logger.debug('💓 Heartbeat timeout already pending, skipping');
        return;
      }

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        logger.warn('🌐 Network is offline, skipping heartbeat');
        this._handleNetworkOffline();

        return;
      }

      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          this._heartbeatTimeout = setTimeout(() => {
            reject(new Error('Heartbeat timeout'));
          }, this._config.heartbeatTimeout);
        });

        const heartbeatPromise = this.sendRequest({
          id: `heartbeat-${v4()}`,
          operation: {
            type: 'heartbeat',
          },
        });
        await Promise.race([heartbeatPromise, timeoutPromise]);
      } catch (error) {
        logger.error('💓 Heartbeat send failed:', error);
        this._handleHeartbeatError();
      } finally {
        if (this._heartbeatTimeout) {
          clearTimeout(this._heartbeatTimeout);
          this._heartbeatTimeout = null;
        }
      }
    }
  }

  private _handleHeartbeatTimeout(): void {
    logger.warn('💓 Heartbeat timeout detected, connection may be lost');

    if (this._state === ConnectionState.CONNECTED) {
      this._setState(ConnectionState.DISCONNECTED, 'heartbeat-timeout');
      this._stopHeartbeat();
      this._rejectPendingRequests('Heartbeat timeout');

      if (!this._maxAttemptsReached) {
        this.connect().catch((error) => {
          logger.error('Failed to reconnect after heartbeat timeout:', error);
        });
      }
    }
  }

  private _handleHeartbeatError(): void {
    logger.error('💓 Heartbeat send failed, connection may be lost');
    this._handleHeartbeatTimeout();
  }

  private _rejectPendingRequests(reason: string): void {
    this._requestMap.forEach(({ reject }) => {
      reject(new Error(reason));
    });
    this._requestMap.clear();
  }

  async connect(): Promise<void> {
    if (this._state === ConnectionState.CONNECTING || this._state === ConnectionState.CONNECTED) {
      return;
    }

    this._reconnectAttempts = 0;
    this._maxAttemptsReached = false;

    if (this._connectionPromise) {
      await this._connectionPromise;
      return;
    }

    this._setState(ConnectionState.CONNECTING, 'manual-connect');

    if (this._ws?.readyState === WebSocket.OPEN) {
      this._setState(ConnectionState.CONNECTED, 'manual-connect');

      return;
    } else {
      this._initializeWebSocket();
    }

    // Wait until connection is complete
    const { promise, resolve, reject } = withResolvers<void>();
    this._connectionPromise = promise;

    const timeout = setTimeout(() => {
      reject(new Error('Connection timeout'));
    }, 10000);

    const unsubscribe = this.onStateChange((state) => {
      if (state === ConnectionState.CONNECTED) {
        clearTimeout(timeout);
        unsubscribe();
        this._connectionPromise = null;
        resolve();
      } else if (state === ConnectionState.FAILED) {
        clearTimeout(timeout);
        unsubscribe();
        this._connectionPromise = null;
        reject(new Error('Connection failed'));
      }
    });
  }

  async sendRequest<T>(request: ContainerRequest): Promise<ContainerResponse<T>> {
    if (!this._ws) {
      throw new Error('WebSocket not initialized');
    }

    return new Promise((resolve, reject) => {
      const requestWithId = { ...request, id: request.id || v4() };

      // Store request in map (for response waiting)
      this._requestMap.set(requestWithId.id, {
        resolve,
        reject,
        timestamp: Date.now(),
      });

      try {
        // websocket-ts automatically checks connection state and handles queuing
        this._ws!.send(JSON.stringify(requestWithId));
      } catch (error) {
        this._requestMap.delete(requestWithId.id);
        reject(error);
      }

      // Set request timeout
      setTimeout(() => {
        if (this._requestMap.has(requestWithId.id)) {
          this._requestMap.delete(requestWithId.id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  // Public API methods
  onStateChange(listener: (state: ConnectionState, prev: ConnectionState) => void): () => void {
    this._stateListeners.add(listener);
    return () => this._stateListeners.delete(listener);
  }

  get connectionState(): ConnectionState {
    return this._state;
  }

  get isConnected(): boolean {
    return this._state === ConnectionState.CONNECTED;
  }

  get reconnectAttempts(): number {
    return this._reconnectAttempts;
  }

  get maxReconnectAttempts(): number {
    return this._config.maxReconnectAttempts;
  }

  get maxAttemptsReached(): boolean {
    return this._maxAttemptsReached;
  }

  async disconnect(): Promise<void> {
    this._stopHeartbeat();
    this._cleanupNetworkStateListener();

    this._reconnectAttempts = 0;
    this._maxAttemptsReached = false;

    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }

    this._setState(ConnectionState.DISCONNECTED, 'manual-disconnect');
    this._rejectPendingRequests('Disconnected by user');
  }

  // Legacy API compatibility methods
  on<E extends keyof EventListenerMap>(event: E, listener: EventListenerMap[E]): Unsubscribe {
    if (this._listeners[event]) {
      this._listeners[event].add(listener as any);

      return () => {
        this._listeners[event].delete(listener as any);
      };
    }

    return () => {
      logger.warn('unregistered event:', 'on', event, listener.toString());
    };
  }

  onProcess(pid: number, listener: (data: any) => void): Unsubscribe {
    const channel = `process:${pid}`;

    if (!this._processListeners.has(channel)) {
      this._processListeners.set(channel, new Set());
    }

    this._processListeners.get(channel)!.add(listener);

    return () => {
      const listeners = this._processListeners.get(channel);

      if (listeners) {
        listeners.delete(listener);

        if (listeners.size === 0) {
          this._processListeners.delete(channel);
        }
      }
    };
  }

  private _notifyError(error: Error) {
    this._listeners.error.forEach((listener) => listener(error));
  }

  close() {
    this.disconnect();
    this._cleanupNetworkStateListener();

    // Output state transition statistics on shutdown
    const stats = this.getStateChangeStats();
    logger.info(`📊 Final connection stats:`, stats);

    // Clean up process listeners
    this._processListeners.clear();

    // Clean up history
    this._stateChangeHistory = [];
    this._stateChangeFrequency.clear();
  }

  private _setupNetworkStateListener(): void {
    if (typeof window !== 'undefined' && 'navigator' in window) {
      this._networkStateListener = (_event: Event) => {
        const isOnline = navigator.onLine;
        logger.info(`🌐 Network state changed: ${isOnline ? 'online' : 'offline'}`);

        if (!isOnline) {
          this._handleNetworkOffline();
        } else {
          this._handleNetworkOnline();
        }
      };

      window.addEventListener('online', this._networkStateListener);
      window.addEventListener('offline', this._networkStateListener);

      // Log initial network state
      logger.info(`🌐 Initial network state: ${navigator.onLine ? 'online' : 'offline'}`);
    }
  }

  private _handleNetworkOffline(): void {
    logger.warn('🌐 Network went offline - forcing disconnection');

    if (this._state === ConnectionState.CONNECTED) {
      this._setState(ConnectionState.DISCONNECTED, 'network-offline');
      this._stopHeartbeat();
      this._rejectPendingRequests('Network went offline');
    }
  }

  private _handleNetworkOnline(): void {
    logger.info('🌐 Network came back online - attempting reconnection');

    if (this._state === ConnectionState.DISCONNECTED && !this._maxAttemptsReached) {
      this.connect().catch((error) => {
        logger.error('Failed to reconnect after network restoration:', error);
      });
    }
  }

  private _cleanupNetworkStateListener(): void {
    if (this._networkStateListener && typeof window !== 'undefined') {
      window.removeEventListener('online', this._networkStateListener);
      window.removeEventListener('offline', this._networkStateListener);
      this._networkStateListener = null;
    }
  }
}

/**
 * Remote file system implementation
 */
export class RemoteContainerFileSystem implements FileSystem {
  constructor(private _connection: RemoteContainerConnection) {}

  async readFile(path: string): Promise<Uint8Array>;
  async readFile(path: string, encoding: BufferEncoding): Promise<string>;
  async readFile(path: string, encoding?: BufferEncoding): Promise<string | Uint8Array> {
    const response = await this._connection.sendRequest<{ content: string | Uint8Array }>({
      id: `readFile-${v4()}`,
      operation: {
        type: 'readFile',
        path,
        options: {
          encoding,
        },
      },
    });

    if (!response.success || !response.data) {
      throw new Error(response.error?.message || 'Failed to read file');
    }

    return response.data.content;
  }

  async writeFile(path: string, content: string | number[], options?: { encoding?: BufferEncoding }): Promise<void> {
    const requestId = `writeFile-${v4()}`;

    const response = await this._connection.sendRequest({
      id: requestId,
      operation: {
        type: 'writeFile',
        path,
        content,
        options,
      },
    });

    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to write file');
    }
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const response = await this._connection.sendRequest({
      id: `mkdir-${v4()}`,
      operation: {
        type: 'mkdir',
        path,
        options,
      },
    });

    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to create directory');
    }
  }

  async readdir(path: string, options?: { withFileTypes?: boolean }): Promise<any> {
    const response = await this._connection.sendRequest<{ entries: any[] }>({
      id: `readdir-${v4()}`,
      operation: {
        type: 'readdir',
        path,
        options,
      },
    });

    if (!response.success || !response.data) {
      throw new Error(response.error?.message || 'Failed to read directory');
    }

    return response.data.entries;
  }

  async rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void> {
    const response = await this._connection.sendRequest({
      id: `rm-${v4()}`,
      operation: {
        type: 'rm',
        path,
        options,
      },
    });

    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to delete file/directory');
    }
  }

  watch(pattern: string, options?: { persistent?: boolean }): FileSystemWatcher {
    const requestId = `watch-${v4()}`;
    let watcherIdFromResponse: string | undefined = undefined;

    // Send request
    this._connection
      .sendRequest<WatchResponse>({
        id: requestId,
        operation: {
          type: 'watch',
          options: {
            persistent: options?.persistent,
            patterns: [pattern],
          },
        },
      })
      .then((response) => {
        watcherIdFromResponse = response.data?.watcherId;
      })
      .catch((err) => {
        logger.error('Failed to watch file:', err);
      });

    const connection = this._connection;
    const unsubscribers: Unsubscribe[] = [];

    return {
      addEventListener(event: string, listener) {
        const unsubscribe = connection.on('file-change', (watcherId, eventType, filename, buffer) => {
          if (watcherId === watcherIdFromResponse) {
            const convertedBuffer = buffer ? base64ToUint8Array(buffer) : null;
            listener(eventType, filename, convertedBuffer);
          }
        });
        unsubscribers.push(unsubscribe);
      },
      close() {
        unsubscribers.forEach((unsubscribe) => unsubscribe());
      },
    };
  }

  watchPaths(options: WatchPathsOptions, callback: (events: PathWatcherEvent[]) => void): void {
    const requestId = `watch-paths-${v4()}`;
    let watcherIdFromResponse: string | undefined = undefined;

    this._connection
      .sendRequest<WatchResponse>({
        id: requestId,
        operation: {
          type: 'watch-paths',
          options,
        },
      })
      .then((response) => {
        watcherIdFromResponse = response.data?.watcherId;
      })
      .catch((err) => {
        logger.error('Failed to watch paths:', err);
      });

    this._connection.on('file-change', (watcherId, eventType, filename, buffer) => {
      if (watcherId === watcherIdFromResponse) {
        const convertedBuffer = buffer ? base64ToUint8Array(buffer) : undefined;
        callback([{ type: eventType as any, path: filename, buffer: convertedBuffer }]);
      }
    });
  }
}

/**
 * Remote container implementation
 */
export class RemoteContainer implements Container {
  readonly fs: FileSystem;
  readonly workdir: string;
  readonly serverUrl: string;

  private _connection: RemoteContainerConnection;
  private _connectionStateListeners = new Set<ConnectionStateListener>();
  private _nonTerminatingProcessRunning = false;

  constructor(serverUrl: string, workdir: string, token: string) {
    this._connection = new RemoteContainerConnection(serverUrl, token);
    this.fs = new RemoteContainerFileSystem(this._connection);
    this.workdir = workdir;
    this.serverUrl = serverUrl;

    // Listen to connection state changes and forward them
    this._connection.onStateChange((newState, prevState) => {
      // Map ConnectionState enum to string values
      const stateMap = {
        [ConnectionState.CONNECTED]: 'connected',
        [ConnectionState.DISCONNECTED]: 'disconnected',
        [ConnectionState.RECONNECTING]: 'reconnecting',
        [ConnectionState.FAILED]: 'failed',
        [ConnectionState.CONNECTING]: 'reconnecting',
      } as const;

      const mappedState = stateMap[newState] || 'disconnected';
      const mappedPrevState = prevState ? stateMap[prevState] : undefined;

      // Notify connection state listeners
      this._connectionStateListeners.forEach((listener) => {
        try {
          listener(mappedState, mappedPrevState);
        } catch (error) {
          logger.error('Connection state listener error:', error);
        }
      });
    });
  }

  on<E extends keyof EventListenerMap>(event: E, listener: EventListenerMap[E]): Unsubscribe;
  on(event: 'connection-state', listener: ConnectionStateListener): Unsubscribe;

  on(event: string, listener: any): Unsubscribe {
    if (event === 'connection-state') {
      this._connectionStateListeners.add(listener as ConnectionStateListener);

      return () => {
        this._connectionStateListeners.delete(listener as ConnectionStateListener);
      };
    }

    return this._connection.on(event as any, listener);
  }

  // Methods for debugging
  getConnectionStats() {
    return {
      serverUrl: this.serverUrl,
      connectionState: this._connection.connectionState,
      reconnectAttempts: this._connection.reconnectAttempts,
      maxReconnectAttempts: this._connection.maxReconnectAttempts,
      maxAttemptsReached: this._connection.maxAttemptsReached,
      stateChangeHistory: this._connection.getStateChangeHistory(),
      stateChangeStats: this._connection.getStateChangeStats(),
    };
  }

  logConnectionStats() {
    const stats = this.getConnectionStats();
    logger.info('📊 Connection Statistics:', stats);

    // Analyze recent state transition patterns
    const recentChanges = stats.stateChangeHistory.filter(
      (entry) => entry.timestamp > Date.now() - 5 * 60 * 1000, // Last 5 minutes
    );

    if (recentChanges.length > 0) {
      logger.info('📈 Recent State Changes (last 5 minutes):');
      recentChanges.forEach((entry, index) => {
        logger.info(
          `  ${index + 1}. ${entry.from} → ${entry.to} (${entry.source}) at ${new Date(entry.timestamp).toLocaleTimeString()}`,
        );
      });
    }

    // Pattern analysis
    const sources = [...new Set(recentChanges.map((entry) => entry.source))];

    if (sources.length > 0) {
      logger.info('📋 Active Sources:', sources);
    }
  }

  private async _mountByFiles(
    tree: FileSystemTree,
    basePath: string = '',
    skippedFiles: string[] = [],
  ): Promise<string[]> {
    const entries = Object.entries(tree);

    for (const [name, node] of entries) {
      const fullPath = basePath ? `${basePath}/${name}` : name;

      if ('file' in node) {
        const contents = node.file.contents;
        const fileSize = Array.isArray(contents) ? contents.length : new TextEncoder().encode(contents).length;

        if (fileSize > MAX_TRANSFER_SIZE) {
          logger.warn(`⚠️ Skipping large file: ${fullPath} (${(fileSize / 1024 / 1024).toFixed(2)}MB > 10MB limit)`);
          skippedFiles.push(fullPath);
          continue;
        }

        await this.fs.writeFile(fullPath, contents);
      } else if ('directory' in node) {
        await this.fs.mkdir(fullPath, { recursive: true });
        await this._mountByFiles(node.directory, fullPath, skippedFiles);
      }
    }

    return skippedFiles;
  }

  async mount(data: FileSystemTree): Promise<void> {
    // Skip top-level project folder (common for all cases)
    let targetTree = data;
    const rootEntries = Object.entries(data);

    if (rootEntries.length === 1) {
      const [, rootNode] = rootEntries[0];

      if ('directory' in rootNode) {
        targetTree = rootNode.directory;
      }
    }

    const content = JSON.stringify(targetTree);

    if (content.length <= MAX_TRANSFER_SIZE) {
      await this._connection.sendRequest({
        id: `mount-${v4()}`,
        operation: {
          type: 'mount',
          path: '/',
          content,
        },
      });
    } else {
      logger.info(
        `📦 Large mount detected (${(content.length / 1024 / 1024).toFixed(2)}MB), using file-by-file upload`,
      );

      const skippedFiles = await this._mountByFiles(targetTree);

      if (skippedFiles.length > 0) {
        logger.warn(`⚠️ ${skippedFiles.length} file(s) skipped due to size limit:`, skippedFiles);
        toast.warning(`${skippedFiles.length} file(s) skipped due to size limit (>10MB)`);
      }
    }
  }

  async spawn(command: string, args: string[] = [], options?: SpawnOptions): Promise<ContainerProcess> {
    const response = await this._connection.sendRequest<ProcessResponse>({
      id: `spawn-${v4()}`,
      operation: {
        type: 'spawn',
        command,
        args,
        options,
      },
    });

    if (!response.success || !response.data) {
      throw new Error(response.error?.message || 'Failed to execute process');
    }

    const { pid } = response.data;
    const { promise: exit, resolve: resolveExit } = withResolvers<number>();

    // Create output stream
    const outputStream = new ReadableStream<string>({
      start: (controller) => {
        this._connection.onProcess(pid, (data) => {
          if (data.stream === 'exit') {
            process.nextTick(() => {
              resolveExit(parseInt(data.data, 10));
              controller.close();
            });
          } else {
            controller.enqueue(data.data);
          }
        });
      },
    });

    // Create input stream
    const inputStream = new WritableStream<string>({
      write: async (chunk) => {
        await this._connection.sendRequest({
          id: `input-${v4()}`,
          operation: {
            type: 'input',
            pid,
            data: chunk,
          },
        });
      },
    });

    return {
      input: inputStream,
      output: outputStream,
      exit,
      resize: async (dimensions: { cols: number; rows: number }) => {
        await this._connection.sendRequest({
          id: `resize-${v4()}`,
          operation: {
            type: 'resize',
            pid,
            cols: dimensions.cols,
            rows: dimensions.rows,
          },
        });
      },
    };
  }

  async spawnShell(terminal: ITerminal, options: ShellOptions = {}): Promise<ShellSession> {
    const args: string[] = options.args || [];

    // Use appropriate shell command
    const process = await this.spawn('/bin/zsh', ['--interactive', ...args], {
      env: {
        __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: `.${ROUTER_DOMAIN}`,
      },
      terminal: {
        cols: terminal.cols ?? 80,
        rows: terminal.rows ?? 15,
      },
    });

    const input = process.input;
    let output: ReadableStream<string>;
    let internalOutput: ReadableStream<string> | undefined;
    let executeCommand: ((command: string) => Promise<ExecutionResult>) | undefined;

    const waitInternalOutputLock = async () => {
      if (!internalOutput) {
        return;
      }

      while (internalOutput.locked) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };

    let _globalOutputBuffer: string = '';

    // Extracts exit code from output text
    const extractExitCode = (text: string): number => {
      const exitMatches = [...text.matchAll(OSC_PATTERNS.EXIT_CODE_REGEX)];

      if (exitMatches.length > 0) {
        const [, , , exitCodeStr] = exitMatches[exitMatches.length - 1];
        return parseInt(exitCodeStr || '0', 10);
      }

      return 0;
    };

    // Process OSC match and potentially return result
    const processOscMatch = (
      match: RegExpMatchArray,
      osc: string,
      waitCode: string,
      fullOutput: string,
      exitCode: number,
    ): { result: { output: string; exitCode: number } | null; newExitCode: number } => {
      const [fullMatch] = match;
      let newExitCode = exitCode;

      if (osc === 'exit') {
        const [, , , code] = match;
        newExitCode = parseInt(code || '0', 10);
      }

      if (osc === waitCode) {
        const matchIndex = fullOutput.indexOf(fullMatch);

        if (matchIndex !== -1) {
          // Get output up to and including the OSC code
          const extractedOutput = fullOutput.substring(0, matchIndex + fullMatch.length);

          // Update the global buffer - remove the part we're returning
          const globalMatchIndex = _globalOutputBuffer.indexOf(fullMatch);

          if (globalMatchIndex !== -1) {
            _globalOutputBuffer = _globalOutputBuffer.substring(globalMatchIndex + fullMatch.length);
          }

          return {
            result: { output: extractedOutput, exitCode: newExitCode },
            newExitCode,
          };
        }
      }

      return { result: null, newExitCode };
    };

    let isWaitingForOscCode = false;

    const waitTillOscCode = async (waitCode: string, signal?: AbortSignal) => {
      const checkAborted = () => {
        if (signal?.aborted) {
          throw new DOMException('Wait till OSC code aborted by user', ERROR_NAMES.ABORT);
        }
      };

      checkAborted();

      let fullOutput = '';
      let exitCode = 0;

      if (!internalOutput) {
        throw new Error('No internal output stream');
      }

      // Create regex for the requested OSC code
      const oscRegex = OSC_PATTERNS.createWaitCodeRegex(waitCode);

      // Check if the requested OSC code is already in the global buffer
      const bufferMatches = [..._globalOutputBuffer.matchAll(oscRegex)];

      /*
       * If not found in buffer, read from the stream
       * Do not move this awaiting after existing buffer check, as there may be existing awaiters.
       */
      await waitInternalOutputLock();

      checkAborted();

      if (bufferMatches.length > 0) {
        // Found the OSC code in the buffer, extract output up to this code
        const match = bufferMatches[0];
        const [fullMatch] = match;
        const matchIndex = _globalOutputBuffer.indexOf(fullMatch);

        if (matchIndex !== -1) {
          // Get output up to and including the OSC code
          fullOutput = _globalOutputBuffer.substring(0, matchIndex + fullMatch.length);

          // Trim the global buffer to remove the extracted part
          _globalOutputBuffer = _globalOutputBuffer.substring(matchIndex + fullMatch.length);

          // Look for exit code in the extracted output
          exitCode = extractExitCode(fullOutput);

          return { output: fullOutput, exitCode };
        }
      }

      const reader = internalOutput.getReader();
      let localBuffer = _globalOutputBuffer; // Start with existing buffer content
      let streamReadTimeoutId: NodeJS.Timeout | null = null;

      try {
        isWaitingForOscCode = true;

        streamReadTimeoutId = setTimeout(() => {
          currentTerminal?.input(':' + '\n');
        }, STREAM_READ_IDLE_TIMEOUT_MS);

        while (true) {
          const readPromise = reader.read();
          const timeoutPromise = new Promise<{ value: undefined; done: true }>((_, reject) => {
            setTimeout(() => {
              if (this._nonTerminatingProcessRunning) {
                reject(new NoneError('read timeout'));
              }
            }, STREAM_READ_IDLE_TIMEOUT_MS);
          });

          // Create abort promise that rejects when signal is aborted
          const abortPromise = new Promise<never>((_, reject) => {
            if (signal?.aborted) {
              reject(new DOMException('stream read aborted by user', ERROR_NAMES.ABORT));
            }

            signal?.addEventListener(
              'abort',
              () => {
                reject(new DOMException('stream read aborted by user', ERROR_NAMES.ABORT));
              },
              { once: true },
            );
          });

          const { value, done } = await Promise.race([readPromise, timeoutPromise, abortPromise]);

          checkAborted();

          if (streamReadTimeoutId) {
            clearTimeout(streamReadTimeoutId);
            streamReadTimeoutId = null;
          }

          if (done) {
            break;
          }

          const text = value || '';

          fullOutput += text;
          localBuffer += text;
          _globalOutputBuffer += text; // Add to global buffer

          // Prevent buffer from growing too large
          if (_globalOutputBuffer.length > BUFFER_CONFIG.MAX_GLOBAL_SIZE) {
            _globalOutputBuffer = _globalOutputBuffer.slice(-BUFFER_CONFIG.TRUNCATED_GLOBAL_SIZE);
          }

          // Check for OSC codes in the updated buffer
          const matches = [...localBuffer.matchAll(OSC_PATTERNS.ALL_OSC_REGEX)];

          if (matches.length === 0) {
            if (localBuffer.length > BUFFER_CONFIG.MAX_LOCAL_SIZE) {
              localBuffer = localBuffer.slice(-BUFFER_CONFIG.TRUNCATED_LOCAL_SIZE);
            }

            continue;
          }

          // Process all matches
          for (const match of matches) {
            const [, osc] = match;
            const { result, newExitCode } = processOscMatch(match, osc, waitCode, fullOutput, exitCode);
            exitCode = newExitCode;

            if (result) {
              return result;
            }
          }

          // Update local buffer to contain only content after the last match
          const lastMatch = matches[matches.length - 1][0];
          const lastMatchIndex = localBuffer.lastIndexOf(lastMatch);

          if (lastMatchIndex !== -1) {
            localBuffer = localBuffer.slice(lastMatchIndex + lastMatch.length);
          }
        }
      } catch (error: any) {
        if (isAbortError(error)) {
          logger.debug(`AbortError: ${error.message}`);
        }

        if (error instanceof NoneError) {
          logger.debug(`NoneError: ${error.message}`);
        }
      } finally {
        if (streamReadTimeoutId) {
          clearTimeout(streamReadTimeoutId);
          streamReadTimeoutId = null;
        }

        isWaitingForOscCode = false;
        reader.releaseLock();
      }

      return { output: fullOutput, exitCode };
    };

    if (options.splitOutput) {
      const streams = process.output.tee();

      output = streams[0];
      internalOutput = streams[1];

      // Command execution implementation
      executeCommand = async (command: string): Promise<ExecutionResult> => {
        if (isNonTerminatingCommand(command)) {
          this._nonTerminatingProcessRunning = true;
        }

        const sessionId = v4().slice(0, 8);

        logger.debug(`[${sessionId}] executeCommand`, command);

        // Use currentTerminal instead of original terminal for input
        if (!currentTerminal) {
          throw new Error('No terminal attached to session');
        }

        /*
         * Clear global output buffer to avoid confusion with previous command outputs
         * This ensures we only wait for OSC codes from the current command execution
         */
        _globalOutputBuffer = '';

        // Interrupt current execution
        currentTerminal.input('\x03');

        // for dead lock prevention
        if (isWaitingForOscCode) {
          currentTerminal.input(':' + '\n');
        }

        logger.debug(`[${sessionId}] waiting for prompt`, command);

        // Wait for prompt
        await waitTillOscCode('prompt');

        // Execute new command
        currentTerminal.input(':' + '\n');
        await waitTillOscCode('exit');
        logger.debug('terminal is responsive');

        logger.debug(`[${sessionId}] prompt received`, command);

        currentTerminal.input(command.trim() + '\n');
        logger.debug(`[${sessionId}] command executed`, command);

        // Wait for execution result
        const { output, exitCode } = await waitTillOscCode('exit');

        logger.debug(`[${sessionId}] execution ended`, command, exitCode);

        return {
          output: cleanTerminalOutput(output),
          exitCode,
        };
      };
    } else {
      output = process.output;
      internalOutput = undefined;
      executeCommand = undefined;
    }

    // Shell ready signal
    const shellReady = withResolvers<void>();

    // Track current terminal for dynamic reconnection
    let currentTerminal: ITerminal | null = terminal;
    let currentTerminalDataDisposable: IDisposable | null = null;

    // Detect interactive mode
    let checkInteractive = false;
    output.pipeTo(
      new WritableStream({
        write(data) {
          if (!checkInteractive && options.interactive !== false) {
            const [, osc] = data.match(/\x1b\]654;([^\x07]+)\x07/) || [];

            if (osc === 'interactive') {
              checkInteractive = true;
              shellReady.resolve();
            }
          }

          // Write to current terminal (allows dynamic switching)
          if (currentTerminal) {
            currentTerminal.write(data);
          }
        },
      }),
    );

    // Handle terminal input - store the disposable for later cleanup
    const pendingBuffer: string[] = [];
    let isProcessingBuffer = false;

    // Process buffer in FIFO order to guarantee input sequence
    const processBuffer = async (): Promise<void> => {
      if (isProcessingBuffer || input.locked || pendingBuffer.length === 0) {
        return;
      }

      isProcessingBuffer = true;

      try {
        while (pendingBuffer.length > 0 && !input.locked) {
          const data = pendingBuffer.shift()!;
          const writer = input.getWriter();

          try {
            await writer.ready;
            await writer.write(data);
          } catch (e) {
            logger.error(`Failed to write to input stream, ${this.serverUrl}`, e);

            // Re-add to front of buffer on error to maintain order
            pendingBuffer.unshift(data);
            break;
          } finally {
            writer.releaseLock();
          }
        }
      } finally {
        isProcessingBuffer = false;
      }
    };

    // Add data to buffer and trigger processing
    const addToBuffer = (data: string): void => {
      pendingBuffer.push(data);
      processBuffer();
    };

    // Create debounced write function for regular text input
    const debouncedWrite = debounce(addToBuffer, 16);

    // Helper function to check if data should be sent immediately
    const shouldSendImmediately = (data: string): boolean => {
      return /[\x03\x04\x1b\r\n\t]/.test(data) || data.length > 1;
    };

    // Attach terminal input handler
    const attachTerminalInput = (term: ITerminal) => {
      // Detach previous terminal if any
      if (currentTerminalDataDisposable) {
        currentTerminalDataDisposable.dispose();
        currentTerminalDataDisposable = null;
      }

      // Attach new terminal
      currentTerminalDataDisposable = term.onData(async (data) => {
        if (shouldSendImmediately(data)) {
          addToBuffer(data);
        } else {
          debouncedWrite(data);
        }
      });
    };

    // Initial terminal attachment
    attachTerminalInput(terminal);

    const detachTerminal = () => {
      if (currentTerminalDataDisposable) {
        currentTerminalDataDisposable.dispose();
        currentTerminalDataDisposable = null;
        logger.debug('Terminal input detached from shell session');
      }

      currentTerminal = null;
    };

    const attachTerminal = async (newTerminal: ITerminal) => {
      logger.debug('Attaching new terminal to existing shell session');

      // Update terminal references
      currentTerminal = newTerminal;

      // Reattach input handler
      attachTerminalInput(newTerminal);

      // Sync terminal dimensions if different
      if (newTerminal.cols && newTerminal.rows) {
        try {
          await process.resize({ cols: newTerminal.cols, rows: newTerminal.rows });
          logger.debug(`Terminal dimensions synced: ${newTerminal.cols}x${newTerminal.rows}`);
        } catch (error) {
          logger.warn('Failed to sync terminal dimensions:', error);
        }
      }

      logger.debug('Terminal successfully reattached to shell session');

      // Send a newline to display prompt after terminal reattachment
      setTimeout(() => {
        if (currentTerminal) {
          logger.debug('Sending newline to display prompt');
          addToBuffer('\n');
        }
      }, TERMINAL_REATTACH_PROMPT_DELAY_MS);
    };

    // Return basic shell session
    const session: ShellSession = {
      process,
      input,
      output,
      internalOutput,
      ready: shellReady.promise,
      executeCommand,
      waitTillOscCode,
      detachTerminal,
      attachTerminal,
    };

    return session;
  }

  async connect() {
    await this._connection.connect();
  }

  close() {
    this._connection.disconnect();
  }
}
