# Security Policy

## Supported version

Security fixes are provided for the latest public beta release.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's
private vulnerability reporting feature from the repository's **Security**
tab. Include the affected route, reproduction steps, and expected impact.

## Security model

- Figma and WordPress credentials are processed in memory for one request and
  are never written to application storage.
- Conversion and WordPress responses use `Cache-Control: no-store`.
- WordPress requests require HTTPS and reject loopback, private, link-local,
  multicast, and reserved network destinations.
- External redirects are rejected to reduce SSRF risk.
- WordPress output is always created with `status: draft`; publishing is not
  implemented.
- Elementor creation is exposed only by FigmaPress Connector, requires an
  authenticated user with `edit_pages`, validates an allowlist of core widget
  types, and sanitizes all nested settings before writing private post meta.
- Remote Elementor images are limited to public HTTPS URLs, 12 files, and
  10 MB per file before they are added to the Media Library.
- Request body limits, timeouts, same-origin checks, validation, and
  best-effort per-instance rate limits are enabled.
- The preview runs in a sandboxed iframe with scripts disabled.

This beta does not yet use Figma OAuth. Users should issue a narrowly scoped,
short-lived Personal Access Token with `file_content:read` only and revoke it
when it is no longer needed.
