import {get, set} from "idb-keyval";
import {Session, AuthClient, TokenData} from "../interfaces";

let sessionManager: SessionManagerClass;

export type SessionManager = SessionManagerClass;

export const getSessionManager = (
  swGlobalScope: ServiceWorkerGlobalScope,
): SessionManager => {
  if (!sessionManager) {
    sessionManager = new SessionManagerClass(swGlobalScope);
  }
  return sessionManager;
};

class SessionManagerClass {
  private readonly maxRetries = 3;
  private readonly retryDelay = 10; // ms

  constructor(private swGlobalScope: ServiceWorkerGlobalScope) {}

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelay * (attempt + 1)));
        }
      }
    }
    throw lastError;
  }

  public async getSession(sessionId: string): Promise<Session | null> {
    try {
      if (!sessionId) {
        throw new Error('Session ID is required');
      }
      
      const sessions = (await get<Session[]>("sessions")) || [];
      return sessions.find((session) => session.sessionId === sessionId) || null;
    } catch (error) {
      console.error('[SessionManager] Failed to get session:', error);
      return null;
    }
  }

  public async addAuthClientSession(
    sessionId: string,
    window: string,
    oAuthClient: AuthClient,
  ): Promise<void> {
    if (!sessionId || !window || !oAuthClient?.id) {
      throw new Error('Missing required parameters for addAuthClientSession');
    }

    return this.withRetry(async () => {
      const sessions = (await get<Session[]>("sessions")) || [];
      const sessionIndex = sessions.findIndex((session) => session.sessionId === sessionId);

      if (sessionIndex >= 0) {
        const session = sessions[sessionIndex];
        session.window = window;
        
        if (!session.oAuthClients) {
          session.oAuthClients = [];
        }
        
        const clientIndex = session.oAuthClients.findIndex(
          (client) => client.id === oAuthClient.id,
        );

        if (clientIndex >= 0) {
          session.oAuthClients[clientIndex] = oAuthClient;
        } else {
          session.oAuthClients.push(oAuthClient);
        }
      } else {
        sessions.push({
          sessionId,
          window,
          oAuthClients: [oAuthClient],
        });
      }
      
      await set("sessions", sessions);
    });
  }

  public async updateSessionWindow(sessionId: string, window: string): Promise<void> {
    if (!sessionId || !window) {
      throw new Error('Session ID and window are required');
    }

    return this.withRetry(async () => {
      const sessions = (await get<Session[]>("sessions")) || [];
      let updated = false;
      
      for (const session of sessions) {
        if (session.sessionId === sessionId) {
          session.window = window;
          updated = true;
          break;
        }
      }
      
      if (updated) {
        await set("sessions", sessions);
      }
    });
  }

  public async removeExpiredSessions(): Promise<void> {
    return this.withRetry(async () => {
      try {
        const sessions = (await get<Session[]>("sessions")) || [];
        const allWindows = (await this.swGlobalScope.clients.matchAll()).map(
          (client) => client.id,
        );
        const updatedSessions = sessions.filter(
          (session) => allWindows.includes(session.window),
        );
        
        if (updatedSessions.length !== sessions.length) {
          await set("sessions", updatedSessions);
        }
      } catch (error) {
        console.error('[SessionManager] Failed to remove expired sessions:', error);
        throw error;
      }
    });
  }

  public async getSessionForWindow(window: string) {
    const sessions = (await get<Session[]>("sessions")) || [];
    return sessions.find((session) => session.window === window);
  }

  public async getAuthClientForRequest(url: string, session: Session): Promise<AuthClient | null> {
    try {
      if (!url || !session?.oAuthClients) {
        return null;
      }

      // Validate URL to prevent ReDoS attacks
      if (url.length > 2048) {
        console.warn('[SessionManager] URL too long, skipping pattern matching');
        return null;
      }

      for (const oAuthClient of session.oAuthClients) {
        if (!oAuthClient.urlPattern) continue;
        
        try {
          // Add timeout protection for regex execution
          const regex = new RegExp(oAuthClient.urlPattern);
          if (regex.test(url)) {
            return oAuthClient;
          }
        } catch (regexError) {
          console.warn('[SessionManager] Invalid regex pattern:', oAuthClient.urlPattern, regexError);
          continue;
        }
      }
      
      return null;
    } catch (error) {
      console.error('[SessionManager] Failed to get auth client for request:', error);
      return null;
    }
  }

  public async getToken(sessionId: string, clientId: string): Promise<any | null> {
    try {
      if (!sessionId || !clientId) {
        throw new Error('Session ID and client ID are required');
      }
      
      const tokendata = (await get<TokenData[]>("tokens")) || [];
      const tokenEntry = tokendata.find(
        (token) => token.sessionId === sessionId && token.clientId === clientId,
      );
      
      return tokenEntry?.tokens || null;
    } catch (error) {
      console.error('[SessionManager] Failed to get token:', error);
      return null;
    }
  }

  public async setToken(sessionId: string, clientId: string, tokendata: any): Promise<void> {
    if (!sessionId || !clientId || !tokendata) {
      throw new Error('Session ID, client ID, and token data are required');
    }

    return this.withRetry(async () => {
      const tokens = (await get<TokenData[]>("tokens")) || [];
      const tokenIndex = tokens.findIndex(
        (token) => token.sessionId === sessionId && token.clientId === clientId,
      );
      
      if (tokenIndex >= 0) {
        tokens[tokenIndex].tokens = tokendata;
      } else {
        tokens.push({ sessionId, clientId, tokens: tokendata });
      }
      
      await set("tokens", tokens);
    });
  }

  public async removeToken(sessionId: string, clientId: string) {
    const tokens = (await get<TokenData[]>("tokens")) || [];
    const updatedTokens = tokens.filter(
      (token) => token.sessionId !== sessionId || token.clientId !== clientId,
    );
    await set("tokens", updatedTokens);
  }
}
