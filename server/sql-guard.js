import { HttpError } from './errors.js'

const COMMENTS = /(--|\/\*|\*\/)/
const WRITE_OR_ADMIN_KEYWORDS = /\b(ALTER|CALL|CHECKPOINT|CLUSTER|COPY|CREATE|DEALLOCATE|DELETE|DISCARD|DO|DROP|EXECUTE|GRANT|INSERT|LISTEN|LOCK|MERGE|NOTIFY|PREPARE|REASSIGN|REFRESH|REINDEX|RESET|REVOKE|SECURITY|SET|TRUNCATE|UNLISTEN|UPDATE|VACUUM)\b/i
const LOCKING_CLAUSE = /\bFOR\s+(UPDATE|NO\s+KEY\s+UPDATE|SHARE|KEY\s+SHARE)\b/i

export function guardReadOnlySql(input) {
  if (typeof input !== 'string') throw new HttpError(400, 'Query SQL harus berupa teks.')

  const trimmed = input.trim()
  if (!trimmed) throw new HttpError(400, 'Masukkan query SQL.')
  if (trimmed.length > 5000) throw new HttpError(400, 'Query maksimal 5.000 karakter.')
  if (trimmed.includes('\0')) throw new HttpError(400, 'Query mengandung karakter yang tidak valid.')
  if (COMMENTS.test(trimmed)) throw new HttpError(400, 'Komentar SQL tidak diizinkan.')

  const statement = trimmed.endsWith(';') ? trimmed.slice(0, -1).trim() : trimmed
  if (statement.includes(';')) throw new HttpError(400, 'Hanya satu statement yang dapat dijalankan.')
  if (!/^(SELECT|WITH)\b/i.test(statement)) {
    throw new HttpError(400, 'Hanya query SELECT read-only yang diizinkan.')
  }
  if (WRITE_OR_ADMIN_KEYWORDS.test(statement) || LOCKING_CLAUSE.test(statement)) {
    throw new HttpError(400, 'Operasi tersebut tidak diizinkan pada query console.')
  }

  return /\bLIMIT\s+\d+\b/i.test(statement) ? statement : `${statement} LIMIT 200`
}
