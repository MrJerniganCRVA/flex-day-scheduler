import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "next-auth/react";

export const metadata: Metadata = {
  title: "Flex Day Scheduler | CodeRVA",
  description: "Sign up for clubs and activities on Flex Days at CodeRVA Regional High School",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
