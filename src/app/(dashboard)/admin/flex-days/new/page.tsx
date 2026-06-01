import { auth } from "@/auth";
import { redirect } from "next/navigation";
import FlexDayForm from "@/components/flex-days/FlexDayForm";

export default async function NewFlexDayPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/unauthorized");

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        Create a New Flex Day
      </h1>
      <FlexDayForm />
      <div className="mt-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-4 py-3 text-sm text-blue-700 dark:text-blue-300">
        <p className="font-medium mb-1">What happens next?</p>
        <ul className="space-y-0.5 text-xs">
          <li>• All clubs with default rotations are auto-scheduled for this date.</li>
          <li>• Head to Sessions to review, then Coverage to assign teachers.</li>
          <li>• Students won&apos;t see it until you mark the flex day as Active.</li>
        </ul>
      </div>
    </div>
  );
}
