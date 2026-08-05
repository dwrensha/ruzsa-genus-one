// Render public/og.png — the social-preview (Open Graph) card at the standard
// 1200x630: the exponent view of the records plot (log |A| / log N against N)
// on the site's dark indigo theme, current records fetched from production.
//
//   node scripts/make-og-image.mjs [database-url-or-path]
import fs from 'node:fs'
import sharp from 'sharp'

const SOURCE = process.argv[2] ?? 'https://ruzsa-genus-one.icarm.cloud/database.json'
const db = SOURCE.startsWith('http')
  ? await (await fetch(SOURCE)).json()
  : JSON.parse(fs.readFileSync(SOURCE, 'utf8'))
const points = db.witnesses.filter((w) => w.current)

// Colors from public/style.css.
const BG = '#16131f'
const FG = '#e9e5f2'
const MUTED = '#9d94b8'
const ACCENT = '#fbbf24'
const ACCENT_DIM = '#b98a10'
const EDGE = '#352d4e'

// Card frame and plot margins. Same shape as the site's exponent plot, drawn
// natively at card size so the text stays crisp.
const W = 1200, H = 630
const L = 96, R = 48, T = 128, B = 84
const INNER_W = W - L - R
const INNER_H = H - T - B
const MAX_N = 50_000
const LOG_NMIN = Math.log10(2) // N = 2 is the smallest valid modulus
const LOG_NMAX = Math.log10(MAX_N)
const YMIN = 0.35, YMAX = 0.5

const X = (logN) => L + ((logN - LOG_NMIN) / (LOG_NMAX - LOG_NMIN)) * INNER_W
const Y = (v) => T + INNER_H - ((v - YMIN) / (YMAX - YMIN)) * INNER_H

const pow10 = (k) =>
  k === 0 ? '1' : `10<tspan font-size="15" dy="-8">${k}</tspan>`

let grid = `<text fill="${MUTED}" font-size="21" x="${L}" y="${T + INNER_H + 30}" text-anchor="middle">2</text>`
for (let k = 1; k <= Math.floor(LOG_NMAX); k++) {
  const x = X(k).toFixed(1)
  grid += `<line stroke="${EDGE}" x1="${x}" y1="${T}" x2="${x}" y2="${T + INNER_H}"/>`
  grid += `<text fill="${MUTED}" font-size="21" x="${x}" y="${T + INNER_H + 30}" text-anchor="middle">${pow10(k)}</text>`
}
for (const v of [0.35, 0.4, 0.45, 0.5]) {
  const y = Y(v)
  if (v > YMIN && v < YMAX) grid += `<line stroke="${EDGE}" x1="${L}" y1="${y.toFixed(1)}" x2="${W - R}" y2="${y.toFixed(1)}"/>`
  grid += `<text fill="${MUTED}" font-size="21" x="${L - 12}" y="${(y + 7).toFixed(1)}" text-anchor="end">${v}</text>`
}

const dots = points
  .filter((p) => Math.log(p.size) / Math.log(p.n) >= YMIN)
  .map((p) => {
    const beats = p.size / Math.sqrt(p.n) > 1
    const fill = beats ? `fill="#34d399" stroke="${FG}" stroke-width="1.5"` : `fill="${ACCENT}"`
    return `<circle ${fill} cx="${X(Math.log10(p.n)).toFixed(1)}" cy="${Y(Math.log(p.size) / Math.log(p.n)).toFixed(1)}" r="${beats ? 7 : 5}"/>`
  })
  .join('\n  ')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="DejaVu Sans, sans-serif">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <text fill="${FG}" font-size="42" font-weight="600" x="${L}" y="62">Ruzsa’s genus-one problem</text>
  <text fill="${MUTED}" font-size="24" x="${W - R}" y="60" text-anchor="end">ruzsa-genus-one.icarm.cloud</text>
  ${grid}
  <line stroke="${ACCENT_DIM}" stroke-width="2.5" stroke-dasharray="9 7" x1="${L}" y1="${Y(0.5)}" x2="${W - R}" y2="${Y(0.5)}"/>
  <text fill="${ACCENT_DIM}" font-size="23" x="${W - R - 12}" y="${(Y(0.5) + 30).toFixed(1)}" text-anchor="end">|A| = √N</text>
  ${dots}
  <line stroke="${MUTED}" x1="${L}" y1="${T}" x2="${L}" y2="${T + INNER_H}"/>
  <line stroke="${MUTED}" x1="${L}" y1="${T + INNER_H}" x2="${W - R}" y2="${T + INNER_H}"/>
  <text fill="${MUTED}" font-size="23" x="${L + INNER_W / 2}" y="${H - 22}" text-anchor="middle">modulus N →</text>
  <text fill="${MUTED}" font-size="23" transform="rotate(-90)" x="${-(T + INNER_H / 2)}" y="30" text-anchor="middle">exponent log |A| / log N →</text>
</svg>`

await sharp(Buffer.from(svg), { density: 96 }).png({ compressionLevel: 9 }).toFile('public/og.png')
console.log(`rendered ${points.length} records; wrote public/og.png (${fs.statSync('public/og.png').size} bytes)`)
