import { describe, expect, it } from "vitest";
import { createRolloutCoordinator } from "./rollout";
import { adminActor, humanActor, openCatalogFixture, approvedRelease } from "./test-fixtures";

const digest = `sha256:${"a".repeat(64)}`;
function seedRelease(db: any) {
  db.exec(`INSERT INTO catalog_sources (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
    VALUES ('source-team','Team','https://example.test/team','team','main',1,1,1,1,1)`);
  const manifest = { formatVersion: 1, kind: 'skill', name: 'demo-skill', version: '1.0.0', description: 'fixture', author: 'OrgOps', license: 'MIT',
    compatibility: { orgops: { min: '0.0.1' }, platforms: ['linux'], tools: [] }, secrets: [], dependencies: [], files: [], executables: [],
    skill: { entrypoint: 'SKILL.md' }, digest };
  db.prepare(`INSERT INTO catalog_package_releases (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at)
    VALUES ('release-skill','source-team','source-team','skill','demo-skill','1.0.0',?,'${'a'.repeat(40)}','${'a'.repeat(40)}','skills/demo-skill',?,?,'[]',1)`).run(digest, JSON.stringify(manifest), JSON.stringify({apiEventShapes:[],runnerScripts:[],wrappedCommands:[],externalSources:[]}));
  db.prepare(`INSERT INTO catalog_release_controls (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at) VALUES ('release-skill','APPROVED',?,'human-a',1,1,1,1)`).run(digest);
  db.prepare(`INSERT INTO catalog_installations (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision) VALUES ('release-skill',?,'/tmp/demo','INSTALLED','human-a',1,1,1)`).run(digest);
}
function fixture(options: { beforeImmediateTransaction?: () => void | Promise<void> } = {}) {
  const opened = openCatalogFixture();
  seedRelease(opened.db);
  opened.db.exec("UPDATE agents SET workspace_path='/tmp/workspace'");
  dbAgents(opened.db);
  opened.db.exec("UPDATE agents SET workspace_path='/tmp/workspace'");
  let id = 0;
  const coordinator = createRolloutCoordinator({
    db: opened.db,
    policy: { decide: input => input.actor.kind === 'HUMAN_ADMIN' ? { allow: true } : input.release ? { allow: true } : { allow: false, reasonCode: 'NOT_FOUND' } },
    readRelease: () => approvedRelease('skill'),
    writeAudit: () => undefined,
    now: () => 100,
    newId: () => `generated-${++id}`,
    beforeImmediateTransaction: options.beforeImmediateTransaction,
  });
  return { ...opened, coordinator };
}
function dbAgents(db: any) {
  db.exec(`INSERT INTO agents (id,name,model_id,soul_path,workspace_path,assigned_runner_id,created_at,updated_at) VALUES ('agent-b','agent-b','model-a','soul','workspace','runner-a',1,1)`);
}
function seedRemovalTombstone(db: any, agentId = "agent-a") {
  db.exec(`INSERT INTO catalog_package_releases (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at)
    SELECT 'release-removed',authority_source_id,content_source_id,kind,'removed-skill',version,digest,catalog_commit,package_commit,'skills/removed-skill',manifest_json,execution_preview_json,warnings_json,created_at FROM catalog_package_releases WHERE package_release_id='release-skill';
    INSERT INTO agent_skill_assignments (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,removal_requested,preload,effective_preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,grant_id,created_at,updated_at)
    VALUES ('assignment-removed-${agentId}', '${agentId}', 'release-removed', 'removed-skill', 'DISABLED', 'DISABLED', 'STABLE', 1, 0, 0, 'generation-removed', 'generation-removed', 8, 'ADMIN', 'human-a', NULL, 1, 1);`);
}

