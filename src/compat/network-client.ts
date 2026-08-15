/**
 * Pure-JS replacement for @mattermost/react-native-network-client
 *
 * Provides the same API surface using standard fetch() and WebSocket,
 * which are both available in RNOH's Hermes runtime.
 *
 * Original native module uses OkHttp on Android / NSURLSession on iOS.
 * This JS implementation sacrifices some features (TLS pinning, client certs)
 * in exchange for zero native dependencies.
 */
import {Platform} from 'react-native';

// ── Types (matching the original module's API) ──

export enum WebSocketReadyState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}

export enum RetryTypes {
  EXPONENTIAL_RETRY = 'exponential',
  LINEAR_RETRY = 'linear',
}

export interface APIClientErrorEvent {
  statusCode: number;
  message: string;
  url: string;
  details?: unknown;
}

export type APIClientErrorEventHandler = (event: APIClientErrorEvent) => void;

export interface ClientHeaders {
  [key: string]: string;
}

export interface APIClientConfiguration {
  headers?: ClientHeaders;
  sessionConfiguration?: {
    timeoutIntervalForRequest?: number;
    timeoutIntervalForResource?: number;
    allowsCellularAccess?: boolean;
    tlsMinimumSupportedProtocolVersion?: string;
    clientCertificate?: {
      path: string;
      password: string;
    };
    retryPolicy?: {
      type: RetryTypes;
      retryLimit?: number;
      retryInterval?: number;
      exponentialBackoffBase?: number;
    };
  };
  serverTrustManager?: {
    host: string;
    certificateChain: string;
  };
}

