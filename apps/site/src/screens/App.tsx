import React from 'react';

const links = [
  { label: 'Docs (repo)', href: '/docs' },
  { label: 'README', href: 'https://github.com/<org>/<repo>#readme' },
  { label: 'API', href: 'http://localhost:8787' },
  { label: 'UI (app)', href: 'http://localhost:5173' }
];

export function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <header className="space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/40 px-3 py-1 text-sm text-slate-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Event-driven agent ops for a single VPS
          </div>

          <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
            OrgOps
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-slate-300">
            A single-company, single-VPS system where humans and autonomous agents collaborate via an event bus.
            Built for verified ingress, mandatory audit logging, and practical automation.
          </p>

          <div className="flex flex-wrap gap-3">
            <a
              className="rounded-md bg-emerald-500 px-4 py-2 font-medium text-slate-950 hover:bg-emerald-400"
              href="/docs"
            >
              Read the docs
            </a>
            <a
              className="rounded-md border border-slate-800 bg-slate-900/40 px-4 py-2 font-medium text-slate-100 hover:bg-slate-900"
              href="https://github.com/<org>/<repo>"
            >
              View on GitHub
            </a>
          </div>
        </header>

        <main className="mt-14 grid gap-6 sm:grid-cols-2">
          <section className="rounded-xl border border-slate-800 bg-slate-900/30 p-6">
            <h2 className="text-xl font-semibold">What it is</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-slate-300">
              <li>Event bus + schemas for typed, auditable automation</li>
              <li>Agent runner that executes tools on the host OS</li>
              <li>API + UI for humans to collaborate with agents</li>
            </ul>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900/30 p-6">
            <h2 className="text-xl font-semibold">Quick links</h2>
            <div className="mt-4 grid gap-2">
              {links.map((l) => (
                <a
                  key={l.label}
                  className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3 text-slate-200 hover:bg-slate-900"
                  href={l.href}
                >
                  <span>{l.label}</span>
                  <span className="text-slate-500">→</span>
                </a>
              ))}
            </div>
            <p className="mt-3 text-sm text-slate-500">
              Note: replace <code>&lt;org&gt;/&lt;repo&gt;</code> placeholders once repo is published.
            </p>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900/30 p-6 sm:col-span-2">
            <h2 className="text-xl font-semibold">Run locally</h2>
            <pre className="mt-4 overflow-x-auto rounded-lg bg-black/40 p-4 text-sm text-slate-200">
              <code>{`npm install\n\n# API + runner + UI\nnpm run dev:all\n\n# Site (this landing page)\nnpm run --workspace @orgops/site dev`}</code>
            </pre>
          </section>
        </main>

        <footer className="mt-16 border-t border-slate-900 pt-8 text-sm text-slate-500">
          © {new Date().getFullYear()} OrgOps. Built for pragmatic ops automation.
        </footer>
      </div>
    </div>
  );
}
