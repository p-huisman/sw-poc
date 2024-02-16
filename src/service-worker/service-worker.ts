import { createOAuthDatabase, SessionRecord } from "./session-database";

declare var self: ServiceWorkerGlobalScope;

const oauthDatabase = createOAuthDatabase(self);

export type {};

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", async (event: FetchEvent) => {
  
  let responseResolve: (value: Response | PromiseLike<Response>) => void;
  let responseReject: (reason?: any) => void;

  const responsePromise = new Promise<Response>((resolve, reject) => {
    responseResolve = resolve;
    responseReject = reject;
  });
  event.respondWith(responsePromise);

  const client = await oauthDatabase.getClientForRequest(
    event.request.url,
    event.clientId
  );


  if (client) {
    console.log("client", client);
    fetch(event.request)
      .then((fetchResponse) => responseResolve(fetchResponse))
      .catch((e) => responseReject(e));
  } else {
    fetch(event.request)
      .then((fetchResponse) => responseResolve(fetchResponse))
      .catch((e) => responseReject(e));
  }
  
});

self.addEventListener("message", async (event: ExtendableMessageEvent) => {
  const eventClient = event.source as Client;

  switch (event.data.type) {
    case "register-auth-client":
      // remove old sessions
      await oauthDatabase.removeExpiredSessions();

      // add or update session
      const { authClient, session } = event.data;
      await oauthDatabase.addSession(
        session,
        eventClient.id,
        authClient.id,
        authClient
      );

      event.ports[0].postMessage({
        type: "register-auth-client",
        success: true,
      });

      break;
  }
});
