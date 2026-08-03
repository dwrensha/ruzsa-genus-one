// D1 persistence for record witnesses. The witnesses table is append-only:
// every record-setting witness is kept, so the history of records for a
// modulus survives being beaten.

import type { Bindings } from './auth'
import type { RecordPoint, TokenRow, UserWitnessRow } from './pages'
import type { VerifyResult } from './verify'

export const COMMENT_MAX = 4000

export interface CommentView {
  id: number
  content: string
  created_at: string
  author: string | null
}

/** One witness row as shown on its page. */
export interface WitnessView {
  id: number
  n: number
  size: number
  ratio: number
  elements: string // JSON array text
  created_at: string
  submitter_name: string | null
  current_comment_id: number | null
  record_size: number // MAX(size) for this n — equal to size when still the record
}

export async function loadWitness(
  env: Bindings,
  id: number,
): Promise<{ witness: WitnessView; comment: CommentView | null } | null> {
  const witness = await env.DB.prepare(
    `SELECT w.id, w.n, w.size, w.ratio, w.elements, w.created_at, w.current_comment_id,
            u.display_name AS submitter_name,
            (SELECT MAX(size) FROM witnesses WHERE n = w.n) AS record_size
       FROM witnesses w LEFT JOIN users u ON u.id = w.submitter_user_id
       WHERE w.id = ?`,
  )
    .bind(id)
    .first<WitnessView>()
  if (!witness) return null
  let comment: CommentView | null = null
  if (witness.current_comment_id != null) {
    comment = await env.DB.prepare(
      `SELECT cl.id, cl.content, cl.created_at, u.display_name AS author
         FROM commentary_log cl LEFT JOIN users u ON u.id = cl.user_id
         WHERE cl.id = ?`,
    )
      .bind(witness.current_comment_id)
      .first<CommentView>()
  }
  return { witness, comment }
}

// Record an edit to a witness's commentary and point the witness at it.
export async function postCommentary(
  env: Bindings,
  witnessId: number,
  userId: number,
  content: string,
): Promise<void> {
  const ins = await env.DB.prepare(
    'INSERT INTO commentary_log (witness_id, user_id, content) VALUES (?, ?, ?)',
  )
    .bind(witnessId, userId, content)
    .run()
  await env.DB.prepare('UPDATE witnesses SET current_comment_id = ? WHERE id = ?')
    .bind(ins.meta.last_row_id, witnessId)
    .run()
}

// Full edit history for a witness, newest first.
export function commentaryHistory(env: Bindings, witnessId: number): Promise<CommentView[]> {
  return env.DB.prepare(
    `SELECT cl.id, cl.content, cl.created_at, u.display_name AS author
       FROM commentary_log cl LEFT JOIN users u ON u.id = cl.user_id
       WHERE cl.witness_id = ? ORDER BY cl.id DESC`,
  )
    .bind(witnessId)
    .all<CommentView>()
    .then((r) => r.results)
}

// One row in the recent-activity feed: a record-setting witness or a
// commentary edit. Both carry the witness's n/size/ratio for context.
export interface ActivityItem {
  kind: 'record' | 'commentary'
  ts: string
  witness_id: number
  n: number
  size: number
  ratio: number
  user: string | null
  content: string | null
}

export const ACTIVITY_PAGE_SIZE = 30

