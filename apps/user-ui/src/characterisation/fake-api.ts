import { http, HttpResponse } from "msw";

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

const readBody = async (request: Request): Promise<unknown> => {
  if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    return request.formData();
  }
  const text = await request.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const matches = (route: FakeRoute, request: FakeRequest): boolean => {
  const methodMatches = (route.method ?? "GET").toUpperCase() === request.method;
  const pathMatches =
    typeof route.path === "string" ? route.path === request.path : route.path.test(request.path);
  return methodMatches && pathMatches;
};

const toResponse = ({ status = 200, json, text }: FakeResponse): Response => {
  if (json !== undefined) return HttpResponse.json(json, { status });
  return new HttpResponse(text ?? "", { status });
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

  const handler = http.all("*", async ({ request }) => {
    const { pathname, search } = new URL(request.url);
    const recorded: FakeRequest = {
      method: request.method.toUpperCase(),
      path: `${pathname}${search}`,
      body: await readBody(request.clone()),
    };
    requests.push(recorded);
    const route = routes.find((candidate) => matches(candidate, recorded));
    if (!route) {
      return toResponse({ status: 404, text: `No fake route for ${recorded.method} ${recorded.path}` });
    }
    return toResponse(await respondTo(route, recorded));
  });

  return { handler, requests };
};
