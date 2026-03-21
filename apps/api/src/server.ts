import { serve } from "@hono/node-server";
import { createApp } from "./app";

const { app, injectWebSocket } = createApp();

const server = serve({
  fetch: app.fetch,
  port: Number(process.env.PORT ?? 8787)
});
injectWebSocket(server);
