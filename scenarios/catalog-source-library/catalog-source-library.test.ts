import { lstat, mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { twoInstanceFixture } from "./fixtures";

describe("catalog source library acceptance", { timeout: 30_000 }, () => {
  it("runs all stopped template kinds and real deployment journeys in both isolated instances", async () => {
    const fixture = await twoInstanceFixture();
    try {
      const published = fixture.preparePublishedReleases(["skill", "native-classic", "native-rlm", "wrapped"]);
      const releases = [published.skill, published.nativeClassic, published.nativeRlm, published.wrapped];
      for (const instance of ["a", "b"] as const) {
        for (const release of releases) await fixture.syncReviewInstallGrant(release, "organization", instance);
        if (instance === "a") {
          await expect(fixture.instantiateStopped(published.nativeClassic, { runnerId: "runner-a", workspacePath: "/tmp/catalog-outside-canary", modelId: "model-test", secretBindings: [] }, instance)).rejects.toThrow("template failed");
          await expect(fixture.instantiateStopped(published.nativeClassic, { runnerId: "runner-a", workspacePath: fixture.workspacePath("b", "cross-instance-canary"), modelId: "model-test", secretBindings: [] }, instance)).rejects.toThrow("template failed");
        }
        const created = [] as Array<{ release: typeof published.nativeClassic; agent: { id: string; name: string } }>;
        for (const release of [published.nativeClassic, published.nativeRlm, published.wrapped] as const) {
          const agent = await fixture.instantiateStopped(release, {
            runnerId: `runner-${instance}`, workspacePath: fixture.workspacePath(instance, `${release.name}-${instance}`),
            modelId: release === published.wrapped ? "wrapped:none" : "model-test", secretBindings: [],
          }, instance);
          expect(agent.mode).toBe(release === published.nativeClassic ? "CLASSIC" : release === published.nativeRlm ? "RLM_REPL" : "WRAPPED");
          expect(agent.desiredState).toBe("STOPPED"); expect(agent.runtimeState).toBe("STOPPED");
          expect(agent.ownerHumanId).toBeTruthy(); expect(agent.assignedRunnerId).toBe(`runner-${instance}`); expect(agent.workspacePath).toBe(fixture.workspacePath(instance, `${release.name}-${instance}`));
          expect(agent.channelIds).toEqual([]); expect(agent.origin.packageReleaseId).toBe(release.releaseId);
          expect(agent.origin.mode).toBe(agent.mode); expect(agent.requirements).toEqual(release === published.nativeRlm
            ? [{ name: "API_KEY", state: "MISSING" }] : []); expect(agent.secretBindingIds).toEqual([]);
          expect(agent.assignments).toEqual(release === published.nativeRlm ? [expect.objectContaining({ releaseId: published.skill.releaseId, desiredState: "ENABLED", revision: 1 })] : []);
          if (release === published.wrapped) expect(agent.wrappedConfig).toMatchObject({ kind: "fixture", harness: "command", runtime: { command: `fixture-runtime-${instance}` } });
          else expect(agent.wrappedConfig).toEqual({});
          created.push({ release, agent });
        }
        const unbound = created[1]!.agent;
        expect(await fixture.start(unbound.name, instance)).toEqual({ ok: false, error: "Agent requirements are not satisfied", code: "REQUIREMENTS_UNSATISFIED",
          reasons: [{ code: "DEPLOYMENT_REQUIRED" }, { code: "SECRET_BINDING_MISSING", packageReleaseId: published.nativeRlm.releaseId, requirementName: "API_KEY" }] });
        await fixture.bindRequiredSecret(unbound, "API_KEY", `secret-value-${instance}-API_KEY`, instance);
        expect(await fixture.start(unbound.name, instance)).toEqual({ ok: false, error: "Agent requirements are not satisfied", code: "REQUIREMENTS_UNSATISFIED",
          reasons: [{ code: "DEPLOYMENT_REQUIRED" }] });
        await fixture.activateDeployment(unbound, instance);
        expect(await fixture.start(unbound.name, instance)).toMatchObject({ ok: true });
        await fixture.tamperAfterLastGood(unbound, instance);
      }
      await fixture.assertIsolation();
    } finally { await fixture.close(); }
  });

  it("denies bidirectional cross-instance credentials, identities, sessions, and roots", async () => {
    const fixture = await twoInstanceFixture();
    try {
      const published = fixture.preparePublishedReleases(["skill", "native-classic", "native-rlm", "wrapped"]);
      for (const instance of ["a", "b"] as const) {
        for (const release of [published.skill, published.nativeClassic, published.nativeRlm, published.wrapped]) {
          await fixture.syncReviewInstallGrant(release, "organization", instance);
        }
        const secretId = await fixture.createRequiredSecret(instance, "API_KEY");
        const agent = await fixture.instantiateStopped(published.nativeRlm, {
          runnerId: `runner-${instance}`, workspacePath: fixture.workspacePath(instance, `matrix-${instance}`), modelId: "model-test",
          secretBindings: [{ requirementName: "API_KEY", secretId }],
        }, instance);
        await fixture.activateDeployment(agent, instance);
        await fixture.createRollout(agent, instance);
      }
      const negatives = await fixture.runNegativeMatrix();
      expect(negatives.map(record => record.case)).toEqual([
        "failed-sync-after-snapshot", "installation-no-overwrite", "changed-immutable-identity",
        "wrong-runner-token-binding-attempt", "reassignment-restart", "local-edit-template-immutability",
        "rollout-finite-retry-cancel", "tamper-metadata-root", "historical-independence",
      ]);
      expect(negatives.map(record => record.code)).toEqual([
        "SOURCE_UNAVAILABLE", "STORAGE_FAILURE", "IDENTITY_CONFLICT", "FORBIDDEN",
        "DEPLOYMENT_SUPERSEDED", "TEMPLATE_ORIGIN_PRESERVED", "CANCELLED", "STORAGE_FAILURE", "SOURCE_NOT_ALLOWED",
      ]);
      for (const record of negatives) {
        expect(record.status).toBe("FAILED");
        expect(record.code).toBeTruthy();
        expect(record.before).toBeTruthy();
        expect(record.after).toBeTruthy();
        expect(record.ids).toBeTruthy();
      }
      await fixture.exerciseSecretBinding("b");
      await fixture.assertIsolation(true);
      expect(fixture.operationCounts()).toMatchObject({ a: { sources: 1, releases: 4, agents: 1 }, b: { sources: 3, releases: 13, agents: 5 } });
      expect(fixture.leakedStrings()).toEqual([]);
      expect(fixture.auditAgentReceiptCount()).toBe(0);
    } finally { await fixture.close(); }
  });

  it("cleans up both instances when setup callback throws", async () => {
    let marker = "";
    await expect(twoInstanceFixture(async fixture => {
      marker = fixture.workspacePath("a", "cleanup-canary");
      await mkdir(marker, { recursive: true });
      await writeFile(`${marker}/marker.txt`, "cleanup-canary");
      throw new Error("callback-canary");
    })).rejects.toThrow("callback-canary");
    await expect(lstat(marker)).rejects.toThrow();
  });

});
