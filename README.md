# P-Auth

A modern OAuth 2.0 / OpenID Connect authentication library built with Web Components and service workers for seamless token management and request interception.

## Features

- 🔒 **Secure Authentication** - OAuth 2.0 Authorization Code Flow with PKCE
- 🌐 **Service Worker Integration** - Automatic token injection for API requests
- 🧩 **Web Components** - Easy to integrate declarative HTML components
- 🔄 **Token Management** - Automatic token refresh and secure storage
- 📱 **Modern Browser Support** - Built for ES6+ environments
- 🎯 **URL Pattern Matching** - Fine-grained control over which requests get authenticated

## Installation

```bash
npm install p-auth
```

## Quick Start

### 1. Basic Setup

Add the authentication components to your HTML:

```html
<!DOCTYPE html>
<html>
<head>
  <title>My App</title>
</head>
<body>
  <!-- Your app content -->
  
  <!-- P-Auth setup -->
  <p-auth sw-url="/dist/sw.js" sw-scope="/">
    <p-code-flow 
      client-id="your-client-id"
      discovery-url="https://your-provider.com"
      scope="openid profile email"
      callback-path="/callback"
      url-pattern="https://api.example.com/.*">
    </p-code-flow>
  </p-auth>

  <script type="module" src="/dist/p-auth.js"></script>
</body>
</html>
```

### 2. Create a Callback Page

Create a callback page at the path specified in `callback-path`:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Authentication Callback</title>
</head>
<body>
    <p-auth sw-url="/dist/sw.js" sw-scope="/">
    <p-code-flow 
      client-id="your-client-id"
      discovery-url="https://your-provider.com"
      scope="openid profile email"
      callback-path="/callback"
      url-pattern="https://api.example.com/.*">
    </p-code-flow>
  </p-auth>
  <script type="module" src="/dist/p-auth.js"></script>
</body>
</html>
```

### 3. Multiple Identity Providers

You can configure multiple identity providers:

```html
<p-auth sw-url="/dist/sw.js" sw-scope="/">
  <!-- Google OAuth -->
  <p-code-flow 
    discovery-url="https://accounts.google.com"
    client-id="google-client-id"
    scope="openid email profile"
    callback-path="/callback"
    url-pattern="https://api.google.com/.*">
  </p-code-flow>
  
  <!-- Custom Provider -->
  <p-code-flow 
    discovery-url="https://auth.mycompany.com"
    client-id="company-client-id"
    scope="openid profile custom-scope"
    callback-path="/company-callback"
    url-pattern="https://api.mycompany.com/.*">
  </p-code-flow>
</p-auth>
```

## API Reference

### `<p-auth>` Element

The main container element that manages the service worker and authentication state.

#### Attributes

- `sw-url` - Path to the service worker file
- `sw-scope` - Scope for the service worker (typically "/")

### `<p-code-flow>` Element

Configures an OAuth 2.0 Authorization Code Flow client.

#### Attributes

- `client-id` - OAuth 2.0 client identifier
- `discovery-url` - OpenID Connect discovery endpoint URL
- `scope` - OAuth 2.0 scope string (space-separated)
- `callback-path` - Path for OAuth callback handling
- `url-pattern` - Regular expression pattern for matching URLs that need authentication

## Development

### Prerequisites

- Node.js 16+
- npm or yarn

### Setup

```bash
# Install dependencies
npm install

# Start development server
npm run develop

# Build for production
npm run build

# Run tests
npm run test
```


### Demo

Run the development server and visit `http://localhost:9090/demo/` to see the authentication flow in action.

## Security Considerations

- Uses PKCE (Proof Key for Code Exchange) for enhanced security
- Tokens are stored securely using IndexedDB
- Service worker runs in a separate context for isolation
- Automatic token refresh prevents expired token issues

## Browser Support

- Chrome 61+
- Firefox 53+
- Safari 11.1+
- Edge 79+

*Requires service worker and Web Components support*

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

ISC License - see LICENSE file for details.
