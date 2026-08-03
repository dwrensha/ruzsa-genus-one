import { Hono } from 'hono'
import { landingPage, notFoundPage } from './pages'
import {
  type AppEnv,
  loadCurrentUser,
  startOAuth,
  handleCallback,
  logout,
} from './auth'
import {
  MAX_ELEMENTS_TEXT_BYTES,
  MAX_SET_SIZE,
  parseElements,
  verify,
  type VerifyResult,
} from './verify'

const app = new Hono<AppEnv>()

// Resolve the current user from the session cookie for every request; the
// lookup short-circuits cheaply when the cookie is absent.
app.use('*', async (c, next) => {
  c.set('user', await loadCurrentUser(c))
  await next()
})

app.get('/', (c) => c.html(landingPage(c.get('user'))))

app.get('/auth/:provider', startOAuth)
app.get('/auth/:provider/callback', handleCallback)
app.post('/auth/logout', logout)

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
  return c.html(
    landingPage(c.get('user'), result, { nValue: nText, elementsValue: elementsText }),
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
  // Echoing the (possibly large) element list back is redundant for API users.
  const { elements: _elements, ...rest } = result
  return c.json(rest)
})

app.notFound((c) => c.html(notFoundPage(c.get('user')), 404))

export default app
