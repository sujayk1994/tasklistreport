/**
 * Standalone DB migration script — creates tables if they don't exist,
 * and applies any column additions for existing deployments.
 * Uses raw SQL so it works without drizzle-kit in the production container.
 * Run: node scripts/migrate.mjs
 */
import pkg from "pg";
const { Client } = pkg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("✗ DATABASE_URL environment variable is required.");
  process.exit(1);
}

async function migrate() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    // ── Create tables ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_lists (
        id           SERIAL PRIMARY KEY,
        user_id      TEXT NOT NULL,
        date         TEXT NOT NULL,
        submitted    BOOLEAN NOT NULL DEFAULT false,
        submitted_at TIMESTAMP,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id           SERIAL PRIMARY KEY,
        task_list_id INTEGER NOT NULL
                       REFERENCES task_lists(id) ON DELETE CASCADE,
        text         TEXT NOT NULL,
        completed    BOOLEAN NOT NULL DEFAULT false,
        position     INTEGER NOT NULL DEFAULT 0,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_settings (
        id                SERIAL PRIMARY KEY,
        user_id           TEXT NOT NULL UNIQUE,
        recipient_emails  TEXT NOT NULL DEFAULT '',
        created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // ── Additive column migrations (safe to run on existing databases) ─────────
    await client.query(`
      ALTER TABLE tasks
        ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
    `);

    await client.query(`
      ALTER TABLE tasks
        ADD COLUMN IF NOT EXISTS posted_for_future BOOLEAN NOT NULL DEFAULT false;
    `);

    // ── Processed-email tracking (idempotent ingestion) ────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS processed_emails (
        id            SERIAL PRIMARY KEY,
        message_id    TEXT NOT NULL UNIQUE,
        subject       TEXT NOT NULL DEFAULT '',
        processed_at  TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // ── Print shipments (used by admin/inbox shipment scheduling) ─────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS print_shipments (
        id                SERIAL PRIMARY KEY,
        magazine          TEXT NOT NULL,
        project           TEXT NOT NULL,
        print_copies      INTEGER NOT NULL,
        print_date        TEXT NOT NULL,
        shipment_date     TEXT NOT NULL,
        shipment_created  BOOLEAN NOT NULL DEFAULT false,
        created_at        TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS print_shipments_unique
        ON print_shipments (magazine, project, print_date);
    `);

    console.log("✓ Database migration complete.");
  } finally {
    await client.end();
  }
}

migrate().catch((err) => {
  console.error("✗ Migration failed:", err.message);
  process.exit(1);
});