// Recent activity, newest first, paginated. Merges record witnesses and
// commentary edits in one timeline. `hasOlder` reports whether a further page
// exists (we fetch one extra row to find out).
export async function recentActivity(
  env: Bindings,
  page = 0,
): Promise<{ items: ActivityItem[]; page: number; hasOlder: boolean }> {
  const size = ACTIVITY_PAGE_SIZE
  const { results } = await env.DB.prepare(
    `SELECT kind, ts, witness_id, n, size, ratio, user, content FROM (
         SELECT 'record' AS kind, w.created_at AS ts, w.id AS witness_id,
                w.n, w.size, w.ratio, u.display_name AS user, NULL AS content
           FROM witnesses w LEFT JOIN users u ON u.id = w.submitter_user_id
         UNION ALL
         SELECT 'commentary' AS kind, cl.created_at AS ts, cl.witness_id AS witness_id,
                w.n, w.size, w.ratio, cu.display_name AS user, cl.content AS content
           FROM commentary_log cl
           LEFT JOIN users cu ON cu.id = cl.user_id
           JOIN witnesses w ON w.id = cl.witness_id
       )
       -- kind ASC tiebreak: at the same second-precision timestamp a
       -- commentary edit sorts above its witness in this newest-first feed,
       -- since the commentary logically follows the record.
       ORDER BY ts DESC, kind ASC
       LIMIT ? OFFSET ?`,
  )
    .bind(size + 1, page * size)
    .all<ActivityItem>()
  return { items: results.slice(0, size), page, hasOlder: results.length > size }
}

export function listTokens(env: Bindings, userId: number): Promise<TokenRow[]> {
  return env.DB.prepare(
    `SELECT id, name, prefix, created_at, last_used_at, revoked_at
       FROM api_tokens WHERE user_id = ? ORDER BY id DESC`,
  )
    .bind(userId)
    .all<TokenRow>()
    .then((r) => r.results)
}

/** The user's record-setting witnesses, best score first, flagged when still the record. */
export function userWitnesses(env: Bindings, userId: number): Promise<UserWitnessRow[]> {
  return env.DB.prepare(
    `SELECT w.id, w.n, w.size, w.ratio, w.created_at,
            (w.size = (SELECT MAX(size) FROM witnesses WHERE n = w.n)) AS is_current
       FROM witnesses w WHERE w.submitter_user_id = ? ORDER BY w.ratio DESC, w.n`,
  )
    .bind(userId)
    .all<UserWitnessRow>()
    .then((r) => r.results)
}

export type ValidResult = Extract<VerifyResult, { ok: true }>

export interface RecordStatus {
  /** True when this submission set a new record for its modulus. */
  recorded: boolean
  /** Size of the current record after the attempt (>= the submission's size). */
  recordSize: number
  /** Row id of the current record witness (the new row when recorded). */
  witnessId: number
}

/** The current record witness (id, n, size) for every modulus that has one. */
export async function currentRecords(env: Bindings): Promise<RecordPoint[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, n, size FROM witnesses w
       WHERE size = (SELECT MAX(size) FROM witnesses WHERE n = w.n)
       ORDER BY n`,
  ).all<RecordPoint>()
  return results
}

// Insert only when strictly larger than every stored witness for this
// modulus. D1 serializes writes, so the NOT EXISTS guard is race-free; the
// unique (n, size) index additionally rules out duplicate same-size rows.
export async function recordWitness(
  env: Bindings,
  result: ValidResult,
  userId: number | null,
): Promise<RecordStatus> {
  const ins = await env.DB.prepare(
    `INSERT INTO witnesses (n, size, ratio, elements, submitter_user_id)
     SELECT ?1, ?2, ?3, ?4, ?5
     WHERE NOT EXISTS (SELECT 1 FROM witnesses WHERE n = ?1 AND size >= ?2)`,
  )
    .bind(result.N, result.size, result.ratio, JSON.stringify(result.elements), userId)
    .run()
  if ((ins.meta.changes ?? 0) > 0) {
    return { recorded: true, recordSize: result.size, witnessId: ins.meta.last_row_id as number }
  }
  const row = await env.DB.prepare(
    'SELECT id, size FROM witnesses WHERE n = ? ORDER BY size DESC LIMIT 1',
  )
    .bind(result.N)
    .first<{ id: number; size: number }>()
  return {
    recorded: false,
    recordSize: row?.size ?? result.size,
    witnessId: row?.id ?? 0,
  }
}
