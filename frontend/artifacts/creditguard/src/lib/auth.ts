// Supabase-backed auth. Replaces the previous localStorage demo shim.
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export interface AuthUser {
  email: string;
  name: string;
  initials: string;
  loggedInAt: string;
}

export function mapUser(u: User): AuthUser {
  const email = u.email ?? "";
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const rawName =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    email.split("@")[0] ||
    "User";
  const name =
    rawName
      .split(/[._\s-]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ") || "User";
  const initials =
    name
      .split(" ")
      .map((s) => s[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "U";
  return { email, name, initials, loggedInAt: u.last_sign_in_at ?? new Date().toISOString() };
}

/** Current access token (JWT) for authenticating API calls, or null. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
}

export async function signUpWithEmail(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/** fetch() wrapper that attaches the bearer token. */
export async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

/** Fetch a file from an authed endpoint and trigger a browser download. */
export async function downloadAuthed(url: string, fallbackName: string): Promise<void> {
  const res = await authedFetch(url);
  if (!res.ok) {
    let msg = "Download failed";
    try {
      const j = await res.json();
      msg = j?.error || msg;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const m = cd.match(/filename="?([^"]+)"?/);
  const name = m?.[1] || fallbackName;
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}
