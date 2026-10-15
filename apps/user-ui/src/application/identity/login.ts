import type { SessionGateway } from "../../ports/session-gateway";

export function createLogin(options: { sessionGateway: SessionGateway }) {
  const { sessionGateway } = options;
  return async function login(credentials: { username: string; password: string }): Promise<void> {
    await sessionGateway.login({
      username: credentials.username.trim(),
      password: credentials.password
    });
  };
}
