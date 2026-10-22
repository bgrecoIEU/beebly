"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";

type Mode = "signup" | "login";

export default function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const session = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already logged in: go straight to the app.
  useEffect(() => {
    if (session) router.replace("/app");
  }, [session, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const supabase = getSupabase();

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(error.message);
      } else if (!data.session) {
        setError("Account created, but you could not be logged in automatically. Please log in.");
      } else {
        router.replace("/app");
        return;
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError("Wrong email or password. Please try again.");
      } else {
        router.replace("/app");
        return;
      }
    }
    setBusy(false);
  }

  const isSignup = mode === "signup";
  const prefix = isSignup ? "signup" : "login";

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <div className="card">
        <h1 className="text-2xl font-bold text-stone-900">
          {isSignup ? "Create your account" : "Log in"}
        </h1>
        <p className="mt-1 text-sm text-stone-700">
          {isSignup
            ? "Email and password only. You'll go straight to the market."
            : "Welcome back to the ticket market."}
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <div>
            <label htmlFor={`${prefix}-email`} className="label">
              Email
            </label>
            <input
              id={`${prefix}-email`}
              data-testid={`${prefix}-email`}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field"
            />
          </div>
          <div>
            <label htmlFor={`${prefix}-password`} className="label">
              Password
            </label>
            <input
              id={`${prefix}-password`}
              data-testid={`${prefix}-password`}
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field"
              aria-describedby={isSignup ? "password-hint" : undefined}
            />
            {isSignup && (
              <p id="password-hint" className="mt-1 text-xs text-stone-600">
                At least 6 characters.
              </p>
            )}
          </div>

          {error && (
            <p role="alert" className="rounded-lg border border-red-700 bg-red-50 px-3 py-2 text-sm text-red-900">
              <span className="font-semibold">Error: </span>
              {error}
            </p>
          )}

          <button
            type="submit"
            data-testid={`${prefix}-submit`}
            disabled={busy}
            className="btn btn-primary w-full"
          >
            {busy ? "Please wait…" : isSignup ? "Sign up" : "Log in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-stone-700">
          {isSignup ? (
            <>
              Already have an account?{" "}
              <Link href="/login" className="link">
                Log in
              </Link>
            </>
          ) : (
            <>
              New here?{" "}
              <Link href="/signup" className="link">
                Sign up
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
