import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase-server";

export default async function StaffHomePage() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/staff/sign-in");

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id, tenant_id, display_name, email")
    .eq("id", user.id)
    .maybeSingle();

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, slug, name")
    .maybeSingle();

  const { data: features } = await supabase
    .from("tenant_features")
    .select("feature_key, enabled");

  return (
    <div className="staff-shell">
      <header className="staff-header">EvolveIT · Staff</header>
      <main className="card" style={{ maxWidth: 640 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginTop: 0 }}>Signed in</h1>
        <p className="muted">Day 1 acceptance: manager session is active.</p>
        <p>
          <strong>{profile?.display_name ?? user.email}</strong>
        </p>
        <p className="mono">{profile?.email}</p>
        <p className="muted">Roles: {(roles ?? []).map((r) => r.role).join(", ") || "none"}</p>
        {profileError ? <p className="field-error">{profileError.message}</p> : null}
        {(roles ?? []).some((r) => ["waiter", "manager", "owner"].includes(r.role)) && (
          <p>
            <a href="/staff/waiter">Open Waiter Tables →</a>
          </p>
        )}
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Tenant</h2>
        <p>
          {tenant?.name} <span className="mono">({tenant?.slug})</span>
        </p>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Feature flags</h2>
        <ul>
          {(features ?? []).map((f) => (
            <li key={f.feature_key} className="mono">
              {f.feature_key}: {f.enabled ? "on" : "off"}
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
