declare var self: ServiceWorkerGlobalScope;
export type {};

interface Config {
  token: string;
  tokenEndpoint: string;
  baseUrl: string;
  remoteToken?: string;
}

const configMap = new Map();

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  updateMap();
  const clientId = event.clientId;
  const config = configMap.get(clientId);
  if (config && event.request.url.indexOf(config.baseUrl) === 0) {
    event.respondWith(remoteFetch(config.remoteToken, event.request));
  }
});

function remoteFetch(token: string, request: Request): Promise<Response> {
  const headers = new Headers();
  headers.append("Authorization", `Bearer ${token}`);
  for (var key of (request.headers as any).keys()) {
    if (key.toString().toLowerCase() !== "authorization") {
      headers.append(key, request.headers.get(key));
    }
  }
  const {
    body,
    cache,
    credentials,
    integrity,
    keepalive,
    method,
    mode,
    redirect,
    referrer,
    referrerPolicy,
    signal,
    window,
  } = request as any;

  return fetch(request.url, {
    headers,
    body,
    cache,
    credentials,
    integrity,
    keepalive,
    method,
    mode,
    redirect,
    referrer,
    referrerPolicy,
    signal,
    window,
  });
}

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "UPDATE_CONFIG") {
    const client: any = event.source;
    updateConfig(client.id, event.data)
      .then(() => {
        event.ports[0].postMessage({ type: "CONFIG_UPDATED" });
      })
      .catch((e) => {
        event.ports[0].postMessage({
          type: "CONFIG_UPDATE_FAILED",
          error: e.message,
        });
      });
  }
});

async function updateConfig(clientId: string, config: Config): Promise<void> {
  const result = await fetch(config.tokenEndpoint, {
    headers: { Authorization: `Bearer ${config.token}` },
  })
    .then((response) => response.json())
    .catch((e) => e);
  if (result instanceof Error) {
    return Promise.reject(result);
  }
  configMap.set(clientId, { ...config, remoteToken: result.token });
  updateMap();
}

async function updateMap() {
  const clients = await self.clients.matchAll();
  for (const [clientId] of configMap) {
    if (!clients.find((client) => client.id === clientId)){
      configMap.delete(clientId);
    }
  }
}