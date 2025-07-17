/**
 * P-Auth: A modern OAuth 2.0 / OpenID Connect authentication library
 * 
 * This library provides Web Components for implementing secure authentication flows
 * using service workers for seamless token management and request interception.
 * 
 * @example Basic Usage
 * ```html
 * <p-auth sw-url="/auth-sw.js" sw-scope="/">
 *   <p-code-flow 
 *     client-id="your-client-id"
 *     discovery-url="https://accounts.google.com"
 *     scope="openid profile email"
 *     callback-path="/callback"
 *     url-pattern="https://api.example.com/.*">
 *   </p-code-flow>
 * </p-auth>
 * ```
 */

// Core Components
export { PAUthElement } from "./components/p-auth";
export { PCodeFlowElement } from "./components/p-code-flow";
