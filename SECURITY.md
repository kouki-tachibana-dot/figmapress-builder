# Security Policy

## Supported version

Security fixes are provided for the latest public beta release.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's
private vulnerability reporting feature from the repository's **Security**
tab. Include the affected route, reproduction steps, and expected impact.

## Security model

- Credentials are never written to the application database or server files.
  Figma OAuth tokens are AES-256-GCM encrypted in an HttpOnly, SameSite cookie.
  Personal Access Tokens use tab session storage unless the user explicitly
  opts into local browser storage.
- WordPress Application Passwords are processed in memory for one request and
  are not retained. One-click pairing stores a 90-day scoped token in browser
  storage and only an HMAC hash in WordPress user metadata.
- Conversion and WordPress responses use `Cache-Control: no-store`.
- WordPress requests require HTTPS and reject loopback, private, link-local,
  multicast, and reserved network destinations.
- External redirects are rejected to reduce SSRF risk.
- WordPress output is always created with `status: draft`; publishing is not
  implemented.
- Elementor creation is exposed only by FigmaPress Connector, requires an
  authenticated user with `edit_pages`, validates an allowlist of core widget
  types, and sanitizes all nested settings before writing private post meta.
- Remote Elementor images are limited to public HTTPS URLs, 60 files, and
  10 MB per file before they are added to the Media Library.
- Request body limits, timeouts, same-origin checks, validation, and
  best-effort per-instance rate limits are enabled.
- The preview runs in a sandboxed iframe with scripts disabled.
- Connector pairing tokens are accepted only under the `figmapress/v1` REST
  namespace, cannot authenticate general WordPress REST or login requests, and
  can be immediately replaced or revoked by the WordPress user.
- Figma OAuth uses PKCE and requests only `file_content:read`. Environments
  without configured OAuth credentials fall back to a narrowly scoped PAT.
