export type SessionState = "loading" | "signedOut" | "mustChangePassword" | "ready";

export function deriveSessionState(flags: {
  authenticated: boolean;
  authLoading: boolean;
  mustChangePassword: boolean;
}): SessionState {
  if (flags.authLoading && !flags.authenticated) return "loading";
  if (!flags.authenticated) return "signedOut";
  if (flags.mustChangePassword) return "mustChangePassword";
  return "ready";
}
