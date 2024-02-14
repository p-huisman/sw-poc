export function swFetch(request: Request, token?: string): Promise<Response> {
  const headers = new Headers();
  if (token) {
    headers.append("Authorization", `Bearer ${token}`);
  }
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
  } = request as Request;

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
  });
}
