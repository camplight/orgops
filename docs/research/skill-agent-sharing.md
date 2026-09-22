# Sharing skills and agents across OrgOps instances

Status: initial research and proposals, not approved requirements. Sources retrieved 2026-09-09; external documentation and default-branch READMEs can change. Documentation review only, not hands-on verification.

## Primary-source comparisons

### Agent Skills: reuse the portable content format

The specification defines a skill as a directory containing `SKILL.md`, YAML name/description metadata, and optional scripts, references, and assets. It supports license, compatibility, and extension metadata. It describes progressive disclosure rather than requiring all resources in the prompt. This is a content format, not by itself an instance authorization or publishing service.

Source: https://agentskills.io/specification

Implication for OrgOps (proposal): retain interoperable skill directories and add distribution metadata separately. Do not assume format compatibility guarantees runtime/tool compatibility.

### Claude Code marketplaces: configurable catalogs backed by Git

A marketplace catalog lists plugins and their sources. The catalog can be hosted on GitHub or another Git host; entries can point to separate repositories. Individual Git plugin sources support exact commit pins. Private repository installation uses authentication. Managed settings distinguish adding known marketplaces from restricting which marketplaces are allowed; an allowlist alone does not register a marketplace. The docs explicitly distinguish trust in a marketplace from restrictions on executable source types.

Source: https://code.claude.com/docs/en/plugin-marketplaces (sections: Overview, Plugin sources, Host and distribute marketplaces, managed marketplace restrictions).

Implication for OrgOps (proposal): separate configured sources, permitted sources, and permission to activate executable content. Git can provide publishing, review, and private access without building a registry service first.

### ClawHub: a dedicated registry product

The first-party README describes publishing/versioning/search for skills, a web UI and CLI/API, changelogs/tags, inspection without installation, local install pinning, moderation, and soft-delete/restore. It also describes an OpenClaw package catalog and experimental whole-agent packages. Its listed backend includes Convex storage/auth and embedding search.

Source: https://github.com/openclaw/clawhub/blob/main/README.md

Implication for OrgOps (proposal): useful later inspiration for a public ecosystem, but search ranking, moderation, publisher identities, storage, and abuse handling expand the scope substantially. Experimental whole-agent support is not evidence of a stable cross-runtime agent standard.

## Existing OrgOps constraints

- Skills are discovered from a local `skills/` directory. Their folder name must match metadata name. There is no remote install/publish endpoint documented in the current API.
  Sources: `packages/skills/src/index.ts` (`resolveSkillRoot`, `listSkills`, `loadSkillMeta`), `docs/SPEC.md` (Secrets / Skills).
- Skill `event-shapes.ts/js` modules are dynamically imported, so installing such a skill into active discovery is potentially API-side code execution—not just providing model instructions.
  Sources: `packages/skills/src/index.ts` (`loadSkillEventShapes`), `apps/api/src/app.ts` (event-shape dependency wiring).
- Agents mix reusable configuration with local model IDs, runner assignment, paths, lifecycle state, and enabled skills. Wrapped agents delegate execution to an external runtime and bypass native skills and prompting.
  Source: `docs/SPEC.md` (Core Data Model / Agents).
- Wrapped recipes can clone repositories and execute setup/runtime commands on a host. Runners are host-local and agents are explicitly assigned.
  Source: `docs/SPEC.md` (Wrapped lifecycle, Runner Nodes, security note).

Implications (proposals): share agent templates rather than database rows; require local binding of model, runner, workspace, and secret references. Exclude credentials, conversation history, memory, and runtime state by default. Treat native and wrapped template compatibility explicitly. Account for delivery to both API and assigned runner where relevant.

## Three plausible approaches

1. **Git-backed catalogs (initial recommendation).** Each instance configures named public/private sources. Authors publish through commits/PRs, manually or using OrgOps-generated exports. Installations resolve immutable revisions. Low infrastructure cost; private Git credentials and monorepo packaging still require design.
2. **Dedicated registry service.** Web/CLI/API publishing, package storage, search, identities and access control. Better marketplace UX and richer publisher workflows, but adds an operated service and security/moderation burden.
3. **Direct instance-to-instance sharing.** Instances expose export catalogs and authorize peers. Convenient for copying between installations, but couples availability, authentication, and public exposure to production instances; Git publishing would need another mechanism.

These can evolve: a later registry can index the same packages used by an initial Git catalog. That is an option, not a requirement to build multiple backends now.

## Candidate requirements to discuss

- Instance administrators choose configured catalogs; support public and authenticated private sources. Reading a public catalog need not require registration of an OrgOps instance.
- Source owner access control answers who may fetch; instance policy answers what it will trust. Publishing rights are separate from both.
- Same package format for Git authoring and OrgOps exports. UI-assisted publishing could generate an export/PR; write access must never be inferred from read credentials.
- Discover/inspect without executing package code. Installation and activation are distinct steps.
- Namespace identities by source/publisher to prevent same-name collisions.
- Record origin, resolved revision, digest, and compatibility. An integrity digest does not establish publisher trust.
- Pin installed content; make upgrades explicit initially. Define local-edit and rollback behavior before promising either.
- Preview template contents and required capabilities, bind local resources, and instantiate stopped rather than auto-running imported code.
- Declare skill dependencies and supported agent mode/runtime. Decide whether native-only templates are a sufficient first release.
- Do not add public marketplace accounts, ratings, billing, automatic peer replication, or autonomous publication unless a concrete need emerges.

## Open decisions

Start with the intended sharing audience: one team's instances, selected partner organizations, or an open community? That drives private authentication, default source policy, publishing review, and whether a hosted registry is necessary. Then clarify the meaning of a reusable agent, publication UX, and the smallest successful end-to-end workflow.
