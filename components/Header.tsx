"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";

export default function Header() {
  const session = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [owner, setOwner] = useState(false);

  // Owner link only in local dev, where /admin exists.
  const userId = session?.user.id;
  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !userId) return;
    getSupabase()
      .rpc("is_owner")
      .then(({ data }) => setOwner(Boolean(data)));
  }, [userId]);

  async function logout() {
    setBusy(true);
    await getSupabase().auth.signOut();
    setBusy(false);
    router.replace("/");
  }

  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold text-stone-900">
          <span aria-hidden="true" className="inline-block h-6 w-6 rounded-full bg-amber-400 ring-2 ring-stone-900" />
          Beebly
        </Link>
        <nav aria-label="Account" className="flex items-center gap-3 text-sm">
          {session ? (
            <>
              {owner && (
                <Link href="/admin" className="link">
                  Owner
                </Link>
              )}
              <Link href="/app" className="link">
                My market
              </Link>
              <button
                type="button"
                data-testid="logout"
                onClick={logout}
                disabled={busy}
                className="btn btn-secondary"
              >
                {busy ? "Logging out…" : "Log out"}
              </button>
            </>
          ) : session === null ? (
            <>
              <Link href="/login" className="link">
                Log in
              </Link>
              <Link href="/signup" className="btn btn-primary">
                Sign up
              </Link>
            </>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
