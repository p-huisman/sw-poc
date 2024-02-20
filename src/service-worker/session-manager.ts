import { get, set } from "idb-keyval";

export interface AuthClient {
  id: string;
  discoveryUrl: string;
  clientId: string;
  scope: string;
  callbackPath: string;
  urlPattern: string;
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

let sessionManager: SessionManagerClass;

export  type SessionManager = SessionManagerClass;

export const getSessionManager = (swGlobalScope: ServiceWorkerGlobalScope): SessionManager => {
  if (!sessionManager) {
    sessionManager = new SessionManagerClass(swGlobalScope);
  }
  return sessionManager;
};

class SessionManagerClass {
  constructor(private swGlobalScope: ServiceWorkerGlobalScope) {}

  public async getSession(sessionId: string): Promise<Session> {
    const sessions = (await get<Session[]>("sessions")) || [];
    return sessions.find((session) => session.sessionId === sessionId);
  }

  public async addAuthClientSession(
    sessionId: string,
    window: string,
    oAuthClient: AuthClient
  ): Promise<void> {
    const sessions = (await get<Session[]>("sessions")) || [];
    const session = sessions.find((session) => session.sessionId === sessionId);

    if (session) {
      session.window = window;
      if (!session.oAuthClients) {
        session.oAuthClients = [];
      } else {
        const c = session.oAuthClients.findIndex(
          (o) => o.id === oAuthClient.id
        );

        if (c < 0) {
          session.oAuthClients.push(oAuthClient);
          await set("sessions", sessions);
        } else {
          session.oAuthClients[c] = oAuthClient;
          await set("sessions", sessions);
        }
      }
    } else {
      sessions.push({
        sessionId,
        window,
        oAuthClients: [oAuthClient],
      });
      await set("sessions", sessions);
    }
  }

  public async updateSessionWindow(sessionId: string, window: string) {
    const sessions = (await get<Session[]>("sessions")) || [];
    for (const session of sessions) {
      if (session.sessionId === sessionId) {
        session.window = window;
      }
    }
    await set("sessions", sessions);
  }

  public async removeExpiredSessions() {
    const sessions = (await get<Session[]>("sessions")) || [];
    const allWindows = (await this.swGlobalScope.clients.matchAll()).map(
      (client) => client.id
    );
    const updatedSessions = sessions.filter(
      (session) => allWindows.indexOf(session.window) > -1
    );
    await set("sessions", updatedSessions);
  }

  public async getSessionForWindow(window: string) {
    const sessions = (await get<Session[]>("sessions")) || [];
    return sessions.find((session) => session.window === window);
  }

  public async getOAuthClientForRequest(url: string, session: Session) {
    if (!session) {
      return null;
    }
    const allPatterns = session.oAuthClients.map(
      (oauthClient) => oauthClient.urlPattern
    );
    const matchingPattern = allPatterns?.find((oAuthPattern) =>
      new RegExp(oAuthPattern).test(url)
    );
    if (matchingPattern) {
      return session.oAuthClients.find((s) => s.urlPattern === matchingPattern);
    }
    return null;
  }

  public async getToken(sessionId: string, clientId: string) {
    const tokendata = (await get<TokenData[]>("tokens")) || [];

    return tokendata.find(
      (token) => token.sessionId === sessionId && token.clientId === clientId
    )?.tokens;
  }

  public async setToken(sessionId: string, clientId: string, tokendata: any) {
    const tokens = (await get<TokenData[]>("tokens")) || [];
    const token = tokens.find(
      (token) => token.sessionId === sessionId && token.clientId === clientId
    );
    if (token) {
      token.tokens = tokendata;
    } else {
      tokens.push({ sessionId, clientId, tokens: tokendata });
    }
    await set("tokens", tokens);
  }

  public async removeToken(sessionId: string, clientId: string) {
    const tokens = (await get<TokenData[]>("tokens")) || [];
    const updatedTokens = tokens.filter(
      (token) => token.sessionId !== sessionId || token.clientId !== clientId
    );
    await set("tokens", updatedTokens);
  }
}
