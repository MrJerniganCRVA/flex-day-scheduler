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
    async signIn({ profile }) {
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

      return true;
    },
    async session({ session, user }) {
      if (!session.user || !user) return session;

      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { id: true, role: true, email: true },
      });

      if (!dbUser) return session;

      // Auto-assign role if still on the default STUDENT role
      if (dbUser.role === "STUDENT") {
        const email = dbUser.email.toLowerCase();
        const domain = process.env.ALLOWED_EMAIL_DOMAIN ?? "";
        const isTeacherEmail =
          email.endsWith(`@${domain}`) &&
          !email.endsWith(`@students.${domain}`);

        if (isTeacherEmail) {
          await prisma.user.update({
            where: { id: user.id },
            data: { role: "TEACHER" },
          });
          session.user.role = "TEACHER";
          console.log(`Auto-assigned TEACHER role to ${email}`);
        } else {
          session.user.role = "STUDENT";
        }
      } else {
        // TEACHER or ADMIN — never auto-downgrade
        session.user.role = dbUser.role;
      }

      session.user.id = dbUser.id;
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
