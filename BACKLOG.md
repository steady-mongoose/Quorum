# Backlog

Open work that is not on the closed-test box yet. The DNS fallback plan is in `deploy/README.md`.

## DNS fallback

- [ ] Create Porkbun A records for `api.avouchsocial.org`, `avouchsocial.org`, and `www.avouchsocial.org` pointing at `140.82.61.209`, TTL 600.
- [ ] Optional Hurricane Electric secondary zone at `dns.he.net`.
- [ ] Monthly Cloudflare zone export, kept in the project Drive.
- [ ] Caddy `file_server` block so the static site can be served from the VPS during a fallback. It needs the Worker's headers and SPA rules: extensionless paths serve the shell, real files stay files, and `/api` is excluded so it is not served as the site.
- [ ] The Caddy site address must follow `API_HOST`, so a switch to `api.avouchsocial.org` does not leave the site block on the `.com` name.
- [ ] Failover drill: point `deploy/.env` at the `.org` host, reload Caddy and the API, check that the certificate covers those names, and check `/api/health`.
- [ ] Confirm no cookie `Domain` is pinned to `.avouchsocial.com`, so a session is not forced onto the `.com` name during a fallback.
