import { environmentFlag, runMigrations } from './migrate.js'

const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) throw new Error('DATABASE_URL wajib diisi pada runtime environment.')

await runMigrations(databaseUrl, {
  enabled: environmentFlag(process.env.RUN_DB_MIGRATIONS, true),
  seedSampleData: environmentFlag(process.env.SEED_SAMPLE_DATA, false)
})
