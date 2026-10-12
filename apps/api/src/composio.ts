// Extracted from the locally deployed skills/composio REST helpers. Service
// credentials stay in the API; callers cannot override the origin or auth headers.
export type ComposioConfig = {
  apiKey: string;
  instanceId: string;
  callbackUrl: string;
  authConfigs: Record<string, string>;
  fetch?: typeof fetch;
};
export function composioConfigFromEnv(): ComposioConfig | undefined {
  const apiKey = process.env.ORGOPS_COMPOSIO_API_KEY;
  const instanceId = process.env.ORGOPS_COMPOSIO_INSTANCE_ID;
  const callbackUrl = process.env.ORGOPS_COMPOSIO_CALLBACK_URL;
  if (!apiKey || !instanceId || !callbackUrl) return;
  try {
    const authConfigs = JSON.parse(
      process.env.ORGOPS_COMPOSIO_AUTH_CONFIGS ?? "{}",
    );
    if (
      !authConfigs ||
      Array.isArray(authConfigs) ||
      typeof authConfigs !== "object" ||
      Object.entries(authConfigs).some(
        ([key, value]) =>
          !/^[a-z0-9_]+$/.test(key) || typeof value !== "string" || !value,
      )
    )
      return;
    return { apiKey, instanceId, callbackUrl, authConfigs };
  } catch {
    return;
  }
}
export function createComposioClient(config: ComposioConfig) {
  const callback = new URL(config.callbackUrl);
  if (
    callback.protocol !== "https:" ||
    callback.username ||
    callback.password ||
    callback.hash ||
    callback.search
  )
    throw Error(
      "Composio callback must be a fixed HTTPS URL without query or fragment",
    );
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(config.instanceId))
    throw Error("Invalid Composio instance ID");
  const transport = config.fetch ?? fetch;
  async function request(
    path: string,
    options: {
      method?: string;
      query?: Record<string, string>;
      body?: unknown;
    } = {},
  ) {
    const url = new URL("https://backend.composio.dev/api/v3.1" + path);
    for (const [key, value] of Object.entries(options.query ?? {}))
      url.searchParams.set(key, value);
    const response = await transport(url, {
      method: options.method ?? "GET",
      headers: {
        "x-api-key": config.apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
    if (!response.ok)
      throw Error(`Composio request failed (${response.status})`);
    return (await response.json()) as any;
  }
  return {
    request,
    config,
    userId: (humanId: string) => `orgops:${config.instanceId}:${humanId}`,
  };
}
export type ComposioClient = ReturnType<typeof createComposioClient>;
