import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import prisma from "@/lib/prisma";
import { allowedEmailDomain, classifyEmail } from "@/lib/email-domain";

// Some platforms (e.g. Railway's RAILWAY_PUBLIC_DOMAIN) expose the deployment
// hostname without a URL scheme. If that bare hostname ends up pasted into
// AUTH_URL/NEXTAUTH_URL, Auth.js's internal URL parsing throws on every
// request. trustHost below means these vars aren't required behind a
// reverse proxy, but normalize them defensively so a missing "https://"
// can't take the whole app down.
for (const key of ["AUTH_URL", "NEXTAUTH_URL"] as const) {
  const value = process.env[key];
  if (value && !/^https?:\/\//i.test(value)) {
    process.env[key] = `https://${value}`;
  }
}

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
          hd: allowedEmailDomain(),
        },
      },

      // Attach a Google login to a User row that already exists with the same
      // email, instead of refusing it.
      //
      // Without this, Auth.js finds no Account row for the incoming Google
      // identity, finds a User row carrying that email, and — unable to rule out
      // that they are two different people — fails the login with
      // OAuthAccountNotLinked. That is the right default for a site with several
      // providers and unverified emails. Here it breaks the two cases where this
      // app deliberately creates a user before they have ever logged in: the CSV
      // student import (POST /api/admin/students/import) and the seeded
      // SEED_ADMIN_EMAIL admin (prisma/seed.ts). Every imported student would be
      // locked out on their first attempt — precisely the students the import
      // exists to reach.
      //
      // "Dangerous" names the general risk: linking by email trusts the provider
      // not to issue an address its owner does not control. The trust is
      // warranted here and nowhere wider. Google is the only provider
      // configured, it verifies the addresses on accounts it issues, and both
      // the `hd` parameter above and the signIn callback below confine logins to
      // the school's own Workspace domain — so the addresses being matched are
      // ones the school itself issued. There is no second provider for anyone to
      // arrive through, and adding one would make this setting unsafe.
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  events: {
    /**
     * Replace a placeholder name the moment the real person turns up.
     *
     * Fires when a Google identity is attached to a User row, which — given the
     * linking enabled above — includes every imported student's first sign-in.
     * Auth.js links the account but never updates the profile of a row it did not
     * create itself, so without this the name derived from a student's email
     * address at import (src/lib/email-domain.ts) would stay on their record
     * permanently, standing in for their real name on every roster, signup list
     * and coverage screen in the app.
     *
     * Best-effort by design: a failure to prettify a name must not fail the login
     * that triggered it.
     */
    async linkAccount({ user, profile }) {
      if (!user.id) return;

      const name = profile?.name?.trim();
      const image = profile?.image ?? null;

      const data = {
        ...(name && name !== user.name ? { name } : {}),
        ...(image && image !== user.image ? { image } : {}),
      };
      if (Object.keys(data).length === 0) return;

      await prisma.user.update({ where: { id: user.id }, data }).catch((err) =>
        console.error(
          `Linked a Google account to ${user.email}, but refreshing their profile failed:`,
          err
        )
      );
    },
  },
  callbacks: {
    async signIn({ profile }) {
      const email = profile?.email?.toLowerCase() ?? "";
      const domain = allowedEmailDomain();

      if (!email || !domain) return false;

      // Accept both @domain and @students.domain
      if (classifyEmail(email, domain) === "outside") {
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

        if (classifyEmail(email, allowedEmailDomain()) === "teacher") {
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
