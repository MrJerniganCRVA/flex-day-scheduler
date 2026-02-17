import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">403</h1>
        <p className="text-gray-600 mb-6">
          You don&apos;t have permission to access this page.
        </p>
        <Link
          href="/"
          className="text-indigo-600 hover:underline text-sm font-medium"
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
