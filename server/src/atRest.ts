import type pg from 'pg'
import { emailHmac, encryptJson } from './crypto.js'

type Db = Pick<pg.Pool, 'query'>

async function hasColumn(db: Db, table: string, column: string): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  )
  return (result.rowCount ?? 0) > 0
}

async function sealUsers(db: Db): Promise<void> {
  if (await hasColumn(db, 'users', 'email')) {
    await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email_hmac bytea')
    await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email_payload bytea')
    await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email_nonce bytea')
    const rows = await db.query<{ id: string; email: string }>(
      'SELECT id, email FROM users WHERE email_hmac IS NULL',
    )
    for (const row of rows.rows) {
      const email = row.email.trim().toLowerCase()
      const sealed = encryptJson(email)
      await db.query(
        `UPDATE users
         SET email_hmac = $2, email_payload = $3, email_nonce = $4
         WHERE id = $1`,
        [row.id, emailHmac(email), sealed.payload, sealed.nonce],
      )
    }
    await db.query('ALTER TABLE users ALTER COLUMN email_hmac SET NOT NULL')
    await db.query('ALTER TABLE users ALTER COLUMN email_payload SET NOT NULL')
    await db.query('ALTER TABLE users ALTER COLUMN email_nonce SET NOT NULL')
    await db.query('CREATE UNIQUE INDEX IF NOT EXISTS users_email_hmac_key ON users (email_hmac)')
    await db.query('ALTER TABLE users DROP COLUMN email CASCADE')
  }
  if (!(await hasColumn(db, 'users', 'born_on'))) return
  await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS born_payload bytea')
  await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS born_nonce bytea')
  const births = await db.query<{ id: string; born_on: string }>(
    'SELECT id, born_on::text AS born_on FROM users WHERE born_on IS NOT NULL AND born_payload IS NULL',
  )
  for (const row of births.rows) {
    const sealed = encryptJson(row.born_on)
    await db.query(
      'UPDATE users SET born_payload = $2, born_nonce = $3 WHERE id = $1',
      [row.id, sealed.payload, sealed.nonce],
    )
  }
  await db.query('ALTER TABLE users DROP COLUMN born_on CASCADE')
}

async function sealKeyedPlaces(
  db: Db,
  table: string,
  keyColumn: string,
  plaintextColumns: string[],
): Promise<void> {
  const marker = plaintextColumns[0]
  if (!marker || !(await hasColumn(db, table, marker))) return
  await db.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS payload bytea`)
  await db.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS nonce bytea`)
  const rows = await db.query<Record<string, unknown>>(
    `SELECT user_id, ${keyColumn}, ${plaintextColumns.join(', ')}
     FROM ${table}
     WHERE payload IS NULL`,
  )
  for (const row of rows.rows) {
    const body: Record<string, unknown> = {}
    for (const column of plaintextColumns) body[column] = row[column] ?? null
    const sealed = encryptJson(body)
    await db.query(
      `UPDATE ${table}
       SET payload = $3, nonce = $4
       WHERE user_id = $1 AND ${keyColumn} = $2`,
      [row.user_id, row[keyColumn], sealed.payload, sealed.nonce],
    )
  }
  await db.query(`ALTER TABLE ${table} ALTER COLUMN payload SET NOT NULL`)
  await db.query(`ALTER TABLE ${table} ALTER COLUMN nonce SET NOT NULL`)
  for (const column of plaintextColumns) {
    await db.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS ${column} CASCADE`)
  }
}

export async function sealPlaintextColumns(db: Db): Promise<void> {
  await sealUsers(db)
  await sealKeyedPlaces(db, 'wifi_places', 'bssid_hmac', [
    'bssid', 'ssid', 'channel', 'security', 'lat', 'lon', 'city', 'state', 'zip',
  ])
  await sealKeyedPlaces(db, 'bluetooth_places', 'address_hmac', [
    'name', 'lat', 'lon', 'city', 'state', 'zip',
  ])
  await sealKeyedPlaces(db, 'bookmarks', 'url_hmac', ['title', 'url'])
}
