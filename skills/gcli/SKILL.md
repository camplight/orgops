---
name: gcli
description: Use Google Cloud CLI (gcloud) for project/account checks and Google API operations. Use when users ask for gcloud commands, Google Cloud auth, project configuration, IAM, or cloud resource inspection and updates.
---
# Google CLI (gcloud) wrapper

Use this skill as a lightweight wrapper around the local Google Cloud CLI.

## Scope

- Use `gcloud` directly for command execution.
- Keep commands explicit and non-interactive where possible.
- Prefer read-only checks first, then apply mutations only when requested.

## Auth and configuration

Preferred auth order:

1. Existing local login/ADC context
2. Service account key file via `GOOGLE_APPLICATION_CREDENTIALS`
3. Explicit `gcloud auth` flows only when necessary

Check active context before doing real work:

```bash
node --import tsx skills/gcli/assets/ensure.ts
```

The ensure script validates:

- `gcloud` binary is installed and reachable in `PATH`
- current active account (if configured)
- current active project (if configured)
- current default compute region/zone (if configured)

If you need to authenticate manually:

```bash
gcloud auth list --format="value(account,status)"
gcloud config list --format="yaml(core.account,core.project,compute.region,compute.zone)"
```

## Command patterns

Project and config:

```bash
gcloud projects list --limit=20
gcloud config set project <PROJECT_ID>
```

IAM and principals:

```bash
gcloud projects get-iam-policy <PROJECT_ID> --format=json
gcloud iam service-accounts list --project <PROJECT_ID>
```

GKE/Compute examples:

```bash
gcloud container clusters list --project <PROJECT_ID>
gcloud compute instances list --project <PROJECT_ID>
```

## Execution rules

- Always run a context check first (`skills/gcli/assets/ensure.ts`).
- Use `--project` explicitly for commands touching resources.
- Use structured output (`--format=json`) when results feed downstream tools.
- Avoid long interactive commands unless user explicitly asks.
- Never print or echo sensitive credentials.

## Failure handling

- If `gcloud` is missing, stop and ask user to install Google Cloud CLI.
- If account/project is missing, return exact setup commands and pause.
- If permissions fail, report the required role/permission from the error and stop.
