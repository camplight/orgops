import { apiFetch, apiJson, getApiHeaders } from "../../api";
import type { AuthMe } from "../../types";
import type { SessionGateway } from "../../ports/session-gateway";

export function createHttpSessionGateway(): SessionGateway {
  return {
    getCurrentUser: () => apiJson<AuthMe>("/api/auth/me"),
    login: async ({ username, password }) => {
      await apiFetch("/api/auth/login", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          username,
          password
        })
      });
    },
    logout: async () => {
      await apiFetch("/api/auth/logout", { method: "POST" });
    },
    updateProfile: async ({ username, newPassword }) => {
      await apiFetch("/api/auth/profile", {
        method: "PATCH",
        headers: getApiHeaders(),
        body: JSON.stringify({
          username,
          newPassword
        })
      });
    }
  };
}
