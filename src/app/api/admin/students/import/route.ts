import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { allowedEmailDomain } from "@/lib/email-domain";
import { importStudentsSchema } from "@/lib/validations";
import { parseStudentCsv, type ParsedStudent } from "@/lib/student-import";

/**
 * POST /api/admin/students/import — create student accounts from a CSV.
 *
 * The counterpart of the export next door, and the reason it can finally do
 * something. Until now the app only learned a student existed when they signed
 * in, so a student who never signed in could not be scheduled, could not be
 * auto-assigned, and could never receive a calendar invite. This creates their
 * User row directly.
 *
 * Nothing downstream needed changing to make that work. Auto-assign selects
 * students with `role: STUDENT` and never asks whether they have logged in
 * (src/app/api/admin/flex-days/[flexDayId]/auto-assign/route.ts), and finalize
 * builds its attendee list from `signup.student.email`
 * (src/app/api/flex-days/[flexDayId]/finalize/route.ts) and sends through the
 * service account — a school Google address receives the invite whether or not
 * its owner has ever opened this app. Creating the row is the whole feature.
 *
 * Admin-only, like the export: it writes accounts for the entire student body.
 */

/** Cap on importable rows, so one wrong file cannot rewrite the users table. */
const MAX_ROWS = 5000;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = importStudentsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const domain = allowedEmailDomain();
  if (!domain) {
    return NextResponse.json(
      {
        error:
          "ALLOWED_EMAIL_DOMAIN is not configured, so no address can be checked against the school's domain.",
      },
      { status: 500 }
    );
  }

  const { students, rejected } = parseStudentCsv(parsed.data.csv, domain);

  if (students.length > MAX_ROWS) {
    return NextResponse.json(
      {
        error: `That file holds ${students.length} students, more than the ${MAX_ROWS} this import accepts at once. Split it and upload in parts.`,
      },
      { status: 400 }
    );
  }

  // Which of them the app already knows. Checked against every role rather than
  // just students, because an address already on file as a TEACHER or ADMIN must
  // count as present and be left alone — the import must never re-role someone
  // who appears in a student export by mistake.
  const emails = students.map((s) => s.email);
  const existing =
    emails.length > 0
      ? await prisma.user.findMany({
          where: { email: { in: emails } },
          select: { email: true, name: true, role: true },
        })
      : [];
  const existingByEmail = new Map(existing.map((u) => [u.email, u]));

  const toCreate = students.filter((s) => !existingByEmail.has(s.email));
  const alreadyPresent = students
    .filter((s) => existingByEmail.has(s.email))
    .map((s) => {
      const found = existingByEmail.get(s.email)!;
      return { email: s.email, name: found.name, role: found.role };
    });

  const summary = {
    toCreate: toCreate.map(publicStudent),
    alreadyPresent,
    rejected,
    counts: {
      toCreate: toCreate.length,
      alreadyPresent: alreadyPresent.length,
      rejected: rejected.length,
    },
  };

  if (parsed.data.dryRun) {
    return NextResponse.json({ ...summary, created: 0, dryRun: true });
  }

  // `skipDuplicates` against the unique email index makes the import idempotent,
  // which matters because the intended workflow is export, edit, re-upload: the
  // file an admin uploads is mostly students who are already here. It also
  // settles the race between the check above and this write.
  //
  // Creates only. An existing row is never updated — an import must not rename a
  // student who has already signed in (their name came from Google and is the
  // one they go by), nor touch the role of anyone already on file.
  const { count } = await prisma.user.createMany({
    data: toCreate.map((s) => ({
      email: s.email,
      name: s.name,
      role: "STUDENT" as const,
    })),
    skipDuplicates: true,
  });

  console.log(
    `Student import by ${session.user.email ?? "unknown"}: ${count} created, ${alreadyPresent.length} already present, ${rejected.length} rejected.`
  );

  return NextResponse.json({ ...summary, created: count, dryRun: false });
}

/** Drop the line number before sending a row back to the browser. */
function publicStudent(student: ParsedStudent) {
  return { email: student.email, name: student.name };
}
