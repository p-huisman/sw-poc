import Dexie from "dexie";

let database: OAuthDatabase;

export const createOAuthDatabase = (
  swGlobalScope: ServiceWorkerGlobalScope
) => {
  if (!database) {
    database = new OAuthDatabase(swGlobalScope);
    database.open();
  }
  return database;
};

class OAuthDatabase extends Dexie {
  sessions!: Dexie.Table<SessionRecord, [string, string, string]>;
  openIdDiscoveries!: Dexie.Table<OpenIdDiscoveryRecord, [string, any]>;
  constructor(private swGlobalScope: ServiceWorkerGlobalScope) {
    super("OAuthDatabase");
    this.version(1).stores({
      sessions: "[session+window+client],data",
      openIdDiscoveries: "url,data",
    });
  }

  public async removeExpiredSessions(): Promise<void> {
    const allClients = await this.swGlobalScope.clients.matchAll();
    const allWindowIds = allClients.map((client) => client.id);
    const allSessionRecords = await database.sessions.toArray();
    allSessionRecords.forEach(async (record: SessionRecord) => {
      if (allWindowIds.indexOf(record.window) < 0) {
        await database.sessions.delete([
          record.session,
          record.window,
          record.client,
        ]);
      }
    });
  }

  public async addSession(
    session: string,
    window: string,
    client: string,
    data: any
  ): Promise<void> {
    const record = await database.sessions.add({
      session,
      window,
      client,
      data,
    });

    const OpenIdDiscoveryRecord = await database.openIdDiscoveries.get(
      data.discoveryUrl
    );
    if (!OpenIdDiscoveryRecord) {
      this.discoverOpenId(data.discoveryUrl);
    }
  }

  private discoverOpenId(discoveryUrl: string): void {
    let url = discoveryUrl;
    if (url.indexOf(".well-known/openid-configuration") < 0) {
      if (url.slice(-1) !== "/") {
        url = url + "/";
      }
      url = url + ".well-known/openid-configuration";
    }
    this.swGlobalScope
      .fetch(url)
      .then((response) => response.json())
      .then((data) => {
        data = { ...data, timestamp: new Date().getTime() };
        database.openIdDiscoveries.add({ url: discoveryUrl, data });
      });
  }

  public async getClientForRequest(url: string, window: string): Promise<any> {
    
    const allSessions = (await database.sessions.toArray()).filter((s) => s.window === window);
    const allPatterns = allSessions.map((s) => s.data.urlPattern);
    const matchingPattern = allPatterns.find((p) => new RegExp(p).test(url));
    if (matchingPattern) {
      return allSessions.find((s) => s.data.urlPattern === matchingPattern);
    }
    return null;
  }

}

export interface SessionRecord {
  session?: string;
  window: string;
  client: string;
  data: any;
}

export interface OpenIdDiscoveryRecord {
  url: string;
  data: any;
}
