export interface AuthClientConfig extends Object {
  id: string;
  discoveryUrl: string;
  clientId: string;
  scope: string;
  callbackPath: string;
  urlPattern: string;
}

export interface AuthClient {
  id: string;
  config: AuthClientConfig;
  tokens?: any;
}

export interface Session {
  sessionId: string;
  window: string;
  oAuthClients: AuthClient[];
}

let sessionManager: OAuthSessionManager;

export const getSessionManager = (swGlobalScope: ServiceWorkerGlobalScope) => {
  if (!sessionManager) {
    sessionManager = new OAuthSessionManager(swGlobalScope);
  }
  return sessionManager;
};

class OAuthSessionManager {
  constructor(private swGlobalScope: ServiceWorkerGlobalScope) {
    this.sessions = new Map<string, Session>();
  }

  private sessions: Map<string, Session>;

  public async getSession(sessionId: string): Promise<Session> {
    return this.sessions.get(sessionId);
  }

  public async addAuthClientSession(
    sessionId: string,
    window: string,
    oAuthClientConfig: any
  ): Promise<void> {
    const session = await this.getSession(sessionId);

    if (session) {
      session.window = window;
      console.log("has session");
      if (!session.oAuthClients) {
        session.oAuthClients = [];
      }
      const existingClientIndex = session.oAuthClients.findIndex(
        (c) => c.id === oAuthClientConfig.id
      );
      if (existingClientIndex > -1) {
        session.oAuthClients[existingClientIndex].config = oAuthClientConfig;
      } else {
        session.oAuthClients.push({
          id: oAuthClientConfig.id,
          config: oAuthClientConfig,
        });
      }
      console.log(Array.from(this.sessions.values()));
      return;
    }

    const authClients = {
      id: oAuthClientConfig.id,
      config: oAuthClientConfig,
    };
    this.sessions.set(sessionId, {
      sessionId,
      window,
      oAuthClients: [authClients],
    });
    console.log(Array.from(this.sessions.values()));
  }

  public async removeExpiredSessions() {
    const allSessions = Array.from(this.sessions.values());
    const swClients = await this.swGlobalScope.clients.matchAll();
    const allWindows: string[] = swClients.map((client) => client.id);
    allSessions.forEach((session) => {
      if (allWindows.indexOf(session.window) < 0) {
        this.sessions.delete(session.sessionId);
      }
    });
  }

  public async getSessionForWindow(window: string) {
    const allSessions = Array.from(this.sessions.values());
    const sessionForWindow = await allSessions.find(
      (session) => session.window === window
    );
    return sessionForWindow;
  }

  public async getOAuthClientForRequest(url: string, session: Session) {
    if (!session) return null;
    const allPatterns = session.oAuthClients.map(
      (oauthClient) => oauthClient.config.urlPattern
    );
    const matchingPattern = allPatterns?.find((oAuthPattern) =>
      new RegExp(oAuthPattern).test(url)
    );
    if (matchingPattern) {
      return session.oAuthClients.find(
        (s) => s.config.urlPattern === matchingPattern
      );
    }
    return null;
  }
}
