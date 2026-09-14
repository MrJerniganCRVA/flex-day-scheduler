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
          Look up a student by their email prefix. Will update calendars and teacher roster.
        </p>
      </div>

      <StudentSignupEditor />
    </div>
  );
}
