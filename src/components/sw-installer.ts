function getServiceWorkerScriptSrc(): string | null {
  const scriptElement = window.document.querySelector<HTMLScriptElement>(
    'script[src*="/p-oauth."]'
  );
  if (!scriptElement) {
    return null;
  }
  return (
    new URL(scriptElement.src).pathname.split("/").slice(0, -1).join("/") +
    "/p-oauth-sw.js"
  );
}
export async function installServiceWorker(
  scope = "/",
  serviceWorkerScriptSrc?: string
): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) {
    return Promise.reject(
      new Error("Service workers are not supported by this browser")
    );
  }
  const swScriptSrc = serviceWorkerScriptSrc
    ? serviceWorkerScriptSrc
    : getServiceWorkerScriptSrc();
  if (!swScriptSrc) {
    return Promise.reject(
      new Error("Service workers script source not configured")
    );
  }

  return navigator.serviceWorker
    .register(swScriptSrc, { scope })
    .catch((error) => error);
}
