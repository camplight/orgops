export const INSTALL_COMPONENTS = ["api", "runner", "admin-ui", "user-ui"] as const;

export type InstallComponent = (typeof INSTALL_COMPONENTS)[number];

export const DEFAULT_INSTALL_COMPONENTS: InstallComponent[] = [
  "api",
  "runner",
  "user-ui",
];

function normalizeComponentToken(value: string): InstallComponent | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "api") return "api";
  if (normalized === "runner") return "runner";
  if (normalized === "admin-ui" || normalized === "admin") return "admin-ui";
  if (normalized === "user-ui" || normalized === "user") return "user-ui";
  return null;
}

export function parseComponentsArg(raw: string | undefined | null): InstallComponent[] {
  if (!raw || !raw.trim()) return [...DEFAULT_INSTALL_COMPONENTS];
  const parts = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (parts.length === 0) return [...DEFAULT_INSTALL_COMPONENTS];
  const seen = new Set<InstallComponent>();
  for (const part of parts) {
    const resolved = normalizeComponentToken(part);
    if (!resolved) {
      throw new Error(
        `Unknown component "${part}". Allowed: ${INSTALL_COMPONENTS.join(", ")}.`
      );
    }
    seen.add(resolved);
  }
  return [...seen];
}

export function formatComponents(components: InstallComponent[]): string {
  return components.join(", ");
}

export function includesComponent(
  components: InstallComponent[],
  component: InstallComponent
) {
  return components.includes(component);
}
