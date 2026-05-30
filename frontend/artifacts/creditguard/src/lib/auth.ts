// Lightweight client-side auth shim.
// Replace with real Google OAuth + server session later — keep these signatures stable.

const STORAGE_KEY = "creditguard.auth";

export interface AuthUser {
  email: string;
  name: string;
  initials: string;
  loggedInAt: string;
}

export function getCurrentUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return getCurrentUser() !== null;
}

export function signInDemo(email: string): AuthUser {
  const cleaned = email.trim().toLowerCase();
  const namePart = cleaned.split("@")[0] || "user";
  const name = namePart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || "Demo User";
  const initials =
    name
      .split(" ")
      .map((s) => s[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "DU";
  const user: AuthUser = {
    email: cleaned,
    name,
    initials,
    loggedInAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event("creditguard-auth-change"));
  return user;
}

export function signOut(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event("creditguard-auth-change"));
}
