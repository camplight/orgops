import React from 'react';

export function DocsRedirect() {
  React.useEffect(() => {
    // In dev, this will 404 unless a docs server exists.
    // In prod, we can later wire this to a real docs site.
    window.location.href = 'https://github.com/<org>/<repo>/tree/main/docs';
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Redirecting to docs…</h1>
        <p className="mt-3 text-slate-300">
          If you are not redirected, open{' '}
          <a className="underline" href="https://github.com/<org>/<repo>/tree/main/docs">
            docs on GitHub
          </a>
          .
        </p>
      </div>
    </div>
  );
}
