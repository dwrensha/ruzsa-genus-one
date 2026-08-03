import { Hono } from 'hono'
import {
  acknowledgePage,
  activityPage,
  apiDocsPage,
  commentaryHistoryPage,
  landingPage,
  notFoundPage,
  profilePage,
  resultPage,
  witnessDetailPage,
  type FormState,
} from './pages'
import {
  type AppEnv,
  generateApiToken,
  loadCurrentUser,
  loadUserFromToken,
  startOAuth,
  handleCallback,
  logout,
  updateSessionUser,
} from './auth'
import {
  COMMENT_MAX,
  commentaryHistory,
  currentRecords,
  listTokens,
  loadWitness,
  postCommentary,
  recentActivity,
  recordWitness,
  userWitnesses,
  type RecordStatus,
} from './store'
import {
  MAX_ELEMENTS_TEXT_BYTES,
  MAX_SET_SIZE,
  parseElements,
  verify,
  type VerifyResult,
} from './verify'

const app = new Hono<AppEnv>()

// Resolve the current user (session cookie, else API bearer token) for every
// request. Both lookups short-circuit cheaply when their credential is absent.
app.use('*', async (c, next) => {
  const user = (await loadCurrentUser(c)) ?? (await loadUserFromToken(c))
  c.set('user', user)
  await next()
})

app.get('/', async (c) =>
  c.html(
    landingPage(c.get('user'), await currentRecords(c.env), c.req.query('expired') === '1'),
  ),
)

app.get('/auth/:provider', startOAuth)
app.get('/auth/:provider/callback', handleCallback)
app.post('/auth/logout', logout)

app.get('/api', (c) => c.html(apiDocsPage(c.get('user'))))

// A JSON attachment response with a strong ETag over the exact body, so
// clients can revalidate cheaply. no-cache = clients may store but must
// revalidate every time; paired with the ETag, a fresh request returns 304
// (no body) when nothing changed — the body only changes when a record does.
async function jsonDownload(req: Request, payload: string, filename: string): Promise<Response> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  const etag =
    '"' +
    [...new Uint8Array(digest)]
      .slice(0, 16)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('') +
    '"'
  const headers = {
    'content-type': 'application/json; charset=UTF-8',
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-cache',
    etag,
  }
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
  return new Response(payload, { status: 200, headers })
}

