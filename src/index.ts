import { Hono } from 'hono'
import {
  acknowledgePage,
  activityPage,
  apiDocsPage,
  commentaryHistoryPage,
  landingPage,
  notFoundPage,
  profilePage,
  witnessDetailPage,
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
  standingRecord,
  userWitnesses,
  type RecordDisplay,
} from './store'
import type { Bindings } from './auth'
import type { User } from './pages'

// Recording requires login; verification does not. For a logged-out valid
// submission, report the standing record instead of writing anything.
async function recordOutcome(
  env: Bindings,
  result: Extract<VerifyResult, { ok: true }>,
  user: User | null,
): Promise<RecordDisplay> {
  if (user) {
    return { kind: 'attempted', ...(await recordWitness(env, result, user.id)) }
  }
  const standing = await standingRecord(env, result.N)
  return {
    kind: 'login-required',
    wouldRecord: standing == null || result.size > standing.size,
    recordSize: standing?.size ?? null,
    witnessId: standing?.id ?? null,
  }
}
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

app.get('/', async (c) => c.html(landingPage(c.get('user'), undefined, {}, undefined, await currentRecords(c.env))))

app.get('/auth/:provider', startOAuth)
app.get('/auth/:provider/callback', handleCallback)
app.post('/auth/logout', logout)

app.get('/api', (c) => c.html(apiDocsPage(c.get('user'))))

app.get('/acknowledge', (c) => c.html(acknowledgePage(c.get('user'))))

app.get('/witness/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.html(notFoundPage(c.get('user')), 404)
  const loaded = await loadWitness(c.env, id)
  if (!loaded) return c.html(notFoundPage(c.get('user')), 404)
  return c.html(witnessDetailPage(loaded.witness, loaded.comment, c.get('user')))
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

app.post('/verify', async (c) => {
  const body = await c.req.parseBody()
  const nText = typeof body.N === 'string' ? body.N : ''
  const elementsText = typeof body.A === 'string' ? body.A : ''
  const result = verifyFromText(nText, elementsText)
  let record: RecordDisplay | undefined
  if (result.ok && result.valid) {
    record = await recordOutcome(c.env, result, c.get('user'))
  }
  return c.html(
    landingPage(
      c.get('user'),
      result,
      { nValue: nText, elementsValue: elementsText },
      record,
      await currentRecords(c.env),
    ),
  )
})

app.post('/api/verify', async (c) => {
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
  let record: Record<string, unknown> | undefined
  if (result.valid) {
    const outcome = await recordOutcome(c.env, result, c.get('user'))
    record =
      outcome.kind === 'attempted'
        ? { recorded: outcome.recorded, recordSize: outcome.recordSize, witnessId: outcome.witnessId }
        : {
            recorded: false,
            reason: 'authentication required to record witnesses',
            wouldRecord: outcome.wouldRecord,
            recordSize: outcome.recordSize,
          }
  }
  // Echoing the (possibly large) element list back is redundant for API users.
  const { elements: _elements, ...rest } = result
  return c.json(record ? { ...rest, record } : rest)
})

app.notFound((c) => c.html(notFoundPage(c.get('user')), 404))

export default app
