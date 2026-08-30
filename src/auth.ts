import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { SINGLE_USER_ID, SINGLE_USER_NAME } from "@/auth/constants";
import { credentialsSchema, verifyPassword } from "@/auth/credentials";
import { getServerEnv } from "@/config/env";

const env = getServerEnv();

export const { auth, handlers, signIn, signOut } = NextAuth({
  secret: env.AUTH_SECRET,
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 12 * 60 * 60,
  },
  providers: [
    Credentials({
      credentials: {
        password: { label: "Password", type: "password" },
      },
      authorize: async (rawCredentials) => {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;

        const isValid = await verifyPassword(
          parsed.data.password,
          env.APP_PASSWORD_HASH,
        );
        if (!isValid) return null;

        return {
          id: SINGLE_USER_ID,
          name: SINGLE_USER_NAME,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id === SINGLE_USER_ID) token.sub = SINGLE_USER_ID;
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub === SINGLE_USER_ID) {
        session.user.id = SINGLE_USER_ID;
      }
      return session;
    },
  },
});
