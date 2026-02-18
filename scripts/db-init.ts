import "dotenv/config";
import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

async function init() {
  // 1. Push schema to database (creates/alters tables directly — no migration files needed)
  console.log("Pushing schema to database...");
  execSync("prisma db push", { stdio: "inherit" });
  console.log("Schema push complete.");

  // 2. Seed admin user (idempotent — safe on every deploy)
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
