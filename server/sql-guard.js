import { HttpError } from './errors.js'

// Conservative by design: this is a bounded reporting console, not a SQL administration client.
const UNSAFE = /\b(ALTER|CALL|CHECKPOINT|COPY|CREATE|DELETE|DO|DROP|EXECUTE|GRANT|INSERT|INTO|LOAD|LOCK|MERGE|PREPARE|REPLACE|REVOKE|SET|TRUNCATE|UNLOCK|UPDATE|USE|OUTFILE|DUMPFILE|LOAD_FILE|SLEEP|BENCHMARK|GET_LOCK|RELEASE_LOCK|RELEASE_ALL_LOCKS|MASTER_POS_WAIT|SOURCE_POS_WAIT|SYS_EXEC|SYS_EVAL|LAST_INSERT_ID)\b/i

const SAFE_CALLS = new Set(('AS IN EXISTS OVER PARTITION ROWS RANGE SELECT WITH RECURSIVE DISTINCT ALL CAST CONVERT CHAR DECIMAL SIGNED UNSIGNED INTEGER DATE DATETIME TIME COUNT SUM AVG MIN MAX COALESCE IFNULL NULLIF IF ABS ROUND CEIL CEILING FLOOR MOD POWER SQRT LENGTH CHAR_LENGTH CHARACTER_LENGTH OCTET_LENGTH LOWER UPPER TRIM LTRIM RTRIM CONCAT CONCAT_WS SUBSTRING SUBSTR LEFT RIGHT REPLACE LOCATE INSTR DATE_FORMAT YEAR MONTH DAY DAYOFMONTH DAYOFWEEK NOW CURRENT_DATE CURRENT_TIMESTAMP DATEDIFF TIMESTAMPDIFF JSON_EXTRACT JSON_UNQUOTE JSON_VALID JSON_TYPE JSON_LENGTH JSON_CONTAINS JSON_OBJECT JSON_ARRAY ROW_NUMBER RANK DENSE_RANK LAG LEAD FIRST_VALUE LAST_VALUE').split(' '))

export function guardReadOnlySql(input) {
  if (typeof input !== 'string' || !input.trim()) throw new HttpError(400, 'Enter a SELECT query.')
  const text = input.trim().replace(/;\s*$/, '')
  if (text.length > 5000 || /\0|;|--|\/\*|\*\/|#|@/.test(text)) {
    throw new HttpError(400, 'Only one query without comments or session variables is allowed.')
  }
  if (!/^(SELECT|WITH)\b/i.test(text) || UNSAFE.test(text) || /\bFOR\s+(UPDATE|SHARE)\b/i.test(text)) {
    throw new HttpError(400, 'Only read-only SELECT queries are allowed.')
  }
  const tokens = text.replace(/'(?:''|\\.|[^'\\])*'|"(?:""|\\.|[^"\\])*"/g, '"literal"')
  if (/`[^`]+`\s*\(/.test(tokens)) throw new HttpError(400, 'Quoted function calls are not allowed.')
  for (const match of tokens.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) {
    const name = match[1].toUpperCase()
    const before = tokens.slice(0, match.index).trimEnd()
    const isCteColumns = /(?:WITH|RECURSIVE|,)\s*$/i.test(before) && /^\s*\([^)]*\)\s+AS\b/i.test(tokens.slice(match.index + match[1].length))
    if (before.endsWith('.') || (!SAFE_CALLS.has(name) && !isCteColumns)) throw new HttpError(400, 'Only supported read-only built-in functions are allowed.')
  }
  return 'SELECT * FROM (' + text + ') AS fe_readonly_result LIMIT 200'
}
