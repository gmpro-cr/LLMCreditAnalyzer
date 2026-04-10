/**
 * Local SQLite database adapter with a Supabase-compatible query builder.
 * Replaces the remote Supabase client so the app works without internet access.
 */
import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import path from 'path'

const DB_PATH = path.join(process.cwd(), 'creditguard.db')

let _db: Database.Database | null = null

function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH)
    _db.pragma('foreign_keys = ON')
    _db.pragma('journal_mode = WAL')
    initSchema(_db)
  }
  return _db
}

function initSchema(db: Database.Database) {
  // Migrate existing DB: add new columns if missing
  const borrowerCols = (db.prepare("PRAGMA table_info(borrowers)").all() as {name: string}[]).map(c => c.name)
  if (!borrowerCols.includes('symbol'))      db.exec("ALTER TABLE borrowers ADD COLUMN symbol TEXT")
  if (!borrowerCols.includes('public_data')) db.exec("ALTER TABLE borrowers ADD COLUMN public_data TEXT")

  const uploadCols = (db.prepare("PRAGMA table_info(financial_uploads)").all() as {name: string}[]).map(c => c.name)
  if (!uploadCols.includes('source')) db.exec("ALTER TABLE financial_uploads ADD COLUMN source TEXT")

  db.exec(`
    CREATE TABLE IF NOT EXISTS borrowers (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      cin           TEXT,
      industry      TEXT,
      loan_amount   REAL,
      loan_type     TEXT,
      sanction_date TEXT,
      symbol        TEXT,
      public_data   TEXT,
      created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );

    CREATE TABLE IF NOT EXISTS financial_uploads (
      id              TEXT PRIMARY KEY,
      borrower_id     TEXT NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
      financial_year  TEXT NOT NULL,
      upload_date     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      extracted_data  TEXT,
      ratios          TEXT,
      memo_content    TEXT,
      status          TEXT NOT NULL DEFAULT 'processing',
      source          TEXT,
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );

    CREATE TABLE IF NOT EXISTS covenants (
      id                  TEXT PRIMARY KEY,
      borrower_id         TEXT NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
      ratio_name          TEXT NOT NULL,
      operator            TEXT NOT NULL,
      threshold           REAL NOT NULL,
      is_breached         INTEGER NOT NULL DEFAULT 0,
      last_checked_at     TEXT,
      waiver_note         TEXT,
      waiver_approved_by  TEXT,
      created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );

    CREATE TABLE IF NOT EXISTS memo_versions (
      id          TEXT PRIMARY KEY,
      upload_id   TEXT NOT NULL,
      borrower_id TEXT NOT NULL,
      label       TEXT NOT NULL DEFAULT 'Draft',
      snapshot    TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
  `)
}

// JSON fields per table that need serialization/deserialization
const JSON_FIELDS: Record<string, string[]> = {
  financial_uploads: ['extracted_data', 'ratios'],
  borrowers: ['public_data'],
  memo_versions: ['snapshot'],
}

// Boolean fields (stored as 0/1 in SQLite)
const BOOL_FIELDS: Record<string, string[]> = {
  covenants: ['is_breached'],
}

type Row = Record<string, unknown>

function deserializeRow(table: string, row: Row | null): Row | null {
  if (!row) return null
  const result: Row = {}
  for (const [k, v] of Object.entries(row)) {
    if (JSON_FIELDS[table]?.includes(k) && typeof v === 'string') {
      try { result[k] = JSON.parse(v) } catch { result[k] = v }
    } else if (BOOL_FIELDS[table]?.includes(k)) {
      result[k] = v === 1 || v === true
    } else {
      result[k] = v
    }
  }
  return result
}

function serializeRow(table: string, data: Row): Row {
  const result: Row = {}
  for (const [k, v] of Object.entries(data)) {
    if (JSON_FIELDS[table]?.includes(k) && typeof v === 'object' && v !== null) {
      result[k] = JSON.stringify(v)
    } else if (BOOL_FIELDS[table]?.includes(k)) {
      result[k] = v ? 1 : 0
    } else {
      result[k] = v
    }
  }
  return result
}

// Parses Supabase-style select columns including joins: "col1, col2, other_table(col3)"
function parseSelectCols(cols: string): {
  plain: string[]
  joins: Array<{ table: string; cols: string[] }>
} {
  const joins: Array<{ table: string; cols: string[] }> = []
  const plain: string[] = []
  const joinRegex = /(\w+)\(([^)]+)\)/g
  let remaining = cols
  let match: RegExpExecArray | null
  while ((match = joinRegex.exec(cols)) !== null) {
    joins.push({ table: match[1], cols: match[2].split(',').map(c => c.trim()) })
    remaining = remaining.replace(match[0], '')
  }
  remaining.split(',').forEach(c => {
    const t = c.trim()
    if (t) plain.push(t)
  })
  return { plain, joins }
}

type DbResult<T> = { data: T; error: null } | { data: null; error: { message: string } }

class QueryBuilder {
  private _table: string
  private _op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private _cols = '*'
  private _conditions: Array<[string, unknown]> = []
  private _order?: { col: string; asc: boolean }
  private _single = false
  private _insertData?: Row
  private _updateData?: Row
  private _returnInserted = false  // .insert().select()

  constructor(table: string) {
    this._table = table
  }

  select(cols = '*') {
    if (this._op === 'insert' || this._op === 'update') {
      // Supabase pattern: .insert(data).select().single() — return inserted row
      this._returnInserted = true
    } else {
      this._op = 'select'
      this._cols = cols
    }
    return this
  }

  eq(col: string, val: unknown) {
    this._conditions.push([col, val])
    return this
  }

