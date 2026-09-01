import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase-server";
import WaiterTableDetail from "./WaiterTableDetail";

export default async function WaiterTableDetailPage({ params }: { params: { tableId: string } }) {
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

  return <WaiterTableDetail tableId={params.tableId} />;
}
