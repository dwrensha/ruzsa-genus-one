// D1 persistence for record witnesses. The witnesses table is append-only:
// every record-setting witness is kept, so the history of records for a
// modulus survives being beaten.

import type { Bindings } from './auth'
import type { RecordPoint } from './pages'
import type { VerifyResult } from './verify'

export type ValidResult = Extract<VerifyResult, { ok: true }>

export interface RecordStatus {
  /** True when this submission set a new record for its modulus. */
  recorded: boolean
  /** Size of the current record after the attempt (>= the submission's size). */
  recordSize: number
}

/** The current record witness size for every modulus that has one. */
export async function currentRecords(env: Bindings): Promise<RecordPoint[]> {
  const { results } = await env.DB.prepare(
    'SELECT n, MAX(size) AS size FROM witnesses GROUP BY n ORDER BY n',
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
    return { recorded: true, recordSize: result.size }
  }
  const row = await env.DB.prepare('SELECT MAX(size) AS size FROM witnesses WHERE n = ?')
    .bind(result.N)
    .first<{ size: number | null }>()
  return { recorded: false, recordSize: row?.size ?? result.size }
}
