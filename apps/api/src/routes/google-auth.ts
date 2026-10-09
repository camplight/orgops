import type { Hono } from 'hono';
import {bodyLimit} from 'hono/body-limit';
import type { OrgOpsDb } from '@orgops/db';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import { buildSessionCookie } from './auth';

export type HumanSession = { id?: string; username: string; mustChangePassword: boolean; expiresAt?: number; google?: boolean };
type Settings = { enabled: number; allowed_domain: string; team_name: string };
type Pending = { nonce: string; verifier: string; binding: string; expiresAt: number; returnTo: string; settings: string };
const random = () => randomBytes(32).toString('base64url');
const hash = (s: string) => createHash('sha256').update(s).digest('base64url');
const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const sessionAge = 8 * 60 * 60;

export function registerGoogleAuthRoutes(app: Hono<any>, { db, sessions, hashPassword, requireAuth }: {
  db: OrgOpsDb; sessions: Map<string, HumanSession>; hashPassword: (password: string) => string;
  requireAuth: (c: any, next: any) => any;
}) {
  const pending = new Map<string, Pending>();
  const settings = () => db.prepare('SELECT * FROM google_auth_settings WHERE id=1').get() as Settings | undefined;
  function configuration() {
    const clientId = process.env.ORGOPS_GOOGLE_CLIENT_ID?.trim() ?? '';
    const clientSecret = process.env.ORGOPS_GOOGLE_CLIENT_SECRET ?? '';
    const redirectUri = process.env.ORGOPS_GOOGLE_REDIRECT_URI?.trim() ?? '';
    let validRedirect = false;
    try { const url = new URL(redirectUri); validRedirect = !url.username && !url.password && !url.search && !url.hash && url.pathname === '/api/auth/google/callback' && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))); } catch {}
    return { clientId, clientSecret, redirectUri, ready: Boolean(clientId && clientSecret && validRedirect) };
  }
  function client() { const cfg = configuration(); return new OAuth2Client({clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: cfg.redirectUri, transporterOptions: {timeout: 15000}}); }
  function flowCookie(value: string, age: number) {
    return `orgops_google_state=${value}; HttpOnly; Path=/api/auth/google; SameSite=Lax; Max-Age=${age}${configuration().redirectUri.startsWith('https:') ? '; Secure' : ''}`;
  }
  const owner = (c: any, next: any) => requireAuth(c, async () => {
    const human = c.get('user');
    const first = db.prepare('SELECT id FROM humans ORDER BY created_at,id LIMIT 1').get() as { id: string } | undefined;
    if (!human?.id || human.username === 'runner' || human.mustChangePassword || human.id !== first?.id) return c.json({error: 'Only the instance owner can manage Google sign-in'}, 403);
    return next();
  });
  app.use('/api/auth/google/*', bodyLimit({maxSize: 4096}));
  app.use('/api/auth/google/*', async (c, next) => { c.header('Cache-Control', 'no-store'); c.header('Referrer-Policy', 'no-referrer'); await next(); });
  app.get('/api/auth/google/config', c => { const value = settings(); return c.json({enabled: Boolean(value?.enabled && configuration().ready), allowedDomain: value?.allowed_domain ?? ''}); });
  app.get('/api/auth/google/settings', owner, c => {
    const value = settings(); const cfg = configuration();
    return c.json({enabled: Boolean(value?.enabled), allowedDomain: value?.allowed_domain ?? '', teamName: value?.team_name ?? '', configured: cfg.ready, clientIdConfigured: Boolean(cfg.clientId), clientSecretConfigured: Boolean(cfg.clientSecret), redirectUri: cfg.redirectUri});
  });
  app.put('/api/auth/google/settings', owner, async c => {
    if (!c.req.header('content-type')?.startsWith('application/json')) return c.json({error: 'Use application/json'}, 415);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.enabled !== 'boolean' || typeof body.allowedDomain !== 'string' || typeof body.teamName !== 'string') return c.json({error: 'Provide enabled, allowedDomain and teamName'}, 400);
    const domain = body.allowedDomain.trim().toLowerCase(), team = body.teamName.trim();
    if (!domainPattern.test(domain) || !team || team.length > 100) return c.json({error: 'Enter a valid Workspace domain and team name'}, 400);
    if (body.enabled && !configuration().ready) return c.json({error: 'Configure Google client ID, client secret and callback URI on the server first'}, 409);
    db.prepare('INSERT INTO google_auth_settings VALUES (1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,allowed_domain=excluded.allowed_domain,team_name=excluded.team_name,updated_at=excluded.updated_at').run(Number(body.enabled), domain, team, Date.now());
    pending.clear();
    for (const [id, session] of sessions) if (session.google) sessions.delete(id);
    return c.json({ok: true});
  });
  app.get('/api/auth/google/start', c => {
    const cfg = configuration(), value = settings();
    if (!cfg.ready || !value?.enabled) return c.json({error: 'Google sign-in is not enabled'}, 503);
    for (const [key, entry] of pending) if (entry.expiresAt < Date.now()) pending.delete(key);
    if (pending.size >= 1000) return c.json({error: 'Please try again shortly'}, 429);
    const state = random(), binding = random(), nonce = random(), verifier = random();
    const returnTo = c.req.query('returnTo') === '/admin/' ? '/admin/' : '/';
    pending.set(state, {nonce, verifier, binding: hash(binding), expiresAt: Date.now() + 300_000, returnTo, settings: JSON.stringify(value)});
    c.header('Set-Cookie', flowCookie(binding, 300));
    return c.redirect(client().generateAuthUrl({scope: ['openid','email','profile'], state, nonce, hd: value.allowed_domain, prompt: 'select_account', code_challenge: hash(verifier), code_challenge_method: CodeChallengeMethod.S256}));
  });
  const provision = db.transaction((subject: string, email: string, domain: string, teamName: string) => {
    const time = Date.now();
    const identity = db.prepare("SELECT human_id FROM human_identities WHERE provider='google' AND subject=?").get(subject) as {human_id: string} | undefined;
    let human: {id: string; username: string} | undefined;
    if (identity) human = db.prepare('SELECT id,username FROM humans WHERE id=?').get(identity.human_id) as typeof human;
    if (!human) {
      if (db.prepare('SELECT id FROM humans WHERE lower(username)=lower(?)').get(email)) throw new Error('account_conflict');
      human = {id: randomUUID(), username: email};
      db.prepare('INSERT INTO humans (id,username,password_hash,must_change_password,created_at,updated_at) VALUES (?,?,?,0,?,?)').run(human.id, human.username, hashPassword(random()), time, time);
      db.prepare("INSERT INTO human_identities VALUES ('google',?,?,?,?,?,?)").run(subject,human.id,email,domain,time,time);
    } else db.prepare("UPDATE human_identities SET email=?,hosted_domain=?,last_login_at=? WHERE provider='google' AND subject=?").run(email,domain,time,subject);
    let team = db.prepare('SELECT id FROM teams WHERE name=?').get(teamName) as {id: string} | undefined;
    if (!team) { team = {id: randomUUID()}; db.prepare('INSERT INTO teams (id,name,description,created_at) VALUES (?,?,?,?)').run(team.id,teamName,'Members joining through Google Workspace',time); }
    db.prepare("INSERT OR IGNORE INTO team_memberships (team_id,member_type,member_id) VALUES (?,'human',?)").run(team.id,human.id);
    return human;
  });
  app.get('/api/auth/google/callback', async c => {
    const state = c.req.query('state') ?? '', entry = pending.get(state); pending.delete(state);
    c.header('Set-Cookie', flowCookie('', 0));
    const fail = (code: string) => c.redirect(`/?authError=${code}`);
    const binding = c.req.header('cookie')?.match(/(?:^|;\s*)orgops_google_state=([^;]+)/)?.[1];
    const value = settings();
    if (!entry || !binding || hash(binding) !== entry.binding || entry.expiresAt < Date.now() || !configuration().ready || !value?.enabled || JSON.stringify(value) !== entry.settings) return fail('google_state');
    if (c.req.query('error')) return fail('google_cancelled');
    const code = c.req.query('code'); if (!code || code.length > 4096) return fail('google_failed');
    try {
      const oauth = client();
      const {tokens} = await oauth.getToken({code, codeVerifier: entry.verifier});
      if (!tokens.id_token) throw new Error('missing_token');
      const ticket = await oauth.verifyIdToken({idToken: tokens.id_token, audience: configuration().clientId});
      const claims = ticket.getPayload() as (ReturnType<typeof ticket.getPayload> & {nonce?: string});
      if (!claims || claims.nonce !== entry.nonce || !claims.sub || claims.sub.length > 255 || claims.email_verified !== true || !claims.email || claims.email.length > 254) return fail('google_failed');
      if (claims.hd !== value.allowed_domain || claims.email.split('@').at(-1)?.toLowerCase() !== value.allowed_domain) return fail('google_domain');
      // Re-check after remote requests: settings may have changed while Google responded.
      if (JSON.stringify(settings()) !== entry.settings) return fail('google_state');
      const human = provision(claims.sub, claims.email.toLowerCase(), value.allowed_domain, value.team_name);
      const old = c.req.header('cookie')?.match(/(?:^|;\s*)orgops_session=([^;]+)/)?.[1]; if (old) sessions.delete(old);
      const sessionId = randomUUID();
      sessions.set(sessionId, {...human, mustChangePassword: false, google: true, expiresAt: Date.now()+sessionAge*1000});
      let sessionCookie = buildSessionCookie(c,sessionId,sessionAge);
      if (configuration().redirectUri.startsWith('https:') && !sessionCookie.includes('; Secure')) sessionCookie += '; Secure';
      c.header('Set-Cookie', sessionCookie, {append: true});
      return c.redirect(entry.returnTo);
    } catch (error) { return fail(error instanceof Error && error.message === 'account_conflict' ? 'google_account_conflict' : 'google_failed'); }
  });
}
