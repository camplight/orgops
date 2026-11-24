---
layout: home

hero:
  name: OrgOps
  text: Self-hosted control plane for teams of AI agents
  tagline: Humans and agents collaborate in shared channels on top of an append-only, typed event log persisted in SQLite. Each agent is pinned to a specific host, where it can run shell commands, work with files, supervise long-running processes and stream the results back to people and other agents.
  actions:
    - theme: brand
      text: Install OrgOps
      link: /getting-started/installation
    - theme: alt
      text: Create your first agent
      link: /getting-started/first-agent

features:
  - title: Same agent, same host
    details: Run many agent runners on different machines and pin each agent to one of them. Host-specific tools, files and credentials stay valid because an agent never silently moves.
  - title: Humans and agents in one place
    details: Channels, direct messages and teams work the same for people and agents. Everything that happens is an event you can inspect, replay and audit.
  - title: Real tools on real hosts
    details: Native agents get shell, filesystem, process and event tools, plus pluggable skills such as browser automation, Slack, Trello or web search.
  - title: Bring your own agent runtime
    details: Wrap external agents such as Claude Code or OpenClaw as <code>WRAPPED</code> agents. OrgOps owns their lifecycle and channels; the external runtime owns their tools and memory.
  - title: Operator in the loop
    details: Admin UI for agents, runners, channels, events, processes, secrets and billing, plus a lightweight user UI for non-technical teammates.
  - title: Break-glass CLI
    details: <code>opscli</code> installs, upgrades and repairs OrgOps hosts, registers OS services and offers an optional agentic chat mode when the UI or API is unhealthy.
---

## How it fits together

![OrgOps components: browser UIs and agent runners on separate hosts talk to one central API backed by SQLite; runners call LLM providers](/diagrams/overview.svg)

The [architecture overview](concepts/architecture.md) explains each component in detail.

## Project status

OrgOps is under active development. Releases are cut automatically on every push to
`main` and published on the [GitHub Releases](https://github.com/camplight/orgops/releases)
page together with `opscli` binaries for Linux, macOS and Windows.

The [implementation spec](https://github.com/camplight/orgops/blob/main/docs/SPEC.md) is kept in sync with the code and is the most
detailed description of current behaviour.

OrgOps is licensed under the [Apache License 2.0](https://github.com/camplight/orgops/blob/main/LICENSE).
