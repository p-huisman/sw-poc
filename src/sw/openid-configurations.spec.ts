import {
  getItemFromOpenIdConfig,
  getOpenIdConfiguration,
} from "./openid-configurations";

const discoveryDocument = {
  issuer: "https://idp.example.com",
  authorization_endpoint: "https://idp.example.com/authorize",
  token_endpoint: "https://idp.example.com/token",
  userinfo_endpoint: "https://idp.example.com/userinfo",
};

const wellKnownUrl = "https://idp.example.com/.well-known/openid-configuration";

function jsonResponse(body: unknown, contentType = "application/json"): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": contentType },
  });
}

/**
 * Creates a minimal fake ServiceWorkerGlobalScope with an in-memory cache,
 * exposing the backing store so tests can pre-seed cache entries.
 */
function fakeScope(fetchImpl: (url: string) => Promise<Response>) {
  const store = new Map<string, string>();
  const fakeCache = {
    match: async (url: string) =>
      store.has(url)
        ? new Response(store.get(url), {
            headers: { "Content-Type": "application/json" },
          })
        : undefined,
    put: async (url: string, response: Response) => {
      store.set(url, await response.text());
    },
  };
  const scope = {
    fetch: fetchImpl,
    caches: {
      open: async () => fakeCache,
      delete: async () => true,
    },
  } as unknown as ServiceWorkerGlobalScope;
  return { scope, store };
}

describe("openid-configurations", () => {
  it("rejects an invalid discovery URL", async () => {
    const { scope } = fakeScope(() => Promise.resolve(jsonResponse(discoveryDocument)));
    await expectAsync(
      getOpenIdConfiguration(scope, "not a url")
    ).toBeRejectedWithError(/Invalid discovery URL format/);
  });

  it("requires HTTPS for non-localhost discovery URLs", async () => {
    const { scope } = fakeScope(() => Promise.resolve(jsonResponse(discoveryDocument)));
    await expectAsync(
      getOpenIdConfiguration(scope, "http://idp.example.com")
    ).toBeRejectedWithError(/HTTPS/);
  });

  it("allows plain HTTP for localhost (local development)", async () => {
    const fetchSpy = jasmine
      .createSpy("fetch")
      .and.callFake(() => Promise.resolve(jsonResponse(discoveryDocument)));
    const { scope } = fakeScope(fetchSpy);
    const config = await getOpenIdConfiguration(scope, "http://localhost:8080");
    expect(config.token_endpoint).toBe(discoveryDocument.token_endpoint);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:8080/.well-known/openid-configuration",
      jasmine.any(Object)
    );
  });

  it("appends the .well-known path when missing", async () => {
    const fetchSpy = jasmine
      .createSpy("fetch")
      .and.callFake(() => Promise.resolve(jsonResponse(discoveryDocument)));
    const { scope } = fakeScope(fetchSpy);
    await getOpenIdConfiguration(scope, "https://idp.example.com");
    expect(fetchSpy).toHaveBeenCalledWith(wellKnownUrl, jasmine.any(Object));
  });

  it("does not append the .well-known path when already present", async () => {
    const fetchSpy = jasmine
      .createSpy("fetch")
      .and.callFake(() => Promise.resolve(jsonResponse(discoveryDocument)));
    const { scope } = fakeScope(fetchSpy);
    await getOpenIdConfiguration(scope, wellKnownUrl);
    expect(fetchSpy).toHaveBeenCalledWith(wellKnownUrl, jasmine.any(Object));
  });
  it("deduplicates concurrent requests for the same URL", async () => {
    const fetchSpy = jasmine
      .createSpy("fetch")
      .and.callFake(() => Promise.resolve(jsonResponse(discoveryDocument)));
    const { scope } = fakeScope(fetchSpy);
    const [a, b] = await Promise.all([
      getOpenIdConfiguration(scope, "https://idp.example.com"),
      getOpenIdConfiguration(scope, "https://idp.example.com"),
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("serves the configuration from cache on subsequent calls", async () => {
    const fetchSpy = jasmine
      .createSpy("fetch")
      .and.callFake(() => Promise.resolve(jsonResponse(discoveryDocument)));
    const { scope } = fakeScope(fetchSpy);
    await getOpenIdConfiguration(scope, "https://idp.example.com");
    const cached = await getOpenIdConfiguration(scope, "https://idp.example.com");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(cached.token_endpoint).toBe(discoveryDocument.token_endpoint);
    // The internal bookkeeping field must not leak into the returned document
    expect(cached.timestamp).toBeUndefined();
  });

  it("refetches when the cached entry is expired", async () => {
    const fetchSpy = jasmine
      .createSpy("fetch")
      .and.callFake(() => Promise.resolve(jsonResponse(discoveryDocument)));
    const { scope, store } = fakeScope(fetchSpy);
    store.set(
      wellKnownUrl,
      JSON.stringify({
        timestamp: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
        data: discoveryDocument,
      })
    );
    await getOpenIdConfiguration(scope, "https://idp.example.com");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects when the discovery document misses required fields", async () => {
    const { scope } = fakeScope(() =>
      Promise.resolve(jsonResponse({ issuer: "https://idp.example.com" }))
    );
    await expectAsync(
      getOpenIdConfiguration(scope, "https://idp.example.com")
    ).toBeRejectedWithError(/missing required fields/);
  });

  it("rejects when the response is not JSON", async () => {
    const { scope } = fakeScope(() =>
      Promise.resolve(jsonResponse(discoveryDocument, "text/plain"))
    );
    await expectAsync(
      getOpenIdConfiguration(scope, "https://idp.example.com")
    ).toBeRejectedWithError(/Invalid content type/);
  });

  it("rejects when the provider returns an HTTP error", async () => {
    const { scope } = fakeScope(() =>
      Promise.resolve(
        new Response("nope", { status: 404, statusText: "Not Found" })
      )
    );
    await expectAsync(
      getOpenIdConfiguration(scope, "https://idp.example.com")
    ).toBeRejectedWithError(/404/);
  });

  it("getItemFromOpenIdConfig returns a single configuration item", async () => {
    const { scope } = fakeScope(() => Promise.resolve(jsonResponse(discoveryDocument)));
    const tokenEndpoint = await getItemFromOpenIdConfig(
      scope,
      "https://idp.example.com",
      "token_endpoint"
    );
    expect(tokenEndpoint).toBe(discoveryDocument.token_endpoint);
  });

  it("getItemFromOpenIdConfig rejects when the item is missing", async () => {
    const { scope } = fakeScope(() => Promise.resolve(jsonResponse(discoveryDocument)));
    await expectAsync(
      getItemFromOpenIdConfig(scope, "https://idp.example.com", "jwks_uri")
    ).toBeRejectedWithError(/not found/);
  });
});

