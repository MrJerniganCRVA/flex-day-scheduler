import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import prisma from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  adapter: PrismaAdapter(prisma),
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      authorization: {
        params: {
          prompt: "select_account",
          hd: process.env.ALLOWED_EMAIL_DOMAIN,
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      const email = profile?.email?.toLowerCase() ?? "";
      const domain = process.env.ALLOWED_EMAIL_DOMAIN ?? "";

      if (!email || !domain) return false;

      // Accept both @domain and @students.domain
      const isStudentEmail = email.endsWith(`@students.${domain}`);
      const isTeacherEmail = email.endsWith(`@${domain}`) && !isStudentEmail;

      if (!isStudentEmail && !isTeacherEmail) {
        console.log(`Rejected login: ${email} (not @${domain} or @students.${domain})`);
        return false;
      }

      // Auto-assign role on first sign-in
      if (account?.provider === "google" && user.id) {
        const existingUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { role: true },
        });

        // Only auto-assign if user doesn't exist yet (first sign-in)
        if (!existingUser) {
          const assignedRole = isStudentEmail ? "STUDENT" : "TEACHER";

          await prisma.user.update({
            where: { id: user.id },
            data: { role: assignedRole },
          });

          console.log(`Auto-assigned role ${assignedRole} to ${email}`);
        }
      }

      return true;
    },
    async session({ session, user }) {
      if (session.user && user) {
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { id: true, role: true },
        });
        if (dbUser) {
          session.user.id = dbUser.id;
          session.user.role = dbUser.role;
        }
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "database",
  },
});
