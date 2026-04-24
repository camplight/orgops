# OrgOps Use Cases

## 1) Same-agent same-host execution

- Run many `agent-runner` instances on different machines.
- Assign each agent to one runner host (`assignedRunnerId`).
- Keep execution deterministic so host-specific tools/skills stay valid.
- Reassign only when explicitly requested by human operators.

## 2) Autonomous host bootstrap and maintenance

- Install and maintain OrgOps components on personal hosts using `opscli`.
- Start with or without an initial goal prompt.
- Let the agent ask for additional user input interactively (`input(...)`).
- Execute host commands via `shell(...)`, print status via `print(...)`, and terminate cleanly via `exit(code)`.

## 3) Collaboration-system augmentation

- Participate beside humans in systems like Slack/GitHub/etc.
- React to collaboration events and coordinate actions across enabled integrations.
- Perform proactive periodic work where configured (scheduled events/wakes).
- Keep local memory and share structured context across agents/channels.

## 4) Human control and auditability

- Use UI as a single oversight surface for agents, channels, events, and processes.
- Observe runner online/offline state and agent-to-runner assignments.
- Inspect emitted events and process outputs for debugging.
- Keep operator-in-the-loop controls for starts/stops/reassignments.

## 5) Low-friction team operation

- Make agent setup and reconfiguration straightforward.
- Enable one team to coordinate many specialized agents cost-effectively.
- Support break-glass remediation from terminal (`opscli`) even if UI/API are unhealthy.