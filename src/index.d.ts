interface Window {
  fetch: (url: URL | RequestInfo, requestInit?: RequestInit) => Promise<Response>;
}