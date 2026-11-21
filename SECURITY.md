# Security

Run the API behind HTTPS in production. Set `WEB_ORIGIN` to the exact browser
origin. Keep `TRUST_PROXY=0` for direct ingress or set it to the number of
trusted proxy hops on the only ingress path. The proxy must replace forwarded
client headers.

Access tokens are short-lived bearer tokens kept in browser memory. Refresh
tokens use an HttpOnly cookie with Secure enabled in production. The database
stores a hash of each refresh token. Refresh rotates the token and detected
reuse revokes the account’s refresh sessions. Cookie-authenticated requests
must supply the configured Origin or a same-origin Referer.

Report suspected issues privately to the repository maintainer using GitHub
private vulnerability reporting if enabled, or contact the maintainer without
including credentials or user data in a public issue.

Account email verification and password reset are currently unavailable. API
limits use per-process memory. Review [known issues](docs/known-issues.md) before
deployment.