describe('finite catalog rollouts', () => {
  it('freezes explicit target IDs and excludes agents created after confirmation', async () => {
    const f = fixture();
    const plan = await f.coordinator.plan({ releaseId: 'release-skill', operation: 'ENABLE', agentIds: ['agent-a', 'agent-b'] }, adminActor());
    const rollout = await f.coordinator.confirm({ planDigest: plan.planDigest, agentIds: ['agent-a', 'agent-b'] }, adminActor());
    f.db.exec(`INSERT INTO agents (id,name,model_id,soul_path,workspace_path,assigned_runner_id,created_at,updated_at) VALUES ('agent-future','agent-future','model-a','soul','workspace','runner-a',1,1)`);
    expect(rollout.targetIds).toEqual(['agent-a', 'agent-b']);
  });

  it('returns the same plan for same-actor replay but conflicts across actors without a second audit', async () => {
    const f = fixture();
    f.db.exec("INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at) VALUES ('human-b','human-b','fixture',0,0,1,1)");
    const command = { releaseId: 'release-skill', operation: 'ENABLE' as const, agentIds: ['agent-a'] };
    const first = await f.coordinator.plan(command, adminActor());
    const replay = await f.coordinator.plan(command, adminActor());
    expect(replay).toEqual(first);
    await expect(f.coordinator.plan(command, humanActor('human-b'))).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect((f.db.prepare("SELECT COUNT(*) AS count FROM catalog_rollouts").get() as any).count).toBe(1);
  });

  it('rejects runner drift immediately before confirmation without mutating durable rollout state', async () => {
    let beforeTransaction = true;
    const f = fixture({ beforeImmediateTransaction: () => {
      if (beforeTransaction) {
        beforeTransaction = false;
        f.db.exec("UPDATE agents SET assigned_runner_id=NULL WHERE id='agent-a'");
      }
    }});
    const plan = await f.coordinator.plan({ releaseId: 'release-skill', operation: 'ENABLE', agentIds: ['agent-a'] }, adminActor());
    await expect(f.coordinator.confirm({ planDigest: plan.planDigest, agentIds: ['agent-a'] }, adminActor())).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(f.db.prepare("SELECT state FROM catalog_rollouts WHERE plan_digest=?").get(plan.planDigest)).toEqual({ state: 'DRAFT' });
    expect(f.db.prepare("SELECT COUNT(*) AS count FROM runner_package_deployments").get()).toEqual({ count: 0 });
    expect(f.db.prepare("SELECT COUNT(*) AS count FROM agent_skill_assignments").get()).toEqual({ count: 0 });
  });

  it('binds SET_PRELOAD booleans into distinct persisted plans', async () => {
    const f = fixture();
    f.db.exec(`INSERT INTO agent_skill_assignments (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,grant_id,created_at,updated_at) VALUES ('assignment-a','agent-a','release-skill','demo-skill','ENABLED','ENABLED','STABLE',0,0,'generation-old','generation-old',1,'ADMIN','human-a',NULL,1,1)`);
    const yes = await f.coordinator.plan({ releaseId: 'release-skill', operation: 'SET_PRELOAD', preload: true, agentIds: ['agent-a'] }, adminActor());
    const no = await f.coordinator.plan({ releaseId: 'release-skill', operation: 'SET_PRELOAD', preload: false, agentIds: ['agent-a'] }, adminActor());
    expect(yes.planDigest).not.toBe(no.planDigest);
    expect((await f.coordinator.confirm({ planDigest: yes.planDigest, agentIds: ['agent-a'] }, adminActor())).operation).toBe('SET_PRELOAD');
  });

  it('confirms an ENABLE plan with the captured existing preload', async () => {
    const f = fixture();
    f.db.exec(`INSERT INTO agent_skill_assignments (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,grant_id,created_at,updated_at) VALUES ('assignment-a','agent-a','release-skill','demo-skill','DISABLED','DISABLED','STABLE',1,0,'generation-old','generation-old',1,'ADMIN','human-a',NULL,1,1)`);
    const plan = await f.coordinator.plan({ releaseId: 'release-skill', operation: 'ENABLE', agentIds: ['agent-a'] }, adminActor());
    await f.coordinator.confirm({ planDigest: plan.planDigest, agentIds: ['agent-a'] }, adminActor());
    expect(f.db.prepare("SELECT preload FROM agent_skill_assignments WHERE assignment_id='assignment-a'").get()).toEqual({ preload: 1 });
  });

  it('rejects retry when failed deployment evidence disagrees with the target reason without writes', async () => {
    const f = fixture();
    const plan = await f.coordinator.plan({ releaseId: 'release-skill', operation: 'ENABLE', agentIds: ['agent-a'] }, adminActor());
    const rollout = await f.coordinator.confirm({ planDigest: plan.planDigest, agentIds: ['agent-a'] }, adminActor());
    f.db.exec("UPDATE runner_package_deployments SET state='FAILED',attempt_token='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',lease_expires_at=1000,failure_code='STORAGE_FAILURE',revision=3,completed_at=1 WHERE rollout_id='" + rollout.id + "'; UPDATE agent_skill_assignments SET deployment_state='FAILED',revision=2 WHERE agent_id='agent-a'; UPDATE catalog_rollout_targets SET state='FAILED',reason_code='INSPECTION_FAILED',revision=3 WHERE rollout_id='" + rollout.id + "'; UPDATE catalog_rollouts SET state='FAILED' WHERE rollout_id='" + rollout.id + "'; INSERT INTO runner_deployment_participants (deployment_id,assignment_id,agent_id,release_id,local_skill_name,role,target_state,target_preload,prior_effective_state,prior_effective_preload,prior_active_generation,assignment_revision) SELECT d.deployment_id,a.assignment_id,'agent-a','release-skill','demo-skill','APPLY_DESIRED','ENABLED',0,'DISABLED',0,NULL,1 FROM runner_package_deployments d JOIN agent_skill_assignments a ON a.agent_id='agent-a' WHERE d.rollout_id='" + rollout.id + "';");
    const before = f.db.prepare("SELECT state,revision FROM catalog_rollouts WHERE rollout_id=?").get(rollout.id);
    await expect(f.coordinator.retryFailed({ rolloutId: rollout.id, expectedRevision: rollout.revision }, adminActor())).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(f.db.prepare("SELECT state,revision FROM catalog_rollouts WHERE rollout_id=?").get(rollout.id)).toEqual(before);
    expect(f.db.prepare("SELECT COUNT(*) AS count FROM runner_package_deployments WHERE rollout_id=?").get(rollout.id)).toEqual({ count: 1 });
  });

  it('requires the failed deployment runner and exact failure-transition revision', async () => {
    const f = fixture();
    const plan = await f.coordinator.plan({ releaseId: 'release-skill', operation: 'ENABLE', agentIds: ['agent-a'] }, adminActor());
    const rollout = await f.coordinator.confirm({ planDigest: plan.planDigest, agentIds: ['agent-a'] }, adminActor());
    f.db.exec("INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at) VALUES ('runner-b','Runner B','{}',1,1,1); UPDATE runner_package_deployments SET state='FAILED',bound_runner_id='runner-b',attempt_token='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',lease_expires_at=1000,failure_code='STORAGE_FAILURE',revision=3,completed_at=1 WHERE rollout_id='" + rollout.id + "'; UPDATE agent_skill_assignments SET deployment_state='FAILED',revision=3 WHERE agent_id='agent-a'; UPDATE catalog_rollout_targets SET state='FAILED',reason_code='STORAGE_FAILURE',revision=3 WHERE rollout_id='" + rollout.id + "'; UPDATE catalog_rollouts SET state='FAILED' WHERE rollout_id='" + rollout.id + "'; INSERT INTO runner_deployment_participants (deployment_id,assignment_id,agent_id,release_id,local_skill_name,role,target_state,target_preload,prior_effective_state,prior_effective_preload,prior_active_generation,assignment_revision) SELECT d.deployment_id,a.assignment_id,'agent-a','release-skill','demo-skill','APPLY_DESIRED','ENABLED',0,'DISABLED',0,NULL,1 FROM runner_package_deployments d JOIN agent_skill_assignments a ON a.agent_id='agent-a' WHERE d.rollout_id='" + rollout.id + "';");
    await expect(f.coordinator.retryFailed({ rolloutId: rollout.id, expectedRevision: rollout.revision }, adminActor())).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    f.db.prepare("UPDATE runner_package_deployments SET bound_runner_id='runner-a' WHERE rollout_id=?").run(rollout.id);
    await expect(f.coordinator.retryFailed({ rolloutId: rollout.id, expectedRevision: rollout.revision }, adminActor())).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(f.db.prepare("SELECT COUNT(*) AS count FROM runner_package_deployments WHERE rollout_id=?").get(rollout.id)).toEqual({ count: 1 });
  });

  it('cancels queued targets and restores the requested assignment projection', async () => {
    const f = fixture();
    seedRemovalTombstone(f.db);
    const plan = await f.coordinator.plan({ releaseId: 'release-skill', operation: 'ENABLE', agentIds: ['agent-a'] }, adminActor());
    const rollout = await f.coordinator.confirm({ planDigest: plan.planDigest, agentIds: ['agent-a'] }, adminActor());
    const result = await f.coordinator.cancel({ rolloutId: rollout.id, expectedRevision: rollout.revision }, adminActor());
    expect(result.rollout.state).toBe('CANCELLED');
    expect(result.skippedTargetIds).toEqual(['agent-a']);
    expect((f.db.prepare("SELECT COUNT(*) AS count FROM agent_skill_assignments WHERE agent_id='agent-a'").get() as any).count).toBe(1);
    expect(f.db.prepare("SELECT removal_requested,revision FROM agent_skill_assignments WHERE assignment_id='assignment-removed-agent-a'").get()).toEqual({ removal_requested: 1, revision: 8 });
  });

  it('retries failed targets without replaying successful targets', async () => {
    const f = fixture();
    seedRemovalTombstone(f.db);
    const plan = await f.coordinator.plan({ releaseId: 'release-skill', operation: 'ENABLE', agentIds: ['agent-a'] }, adminActor());
    const rollout = await f.coordinator.confirm({ planDigest: plan.planDigest, agentIds: ['agent-a'] }, adminActor());
    f.db.exec("UPDATE runner_package_deployments SET state='FAILED',attempt_token='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',lease_expires_at=1000,failure_code='STORAGE_FAILURE',revision=3,completed_at=1 WHERE rollout_id='" + rollout.id + "'; UPDATE agent_skill_assignments SET deployment_state='FAILED',revision=2 WHERE agent_id='agent-a' AND release_id='release-skill'; UPDATE catalog_rollout_targets SET state='FAILED',reason_code='STORAGE_FAILURE',revision=3 WHERE rollout_id='" + rollout.id + "'; UPDATE catalog_rollouts SET state='FAILED' WHERE rollout_id='" + rollout.id + "'; INSERT INTO runner_deployment_participants (deployment_id,assignment_id,agent_id,release_id,local_skill_name,role,target_state,target_preload,prior_effective_state,prior_effective_preload,prior_active_generation,assignment_revision) SELECT d.deployment_id,a.assignment_id,'agent-a','release-skill','demo-skill','APPLY_DESIRED','ENABLED',0,'DISABLED',0,NULL,1 FROM runner_package_deployments d JOIN agent_skill_assignments a ON a.agent_id='agent-a' AND a.release_id='release-skill' WHERE d.rollout_id='" + rollout.id + "';");
    const result = await f.coordinator.retryFailed({ rolloutId: rollout.id, expectedRevision: rollout.revision }, adminActor());
    expect(result.targetIds).toEqual(['agent-a']);
    expect(result.deploymentIds).toHaveLength(1);
    expect(f.db.prepare("SELECT removal_requested,revision FROM agent_skill_assignments WHERE assignment_id='assignment-removed-agent-a'").get()).toEqual({ removal_requested: 1, revision: 8 });
  });

  it('does not retry a cancelled target even when the exact restored assignment remains', async () => {
    const f = fixture();
    f.db.exec("INSERT INTO agent_skill_assignments (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at) VALUES ('assignment-existing','agent-a','release-skill','demo-skill','DISABLED','DISABLED','STABLE',0,0,'old-generation','old-generation',1,'ADMIN','human-a',1,1)");
    const plan = await f.coordinator.plan({ releaseId: 'release-skill', operation: 'ENABLE', agentIds: ['agent-a'] }, adminActor());
    const confirmed = await f.coordinator.confirm({ planDigest: plan.planDigest, agentIds: ['agent-a'] }, adminActor());
    const cancelled = await f.coordinator.cancel({ rolloutId: confirmed.id, expectedRevision: confirmed.revision }, adminActor());
    await expect(f.coordinator.retryFailed({ rolloutId: cancelled.rollout.id, expectedRevision: cancelled.rollout.revision }, adminActor())).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect((f.db.prepare("SELECT desired_state,preload,deployment_state,revision FROM agent_skill_assignments WHERE assignment_id='assignment-existing'").get() as any)).toMatchObject({ desired_state: 'DISABLED', preload: 0, deployment_state: 'STABLE', revision: 3 });
    expect(f.db.prepare("SELECT COUNT(*) AS count FROM runner_package_deployments WHERE rollout_id=?").get(confirmed.id)).toEqual({ count: 1 });
  });

  it('treats removal tombstones as absent while planning and confirming an active sibling', async () => {
    const f = fixture();
    seedRemovalTombstone(f.db);
    f.db.exec(`INSERT INTO agent_skill_assignments (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at)
      VALUES ('assignment-active','agent-a','release-skill','demo-skill','DISABLED','DISABLED','STABLE',0,0,'generation-old','generation-old',1,'ADMIN','human-a',1,1)`);
    const plan = await f.coordinator.plan({ releaseId: 'release-skill', operation: 'ENABLE', agentIds: ['agent-a'] }, adminActor());
    expect(plan.targets).toEqual([expect.objectContaining({ agentId: 'agent-a', assignmentRevision: 1, blocker: null })]);
    const confirmed = await f.coordinator.confirm({ planDigest: plan.planDigest, agentIds: ['agent-a'] }, adminActor());
    expect(confirmed.state).toBe('QUEUED');
    expect(f.db.prepare("SELECT revision FROM agent_skill_assignments WHERE assignment_id='assignment-removed-agent-a'").get()).toEqual({ revision: 8 });
  });

  it('blocks rollout resurrection of a removed target and fails closed on a corrupt marker', async () => {
    const f = fixture();
    f.db.exec(`INSERT INTO agent_skill_assignments (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,removal_requested,preload,effective_preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at)
      VALUES ('assignment-removed','agent-a','release-skill','demo-skill','DISABLED','DISABLED','STABLE',1,0,0,'generation-old','generation-old',7,'ADMIN','human-a',1,1)`);
    const plan = await f.coordinator.plan({ releaseId: 'release-skill', operation: 'ENABLE', agentIds: ['agent-a'] }, adminActor());
    expect(plan.targets).toEqual([expect.objectContaining({ assignmentRevision: 0, blocker: { code: 'DEPLOYMENT_REQUIRED' } })]);
    await expect(f.coordinator.confirm({ planDigest: plan.planDigest, agentIds: ['agent-a'] }, adminActor())).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(f.db.prepare("SELECT revision,removal_requested FROM agent_skill_assignments WHERE assignment_id='assignment-removed'").get()).toEqual({ revision: 7, removal_requested: 1 });

    f.db.exec("PRAGMA ignore_check_constraints=ON; UPDATE agent_skill_assignments SET removal_requested=2 WHERE assignment_id='assignment-removed'");
    await expect(f.coordinator.plan({ releaseId: 'release-skill', operation: 'ENABLE', agentIds: ['agent-a'] }, adminActor())).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it('rejects preload on ENABLE and duplicate targets before touching the database', async () => {
    const f = fixture();
    await expect(f.coordinator.plan({ releaseId: 'release-skill', operation: 'ENABLE', preload: true as never, agentIds: ['agent-a'] } as never, adminActor())).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(f.coordinator.plan({ releaseId: 'release-skill', operation: 'ENABLE', agentIds: ['agent-a', 'agent-a'] }, adminActor())).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect((f.db.prepare('SELECT COUNT(*) AS count FROM catalog_rollouts').get() as any).count).toBe(0);
  });
});
