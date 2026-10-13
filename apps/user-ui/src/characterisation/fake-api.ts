export type FakeRequest = {
  method: string;
  path: string;
  body: unknown;
};

export type FakeResponse = {
  status?: number;
  json?: unknown;
  text?: string;
};

export type FakeResponder = FakeResponse | ((request: FakeRequest) => FakeResponse | Promise<FakeResponse>);

export type FakeRoute = {
  method?: string;
  path: string | RegExp;
} & ({ respond: FakeResponder } | { respondInOrder: readonly FakeResponse[] });

const parseBody = (body: BodyInit | null | undefined): unknown => {
  if (typeof body !== "string") return body ?? undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
};

const pathOf = (input: RequestInfo | URL): string => {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, "http://localhost");
  return `${url.pathname}${url.search}`;
};

const matches = (route: FakeRoute, request: FakeRequest): boolean => {
  const methodMatches = (route.method ?? "GET").toUpperCase() === request.method;
  const pathMatches =
    typeof route.path === "string" ? route.path === request.path : route.path.test(request.path);
  return methodMatches && pathMatches;
};

const toResponse = ({ status = 200, json, text }: FakeResponse): Response => {
  if (json !== undefined) {
    return new Response(JSON.stringify(json), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(text ?? "", { status });
};

export const createFakeApi = (routes: readonly FakeRoute[]) => {
  const requests: FakeRequest[] = [];
  const callCounts = new Map<FakeRoute, number>();

  const respondTo = async (route: FakeRoute, request: FakeRequest): Promise<FakeResponse> => {
    if ("respondInOrder" in route) {
      const callIndex = callCounts.get(route) ?? 0;
      callCounts.set(route, callIndex + 1);
      return route.respondInOrder[Math.min(callIndex, route.respondInOrder.length - 1)];
    }
    return typeof route.respond === "function" ? route.respond(request) : route.respond;
  };

  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request: FakeRequest = {
      method: (init?.method ?? "GET").toUpperCase(),
      path: pathOf(input),
      body: parseBody(init?.body),
    };
    requests.push(request);
    const route = routes.find((candidate) => matches(candidate, request));
    if (!route) {
      return toResponse({ status: 404, text: `No fake route for ${request.method} ${request.path}` });
    }
    return toResponse(await respondTo(route, request));
  };

  return { fetch: fakeFetch, requests };
};
