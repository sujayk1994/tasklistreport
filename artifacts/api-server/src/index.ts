import app from "./app";
import { logger } from "./lib/logger";
import { startInboxPoller, startPrintTaskScheduler, startManualProjectScheduler } from "./lib/inbox";
import { startAutoSubmitScheduler } from "./lib/autoSubmit";
import { pool } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function runMigrations(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reprint_receipts (
        id SERIAL PRIMARY KEY,
        magazine TEXT NOT NULL,
        project TEXT NOT NULL,
        received_at TIMESTAMP DEFAULT NOW() NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reprint_completions (
        id SERIAL PRIMARY KEY,
        magazine TEXT NOT NULL,
        project TEXT NOT NULL,
        completed_at TIMESTAMP DEFAULT NOW() NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);
    logger.info("Migrations: reprint_receipts and reprint_completions tables ensured");
  } catch (err) {
    logger.error({ err }, "Migrations: failed to create reprint tracking tables");
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS manual_projects (
        id SERIAL PRIMARY KEY,
        magazine TEXT NOT NULL,
        project TEXT NOT NULL,
        copies INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        reprint_task_created BOOLEAN NOT NULL DEFAULT FALSE,
        reprint_task_created_at TIMESTAMP,
        reprint_completed_at TIMESTAMP,
        twitter_task_created BOOLEAN NOT NULL DEFAULT FALSE,
        twitter_task_created_at TIMESTAMP,
        UNIQUE(magazine, project)
      );
    `);
    logger.info("Migrations: manual_projects table ensured");
  } catch (err) {
    logger.error({ err }, "Migrations: failed to create manual_projects table");
  }
}

runMigrations().then(() => {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    startInboxPoller();
    startAutoSubmitScheduler();
    startPrintTaskScheduler();
    startManualProjectScheduler();
  });
});