// Every record witness (current and superseded) as one JSON download.
app.get('/database.json', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT w.id, w.n, w.size, w.ratio, w.elements, w.created_at,
            u.display_name AS submitter,
            (w.size = (SELECT MAX(size) FROM witnesses WHERE n = w.n)) AS is_current
       FROM witnesses w LEFT JOIN users u ON u.id = w.submitter_user_id
       ORDER BY w.n, w.size`,
  ).all<{
    id: number
    n: number
    size: number
    ratio: number
    elements: string
    created_at: string
    submitter: string | null
    is_current: number
  }>()
  const witnesses = results.map((r) => ({
    id: r.id,
    n: r.n,
    size: r.size,
    ratio: r.ratio,
    elements: JSON.parse(r.elements) as number[],
    submitter: r.submitter,
    created_at: r.created_at,
    current: !!r.is_current,
  }))
  const payload = JSON.stringify({ count: witnesses.length, witnesses }, null, 2)
  return jsonDownload(c.req.raw, payload, 'ruzsa-genus-one-records.json')
})

app.get('/acknowledge', (c) => c.html(acknowledgePage(c.get('user'))))

app.get('/witness/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.html(notFoundPage(c.get('user')), 404)
  const loaded = await loadWitness(c.env, id)
  if (!loaded) return c.html(notFoundPage(c.get('user')), 404)
  return c.html(
    witnessDetailPage(loaded.witness, loaded.comment, c.get('user'), c.req.query('new') === '1'),
  )
})

app.post('/witness/:id/commentary', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/auth/github', 302)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.html(notFoundPage(user), 404)
  const exists = await c.env.DB.prepare('SELECT id FROM witnesses WHERE id = ?').bind(id).first()
  if (!exists) return c.html(notFoundPage(user), 404)
  const form = await c.req.parseBody()
  const content = (typeof form.content === 'string' ? form.content : '').slice(0, COMMENT_MAX)
  await postCommentary(c.env, id, user.id, content)
  return c.redirect(`/witness/${id}`, 302)
})

app.get('/witness/:id/commentary-history', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.html(notFoundPage(c.get('user')), 404)
  const loaded = await loadWitness(c.env, id)
  if (!loaded) return c.html(notFoundPage(c.get('user')), 404)
  return c.html(
    commentaryHistoryPage(loaded.witness, await commentaryHistory(c.env, id), c.get('user')),
  )
})

app.get('/recent', async (c) => {
  const p = Math.max(0, Math.floor(Number(c.req.query('p')) || 0))
  const { items, page, hasOlder } = await recentActivity(c.env, p)
  return c.html(activityPage(items, page, hasOlder, c.get('user')))
})

app.get('/profile', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/auth/github?return_to=/profile', 302)
  const [tokens, witnesses] = await Promise.all([
    listTokens(c.env, user.id),
    userWitnesses(c.env, user.id),
  ])
  return c.html(profilePage(user, tokens, null, witnesses))
})

app.post('/profile/tokens', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/auth/github', 302)
  const form = await c.req.parseBody()
  const name = String(form.name ?? '').trim().slice(0, 100) || null
  const newToken = await generateApiToken(c.env, user.id, name)
  const [tokens, witnesses] = await Promise.all([
    listTokens(c.env, user.id),
    userWitnesses(c.env, user.id),
  ])
  return c.html(profilePage(user, tokens, newToken, witnesses))
})

app.post('/profile/tokens/:id/revoke', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/auth/github', 302)
  const id = Number(c.req.param('id'))
  if (Number.isInteger(id)) {
    await c.env.DB.prepare(
      'UPDATE api_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
    )
      .bind(id, user.id)
      .run()
  }
  return c.redirect('/profile', 302)
})

app.post('/profile/name', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/auth/github', 302)
  const form = await c.req.parseBody()
  const name = String(form.name ?? '').trim().slice(0, 100)
  if (name) {
    await c.env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(name, user.id).run()
    await updateSessionUser(c, { display_name: name })
  }
  return c.redirect('/profile', 302)
})

function verifyFromText(nText: string, elementsText: string): VerifyResult {
  if (elementsText.length > MAX_ELEMENTS_TEXT_BYTES) {
    return { ok: false, error: 'submission too large' }
  }
  const nTrimmed = nText.trim()
  if (!/^\d+$/.test(nTrimmed)) {
    return { ok: false, error: 'N must be a positive integer' }
  }
  const N = Number(nTrimmed)
  const parsed = parseElements(elementsText)
  if (!Array.isArray(parsed)) {
    return { ok: false, error: parsed.error }
  }
  return verify(N, parsed)
}

// A stray GET (old bookmark, stale OAuth return) lands home rather than 404.
app.get('/verify', (c) => c.redirect('/', 302))

// Verdict + form state stashed between the POST and the redirected GET.
// The element list is dropped from the stored result (the page never shows
// it; the form echo comes from the raw text in `form`).
interface ResultFlash {
  result: VerifyResult
  record?: RecordStatus
  form: FormState
}

const RESULT_FLASH_TTL_SEC = 10 * 60

// Post/Redirect/Get: a record-setting submission redirects to its new witness
// page; anything else stores a short-lived flash and redirects to /result/:key,
// so reloading the result never re-submits the form.
app.post('/verify', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/auth/github?return_to=/', 302)
  const body = await c.req.parseBody()
  const nText = typeof body.N === 'string' ? body.N : ''
  const elementsText = typeof body.A === 'string' ? body.A : ''
  const result = verifyFromText(nText, elementsText)
  let record: RecordStatus | undefined
  if (result.ok && result.valid) {
    record = await recordWitness(c.env, result, user.id)
    if (record.recorded) return c.redirect(`/witness/${record.witnessId}?new=1`, 303)
  }
  const flash: ResultFlash = {
    result: result.ok ? { ...result, elements: [] } : result,
    record,
    form: { nValue: nText, elementsValue: elementsText },
  }
  const key = crypto.randomUUID()
  await c.env.SESSIONS.put(`result:${key}`, JSON.stringify(flash), {
    expirationTtl: RESULT_FLASH_TTL_SEC,
  })
  return c.redirect(`/result/${key}`, 303)
})

app.get('/result/:key', async (c) => {
  const key = c.req.param('key')
  if (!/^[0-9a-f-]{36}$/.test(key)) return c.html(notFoundPage(c.get('user')), 404)
  const flash = (await c.env.SESSIONS.get(`result:${key}`, 'json')) as ResultFlash | null
  if (!flash) return c.redirect('/?expired=1', 302)
  return c.html(resultPage(c.get('user'), flash.result, flash.record, flash.form))
})

app.post('/api/verify', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ ok: false, error: 'authentication required' }, 401)
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'request body must be JSON' }, 400)
  }
  const { N, A } = (body ?? {}) as { N?: unknown; A?: unknown }
  if (typeof N !== 'number' || !Array.isArray(A)) {
    return c.json(
      { ok: false, error: 'expected {"N": <integer>, "A": [<integers>]}' },
      400,
    )
  }
  if (A.length > MAX_SET_SIZE) {
    return c.json({ ok: false, error: `the set may have at most ${MAX_SET_SIZE} elements` }, 400)
  }
  if (!A.every((x) => typeof x === 'number' && Number.isSafeInteger(x))) {
    return c.json({ ok: false, error: 'all elements of A must be integers' }, 400)
  }
  const result = verify(N, A as number[])
  if (!result.ok) return c.json(result, 400)
  let record: RecordStatus | undefined
  if (result.valid) {
    record = await recordWitness(c.env, result, user.id)
  }
  // Echoing the (possibly large) element list back is redundant for API users.
  const { elements: _elements, ...rest } = result
  return c.json(record ? { ...rest, record } : rest)
})

app.notFound((c) => c.html(notFoundPage(c.get('user')), 404))

export default app
