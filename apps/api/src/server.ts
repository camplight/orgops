import { serve } from "bun";
import { websocket } from "hono/bun";
import { createApp } from "./app";

const { app } = createApp();

serve({
  fetch: app.fetch,
  websocket,
  port: Number(process.env.PORT ?? 8787)
});
