import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase-server";
import WaiterTablesView from "./WaiterTablesView";

// Section 09: My Tables (waiter) / All Tables (manager). Role gating
// mirrors /staff/page.tsx's pattern — check the cookie session
// server-side, redirect to sign-in if absent — but additionally
// requires waiter/manager/owner, since a bare staff account with no
// floor role has nothing to see here.

export default async function WaiterTablesPage() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/staff/sign-in");

  const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r) => r.role as string);
  const allowed = roles.some((r) => ["waiter", "manager", "owner"].includes(r));
  if (!allowed) {
    return (
      <div className="staff-shell">
        <header className="staff-header">EvolveIT · Staff</header>
        <main className="card">
          <p className="field-error">Your account has no waiter, manager, or owner role in this tenant.</p>
        </main>
      </div>
    );
  }

  return <WaiterTablesView isManager={roles.includes("manager") || roles.includes("owner")} />;
}