export interface WebSocketClientInterface {
  readyState: WebSocketReadyState;
  onOpen: (() => void) | null;
  onMessage: ((event: {data: string}) => void) | null;
  onClose: ((event: {code: number; reason: string}) => void) | null;
  onError: ((event: {message: string}) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface APIClientInterface {
  get(url: string, headers?: ClientHeaders): Promise<APIResponse>;
  post(url: string, body?: unknown, headers?: ClientHeaders): Promise<APIResponse>;
  put(url: string, body?: unknown, headers?: ClientHeaders): Promise<APIResponse>;
  patch(url: string, body?: unknown, headers?: ClientHeaders): Promise<APIResponse>;
  delete(url: string, headers?: ClientHeaders): Promise<APIResponse>;
  head(url: string, headers?: ClientHeaders): Promise<APIResponse>;
  cancelRequest(url: string): void;
  getRedirects(url: string): Promise<string[]>;
  invalidateToken(): void;
}

export interface APIResponse {
  code: number;
  data?: unknown;
  headers: Record<string, string>;
  ok: boolean;
  redirected: boolean;
  status: number;
}

// ── Pure-JS WebSocket Implementation ──

export class JSWebSocketClient implements WebSocketClientInterface {
  private ws: WebSocket | null = null;
  private url: string;
  private headers: ClientHeaders;

  public readyState: WebSocketReadyState = WebSocketReadyState.CLOSED;
  public onOpen: (() => void) | null = null;
  public onMessage: ((event: {data: string}) => void) | null = null;
  public onClose: ((event: {code: number; reason: string}) => void) | null = null;
  public onError: ((event: {message: string}) => void) | null = null;

  constructor(url: string, headers: ClientHeaders = {}) {
    this.url = url;
    this.headers = headers;
  }

  connect(): void {
    if (this.ws) {
      return;
    }

    try {
      this.readyState = WebSocketReadyState.CONNECTING;

      // Build auth header for WebSocket connection
      const protocols: string[] = [];
      const authHeader = this.headers['Authorization'];
      if (authHeader) {
        protocols.push(`Authorization: ${authHeader}`);
      }

      // Note: Standard WebSocket API doesn't support custom headers.
      // For Mattermost, the auth token is typically passed as a query param
      // or via the initial handshake. We strip 'Bearer ' prefix if present.
      const token = authHeader?.replace('Bearer ', '') || '';
      const wsUrl = token
        ? `${this.url}?access_token=${encodeURIComponent(token)}`
        : this.url;

      this.ws = new WebSocket(wsUrl, protocols.length > 0 ? protocols : undefined);

      this.ws.onopen = () => {
        this.readyState = WebSocketReadyState.OPEN;
        this.onOpen?.();
      };

      this.ws.onmessage = (event: WebSocketMessageEvent) => {
        this.onMessage?.({data: typeof event.data === 'string' ? event.data : ''});
      };

      this.ws.onclose = (event: WebSocketCloseEvent) => {
        this.readyState = WebSocketReadyState.CLOSED;
        this.onClose?.({code: event.code ?? 0, reason: event.reason ?? ''});
      };

      this.ws.onerror = (event: Event) => {
        this.onError?.({message: 'WebSocket connection error'});
      };
    } catch (error) {
      this.readyState = WebSocketReadyState.CLOSED;
      this.onError?.({message: `Failed to create WebSocket: ${String(error)}`});
    }
  }

  send(data: string): void {
    if (this.ws && this.readyState === WebSocketReadyState.OPEN) {
      this.ws.send(data);
    }
  }

  close(code?: number, reason?: string): void {
    if (this.ws) {
      this.ws.close(code, reason);
      this.ws = null;
    }
    this.readyState = WebSocketReadyState.CLOSED;
  }
}

// ── Pure-JS API Client Implementation ──

export class JSAPIClient implements APIClientInterface {
  private config: APIClientConfiguration;
  private baseHeaders: ClientHeaders;
  private abortControllers: Map<string, AbortController> = new Map();

  public onError: APIClientErrorEventHandler | null = null;

  constructor(config: APIClientConfiguration = {}) {
    this.config = config;
    this.baseHeaders = {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...config.headers,
    };
  }

  private async request(
    method: string,
    url: string,
    body?: unknown,
    extraHeaders?: ClientHeaders,
  ): Promise<APIResponse> {
    const controller = new AbortController();
    // Use method+url as key so GET /users/me doesn't cancel a concurrent POST /users/ids
    const reqKey = `${method}:${url}`;
    this.abortControllers.set(reqKey, controller);

    try {
      const headers: Record<string, string> = {
        ...this.baseHeaders,
        ...extraHeaders,
      };

      const options: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };

      if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
        // FormData must be passed as-is so fetch can set the multipart boundary.
        if (typeof FormData !== 'undefined' && body instanceof FormData) {
          options.body = body;
          // Let the runtime set the Content-Type (with boundary); drop our JSON default.
          delete headers['Content-Type'];
        } else {
          options.body = typeof body === 'string' ? body : JSON.stringify(body);
        }
      }

      const startTime = Date.now();
      const response = await fetch(url, options);
      const duration = Date.now() - startTime;

      this.abortControllers.delete(reqKey);

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      let data: unknown;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      const apiResponse: APIResponse = {
        code: response.status,
        data,
        headers: responseHeaders,
        ok: response.ok,
        redirected: response.redirected,
        status: response.status,
      };

      // Handle error responses
      if (!response.ok && this.onError) {
        this.onError({
          statusCode: response.status,
          message: `HTTP ${response.status}: ${response.statusText}`,
          url,
          details: data,
        });
      }

      return apiResponse;
    } catch (error) {
      this.abortControllers.delete(reqKey);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request cancelled');
      }

      if (this.onError) {
        this.onError({
          statusCode: 0,
          message: `Network error: ${String(error)}`,
          url,
        });
      }
      throw error;
    }
  }

  async get(url: string, headers?: ClientHeaders): Promise<APIResponse> {
    return this.request('GET', url, undefined, headers);
  }

  async post(url: string, body?: unknown, headers?: ClientHeaders): Promise<APIResponse> {
    return this.request('POST', url, body, headers);
  }

  async put(url: string, body?: unknown, headers?: ClientHeaders): Promise<APIResponse> {
    return this.request('PUT', url, body, headers);
  }

  async patch(url: string, body?: unknown, headers?: ClientHeaders): Promise<APIResponse> {
    return this.request('PATCH', url, body, headers);
  }

  async delete(url: string, headers?: ClientHeaders): Promise<APIResponse> {
    return this.request('DELETE', url, undefined, headers);
  }

  async head(url: string, headers?: ClientHeaders): Promise<APIResponse> {
    return this.request('HEAD', url, undefined, headers);
  }

  cancelRequest(url: string): void {
    // Try both GET and POST keys since we don't know the method here
    for (const key of [`GET:${url}`, `POST:${url}`, `PUT:${url}`, `DELETE:${url}`, `PATCH:${url}`]) {
      const controller = this.abortControllers.get(key);
      if (controller) {
        controller.abort();
        this.abortControllers.delete(key);
      }
    }
  }

  async getRedirects(url: string): Promise<string[]> {
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        headers: this.baseHeaders,
      } as RequestInit);
      const redirects: string[] = [];

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location) {
          redirects.push(location);
          // Follow redirect chain
          const next = await this.getRedirects(location);
          redirects.push(...next);
        }
      }
      return redirects;
    } catch {
      return [];
    }
  }

  invalidateToken(): void {
    // Clear auth-related headers; the caller should set new token
    delete this.baseHeaders['Authorization'];
  }

  setToken(token: string, type: string = 'Bearer'): void {
    this.baseHeaders['Authorization'] = `${type} ${token}`;
  }

  setCSRF(token: string): void {
    this.baseHeaders['X-CSRF-Token'] = token;
  }

  getHeaders(): ClientHeaders {
    return {...this.baseHeaders};
  }
}

// ── Factory Functions (matching original module's API) ──

const apiClients: Record<string, JSAPIClient> = {};
const wsClients: Record<string, JSWebSocketClient> = {};

export function getOrCreateAPIClient(
  serverUrl: string,
  config: APIClientConfiguration = {},
): JSAPIClient {
  if (!apiClients[serverUrl]) {
    apiClients[serverUrl] = new JSAPIClient(config);
  }
  return apiClients[serverUrl];
}

export function getOrCreateWebSocketClient(
  url: string,
  headers: ClientHeaders = {},
): {client: JSWebSocketClient; readyState: WebSocketReadyState} {
  const key = url;
  if (!wsClients[key]) {
    wsClients[key] = new JSWebSocketClient(url, headers);
  }
  const client = wsClients[key];
  return {
    client,
    get readyState(): WebSocketReadyState {
      return client.readyState;
    },
  };
}

export function connectWebSocket(
  url: string,
  headers: ClientHeaders = {},
): JSWebSocketClient {
  const client = new JSWebSocketClient(url, headers);
  client.connect();
  return client;
}

// ── Default export for easy import ──

export default {
  getOrCreateAPIClient,
  getOrCreateWebSocketClient,
  connectWebSocket,
  WebSocketReadyState,
  RetryTypes,
};
