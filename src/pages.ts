// Server-rendered HTML pages, plain template literals.

import {
  MAX_N,
  MAX_SET_SIZE,
  type VerifyResult,
} from './verify'
import type {
  ActivityItem,
  CommentView,
  RecordStatus,
  WitnessView,
} from './store'
import { COMMENT_MAX } from './store'

export interface User {
  id: number
  provider: string
  email?: string | null
  display_name?: string | null
  avatar_url?: string | null
}

export interface TokenRow {
  id: number
  name: string | null
  prefix: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export interface UserWitnessRow {
  id: number
  n: number
  size: number
  ratio: number
  created_at: string
  is_current: number // SQLite boolean: 1 when still the record for n
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

const SITE_NAME = 'Ruzsa’s genus-one problem'
const SITE_DESCRIPTION =
  "Ruzsa's genus-one equation: hunt for large subsets of Z/NZ with no " +
  'nontrivial solutions to a + 3b = 2c + 2d. Can you beat sqrt(N)?'

function authNav(user: User | null): string {
  if (user) {
    const name = escapeHtml(user.display_name || user.email || 'user')
    return (
      `<a href="/profile" class="auth-user">${name}</a>` +
      `<form class="auth-logout" method="post" action="/auth/logout"><button type="submit">log out</button></form>`
    )
  }
  return `<a class="auth-login" href="/auth/github">log in with GitHub</a>`
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
        <h1><a href="/">Ruzsa&rsquo;s genus-one problem</a></h1>
        <nav><span class="auth-nav">${authNav(user)}</span></nav>
      </div>
    </header>
    <main>${bodyInner}</main>
    <footer>
      <div class="inner">
        <nav class="footer-links">
          <a href="/recent">recent activity</a> &nbsp;&middot;&nbsp;
          <a href="/api">API</a> &nbsp;&middot;&nbsp;
          <a class="external" href="https://github.com/dwrensha/ruzsa-genus-one">source</a> &nbsp;&middot;&nbsp;
          <a class="external" href="https://icarm.io">icarm.io</a>
        </nav>
        <p class="acknowledgment">This website is maintained by the NSF Institute for Computer-Aided
        Reasoning in Mathematics <span class="nowrap">(<a class="external" href="https://icarm.io">ICARM</a>)</span>.
        Please <a href="/acknowledge">acknowledge</a> ICARM and NSF Grant DMS 2425401 in related
        publications, projects, or other scholarly work.</p>
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

/** A current record: the witness row id, the modulus, and its best size. */
export interface RecordPoint {
  id: number
  n: number
  size: number
}

// Server-rendered SVG scatters of the records against the modulus N. Both
// views share a fixed 720x440 frame with a log10-N x-axis, so the sqrt(N)
// goal always reads the same. No JS; tooltips via <title>.
const PLOT = { W: 720, H: 440, L: 56, R: 18, T: 18, B: 46 }
const INNER_W = PLOT.W - PLOT.L - PLOT.R
const INNER_H = PLOT.H - PLOT.T - PLOT.B
const LOG_NMAX = Math.log10(MAX_N) // ~4.7
const plotX = (logN: number) => PLOT.L + (logN / LOG_NMAX) * INNER_W

// Tick labels as powers of ten.
const pow10 = (k: number): string =>
  k === 0 ? '1' : `10<tspan class="sup" dy="-5">${k}</tspan><tspan dy="5">&#8203;</tspan>`

// Decade gridlines and ticks for the shared x-axis.
function xDecadeGrid(): string {
  let grid = ''
  for (let k = 0; k <= Math.floor(LOG_NMAX); k++) {
    const x = plotX(k).toFixed(1)
    if (k > 0) grid += `<line class="grid" x1="${x}" y1="${PLOT.T}" x2="${x}" y2="${PLOT.T + INNER_H}"/>`
    grid += `<text class="tick" x="${x}" y="${PLOT.T + INNER_H + 18}" text-anchor="middle">${pow10(k)}</text>`
  }
  return grid
}

// One record dot linking to its witness page; cy is view-specific.
function recordDot(p: RecordPoint, cy: number): string {
  const ratio = p.size / Math.sqrt(p.n)
  const exponent = Math.log(p.size) / Math.log(p.n)
  const beats = ratio > 1
  return `<a href="/witness/${p.id}"><circle class="dot${beats ? ' beats-sqrt' : ''}" cx="${plotX(
    Math.log10(p.n),
  ).toFixed(1)}" cy="${cy.toFixed(1)}" r="${beats ? 4.5 : 3}"><title>N = ${p.n.toLocaleString(
    'en-US',
  )}: record |A| = ${p.size.toLocaleString('en-US')} (score ${ratio.toFixed(4)}, exponent ${exponent.toFixed(
    4,
  )})</title></circle></a>`
}

function plotSvg(ariaLabel: string, yTitle: string, body: string): string {
  return `<svg class="records-plot" viewBox="0 0 ${PLOT.W} ${PLOT.H}" role="img" aria-label="${ariaLabel}">
      ${body}
      <line class="axis" x1="${PLOT.L}" y1="${PLOT.T}" x2="${PLOT.L}" y2="${PLOT.T + INNER_H}"/>
      <line class="axis" x1="${PLOT.L}" y1="${PLOT.T + INNER_H}" x2="${PLOT.W - PLOT.R}" y2="${PLOT.T + INNER_H}"/>
      <text class="axis-title" x="${PLOT.L + INNER_W / 2}" y="${PLOT.H - 6}" text-anchor="middle">modulus N &#8594;</text>
      <text class="axis-title" transform="rotate(-90)" x="${-(PLOT.T + INNER_H / 2)}" y="15" text-anchor="middle">${yTitle}</text>
    </svg>`
}

// Log-log view: record size r(N) against N. The y-scale is chosen so the
// r = sqrt(N) goal line runs corner to corner.
function sizePlot(pts: RecordPoint[]): string {
  const ymax = LOG_NMAX / 2
  const Y = (logR: number) => PLOT.T + INNER_H - (logR / ymax) * INNER_H

  let grid = xDecadeGrid()
  for (let k = 0; k <= Math.floor(ymax); k++) {
    const y = Y(k).toFixed(1)
    if (k > 0) grid += `<line class="grid" x1="${PLOT.L}" y1="${y}" x2="${PLOT.W - PLOT.R}" y2="${y}"/>`
    grid += `<text class="tick" x="${PLOT.L - 8}" y="${(Y(k) + 4).toFixed(1)}" text-anchor="end">${pow10(k)}</text>`
  }

  // The sqrt(N) barrier (log r = log N / 2), corner to corner. Its label runs
  // along the line, nudged perpendicular so it doesn't overlap.
  const lineAngle = (Math.atan2(-INNER_H, INNER_W) * 180) / Math.PI
  const labelX = PLOT.L + 0.85 * INNER_W, labelY = PLOT.T + 0.15 * INNER_H
  const sqrtLine = `<line class="guide guide-sqrt" x1="${plotX(0)}" y1="${Y(0)}" x2="${plotX(LOG_NMAX).toFixed(1)}" y2="${Y(LOG_NMAX / 2).toFixed(1)}"/>
      <text class="guide-label" transform="rotate(${lineAngle.toFixed(1)} ${labelX.toFixed(1)} ${labelY.toFixed(1)})" x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" dy="-7" text-anchor="end">r = &#8730;N</text>`

  const dots = pts.map((p) => recordDot(p, Y(Math.log10(p.size)))).join('\n      ')
  return plotSvg(
    'record witness size versus modulus, log-log scatter plot',
    'record witness size r(N) &#8594;',
    `${grid}\n      ${sqrtLine}\n      ${dots}`,
  )
}

// Exponent view: log r(N) / log N against N, linear y from 0 to 1, so the
// sqrt(N) barrier is the horizontal line at 1/2.
function exponentPlot(pts: RecordPoint[]): string {
  const Y = (v: number) => PLOT.T + INNER_H - v * INNER_H

  let grid = xDecadeGrid()
  for (const v of [0, 0.25, 0.75, 1]) {
    const y = Y(v).toFixed(1)
    if (v > 0) grid += `<line class="grid" x1="${PLOT.L}" y1="${y}" x2="${PLOT.W - PLOT.R}" y2="${y}"/>`
    grid += `<text class="tick" x="${PLOT.L - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`
  }
  grid += `<text class="tick" x="${PLOT.L - 8}" y="${(Y(0.5) + 4).toFixed(1)}" text-anchor="end">0.5</text>`

  const sqrtLine = `<line class="guide guide-sqrt" x1="${PLOT.L}" y1="${Y(0.5)}" x2="${PLOT.W - PLOT.R}" y2="${Y(0.5)}"/>
      <text class="guide-label" x="${PLOT.W - PLOT.R - 8}" y="${(Y(0.5) - 8).toFixed(1)}" text-anchor="end">r = &#8730;N</text>`

  const dots = pts.map((p) => recordDot(p, Y(Math.log(p.size) / Math.log(p.n)))).join('\n      ')
  return plotSvg(
    'exponent log r over log N versus modulus scatter plot',
    'exponent log r(N) / log N &#8594;',
    `${grid}\n      ${sqrtLine}\n      ${dots}`,
  )
}

function recordsSection(records: RecordPoint[]): string {
  const inner =
    records.length === 0
      ? '<p class="muted">No record witnesses yet &mdash; submit a valid set to put the first dot on the board.</p>'
      : `<input class="plot-radio" type="radio" name="records-plot" id="plot-size" checked>
    <input class="plot-radio" type="radio" name="records-plot" id="plot-exponent">
    <div class="plot-tabs">
      <label for="plot-size">record size r(N)</label>
      <label for="plot-exponent">exponent log&thinsp;r&thinsp;/&thinsp;log&thinsp;N</label>
    </div>
    <div class="plot-panel plot-panel-size">${sizePlot(records)}</div>
    <div class="plot-panel plot-panel-exponent">${exponentPlot(records)}</div>`
  return `
  <section class="panel records">
    <h2>Records</h2>
    ${inner}
    <p class="muted plot-caption">Each dot is the largest known witness for its modulus.
    A dot above the dashed line beats &radic;<span class="sqrt">N</span>.</p>
    <p class="plot-caption"><a class="nowrap" href="/database.json" download>Download all records (JSON) &darr;</a></p>
  </section>`
}

function verifierForm(state: FormState, user: User | null): string {
  const submit = user
    ? '<button type="submit">Verify</button>'
    : '<a class="login-to-submit" href="/auth/github">Log in to submit</a>'
  return `
  <section class="panel">
    <h2>Submit a witness</h2>
    <form method="post" action="/verify">
      <label for="N">Modulus <var>N</var></label>
      <input id="N" name="N" type="text" inputmode="numeric" required
             placeholder="e.g. 25045" value="${escapeHtml(state.nValue ?? '')}" />
      <label for="A">Elements of <var>A</var> (integers separated by commas, spaces, or newlines; brackets ok)</label>
      <textarea id="A" name="A" rows="8" required
                placeholder="e.g. 0, 260, 268, 280, ...">${escapeHtml(state.elementsValue ?? '')}</textarea>
      ${submit}
      <p class="muted form-note">Verification runs server-side in O(|A|&sup2;) time.
         Limits: N &le; ${MAX_N.toLocaleString('en-US')}, |A| &le; ${MAX_SET_SIZE.toLocaleString('en-US')}.</p>
    </form>
  </section>`
}

function fmtRatio(r: number): string {
  return r.toFixed(4)
}

function recordSection(size: number, N: number, record?: RecordStatus): string {
  if (!record) return ''
  const nStr = N.toLocaleString('en-US')
  const recordLink = (text: string) =>
    record.witnessId ? `<a href="/witness/${record.witnessId}">${text}</a>` : text
  if (record.recorded) {
    return `<p class="record-new">New record: the largest known witness for N = ${nStr}. Saved as ${recordLink(
      `witness #${record.witnessId}`,
    )}.</p>`
  }
  if (record.recordSize === size) {
    if (record.tiedExact) {
      return `<p class="muted">This is exactly the ${recordLink('current record witness')} for N = ${nStr} (|A| = ${record.recordSize.toLocaleString(
        'en-US',
      )}), element for element.</p>`
    }
    return `<p class="muted">Ties the ${recordLink('current record')} for N = ${nStr} (|A| = ${record.recordSize.toLocaleString(
      'en-US',
    )}) with a <em>different</em> set of the same size &mdash; the standing record keeps its place.</p>`
  }
  return `<p class="muted">The ${recordLink('record witness')} for N = ${nStr} has |A| = ${record.recordSize.toLocaleString(
    'en-US',
  )}, so this one was not saved.</p>`
}

function resultSection(result: VerifyResult, record?: RecordStatus): string {
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
      ${recordSection(result.size, result.N, record)}
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
  records: RecordPoint[] = [],
  resultExpired = false,
): string {
  const expiredNote = resultExpired
    ? '<section class="prose"><p class="muted">That result link has expired &mdash; submit the set again below.</p></section>'
    : ''
  const body = `
    ${problemStatement()}
    ${expiredNote}
    ${recordsSection(records)}
    ${verifierForm({}, user)}
    <section class="prose api-note">
      <h2>API</h2>
      <p>
        <code>POST /api/verify</code> with JSON body
        <code>{"N": 25045, "A": [0, 260, ...]}</code> returns the same verdict
        as JSON. See the <a href="/api">API docs</a>.
      </p>
    </section>`
  return layout(SITE_NAME, body, user)
}

// Post/Redirect/Get target for non-record submissions: the verdict plus the
// form, pre-filled for quick iteration. Served from a short-lived KV flash,
// so reloading is harmless.
export function resultPage(
  user: User | null,
  result: VerifyResult,
  record: RecordStatus | undefined,
  form: FormState,
): string {
  const body = `
    <section class="prose">
      <p class="page-nav"><a href="/">&larr; home</a></p>
    </section>
    ${resultSection(result, record)}
    ${verifierForm(form, user)}`
  return layout(`Result — ${SITE_NAME}`, body, user)
}

function userWitnessesSection(rows: UserWitnessRow[]): string {
  const heading = `<h3>Your record witnesses <span class="muted">(${rows.length})</span></h3>`
  if (rows.length === 0) {
    return `<section class="my-witnesses">
      ${heading}
      <p class="muted">None yet &mdash; a witness is saved here when it sets the record for its modulus. <a href="/">Submit one &rarr;</a></p>
    </section>`
  }
  const trs = rows
    .map(
      (w) => `<tr>
        <td class="num"><a href="/witness/${w.id}">${w.n.toLocaleString('en-US')}</a></td>
        <td class="num">${w.size.toLocaleString('en-US')}</td>
        <td class="num">${w.ratio.toFixed(4)}</td>
        <td>${escapeHtml(w.created_at)}</td>
        <td>${w.is_current ? 'current record' : '<span class="muted">superseded</span>'}</td>
      </tr>`,
    )
    .join('\n')
  return `<section class="my-witnesses">
      ${heading}
      <p class="muted">Witnesses that set the record for their modulus when you submitted them, best score first.</p>
      <table class="tokens-table">
        <thead><tr><th class="num">N</th><th class="num">|A|</th><th class="num">score</th><th>Submitted</th><th>Status</th></tr></thead>
        <tbody>${trs}</tbody>
      </table>
    </section>`
}

export function profilePage(
  user: User,
  tokens: TokenRow[],
  newToken: { token: string; prefix: string } | null,
  witnesses: UserWitnessRow[] = [],
): string {
  const newTokenBlock = newToken
    ? `<div class="new-token">
        <p><strong>New token created.</strong> Copy it now &mdash; this is the only time it will be shown.</p>
        <pre class="token-secret">${escapeHtml(newToken.token)}</pre>
        <p class="muted">Send it as <code>Authorization: Bearer ${escapeHtml(newToken.token)}</code> when calling the API.</p>
      </div>`
    : ''
  const tokenRows = tokens.length
    ? tokens
        .map((t) => {
          const label = t.name ? escapeHtml(t.name) : '<span class="muted">(unnamed)</span>'
          const status = t.revoked_at
            ? `<span class="muted">revoked ${escapeHtml(t.revoked_at)}</span>`
            : `<form method="post" action="/profile/tokens/${t.id}/revoke" class="inline-form"><button type="submit" class="link-button">revoke</button></form>`
          const lastUsed = t.last_used_at
            ? escapeHtml(t.last_used_at)
            : '<span class="muted">never</span>'
          return `<tr>
            <td><code>${escapeHtml(t.prefix)}&hellip;</code></td>
            <td>${label}</td>
            <td>${escapeHtml(t.created_at)}</td>
            <td>${lastUsed}</td>
            <td>${status}</td>
          </tr>`
        })
        .join('\n')
    : `<tr><td colspan="5" class="muted">No tokens yet.</td></tr>`
  const body = `
    <section class="prose">
      <p class="page-nav"><a href="/">&larr; home</a></p>
      <h2>Profile</h2>
      <p class="muted">Signed in as ${escapeHtml(user.display_name || user.email || 'user')} (via ${escapeHtml(
        user.provider,
      )}).</p>
      ${newTokenBlock}
      <section class="profile-name">
        <h3>Display name</h3>
        <form method="post" action="/profile/name" class="profile-name-form">
          <input type="text" name="name" value="${escapeHtml(user.display_name || '')}" maxlength="100" required />
          <button type="submit">save</button>
        </form>
      </section>
      <section class="tokens">
        <h3>API tokens</h3>
        <p>Send a token in the <code>Authorization: Bearer &hellip;</code> header to call the <a href="/api">API</a> as yourself, so record witnesses are attributed to you.</p>
        <table class="tokens-table">
          <thead><tr><th>Prefix</th><th>Name</th><th>Created</th><th>Last used</th><th></th></tr></thead>
          <tbody>${tokenRows}</tbody>
        </table>
        <form method="post" action="/profile/tokens" class="new-token-form">
          <label>Name (optional) <input type="text" name="name" maxlength="100" placeholder="e.g. laptop CLI" /></label>
          <button type="submit">Generate new token</button>
        </form>
      </section>
      ${userWitnessesSection(witnesses)}
    </section>`
  return layout(`Profile — ${SITE_NAME}`, body, user)
}

export function apiDocsPage(user: User | null = null): string {
  const verifyReq = `curl -X POST https://ruzsa-genus-one.icarm.cloud/api/verify \\
  -H 'content-type: application/json' \\
  -H 'authorization: Bearer ruzsa_...' \\
  -d '{ "N": 49, "A": [0, 7, 13, 29, 41] }'`
  const verifyResp = `{
  "ok": true,
  "N": 49,
  "size": 5,
  "ratio": 0.7142857142857143,     // |A| / sqrt(N), the score
  "valid": true,
  "record": { "recorded": true, "recordSize": 5 }
}`
  const invalidResp = `{
  "ok": true,
  "valid": false,
  "counterexample": { "a": 3, "b": 1, "c": 1, "d": 2 },  // a + 3b ≡ 2c + 2d (mod N)
  ...
}`
  const body = `
    <section class="prose">
      <p class="page-nav"><a href="/">&larr; home</a></p>
      <h2>API</h2>

      <h3>POST <code>/api/verify</code></h3>
      <p>Verifies that a set <var>A</var> &sube; <span class="math">&#8484;/N&#8484;</span> contains no
      nontrivial solutions to <span class="eq">a + 3b &equiv; 2c + 2d (mod N)</span>. Elements are
      reduced mod <var>N</var>; duplicates after reduction are rejected. Limits:
      <var>N</var> &le; ${MAX_N.toLocaleString('en-US')} and
      |<var>A</var>| &le; ${MAX_SET_SIZE.toLocaleString('en-US')}.</p>
      <p>Requires an <code>Authorization: Bearer &lt;token&gt;</code> header &mdash; create a token
      on your <a href="/profile">profile</a> page. Requests without a valid token receive
      <code>401</code>. A record-setting witness is saved and attributed to your account.</p>
      <pre><code>${escapeHtml(verifyReq)}</code></pre>
      <p>Returns <code>200</code> with the verdict, <code>401</code> without a valid token, or
      <code>400</code> if the body isn&rsquo;t JSON of
      the form <code>{"N": &lt;integer&gt;, "A": [&lt;integers&gt;]}</code> or violates the limits.
      A <em>valid</em> witness that is larger than every previously recorded witness for its modulus
      is saved, and <code>record.recorded</code> is <code>true</code>; otherwise
      <code>record.recordSize</code> reports the standing record. When a valid submission ties the
      record, <code>record.tiedExact</code> reports whether it is element-for-element the record
      witness itself (<code>true</code>) or a different set of the same size (<code>false</code>).</p>
      <pre><code>${escapeHtml(verifyResp)}</code></pre>
      <p>An invalid set instead gets <code>valid: false</code> and one concrete nontrivial solution
      (no <code>record</code> field):</p>
      <pre><code>${escapeHtml(invalidResp)}</code></pre>

      <h3>GET <code>/database.json</code></h3>
      <p>All record witnesses as one JSON download: <code>{ count, witnesses }</code>, each with
      its modulus <code>n</code>, <code>size</code>, <code>ratio</code>, full <code>elements</code>
      list, <code>submitter</code>, <code>created_at</code>, and <code>current</code> (false for
      superseded records, which are kept as history). No auth required. Responses carry a strong
      <code>ETag</code>; conditional requests return <code>304</code> when nothing has changed.</p>
    </section>`
  return layout(`API — ${SITE_NAME}`, body, user)
}

// Linkify `witness#123` references in commentary text; everything else is escaped.
function renderCommentary(content: string): string {
  let out = ''
  let last = 0
  for (const m of content.matchAll(/witness#(\d+)/g)) {
    out += escapeHtml(content.slice(last, m.index))
    out += `<a href="/witness/${m[1]}">witness#${m[1]}</a>`
    last = (m.index ?? 0) + m[0].length
  }
  return out + escapeHtml(content.slice(last))
}

function commentarySection(witnessId: number, comment: CommentView | null, user: User | null): string {
  const hasContent = !!comment && comment.content.length > 0
  const body = hasContent
    ? `<div class="comment-body">${renderCommentary(comment!.content)}</div>`
    : `<p class="muted">No commentary yet.</p>`
  const meta = comment
    ? `<p class="comment-meta">last edited ${comment.author ? `by ${escapeHtml(comment.author)} ` : ''}at ${escapeHtml(
        comment.created_at,
      )} &middot; <a href="/witness/${witnessId}/commentary-history">history</a></p>`
    : ''
  const editor = user
    ? `<details class="comment-edit">
        <summary>edit</summary>
        <form method="post" action="/witness/${witnessId}/commentary">
          <textarea name="content" rows="6" maxlength="${COMMENT_MAX}">${escapeHtml(comment?.content ?? '')}</textarea>
          <div><button type="submit">save</button> <span class="muted">submit empty to clear</span></div>
        </form>
      </details>`
    : `<p class="muted"><a href="/auth/github">Log in</a> to add commentary.</p>`
  return `<section class="comment-section">
      <h3>Commentary</h3>
      ${body}
      ${meta}
      ${editor}
    </section>`
}

export function witnessDetailPage(
  w: WitnessView,
  comment: CommentView | null = null,
  user: User | null = null,
  justRecorded = false,
): string {
  let elements: number[] = []
  try {
    elements = JSON.parse(w.elements)
  } catch {
    /* leave empty */
  }
  const submitter = w.submitter_name
    ? escapeHtml(w.submitter_name)
    : '<span class="muted">anonymous</span>'
  const isCurrent = w.size === w.record_size
  const status = isCurrent
    ? 'current record for this modulus'
    : `superseded &mdash; the record is now |A| = ${w.record_size.toLocaleString('en-US')}`
  const body = `
    <section class="prose">
      <p class="page-nav"><a href="/">&larr; home</a> &nbsp;&middot;&nbsp; <a href="/recent">recent activity</a></p>
      ${justRecorded ? `<p class="record-new">New record: the largest known witness for N = ${w.n.toLocaleString('en-US')}. Saved. 🏅</p>` : ''}
      <h2>witness #${w.id}</h2>
      <dl class="stats">
        <div><dt>N</dt><dd>${w.n.toLocaleString('en-US')}</dd></div>
        <div><dt>|A|</dt><dd>${w.size.toLocaleString('en-US')}</dd></div>
        <div><dt>score |A|/&radic;<span class="sqrt">N</span></dt><dd class="score">${w.ratio.toFixed(4)}</dd></div>
      </dl>
      <dl class="witness-meta">
        <dt>status</dt><dd>${status}</dd>
        <dt>submitted by</dt><dd>${submitter}</dd>
        <dt>submitted at</dt><dd>${escapeHtml(w.created_at)}</dd>
      </dl>
      <section class="witness-elements">
        <h3>Elements <span class="muted">(${elements.length.toLocaleString('en-US')})</span></h3>
        <pre class="elements">${elements.join(', ')}</pre>
      </section>
      ${commentarySection(w.id, comment, user)}
    </section>`
  return layout(`witness #${w.id} — ${SITE_NAME}`, body, user)
}

export function commentaryHistoryPage(
  w: WitnessView,
  entries: CommentView[],
  user: User | null = null,
): string {
  const list = entries.length
    ? entries
        .map(
          (e) => `<li>
        <p class="comment-meta">${e.author ? escapeHtml(e.author) : '<span class="muted">(deleted user)</span>'} &middot; ${escapeHtml(
            e.created_at,
          )}</p>
        ${e.content.length > 0 ? `<div class="comment-body">${renderCommentary(e.content)}</div>` : `<p class="muted">(cleared)</p>`}
      </li>`,
        )
        .join('\n')
    : `<li class="muted">No commentary yet.</li>`
  const body = `
    <section class="prose">
      <p class="page-nav"><a href="/witness/${w.id}">&larr; witness #${w.id}</a></p>
      <h2>Commentary history</h2>
      <p class="muted">${entries.length} edit${entries.length === 1 ? '' : 's'}.</p>
      <ul class="comment-history">${list}</ul>
    </section>`
  return layout(`Commentary history — ${SITE_NAME}`, body, user)
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

// Recent-activity feed: record witnesses and commentary edits, newest first.
export function activityPage(
  items: ActivityItem[],
  page: number,
  hasOlder: boolean,
  user: User | null = null,
): string {
  const who = (u: string | null) => (u ? escapeHtml(u) : '<span class="muted">anonymous</span>')
  const entry = (a: ActivityItem): string => {
    const link = `<a href="/witness/${a.witness_id}">witness #${a.witness_id}</a>`
    const meta = `<p class="activity-meta">${escapeHtml(a.ts)} &middot; ${who(a.user)}</p>`
    if (a.kind === 'record') {
      return `<li>
        ${meta}
        <p class="activity-line">set a record for N = ${a.n.toLocaleString('en-US')} with ${link} &mdash; |A| = ${a.size.toLocaleString(
          'en-US',
        )}, score ${a.ratio.toFixed(4)}</p>
      </li>`
    }
    const cleared = !a.content || a.content.length === 0
    return `<li>
        ${meta}
        <p class="activity-line">${cleared ? `cleared commentary on ${link}` : `edited commentary on ${link}`}</p>
        ${cleared ? '' : `<div class="comment-body">${renderCommentary(clip(a.content!, 280))}</div>`}
      </li>`
  }
  const list = items.length
    ? `<ul class="activity">${items.map(entry).join('\n')}</ul>`
    : `<p class="muted">No activity yet.</p>`
  const newer =
    page > 0
      ? `<a href="/recent${page - 1 === 0 ? '' : `?p=${page - 1}`}">&larr; newer</a>`
      : `<span class="muted">&larr; newer</span>`
  const older = hasOlder
    ? `<a href="/recent?p=${page + 1}">older &rarr;</a>`
    : `<span class="muted">older &rarr;</span>`
  const body = `
    <section class="prose">
      <p class="page-nav"><a href="/">&larr; home</a></p>
      <h2>Recent activity</h2>
      <p class="muted">Record witnesses and commentary edits, newest first.</p>
      ${list}
      <nav class="pager">${newer} <span class="muted">page ${page + 1}</span> ${older}</nav>
    </section>`
  return layout(`Recent activity — ${SITE_NAME}`, body, user)
}

export function acknowledgePage(user: User | null = null): string {
  const body = `
    <section class="prose">
      <p class="page-nav"><a href="/">&larr; home</a></p>
      <h2>Acknowledgement</h2>
      <p>The Institute for Computer-Aided Reasoning in Mathematics
      <span class="nowrap">(<a class="external" href="https://icarm.io">ICARM</a>)</span> is supported by
      U.S. National Science Foundation Grant DMS 2425401. The views expressed on these pages do not
      necessarily reflect those of the NSF.</p>
      <p>If any ICARM meetings, resources, or innovation engineers are helpful to you, you can indicate
      that in associated publications with a brief acknowledgment, such as the following:</p>
      <ul>
        <li>&ldquo;Part of this research has been carried out at the Institute for Computer-Aided
        Reasoning (ICARM), which is supported by NSF Grant DMS 2425401.&rdquo;</li>
        <li>&ldquo;This research made use of the Ruzsa genus-one problem site, maintained by the
        Institute for Computer-Aided Reasoning (ICARM) under NSF Grant DMS 2425401.&rdquo;</li>
        <li>&ldquo;We are grateful to the Institute for Computer-Aided Reasoning (ICARM) for technical
        support provided under NSF Grant DMS 2425401.&rdquo;</li>
      </ul>
    </section>`
  return layout(`Acknowledgement — ${SITE_NAME}`, body, user)
}

export function notFoundPage(user: User | null = null): string {
  return layout('Not found', `<section class="prose"><p>Page not found.</p></section>`, user)
}
