// Server-rendered HTML pages, plain template literals.

import {
  MAX_N,
  MAX_SET_SIZE,
  type VerifyResult,
} from './verify'

export interface User {
  id: number
  provider: string
  email?: string | null
  display_name?: string | null
  avatar_url?: string | null
}

export function escapeHtml(s: unknown): string {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const SITE_NAME = 'a + 3b = 2c + 2d'
const SITE_DESCRIPTION =
  "Ruzsa's genus-one equation: hunt for large subsets of Z/NZ with no " +
  'nontrivial solutions to a + 3b = 2c + 2d. Can you beat sqrt(N)?'

function authNav(user: User | null): string {
  if (user) {
    const name = escapeHtml(user.display_name || user.email || 'user')
    return (
      `<span class="auth-user">${name}</span>` +
      `<form class="auth-logout" method="post" action="/auth/logout"><button type="submit">log out</button></form>`
    )
  }
  return `<a href="/auth/github">log in with GitHub</a>`
}

export function layout(title: string, bodyInner: string, user: User | null = null): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(SITE_DESCRIPTION)}" />
    <link rel="stylesheet" href="/style.css" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  </head>
  <body>
    <header>
      <div class="inner">
        <h1><a href="/"><span class="eq">a&#8202;+&#8202;3b&#8202;=&#8202;2c&#8202;+&#8202;2d</span></a></h1>
        <nav><span class="tagline">Ruzsa&rsquo;s genus-one problem</span><span class="auth-nav">${authNav(user)}</span></nav>
      </div>
    </header>
    <main>${bodyInner}</main>
    <footer>
      <div class="inner">
        <p>Verification runs server-side in O(|A|&sup2;) time.
           Limits: N &le; ${MAX_N.toLocaleString('en-US')}, |A| &le; ${MAX_SET_SIZE.toLocaleString('en-US')}.</p>
      </div>
    </footer>
  </body>
</html>`
}

function problemStatement(): string {
  return `
  <section class="prose">
    <p>
      Fix a modulus <var>N</var> and look for a large set
      <var>A</var> &sube; <span class="math">&#8484;/N&#8484;</span> containing
      <em>no nontrivial solutions</em> to
    </p>
    <p class="display-eq"><span class="eq">a + 3b &equiv; 2c + 2d (mod N)</span></p>
    <p>
      with <var>a</var>, <var>b</var>, <var>c</var>, <var>d</var> &isin; <var>A</var>.
      A solution is <em>trivial</em> when <var>a</var> = <var>b</var> = <var>c</var> = <var>d</var>.
    </p>
    <p>
      The best known constructions achieve
      |<var>A</var>| = &Theta;(&radic;<span class="sqrt">N</span>), while the
      conjecture is that |<var>A</var>| = <var>N</var><sup>1&minus;o(1)</sup>
      is possible. The challenge: find a witness with score
      |<var>A</var>|&thinsp;/&thinsp;&radic;<span class="sqrt">N</span> &gt; 1.
    </p>
  </section>`
}

export interface FormState {
  nValue?: string
  elementsValue?: string
}

function verifierForm(state: FormState): string {
  return `
  <section class="panel">
    <h2>Verify a witness</h2>
    <form method="post" action="/verify">
      <label for="N">Modulus <var>N</var></label>
      <input id="N" name="N" type="text" inputmode="numeric" required
             placeholder="e.g. 25045" value="${escapeHtml(state.nValue ?? '')}" />
      <label for="A">Elements of <var>A</var> (integers separated by commas, spaces, or newlines; brackets ok)</label>
      <textarea id="A" name="A" rows="8" required
                placeholder="e.g. 0, 260, 268, 280, ...">${escapeHtml(state.elementsValue ?? '')}</textarea>
      <button type="submit">Verify</button>
    </form>
  </section>`
}

function fmtRatio(r: number): string {
  return r.toFixed(4)
}

function resultSection(result: VerifyResult): string {
  if (!result.ok) {
    return `
    <section class="result result-error">
      <h2>Error</h2>
      <p>${escapeHtml(result.error)}</p>
    </section>`
  }
  const sqrtN = Math.sqrt(result.N)
  const stats = `
      <dl class="stats">
        <div><dt>N</dt><dd>${result.N.toLocaleString('en-US')}</dd></div>
        <div><dt>|A|</dt><dd>${result.size.toLocaleString('en-US')}</dd></div>
        <div><dt>&radic;<span class="sqrt">N</span></dt><dd>${sqrtN.toFixed(1)}</dd></div>
        <div><dt>score |A|/&radic;<span class="sqrt">N</span></dt><dd class="score">${fmtRatio(result.ratio)}</dd></div>
      </dl>`
  if (result.valid) {
    const beats = result.ratio > 1
    return `
    <section class="result result-valid">
      <h2>Valid witness ✓</h2>
      <p>No nontrivial solutions to <span class="eq">a + 3b &equiv; 2c + 2d (mod ${result.N.toLocaleString(
        'en-US',
      )})</span> in this set.</p>
      ${stats}
      ${
        beats
          ? '<p class="beats">This witness beats &radic;<span class="sqrt">N</span>! 🏆</p>'
          : '<p class="muted">A score above 1 would beat the &radic;<span class="sqrt">N</span> barrier.</p>'
      }
    </section>`
  }
  const ce = result.counterexample
  const ceHtml = ce
    ? `<p>Counterexample: <span class="eq">${ce.a} + 3&middot;${ce.b} &equiv; 2&middot;${ce.c} + 2&middot;${
        ce.d
      } &equiv; ${(ce.a + 3 * ce.b) % result.N} (mod ${result.N.toLocaleString('en-US')})</span></p>`
    : ''
  return `
  <section class="result result-invalid">
    <h2>Not a valid witness ✗</h2>
    <p>The set contains a nontrivial solution.</p>
    ${ceHtml}
    ${stats}
  </section>`
}

export function landingPage(
  user: User | null = null,
  result?: VerifyResult,
  form: FormState = {},
): string {
  const body = `
    ${problemStatement()}
    ${result ? resultSection(result) : ''}
    ${verifierForm(form)}
    <section class="prose api-note">
      <h2>API</h2>
      <p>
        <code>POST /api/verify</code> with JSON body
        <code>{"N": 25045, "A": [0, 260, ...]}</code> returns the same verdict
        as JSON.
      </p>
    </section>`
  return layout(SITE_NAME, body, user)
}

export function notFoundPage(user: User | null = null): string {
  return layout('Not found', `<section class="prose"><p>Page not found.</p></section>`, user)
}
