import { redirect } from "next/navigation";

import { landingPathForRole } from "@/lib/auth/access";
import { requireAuth } from "@/lib/auth/guard";

/**
 * Post-login dispatcher.
 *
 * The login action cannot know which landing page to aim at — the role is only
 * known once the credentials have been verified, and the session cookie is
 * issued on the redirect itself. So sign-in points here, and here reads the
 * session and forwards. It renders nothing.
 */
export default async function StartPage() {
  const { user } = await requireAuth();
  redirect(landingPathForRole(user.role));
}
