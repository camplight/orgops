type RuntimeUiConfig = {
  apiBaseUrl?: string;
  wsBaseUrl?: string;
};

const DEFAULT_API_BASE = "/api";
const DEFAULT_WS_BASE = "/ws";

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

function isAbsoluteWsUrl(value: string): boolean {
  return /^wss?:\/\//i.test(value);
}

function parseHttpUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function toWsProtocol(protocol: string): "ws:" | "wss:" {
  return protocol === "https:" ? "wss:" : "ws:";
}

function deriveWsBaseFromApiBase(apiBaseUrl: string): string | undefined {
  if (!isAbsoluteHttpUrl(apiBaseUrl)) return undefined;
  const parsed = parseHttpUrl(apiBaseUrl);
  if (!parsed) return undefined;
  const normalizedPath = stripTrailingSlashes(parsed.pathname) || "/";
  const wsPath =
    normalizedPath === "/api"
      ? "/ws"
      : normalizedPath.endsWith("/api")
        ? `${normalizedPath.slice(0, -4)}/ws`
        : normalizedPath === "/"
          ? "/ws"
          : `${normalizedPath}/ws`;
  return `${toWsProtocol(parsed.protocol)}//${parsed.host}${wsPath}`;
}

function resolveConfiguredApiBase(): string {
  const runtimeConfig = (globalThis as { __ORGOPS_UI_CONFIG__?: RuntimeUiConfig })
    .__ORGOPS_UI_CONFIG__;
  return (
    trimToUndefined(runtimeConfig?.apiBaseUrl) ??
    trimToUndefined(import.meta.env.VITE_API_BASE_URL) ??
    DEFAULT_API_BASE
  );
}

function resolveConfiguredWsBase(configuredApiBase: string): string {
  const runtimeConfig = (globalThis as { __ORGOPS_UI_CONFIG__?: RuntimeUiConfig })
    .__ORGOPS_UI_CONFIG__;
  return (
    trimToUndefined(runtimeConfig?.wsBaseUrl) ??
    trimToUndefined(import.meta.env.VITE_WS_BASE_URL) ??
    deriveWsBaseFromApiBase(configuredApiBase) ??
    DEFAULT_WS_BASE
  );
}

const configuredApiBase = resolveConfiguredApiBase();
const configuredWsBase = resolveConfiguredWsBase(configuredApiBase);

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

export function wsUrl(): string {
  if (isAbsoluteWsUrl(configuredWsBase)) return configuredWsBase;
  if (isAbsoluteHttpUrl(configuredWsBase)) {
    const parsed = parseHttpUrl(configuredWsBase);
    if (parsed) {
      return `${toWsProtocol(parsed.protocol)}//${parsed.host}${parsed.pathname}${parsed.search}`;
    }
  }
  const wsPath = configuredWsBase.startsWith("/")
    ? configuredWsBase
    : `/${configuredWsBase}`;
  return `${toWsProtocol(location.protocol)}//${location.host}${wsPath}`;
}

export function runnerApiUrlHint(): string {
  if (isAbsoluteHttpUrl(configuredApiBase)) {
    const parsed = parseHttpUrl(configuredApiBase);
    if (parsed) {
      const normalizedPath = stripTrailingSlashes(parsed.pathname);
      const runnerPath = normalizedPath.endsWith("/api")
        ? normalizedPath.slice(0, -4)
        : normalizedPath;
      return `${parsed.protocol}//${parsed.host}${runnerPath || ""}`;
    }
  }
  return window.location.origin;
}

