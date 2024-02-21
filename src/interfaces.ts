import {SessionManager} from "./service-worker/session-manager";

export interface AuthorizationCallbackParam {
  sessionId: string;
  authClient: AuthClient;
  data: any;
}

export interface AuthServiceWorker extends ServiceWorkerGlobalScope {
  sessionManager: SessionManager;
  authorizationCallbacksInProgress: AuthorizationCallbackParam[];
  debugConsole: any;
  registerPromise: Promise<void> | null;
}

export interface AuthClient {
  id: string;
  discoveryUrl: string;
  clientId: string;
  scope: string;
  callbackPath: string;
  urlPattern: string;
  type: string;
}

export interface Session {
  sessionId: string;
  window: string;
  oAuthClients: AuthClient[];
}

export interface TokenData {
  sessionId: string;
  clientId: string;
  tokens: any;
}
