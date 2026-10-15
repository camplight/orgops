import type { SessionGateway } from "../../ports/session-gateway";

export function createUpdatePassword(options: { sessionGateway: SessionGateway }) {
  const { sessionGateway } = options;
  return async function updatePassword(input: {
    username: string;
    fallbackUsername: string;
    newPassword: string;
  }): Promise<void> {
    await sessionGateway.updateProfile({
      username: input.username || input.fallbackUsername.trim(),
      newPassword: input.newPassword
    });
  };
}