  order(col: string, opts: { ascending?: boolean } = {}) {
    this._order = { col, asc: opts.ascending !== false }
    return this
  }

  insert(data: Row) {
    this._op = 'insert'
    this._insertData = data
    return this
  }

  update(data: Row) {
    this._op = 'update'
    this._updateData = data
    return this
  }

  delete() {
    this._op = 'delete'
    return this
  }

  single() {
    this._single = true
    return this
  }

  // Make the builder thenable so it works with `await`
  then<T>(
    resolve: (val: DbResult<T>) => void,
    _reject?: (err: unknown) => void
  ) {
    try {
      resolve(this._execute() as DbResult<T>)
    } catch (e) {
      resolve({ data: null, error: { message: String(e) } } as DbResult<T>)
    }
  }

  private _buildWhere(qualify = false): { clause: string; params: unknown[] } {
    if (this._conditions.length === 0) return { clause: '', params: [] }
    const prefix = qualify ? `${this._table}.` : ''
    const clause =
      'WHERE ' + this._conditions.map(([c]) => `${prefix}${c} = ?`).join(' AND ')
    const params = this._conditions.map(([, v]) => v)
    return { clause, params }
  }

  private _execute(): DbResult<unknown> {
    const db = getDb()
    switch (this._op) {
      case 'select': return this._execSelect(db)
      case 'insert': return this._execInsert(db)
      case 'update': return this._execUpdate(db)
      case 'delete': return this._execDelete(db)
    }
  }

  private _execSelect(db: Database.Database): DbResult<unknown> {
    const { clause, params } = this._buildWhere()
    const orderSql = this._order
      ? `ORDER BY ${this._order.col} ${this._order.asc ? 'ASC' : 'DESC'}`
      : ''

    // Handle join syntax: "col1, col2, other_table(col3)"
    if (this._cols !== '*' && this._cols.includes('(')) {
      const { plain, joins } = parseSelectCols(this._cols)
      const { clause, params } = this._buildWhere(true)  // qualify to avoid ambiguity

      const selectParts = plain.map(c => `${this._table}.${c}`)
      let joinSql = ''

      for (const join of joins) {
        for (const col of join.cols) {
          selectParts.push(`${join.table}.${col} AS __${join.table}__${col}`)
        }
        // Guess FK: financial_uploads → borrowers via borrower_id (remove trailing 's' + '_id')
        const fk = join.table.replace(/s$/, '') + '_id'
        joinSql += ` LEFT JOIN ${join.table} ON ${this._table}.${fk} = ${join.table}.id`
      }

      const sql = `SELECT ${selectParts.join(', ')} FROM ${this._table}${joinSql} ${clause} ${orderSql}`.trim()
      const stmt = db.prepare(sql)
      const raw = this._single
        ? (stmt.get(...(params as [])) as Row | undefined)
        : (stmt.all(...(params as [])) as Row[])

      const process = (row: Row): Row => {
        const result: Row = {}
        const nested: Record<string, Row> = {}
        for (const [k, v] of Object.entries(row)) {
          if (k.startsWith('__')) {
            const rest = k.slice(2)
            const sep = rest.indexOf('__')
            const tbl = rest.slice(0, sep)
            const col = rest.slice(sep + 2)
            if (!nested[tbl]) nested[tbl] = {}
            nested[tbl][col] = v
          } else {
            result[k] = v
          }
        }
        // Deserialize plain fields
        const deserialized = deserializeRow(this._table, result)!
        return { ...deserialized, ...nested }
      }

      if (this._single) {
        const row = raw as Row | undefined
        return { data: row ? process(row) : null, error: null }
      }
      return { data: (raw as Row[]).map(process), error: null }
    }

    // Simple select
    const colsSql = this._cols === '*' ? '*' : this._cols
    const sql = `SELECT ${colsSql} FROM ${this._table} ${clause} ${orderSql}`.trim()
    const stmt = db.prepare(sql)

    if (this._single) {
      const row = stmt.get(...(params as [])) as Row | undefined
      return { data: deserializeRow(this._table, row ?? null), error: null }
    }
    const rows = stmt.all(...(params as [])) as Row[]
    return { data: rows.map(r => deserializeRow(this._table, r)!), error: null }
  }

  private _execInsert(db: Database.Database): DbResult<unknown> {
    const data = this._insertData!
    const id = (data.id as string) || randomUUID()
    const row = { id, ...data }
    const serialized = serializeRow(this._table, row)

    const cols = Object.keys(serialized)
    const sql = `INSERT INTO ${this._table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    db.prepare(sql).run(...(Object.values(serialized) as []))

    if (this._returnInserted) {
      const inserted = db.prepare(`SELECT * FROM ${this._table} WHERE id = ?`).get(id) as Row
      return { data: deserializeRow(this._table, inserted), error: null }
    }
    return { data: null, error: null }
  }

  private _execUpdate(db: Database.Database): DbResult<unknown> {
    const data = this._updateData!
    const { clause, params } = this._buildWhere()
    const serialized = serializeRow(this._table, data)
    const setCols = Object.keys(serialized).map(c => `${c} = ?`).join(', ')
    const sql = `UPDATE ${this._table} SET ${setCols} ${clause}`.trim()
    db.prepare(sql).run(...([...Object.values(serialized), ...params] as []))
    return { data: null, error: null }
  }

  private _execDelete(db: Database.Database): DbResult<unknown> {
    const { clause, params } = this._buildWhere()
    const sql = `DELETE FROM ${this._table} ${clause}`.trim()
    db.prepare(sql).run(...(params as []))
    return { data: null, error: null }
  }
}

export function createLocalClient() {
  return {
    from(table: string) {
      return new QueryBuilder(table)
    },
  }
}
