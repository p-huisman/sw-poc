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

let sessionManager: OAuthSessionManager;

export const getSessionManager = (swGlobalScope: ServiceWorkerGlobalScope) => {
  if (!sessionManager) {
    sessionManager = new OAuthSessionManager(swGlobalScope);
  }
  return sessionManager;
};

class OAuthSessionManager {
  constructor(private swGlobalScope: ServiceWorkerGlobalScope) {
    this.ready = Promise.resolve(); // this.removeExpiredSessions();
  }

  public ready: Promise<void>;

  public async getSession(sessionId: string): Promise<Session> {
    await this.ready;
    const sessions = (await get<Session[]>("sessions")) || [];
    return sessions.find((session) => session.sessionId === sessionId);
  }

  public async addAuthClientSession(
    sessionId: string,
    window: string,
    oAuthClient: AuthClient
  ): Promise<void> {
    await this.ready;
    const sessions = (await get<Session[]>("sessions")) || [];
    const session = sessions.find((session) => session.sessionId === sessionId);

    if (session) {
      if (!session.oAuthClients) {
        session.oAuthClients = [];
        session.oAuthClients.push(oAuthClient);
      } else {
        const c = session.oAuthClients.findIndex(
          (oAuthClient) => oAuthClient.id === oAuthClient.id
        );
        if (c < 0) {
          session.oAuthClients.push(oAuthClient);
        } else {
          session.oAuthClients[c] = oAuthClient;
        }
      }
    } else {
      sessions.push({
        sessionId,
        window,
        oAuthClients: [oAuthClient],
      });
    }
    await set("sessions", sessions);
  }

  public async updateSessionWindow(sessionId: string, window: string) {
    await this.ready;
    const sessions = (await get<Session[]>("sessions")) || [];
    for (const session of sessions) {
      if (session.sessionId === sessionId) {
        console.log("updating session window", window);
        session.window = window;
      }
    }
    await set("sessions", sessions);
  }

  public async removeExpiredSessions() {
    await this.ready;
    const sessions = (await get<Session[]>("sessions")) || [];
    const allWindows = (await this.swGlobalScope.clients.matchAll()).map(
      (client) => client.id
    );
    const updatedSessions = sessions
      .filter((session) => allWindows.indexOf(session.window) > -1)
      .map((s) => s);
    await set("sessions", updatedSessions);
  }

  public async getSessionForWindow(window: string) {
    await this.ready;
    const sessions = (await get<Session[]>("sessions")) || [];
    return sessions.find((session) => session.window === window);
  }

  public async getOAuthClientForRequest(url: string, session: Session) {
    await this.ready;
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
    await this.ready;
    const tokendata = (await get<TokenData[]>("tokens")) || [];
    
    return tokendata.find(
      (token) =>
        token.sessionId === sessionId && token.clientId === clientId
    ).tokens;
  }

  public async setToken(sessionId: string, clientId: string, tokendata: any) {
    await this.ready;
    const tokens = (await get<TokenData[]>("tokens")) || [];
    const token = tokens.find(
      (token) =>
        token.sessionId === sessionId && token.clientId === clientId
    );
    if (token) {
      token.tokens = tokendata;
    } else {
      tokens.push({ sessionId, clientId, tokens: tokendata });
    }
    await set("tokens", tokens);
  }

  public async removeToken(sessionId: string, clientId: string) {
    await this.ready;
    const tokens = (await get<TokenData[]>("tokens")) || [];
    const updatedTokens = tokens.filter(
      (token) =>
        token.sessionId !== sessionId || token.clientId !== clientId
    ).map((t) => t);
    await set("tokens", updatedTokens);
  }


}
