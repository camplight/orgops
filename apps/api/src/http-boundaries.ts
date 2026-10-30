import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
function configuredLimit(name: string, fallback: number): number {
    const value = Number(process.env[name]);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
/** API resource limits apply in production, including bodies without Content-Length. */
export function registerHttpBoundaries(app: Hono<any>) {
    const ordinary = configuredLimit('ORGOPS_API_MAX_BODY_BYTES', 1024 * 1024);
    const upload = configuredLimit('ORGOPS_UPLOAD_MAX_BODY_BYTES', 21 * 1024 * 1024);
    const transfer = configuredLimit('ORGOPS_TRANSFER_MAX_BODY_BYTES', 16 * 1024 * 1024);
    app.use('/api/*', async (c, next) => {
        c.header('X-Content-Type-Options', 'nosniff');
        c.header('Referrer-Policy', 'no-referrer');
        c.header('X-Frame-Options', 'SAMEORIGIN');
        c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'");
        c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        c.header('Cache-Control', 'private, no-store');
        const path = c.req.path;
        const maxSize = path === '/api/files' ? upload : /\/agents(?:\/[^/]+)?\/(?:copy|move|transfer)$/.test(path) ? transfer : ordinary;
        return bodyLimit({ maxSize, onError: ctx => ctx.json({ error: 'Request too large' }, 413) })(c, next);
    });
}
