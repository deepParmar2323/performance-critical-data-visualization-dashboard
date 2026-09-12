/**
 * app/page.tsx — Root page (Server Component)
 * Redirects to the dashboard.
 */

import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/dashboard");
}
