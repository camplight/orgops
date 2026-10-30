import { it, expect } from 'vitest';
import { securityFixture } from './security-fixture';
it('bounds ordinary and streamed API requests while retaining dedicated upload capacity', async () => {
    const f = await securityFixture();
    try {
        const tooLarge = JSON.stringify({ text: 'x'.repeat(1024 * 1024) });
        const response = await f.engine.app.request('/api/events', { method: 'POST', headers: f.owner, body: tooLarge });
        expect(response.status).toBe(413);
        expect(await response.json()).toEqual({ error: 'Request too large' });
        const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(tooLarge)); controller.close(); } });
        const streamed = await f.engine.app.request('/api/events', { method: 'POST', headers: f.owner, body: stream, duplex: 'half' } as RequestInit);
        expect(streamed.status).toBe(413);
        const upload = new FormData();
        upload.set('file', new File(['x'.repeat(20 * 1024 * 1024)], 'fixture.txt', { type: 'text/plain' }));
        const saved = await f.engine.app.request('/api/files', { method: 'POST', headers: { cookie: f.owner.cookie }, body: upload });
        expect(saved.status).toBe(201);
        const over = new FormData();
        over.set('file', new File(['x'.repeat(21 * 1024 * 1024 + 1)], 'oversized.txt'));
        expect((await f.engine.app.request('/api/files', { method: 'POST', headers: { cookie: f.owner.cookie }, body: over })).status).toBe(413);
        const meta = await f.request('/api/files/' + (await saved.json()).id + '/meta');
        expect(meta.status).toBe(200);
        const missing = await f.request('/api/not-a-route');
        expect(missing.status).toBe(404);
        for (const r of [response, streamed, meta, missing]) {
            expect(r.headers.get('x-content-type-options')).toBe('nosniff');
            expect(r.headers.get('referrer-policy')).toBe('no-referrer');
            expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
            expect(r.headers.get('cache-control')).toBe('private, no-store');
        }
    }
    finally {
        f.close();
    }
});
