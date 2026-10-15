import type { SessionGateway } from "../../ports/session-gateway";

export function createLogout(options: { sessionGateway: SessionGateway }) {
  const { sessionGateway } = options;
  return async function logout(): Promise<void> {
    await sessionGateway.logout().catch(() => undefined);
  };
}
