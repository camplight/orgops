import type { Hono } from "hono";
import { randomUUID, createHash } from "node:crypto";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";

type RuntimeDeps = {
  orm: OrgOpsDrizzleDb;
  FILES_DIR: string;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  publishProcessOutput: (processId: string, payload: any) => void;
  insertEvent: (input: any) => any;
};

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    // ESRCH means the PID does not exist. EPERM can still mean the process exists.
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    return false;
  }
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isPidAlive(pid);
}

export function registerRuntimeRoutes(app: Hono<any>, deps: RuntimeDeps) {
  const { orm, FILES_DIR, jsonResponse, publishProcessOutput, insertEvent } = deps;
  const PROCESS_EVENT_SOURCE = "system:process-runner";
  const processContextById = (processId: string) =>
    orm
      .select({
        channelId: schema.processes.channel_id,
        agentName: schema.processes.agent_name,
      })
      .from(schema.processes)
      .where(eq(schema.processes.id, processId))
      .get() as { channelId: string | null; agentName: string | null } | undefined;

  app.post("/api/files", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file as File | undefined;
    if (!file) return jsonResponse(c, { error: "Missing file" }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const id = randomUUID();
    const tempFilesDir = join(FILES_DIR, "tmp");
    mkdirSync(tempFilesDir, { recursive: true });
    const storagePath = join(tempFilesDir, id);
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
    const reconcile = params.get("reconcile") === "1";
    const clauses: any[] = [];
    if (agentName) clauses.push(eq(schema.processes.agent_name, agentName));
    if (channelId) clauses.push(eq(schema.processes.channel_id, channelId));
    if (state) clauses.push(eq(schema.processes.state, state));
    const queryWhere = clauses.length > 0 ? and(...clauses) : undefined;
    let rows = orm
      .select()
      .from(schema.processes)
      .where(queryWhere)
      .orderBy(desc(schema.processes.started_at))
      .all();
    if (reconcile) {
      const staleActiveIds = rows
        .filter(
          (row) =>
            (row.state === "RUNNING" || row.state === "STARTING") &&
            (typeof row.pid !== "number" || !isPidAlive(row.pid)),
        )
        .map((row) => row.id);
      if (staleActiveIds.length > 0) {
        orm
          .update(schema.processes)
          .set({
            state: "EXITED",
            ended_at: Date.now(),
          })
          .where(inArray(schema.processes.id, staleActiveIds))
          .run();
        rows = orm
          .select()
          .from(schema.processes)
          .where(queryWhere)
          .orderBy(desc(schema.processes.started_at))
          .all();
      }
    }
    const outputStats = orm
      .select({
        process_id: schema.processOutput.process_id,
        output_count: sql<number>`count(*)`,
        last_output_at: sql<number>`max(${schema.processOutput.ts})`,
      })
      .from(schema.processOutput)
      .groupBy(schema.processOutput.process_id)
      .all();
    const statsByProcess = new Map(
      outputStats.map((row) => [row.process_id, row]),
    );
    const enrichedRows = rows.map((row) => {
      const stats = statsByProcess.get(row.id);
      return {
        ...row,
        output_count: Number(stats?.output_count ?? 0),
        last_output_at:
          stats?.last_output_at === undefined || stats?.last_output_at === null
            ? null
            : Number(stats.last_output_at),
      };
    });
    return jsonResponse(c, enrichedRows);
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
        execution_mode: body.executionMode ?? "ASYNC",
        state: body.state ?? "STARTING",
        exit_code: body.exitCode ?? null,
        started_at: body.startedAt ?? Date.now(),
        ended_at: body.endedAt ?? null
      })
      .run();
    return jsonResponse(c, { ok: true }, 201);
  });

  app.delete("/api/processes/:id", async (c) => {
    const processId = c.req.param("id");
    const row = orm
      .select({
        id: schema.processes.id,
        pid: schema.processes.pid,
        state: schema.processes.state,
      })
      .from(schema.processes)
      .where(eq(schema.processes.id, processId))
      .get();
    if (!row) return jsonResponse(c, { error: "Process not found" }, 404);

    const isActiveState = row.state === "RUNNING" || row.state === "STARTING";
    let signaled = false;
    let forceKilled = false;
    let pidMissing = false;
    if (row.pid !== null && row.pid !== undefined && isActiveState) {
      try {
        process.kill(row.pid, "SIGTERM");
        signaled = true;
        pidMissing = await waitForPidExit(row.pid, 1200);
        if (!pidMissing && isPidAlive(row.pid)) {
          try {
            process.kill(row.pid, "SIGKILL");
            signaled = true;
            forceKilled = true;
            pidMissing = await waitForPidExit(row.pid, 500);
          } catch (error) {
            const code = (error as NodeJS.ErrnoException)?.code;
            pidMissing = code === "ESRCH" || !isPidAlive(row.pid);
          }
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        // If a PID no longer exists, mark this record as exited.
        pidMissing = code === "ESRCH" || !isPidAlive(row.pid);
      }
    } else if (isActiveState) {
      pidMissing = true;
    }

    const markedExited = Boolean(isActiveState && pidMissing);
    if (markedExited) {
      orm
        .update(schema.processes)
        .set({
          state: forceKilled ? "TERMINATED" : "EXITED",
          ended_at: Date.now(),
        })
        .where(eq(schema.processes.id, processId))
        .run();
    }

    return jsonResponse(c, { ok: true, signaled, forceKilled, markedExited, processId });
  });

  app.delete("/api/processes", (c) => {
    const url = new URL(c.req.url);
    const scope = url.searchParams.get("scope");
    const clearExitedOnly = scope === "exited";
    const rows = orm
      .select({
        id: schema.processes.id,
        pid: schema.processes.pid,
        state: schema.processes.state,
      })
      .from(schema.processes)
      .all();
    const rowsToClear = clearExitedOnly
      ? rows.filter((row) => row.state !== "RUNNING" && row.state !== "STARTING")
      : rows;
    let terminatedCount = 0;
    for (const row of rowsToClear) {
      if (
        row.pid !== null &&
        row.pid !== undefined &&
        (row.state === "RUNNING" || row.state === "STARTING")
      ) {
        try {
          process.kill(row.pid, "SIGTERM");
          terminatedCount += 1;
        } catch {
          // Process already ended or cannot be signaled.
        }
      }
    }
    if (rowsToClear.length > 0) {
      orm
        .delete(schema.processOutput)
        .where(inArray(schema.processOutput.process_id, rowsToClear.map((row) => row.id)))
        .run();
      orm
        .delete(schema.processes)
        .where(inArray(schema.processes.id, rowsToClear.map((row) => row.id)))
        .run();
    }
    insertEvent({
      type: "processes.cleared",
      payload: {
        scope: clearExitedOnly ? "exited" : "all",
        terminatedCount,
        clearedCount: rowsToClear.length,
      },
      source: "system",
    });
    return jsonResponse(c, {
      ok: true,
      scope: clearExitedOnly ? "exited" : "all",
      clearedCount: rowsToClear.length,
      terminatedCount,
    });
  });

  app.post("/api/processes/:id/output", async (c) => {
    const processId = c.req.param("id");
    const body = await c.req.json();
    const processContext = processContextById(processId);
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
      payload: {
        processId,
        seq: body.seq,
        stream: body.stream,
        text: body.text,
        ...(processContext?.agentName
          ? {
              ownerAgentName: processContext.agentName,
              targetAgentName: processContext.agentName,
            }
          : {}),
      },
      source: body.source ?? PROCESS_EVENT_SOURCE,
      channelId: processContext?.channelId ?? undefined,
    });
    return jsonResponse(c, { ok: true }, 201);
  });

  app.post("/api/processes/:id/exit", async (c) => {
    const processId = c.req.param("id");
    const body = await c.req.json();
    const processContext = processContextById(processId);
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
      payload: {
        processId,
        exitCode: body.exitCode ?? null,
        ...(processContext?.agentName
          ? {
              ownerAgentName: processContext.agentName,
              targetAgentName: processContext.agentName,
            }
          : {}),
      },
      source: body.source ?? PROCESS_EVENT_SOURCE,
      channelId: processContext?.channelId ?? undefined,
    });
    return jsonResponse(c, { ok: true });
  });

  app.get("/api/processes/:id/output", (c) => {
    const processId = c.req.param("id");
    const url = new URL(c.req.url);
    const params = url.searchParams;
    const afterSeqParam = params.get("afterSeq");
    const limitParam = params.get("limit");
    const tailParam = params.get("tail");
    const afterSeq =
      afterSeqParam && Number.isFinite(Number(afterSeqParam))
        ? Number(afterSeqParam)
        : null;
    const parsedLimit =
      limitParam && Number.isFinite(Number(limitParam))
        ? Number(limitParam)
        : null;
    const limit = Math.max(1, Math.min(5000, parsedLimit ?? 2000));
    const tail = tailParam === "1";
    const whereClause =
      afterSeq !== null
        ? and(
            eq(schema.processOutput.process_id, processId),
            gt(schema.processOutput.seq, afterSeq),
          )
        : eq(schema.processOutput.process_id, processId);
    const rows =
      tail && afterSeq === null
        ? orm
            .select()
            .from(schema.processOutput)
            .where(whereClause)
            .orderBy(desc(schema.processOutput.seq))
            .limit(limit)
            .all()
            .reverse()
        : orm
            .select()
            .from(schema.processOutput)
            .where(whereClause)
            .orderBy(asc(schema.processOutput.seq))
            .limit(limit)
            .all();
    return jsonResponse(c, rows);
  });
}
