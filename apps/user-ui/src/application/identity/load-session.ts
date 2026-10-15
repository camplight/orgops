import type { SessionGateway } from "../../ports/session-gateway";

export type LoadSessionResult =
  | {
      kind: "loaded";
      username: string;
      userId: string | null;
      authenticated: boolean;
      mustChangePassword: boolean;
    }
  | { kind: "unavailable" };

export function createLoadSession(options: { sessionGateway: SessionGateway }) {
  const { sessionGateway } = options;
  return async function loadSession(): Promise<LoadSessionResult> {
    try {
      const me = await sessionGateway.getCurrentUser();
      const nextUsername = me.username ?? "";
      return {
        kind: "loaded",
        username: nextUsername,
        userId: me.id ?? null,
        authenticated: Boolean(nextUsername),
        mustChangePassword: Boolean(me.mustChangePassword)
      };
    } catch {
      return { kind: "unavailable" };
    }
  };
}
