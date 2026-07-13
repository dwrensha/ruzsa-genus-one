# Ruzsa genus-one equation verifier

Hunt for large subsets A of Z/NZ with no nontrivial solutions to

    a + 3b ≡ 2c + 2d (mod N)

(nontrivial: not all of a, b, c, d equal). Best known constructions have
|A| = Θ(√N); the conjecture is |A| = N^(1-o(1)) is possible. The goal is a
witness with |A|/√N > 1.

Runs on [Cloudflare Workers](https://developers.cloudflare.com/workers/) with
[Hono](https://hono.dev). Verification is pure TypeScript, O(|A|²) time and
O(N) memory via a counting argument (see `src/verify.ts`).

## Development

    npm install
    npm run dev        # local server
    npm run typecheck

## Deploy

    npm run deploy
