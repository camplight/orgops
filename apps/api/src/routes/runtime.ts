import type { Hono } from "hono";
import { randomUUID, createHash } from "node:crypto";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import { and, asc, desc, eq } from "drizzle-orm";

type RuntimeDeps = {
  orm: OrgOpsDrizzleDb;
  FILES_DIR: string;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  publishProcessOutput: (processId: string, payload: any) => void;
  insertEvent: (input: any) => any;
};

export function registerRuntimeRoutes(app: Hono<any>, deps: RuntimeDeps) {
  const { orm, FILES_DIR, jsonResponse, publishProcessOutput, insertEvent } = deps;

  app.post("/api/files", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file as File | undefined;
    if (!file) return jsonResponse(c, { error: "Missing file" }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const id = randomUUID();
    const storagePath = join(FILES_DIR, id);
    writeFileSync(storagePath, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    orm
      .insert(schema.files)
      .values({
        id,
        storage_path: storagePath,
        original_name: file.name,
        mime: file.type,
        size: bytes.length,
        sha256,
        created_at: Date.now()
      })
      .run();
    return jsonResponse(c, { id }, 201);
  });

  app.get("/api/files/:id", (c) => {
    const id = c.req.param("id");
    const row = orm.select().from(schema.files).where(eq(schema.files.id, id)).get() as any;
    if (!row) return jsonResponse(c, { error: "Not found" }, 404);
    const data = readFileSync(row.storage_path);
    return new Response(data, { headers: { "content-type": row.mime } });
  });

  app.get("/api/files/:id/meta", (c) => {
    const id = c.req.param("id");
    const row = orm.select().from(schema.files).where(eq(schema.files.id, id)).get() as any;
    if (!row) return jsonResponse(c, { error: "Not found" }, 404);
    return jsonResponse(c, row);
  });

  app.get("/api/processes", (c) => {
    const url = new URL(c.req.url);
    const params = url.searchParams;
    const agentName = params.get("agentName");
    const channelId = params.get("channelId");
    const state = params.get("state");
    const clauses: any[] = [];
    if (agentName) clauses.push(eq(schema.processes.agent_name, agentName));
    if (channelId) clauses.push(eq(schema.processes.channel_id, channelId));
    if (state) clauses.push(eq(schema.processes.state, state));
    const rows = orm
      .select()
      .from(schema.processes)
      .where(clauses.length > 0 ? and(...clauses) : undefined)
      .orderBy(desc(schema.processes.started_at))
      .all();
    return jsonResponse(c, rows);
  });

  app.post("/api/processes", async (c) => {
    const body = await c.req.json();
    orm
      .insert(schema.processes)
      .values({
        id: body.id,
        agent_name: body.agentName,
        channel_id: body.channelId ?? null,
        cmd: body.cmd,
        cwd: body.cwd,
        pid: body.pid ?? null,
        state: body.state ?? "STARTING",
        exit_code: body.exitCode ?? null,
        started_at: body.startedAt ?? Date.now(),
        ended_at: body.endedAt ?? null
      })
      .run();
    return jsonResponse(c, { ok: true }, 201);
  });

  app.post("/api/processes/:id/output", async (c) => {
    const processId = c.req.param("id");
    const body = await c.req.json();
    orm
      .insert(schema.processOutput)
      .values({
        id: body.id,
        process_id: processId,
        seq: body.seq,
        stream: body.stream,
        text: body.text,
        ts: body.ts ?? Date.now()
      })
      .run();
    publishProcessOutput(processId, { seq: body.seq, stream: body.stream, text: body.text });
    insertEvent({
      type: "process.output",
      payload: { processId, seq: body.seq, stream: body.stream, text: body.text },
      source: body.source ?? "system"
    });
    return jsonResponse(c, { ok: true }, 201);
  });

  app.post("/api/processes/:id/exit", async (c) => {
    const processId = c.req.param("id");
    const body = await c.req.json();
    orm
      .update(schema.processes)
      .set({
        state: body.state ?? "EXITED",
        exit_code: body.exitCode ?? null,
        ended_at: body.endedAt ?? Date.now()
      })
      .where(eq(schema.processes.id, processId))
      .run();
    insertEvent({
      type: "process.exited",
      payload: { processId, exitCode: body.exitCode ?? null },
      source: body.source ?? "system"
    });
    return jsonResponse(c, { ok: true });
  });

  app.get("/api/processes/:id/output", (c) => {
    const processId = c.req.param("id");
    const rows = orm
      .select()
      .from(schema.processOutput)
      .where(eq(schema.processOutput.process_id, processId))
      .orderBy(asc(schema.processOutput.seq))
      .all();
    return jsonResponse(c, rows);
  });
}
