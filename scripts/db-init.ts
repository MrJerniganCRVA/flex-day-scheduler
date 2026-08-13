import "dotenv/config";
import { execSync } from "child_process";
import { readdirSync, statSync } from "fs";
import { join } from "path";
import { Pool } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Before running `migrate deploy`, bring the _prisma_migrations table into a
 * consistent state so deploy never hits a blocking failed-migration error.
 *
 * Two scenarios this must handle:
 *
 *  A) First deploy on a database that was previously managed by `db push`:
 *     _prisma_migrations doesn't exist, but the schema is already in place.
 *     → Baseline every migration as applied so deploy sees nothing to do.
 *
 *  B) A previous `migrate deploy` started a migration but never finished
 *     (P3009): _prisma_migrations exists with rows where finished_at IS NULL.
 *     → Resolve each as rolled back, so `migrate deploy` retries its real SQL
 *       next. Resolving as "applied" instead would be wrong whenever the
 *       migration's SQL genuinely failed (e.g. it altered a table that
 *       doesn't exist yet) rather than merely failing to record success —
 *       that silently marks a no-op migration "done" and permanently strands
 *       the schema short of what it adds. Retrying is always safe here: if
 *       the SQL truly already succeeded, the retry fails loudly (e.g.
 *       "column already exists") instead of corrupting history silently.
 */
async function ensureMigrationsReady() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    // Check whether the migrations tracking table exists.
    const { rows: tableCheck } = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_tables
        WHERE schemaname = 'public' AND tablename = '_prisma_migrations'
      ) AS exists
    `);

    if (!tableCheck[0].exists) {
      // No migrations table yet. If other tables exist, this is a db-push database
      // and we need to baseline so migrate deploy won't try to re-create the schema.
      const { rows: anyTable } = await client.query(`
        SELECT 1 FROM pg_tables WHERE schemaname = 'public' LIMIT 1
      `);

      if (anyTable.length > 0) {
        console.log("Detected existing schema without migration history — baselining migrations...");
        const migrationsDir = join(__dirname, "..", "prisma", "migrations");
        const migrationNames = readdirSync(migrationsDir)
          .filter((entry) => statSync(join(migrationsDir, entry)).isDirectory())
          .sort();

        for (const name of migrationNames) {
          console.log(`  Marking as applied: ${name}`);
          execSync(`prisma migrate resolve --applied "${name}"`, { stdio: "inherit" });
        }
      }
      // Fresh database with no tables — let migrate deploy handle it from scratch.
    } else {
      // Migrations table exists. Resolve any entries that started but never
      // finished as rolled back, so `migrate deploy` retries their real SQL.
      const { rows: failed } = await client.query<{ migration_name: string }>(`
        SELECT migration_name FROM _prisma_migrations
        WHERE finished_at IS NULL AND rolled_back_at IS NULL
        ORDER BY started_at
      `);

      for (const { migration_name } of failed) {
        console.log(`Resolving incomplete migration as rolled back: ${migration_name}`);
        execSync(`prisma migrate resolve --rolled-back "${migration_name}"`, { stdio: "inherit" });
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

async function init() {
  // 1. Ensure migration history is clean before deploying.
  await ensureMigrationsReady();

  // 2. Apply any pending migrations (never drops data).
  console.log("Applying database migrations...");
  execSync("prisma migrate deploy", { stdio: "inherit" });
  console.log("Migrations applied.");

  // 3. Seed admin user (idempotent — safe on every deploy).
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  if (!adminEmail) {
    console.log("SEED_ADMIN_EMAIL not set — skipping admin seed.");
    return;
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  try {
    const user = await prisma.user.upsert({
      where: { email: adminEmail },
      update: { role: "ADMIN" },
      create: { email: adminEmail, name: "Administrator", role: "ADMIN" },
    });
    console.log(`Admin user ready: ${user.email} (${user.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

init().catch((e) => {
  console.error("Database initialization failed:", e);
  process.exit(1);
});
