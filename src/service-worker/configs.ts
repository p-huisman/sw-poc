export interface Config {
  authClients: AuthClient[];
  session: string;
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

export interface Tokens {
  access_token: string;
  id_token: string;
}

interface DiscoverdAuthServer {
  data: any;
  timestamp: number;
}

declare var self: ServiceWorkerGlobalScope;

const configMap = new Map<string, Config>();

const tokenMap = new Map<string, Tokens>();



const discoverdAuthServers = new Map<string, DiscoverdAuthServer>();

export function getConfigByClientId(clientId: string): Config | undefined {
  return configMap.get(clientId);
}

export async function getTokensBySessionId(
  sessionId: string,
  authClientId: string
): Promise<Tokens | undefined> {
  console.log("get token", `${sessionId}.${authClientId}`);
  return tokenMap.get(`${sessionId}.${authClientId}`);
}

export async function getNewTokenBySessionId(
  sessionId: string,
  authClientId: string
): Promise<Tokens | undefined> {
  return tokenMap.get(`${sessionId}.${authClientId}`);
}

export async function setTokenBySessionId(
  sessionId: string,
  authClientId: string,
  tokens: Tokens
): Promise<void> {
  tokenMap.set(`${sessionId}.${authClientId}`, tokens);
  console.log(tokenMap);
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
  updateConfigMap();
}

export function handleConfigEvent(event: ExtendableMessageEvent) {
  const client: any = event.source;
  // &state=
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

export function getDiscoveryDocumentByClientDiscoveryUrl(
  clientDiscoveryUrl: string
) {
  // todo: check and remove if the discovery document is expired
  return discoverdAuthServers.get(clientDiscoveryUrl).data;
}
