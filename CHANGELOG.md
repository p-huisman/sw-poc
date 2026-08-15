# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- OAuth `state` parameter is now generated with a random nonce, stored in
  `sessionStorage` and validated on the authorization callback, protecting
  against CSRF / login-confusion attacks.
- Post-authorization redirects are validated in the service worker to be
  same-origin, closing an open redirect via a crafted `state.url`.
- Client registration failures no longer mark clients as initialised or flush
  the queued fetch requests; an `authError` event is dispatched instead.
- Removed internal (non-public) identity provider URLs from the demo page and
  the development API.

### Fixed

- Main entry point exported a misspelled `PAUthElement`, causing
  `PAuthElement` to be silently missing from the built bundle.
- Service worker `message` handler now uses `event.waitUntil()`, so token
  exchange and token storage complete even when the worker would otherwise be
  terminated mid-operation.
- A failed token refresh after a 401 no longer retries the request with an
  invalid `Bearer undefined` header; the original 401 response is returned
  while re-authorization is initiated.
- Removed a double `decodeURIComponent` of the OAuth `state` parameter that
  could corrupt URLs containing percent-encoded characters.
- The service worker message listener is now (re)attached in
  `connectedCallback`, so reconnecting the `<p-auth>` element no longer breaks
  authorization and redirect handling.
- Service worker registration now runs in `connectedCallback` instead of the
  constructor, where the `sw-url` / `sw-scope` attributes are reliably
  available.
- `get-user-info` error paths now always respond on the message port instead
  of leaving the caller hanging until the 5 second timeout.
- The discovery document cache no longer leaks its internal `timestamp`
  bookkeeping field into the configuration returned to callers.
- Type declarations (`types/*.d.ts`) are emitted again during
  `npm run build` (broken `nodeModulesPath` in `p-build.json`).
- The logout return URL is built from `location.pathname + search + hash`
  instead of splitting the href on the origin string.
- The authorization callback parser now uses `URLSearchParams`, correctly
  handling values containing `=` characters.
- The fetch queue no longer leaks its periodic cleanup interval and logs less
  noise.

### Added

- Proactive token refresh: `expires_at` is computed when tokens are stored and
  expired access tokens are refreshed before a request is made (with a 30
  second skew allowance), instead of only reacting to 401 responses.
- `PAuthMessage` constants in `interfaces.ts` as the shared single source of
  truth for window ↔ service worker message types.
- Plain HTTP discovery URLs are allowed for `localhost` / `127.0.0.1` /
  `[::1]` to ease local development.
- `<p-code-flow>` skips re-registration when reconnected while already
  initialised, and cleans up its reference on disconnect.
- Tests: 28 browser tests covering the crypto helpers (including the
  RFC 7636 appendix B PKCE vector), the fetch queue and OpenID configuration
  fetching / validation / caching / deduplication. Added `@types/jasmine` and
  a `typecheck` script; `tsc --noEmit` is now clean.
- `package.json`: `files` list, `exports` map (including `./sw.js`), `types`
  field and `prepublishOnly` script for correct npm publishing.
- `LICENSE` file (ISC), matching the `license` field in `package.json`.
- README: documented the events (`authConnected`, `authInitialised`,
  `authError`), the `logout()` / `getUserInfo()` methods and the service
  worker serving requirements.

### Changed

- The service worker fetch path caches client registrations in memory and
  compiles URL patterns once, avoiding IndexedDB reads and regex compilation
  on every intercepted request.
- Fetch queuing now starts when the `<p-auth>` element connects to the DOM
  instead of at module import time.
- The OpenID discovery cache is versioned (`p-auth-openid-discovery-v1`) with
  opportunistic cleanup of the legacy cache.
- `idb-keyval` moved from `devDependencies` to `dependencies` (it is a runtime
  import).
- Log prefix aligned with the actual class name: `[ClientManager]`.

### Removed

- Dead silent-renewal code: `ClientManager.silentRenew()` and the unused
  `AuthFlowIFrameWrapper` helper (token refresh uses the refresh token or a
  full re-authorization flow).
- `cleanupStaleRequests()` and the periodic cleanup interval from the fetch
  queue (per-request timeouts already cover stale requests).
- Dead `testFiles` reference to the uninstalled `p-elements-core` package,
  which caused a 404 on the test page.

## [1.0.0] - 2025-07-17

### Added

- Initial release: `<p-auth>` and `<p-code-flow>` Web Components implementing
  the OAuth 2.0 Authorization Code Flow with PKCE, service-worker-based Bearer
  token injection for URL-pattern-matched requests, automatic token refresh on
  401 responses, token storage in IndexedDB, logout with token revocation and
  OpenID Connect user info retrieval.

[Unreleased]: https://github.com/p-huisman/sw-poc/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/p-huisman/sw-poc/releases/tag/v1.0.0
