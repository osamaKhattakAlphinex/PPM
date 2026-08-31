import { handlers } from "@/lib/auth/auth";

/**
 * The Auth.js endpoints: the credentials callback, the CSRF token and the
 * session read.
 *
 * A Route Handler is the right shape here despite CLAUDE.md reserving them for
 * webhooks, files and AI — this IS the framework's callback surface, and it is
 * the one place a browser has to POST to in order to obtain a session.
 *
 * Pinned to the Node runtime because the sign-in path reaches Mongoose and the
 * argon2 native binding, neither of which exists on the Edge.
 */
export const runtime = "nodejs";

export const { GET, POST } = handlers;
