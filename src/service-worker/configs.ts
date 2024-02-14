export interface Config {
  authClients: AuthClient[];
}

export interface AuthClient {
  type: string;
  id: string;
  discoveryUrl: string;
  clientId: string;
  scope: string;
  callbackPath: string;
  urlPattern: string;
}

interface DiscoverdAuthServer {
  data: any;
  timestamp: number;
}

declare var self: ServiceWorkerGlobalScope;

const configMap = new Map<string, Config>();

const tokenMap = new Map<string, string>();

const discoverdAuthServers = new Map<string, DiscoverdAuthServer>();

export function getConfigByClientId(clientId: string): Config | undefined {
  return configMap.get(clientId);
}

export async function getTokenByClientId(clientId: string, authClientId: string): Promise<string | undefined> {
  console.log("get token", `${clientId}.${authClientId}`)
  return tokenMap.get(`${clientId}.${authClientId}` );
}

export async function getNewTokenByClientId(clientId: string, authClientId: string): Promise<string | undefined> {
  console.log("get new token", `${clientId}.${authClientId}`)
  return "Lala";
}

export async function setTokenByClientId(clientId: string, authClientId: string, token: string): Promise<void> {
  console.log("set token", `${clientId}.${authClientId} ${token}`)
  tokenMap.set(`${clientId}.${authClientId}`, token);
}

export async function updateConfigMap() {
  const clients = await self.clients.matchAll();
  for (const [clientId] of configMap) {
    if (!clients.find((client) => client.id === clientId)) {
      configMap.delete(clientId);
    }
  }
}

export async function updateConfig(
  clientId: string,
  config: Config
): Promise<void> {
  configMap.set(clientId, config);

  await getDiscoveryDocuments(config.authClients);

  config.authClients.forEach((client) => {
    console.log(getDiscoveryDocumentByClientDiscoveryUrl(client.discoveryUrl));
  });

  updateConfigMap();
}

export function handleConfigEvent(event: ExtendableMessageEvent) {
  const client: any = event.source;
  updateConfig(client.id, event.data)
    .then(() => {
      event.ports[0].postMessage({
        ...getConfigByClientId(client.id),
        type: "CONFIG",
      });
    })
    .catch((e) => {
      event.ports[0].postMessage({
        type: "CONFIG",
        error: e.message,
      });
    });
}

function getDiscoveryDocuments(authClients: AuthClient[]) {
  const requests: Promise<Response>[] = [];

  authClients.forEach((client) => {
    if (!discoverdAuthServers.has(client.discoveryUrl)) {
      let url = client.discoveryUrl;
      if (url.indexOf(".well-known/openid-configuration") < 0) {
        if (url.slice(-1) !== "/") {
          url = url + "/";
        }
        url = url + ".well-known/openid-configuration";
      }

      requests.push(
        fetch(url)
          .then((response) => response.json())
          .then((data) => {
            discoverdAuthServers.set(client.discoveryUrl, {
              data,
              timestamp: Date.now(),
            });
          })
          .catch((e) => e)
      );
    }
  });
  return Promise.all(requests);
}

export function getDiscoveryDocumentByClientDiscoveryUrl(clientDiscoveryUrl: string) {
  // todo: check and remove if the discovery document is expired
  console.log("discover", Array.from(discoverdAuthServers.values()));
  return discoverdAuthServers.get(clientDiscoveryUrl).data;
}
