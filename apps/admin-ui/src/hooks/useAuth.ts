import { useCallback, useEffect, useRef, useState } from "react";
import { createAuthSession, type AuthSession, type AuthSnapshot } from "../auth-session";

export function useAuth() {
  const sessionRef = useRef<AuthSession | null>(null);
  if (sessionRef.current === null) sessionRef.current = createAuthSession();
  const [snapshot, setSnapshot] = useState(() => sessionRef.current!.getSnapshot());
  const refreshRef = useRef<{ session: AuthSession; promise: Promise<AuthSnapshot | null> } | null>(null);

  const refreshAuth = useCallback(() => {
    if (sessionRef.current === null) sessionRef.current = createAuthSession();
    const session = sessionRef.current;
    if (refreshRef.current?.session === session) return refreshRef.current.promise;
    const promise = session.refreshAuth().finally(() => {
      if (refreshRef.current?.promise === promise) refreshRef.current = null;
    });
    refreshRef.current = { session, promise };
    return promise;
  }, []);
  const invalidateCatalogAuthority = useCallback((expectedUserId: string) => {
    sessionRef.current?.invalidateCatalogAuthority(expectedUserId);
  }, []);
  const logout = useCallback(() => sessionRef.current?.logout() ?? Promise.resolve(), []);

  useEffect(() => {
    // StrictMode effect replay owns a new session, never a revived disposed one.
    const session = sessionRef.current ?? createAuthSession();
    sessionRef.current = session;
    const unsubscribe = session.subscribe(() => setSnapshot(session.getSnapshot()));
    setSnapshot(session.getSnapshot());
    void refreshAuth();
    return () => {
      unsubscribe();
      session.dispose();
      if (refreshRef.current?.session === session) refreshRef.current = null;
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [refreshAuth]);

  return { ...snapshot, refreshAuth, invalidateCatalogAuthority, logout };
}
