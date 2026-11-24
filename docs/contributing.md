# Contributing

Contributions are welcome. Open an issue or a pull request on
[GitHub](https://github.com/camplight/orgops).

## Development setup

```bash
git clone https://github.com/camplight/orgops.git
cd orgops
npm install
cp .env.example .env     # keep your existing .env if you already have one
npm run dev:all
```

Use **npm**, not pnpm: the repository relies on npm workspaces and a committed
`package-lock.json`. Set `ORGOPS_LLM_STUB=1` to work without provider keys.

## Repository layout

```text
apps/
  api/            Hono HTTP + WebSocket API (owns the SQLite DB)
  agent-runner/   Agent supervisor and tool executor
  opscli/         Host bootstrap + maintenance CLI
  admin-ui/       React + Tailwind admin UI
  user-ui/        Lightweight user UI
packages/
  crypto/         Envelope encryption helpers
  db/             SQLite schema + migrations
  event-bus/      Pub/sub helpers
  llm/            Vercel AI SDK wrapper
  schemas/        Zod schemas + typed event shapes
  skills/         Skill catalog parser
  js-runtime/     node:vm sessions for RLM_REPL mode
  events-scenario-tests/  JSON-driven end-to-end scenarios
skills/           Built-in skills
docs/             This documentation
```

Backend apps run TypeScript directly through `tsx`. There is no backend build step, so
`npm run lint` (`tsc --noEmit` across workspaces) is the type check.

## Tests

```bash
npm test                                                   # whole repo (Vitest)
npx vitest run apps/agent-runner/src/turn-executor.test.ts # one file
npx vitest run apps/api/src/app.test.ts -t "creates an agent"
npm run lint
```

OpsCLI uses the Node test runner and is not part of `npm test`:

```bash
npm run --workspace @orgops/opscli test
```

Scenario tests run against a live `dev:all` stack:

```bash
npm run scenario:test:countdown
```

## Guidelines

- [`docs/SPEC.md`](SPEC.md) describes the current implementation. Read it before
  architectural changes and **update it** when you change the API surface, the event
  contract or runtime behaviour.
- Database changes go into a new numbered migration in `packages/db/migrations/`.
- New event types belong in `packages/schemas/src/event-shapes.ts` or in a skill's
  `event-shapes.ts`.
- [`AGENTS.md`](https://github.com/camplight/orgops/blob/main/AGENTS.md) has more
  conventions for coding agents and humans alike.

## Working on the docs

The site is built with [Zensical](https://zensical.org/), which reads the existing
`mkdocs.yml`.

Requires Python 3. Install Zensical into a virtual environment in the repository root
(`.venv/` is gitignored):

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install "zensical>=0.1.2,<0.2"

zensical serve                     # preview at http://localhost:8000
zensical build --clean --strict    # the same check CI runs
```

`--strict` fails the build on links to missing pages or anchors. Stop the preview with
`Ctrl+C`; run `deactivate` to leave the virtual environment.

Pages live in `docs/`, navigation in `mkdocs.yml`. The site is published to GitHub Pages
by `.github/workflows/docs.yml` on every push to `main` that touches the docs.

## Releases

Every push to `main` creates a release tagged `0.0.N-YYYY-MM-DD` with `opscli` binaries
and generated release notes. See [GitHub Releases](https://github.com/camplight/orgops/releases).
