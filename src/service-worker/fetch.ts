export function fetchWithAuthorizationHeader(
  request: Request,
  authorizationHeader?: string,
): Promise<Response> {
  const headers = new Headers();
  if (authorizationHeader) {
    headers.append("Authorization", authorizationHeader);
  }
  if (request.headers) {
    for (const key of (request.headers as any).keys()) {
      if (key.toString().toLowerCase() !== "authorization") {
        headers.append(key, request.headers.get(key));
      }
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
