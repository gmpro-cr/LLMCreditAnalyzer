import { useEffect, useState } from "react";
import { getCurrentUser, type AuthUser } from "@/lib/auth";

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(() => getCurrentUser());

  useEffect(() => {
    const sync = () => setUser(getCurrentUser());
    window.addEventListener("creditguard-auth-change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("creditguard-auth-change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return { user, isAuthenticated: user !== null };
}
