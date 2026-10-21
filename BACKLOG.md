# Backlog

Open work that is not on the closed-test box yet. The DNS fallback plan is in `deploy/README.md`.

## DNS fallback

- [ ] Create Porkbun A records for `api.avouchsocial.org`, `avouchsocial.org`, and `www.avouchsocial.org` pointing at `140.82.61.209`, TTL 600.
- [ ] Optional Hurricane Electric secondary zone at `dns.he.net`.
- [ ] Monthly Cloudflare zone export, kept in the project Drive.
- [ ] Caddy `file_server` block so the static site can be served from the VPS during a fallback.
- [ ] Failover drill: point `deploy/.env` at the `.org` host, reload Caddy and the API, and check `/api/health`.
