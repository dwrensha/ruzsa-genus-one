# Ruzsa's genus-one problem

A record-keeping site for a problem of Ruzsa: live at
[ruzsa-genus-one.icarm.cloud](https://ruzsa-genus-one.icarm.cloud).

## The problem

Fix a modulus N and hunt for a large subset A ⊆ Z/NZ with no nontrivial
solutions to

    a + 3b ≡ 2c + 2d (mod N)

(nontrivial: not all of a, b, c, d equal). This is a genus-one equation in
the sense of Ruzsa, [*Solving a linear equation in a set of integers I*,
Acta Arith. 65 (1993)](https://matwbn.icm.edu.pl/ksiazki/aa/aa65/aa6537.pdf).
Best known constructions have |A| = Θ(√N); the conjecture is that
|A| = N^(1−o(1)) is possible. The challenge: a *witness* — a verified
solution-free set — with score |A|/√N > 1.

## The site

- **Submit witnesses** (GitHub login required). Verification is pure
  TypeScript, O(|A|²) time and O(N) memory via a counting argument
  (`src/verify.ts`). Limits: N ≤ 50,000 and |A| ≤ 10,000.
- **Records.** A submission that strictly beats the record for its modulus
  is saved and attributed; beaten records are kept as history. The landing
  page plots r(N) against N on log-log axes with the √N barrier drawn in.
- **Witness pages** with a single editable commentary each (full edit
  history kept), plus a paginated recent-activity feed.
- **JSON API** (`POST /api/verify`, bearer tokens managed on the profile
  page) and a full database download (`GET /database.json`). Docs at
  [/api](https://ruzsa-genus-one.icarm.cloud/api).

## Architecture

[Cloudflare Workers](https://developers.cloudflare.com/workers/) with
[Hono](https://hono.dev). Users, witnesses, commentary, and API tokens live
in D1 (`migrations/`); login sessions and post-submit result flashes live in
KV. Session cookies and API tokens are stored only as SHA-256 hashes.

## Development

    npm install
    npx wrangler d1 migrations apply ruzsa-genus-one --local
    npm run dev        # local server
    npm run typecheck

GitHub login needs a dev OAuth app (callback
`http://localhost:8787/auth/github/callback`) with its credentials in
`.dev.vars`:

    GITHUB_CLIENT_ID=...
    GITHUB_CLIENT_SECRET=...

## Deploy

    npx wrangler d1 migrations apply ruzsa-genus-one --remote
    npm run deploy

One-time setup: create the D1 database and KV namespace (ids in
`wrangler.jsonc`), and set `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` via
`wrangler secret put` from a GitHub OAuth app whose callback URL is
`https://ruzsa-genus-one.icarm.cloud/auth/github/callback`.
