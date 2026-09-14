import { auth } from "@/auth";
import { redirect } from "next/navigation";
import StudentSignupEditor from "@/components/admin/StudentSignupEditor";

/**
 * Deliberately fetches nothing. The whole screen hangs off an email address the
 * admin has not typed yet, so there is no initial data to hand down — unlike
 * the required-members panel, which is given its candidate list up front
 * because the club is already known.
 */
export default async function AdminStudentSignupsPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/unauthorized");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Student Signups
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Look a student up and change their clubs on any upcoming Flex Day —
          before or after invites have gone out. Changes are applied in one go,
          recorded in that day&apos;s Changes tab, and the student&apos;s calendar
          invites are updated to match. Nobody else on the session is
          re-notified.
        </p>
      </div>

      <StudentSignupEditor />
    </div>
  );
}
