import type { AuthMe } from "../types";

export type SessionGateway = {
  getCurrentUser: () => Promise<AuthMe>;
  login: (options: { username: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (options: { username: string; newPassword: string }) => Promise<void>;
};
