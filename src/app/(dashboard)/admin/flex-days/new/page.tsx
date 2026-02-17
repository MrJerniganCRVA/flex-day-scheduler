import { auth } from "@/auth";
import { redirect } from "next/navigation";
import FlexDayForm from "@/components/flex-days/FlexDayForm";

export default async function NewFlexDayPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/unauthorized");

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        Create a New Flex Day
      </h1>
      <FlexDayForm />
    </div>
  );
}
