# P-OAuth - OAuth2 Web Components with Service Worker

A proof-of-concept OAuth2 client library built as Web Components that leverages Service Workers for secure authentication and token management.

## Overview

This project provides a seamless OAuth2/OpenID Connect authentication solution for web applications using modern web standards. The library consists of custom web components that handle OAuth2 Authorization Code Flow with PKCE, while a Service Worker manages secure token storage and automatic request interception.

## Features

- 🔒 **Secure Token Management**: Service Worker-based token storage and management
- 🔄 **Automatic Token Refresh**: Transparent token renewal without user interaction
- 🚀 **Request Interception**: Automatic injection of authentication headers
- 📱 **Multiple Auth Providers**: Support for multiple OAuth2 providers simultaneously
- 🎯 **URL Pattern Matching**: Configure which requests should be authenticated
- 🛡️ **PKCE Support**: Built-in support for Proof Key for Code Exchange
- 🔧 **TypeScript**: Full TypeScript support with type definitions
- 🎨 **Web Components**: Standard-based custom elements for easy integration

## Architecture

### Components

- **`<p-oauth>`**: Main container component that manages Service Worker installation
- **`<p-auth-code-flow>`**: OAuth2 Authorization Code Flow implementation
- **Service Worker**: Handles token storage, request interception, and automatic authentication

### Key Files

- `src/components/p-oauth.ts` - Main OAuth container component
- `src/components/p-auth-code-flow.ts` - Authorization Code Flow component
- `src/service-worker/service-worker.ts` - Service Worker for token management
- `src/service-worker/session-manager.ts` - Session and token management
- `src/service-worker/code-flow/` - OAuth2 Code Flow handlers

## Installation

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn

### Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd sw-poc
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Development

### Scripts

- `npm start` - Build and serve the application
- `npm run develop` - Start development mode with file watching
- `npm run build` - Build production bundles
- `npm run serve` - Start the development server
- `npm run lint` - Run ESLint

### Development Mode

```bash
npm run develop
```

This will:
- Watch and rebuild TypeScript files
- Serve the application on http://localhost:9000
- Enable hot reloading for development

## Usage

### Basic Setup

```html
<!DOCTYPE html>
<html>
<head>
    <script src="dist/p-oauth.js"></script>
</head>
<body>
    <p-oauth>
        <p-auth-code-flow
            id="MyAuthProvider"
            discovery-url="https://your-oauth-provider.com/"
            client-id="your-client-id"
            scope="openid email profile"
            callback-path="/callback.html"
            url-pattern="(/api/|/secure/)"
        ></p-auth-code-flow>
    </p-oauth>
</body>
</html>
```

### Configuration Options

#### `<p-auth-code-flow>` Attributes

- `id` - Unique identifier for the auth client
- `discovery-url` - OAuth2/OpenID Connect discovery endpoint
- `client-id` - OAuth2 client identifier
- `scope` - Requested OAuth2 scopes (space-separated)
- `callback-path` - Path to the callback page
- `url-pattern` - Regular expression pattern for URLs that require authentication
- `storage` - Storage type (`local` or `session`, default: `local`)
- `storage-key` - Custom key for token storage

### Multiple Auth Providers

```html
<p-oauth>
    <p-auth-code-flow
        id="Provider1"
        discovery-url="https://provider1.com/"
        client-id="client1"
        scope="openid profile"
        callback-path="/callback.html"
        url-pattern="(/api/provider1/)"
    ></p-auth-code-flow>

    <p-auth-code-flow
        id="Provider2"
        discovery-url="https://provider2.com/"
        client-id="client2"
        scope="openid email"
        callback-path="/callback.html"
        url-pattern="(/api/provider2/)"
    ></p-auth-code-flow>
</p-oauth>
```

## Demo

The project includes a demo application showcasing integration with multiple OAuth2 providers:

1. **Duende Demo**: Public demo using Duende IdentityServer
2. **PFZW Demo**: Example enterprise integration

Run the demo:
```bash
npm start
```

Navigate to http://localhost:9000/demo/ to see the demo in action.

## How It Works

1. **Service Worker Installation**: The `<p-oauth>` component installs and manages a Service Worker
2. **Request Interception**: The Service Worker intercepts network requests matching configured URL patterns
3. **Token Management**: Tokens are securely stored and managed by the Service Worker
4. **Automatic Authentication**: Valid tokens are automatically injected into matching requests
5. **Token Refresh**: Expired tokens are automatically refreshed using refresh tokens
6. **Authorization Flow**: When authentication is needed, the Authorization Code Flow with PKCE is initiated

## Security Features

- **Service Worker Isolation**: Tokens are stored in Service Worker scope, isolated from the main thread
- **PKCE Implementation**: Uses Proof Key for Code Exchange for enhanced security
- **Automatic Token Rotation**: Handles token refresh automatically
- **Secure Storage**: Tokens are stored using browser's native storage mechanisms
- **Pattern-based Authorization**: Only specified URL patterns trigger authentication

## Browser Support

- Chrome 61+
- Firefox 53+
- Safari 11.1+
- Edge 79+

Requires Service Worker and Web Components support.

## License

UNLICENSED - Private project

## Contributing

This is a proof-of-concept project. For contributions or questions, please contact the author.

## Author

Peter Huisman

---

*This project demonstrates modern web authentication patterns using Service Workers and Web Components for secure, seamless OAuth2 integration.*
