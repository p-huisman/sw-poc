export function fetchWithAuthorizationHeader(
  request: Request,
  authorizationHeader?: string,
): Promise<Response> {
  const headers = new Headers();
  if (authorizationHeader) {
    headers.append("Authorization", authorizationHeader);
  }
  if (request.headers) {
    for (const [key, value] of request.headers.entries()) {
      if (key.toLowerCase() !== "authorization") {
        headers.append(key, value);
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
  } = request;

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
