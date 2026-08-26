type RuntimeUserUiConfig = {
  apiBaseUrl?: string;
};

const DEFAULT_API_BASE = "/api";

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function stripApiPrefix(path: string): string {
  return path.replace(/^\/api(?=\/|$)/, "");
}

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function resolveConfiguredApiBase(): string {
  const runtimeConfig = (globalThis as { __ORGOPS_USER_UI_CONFIG__?: RuntimeUserUiConfig })
    .__ORGOPS_USER_UI_CONFIG__;
  return (
    trimToUndefined(runtimeConfig?.apiBaseUrl) ??
    trimToUndefined(import.meta.env.VITE_API_BASE_URL) ??
    DEFAULT_API_BASE
  );
}

const configuredApiBase = resolveConfiguredApiBase();

export function apiUrl(path: string): string {
  if (isAbsoluteHttpUrl(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = stripTrailingSlashes(configuredApiBase) || DEFAULT_API_BASE;
  const pathWithoutApiPrefix = stripApiPrefix(normalizedPath);
  if (base.endsWith("/api")) {
    return `${base}${pathWithoutApiPrefix}`;
  }
  return `${base}${normalizedPath}`;
}
