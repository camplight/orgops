import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OAuth2Client} from 'google-auth-library';
import {createApp} from './app';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
let system:ReturnType<typeof createApp>, root:string, ownerCookie:string;
const cfg={enabled:true,allowedDomain:'camplight.net',teamName:'Camplight'};
const headers=()=>({'content-type':'application/json',cookie:ownerCookie});
beforeEach(async()=>{
 vi.stubEnv('ORGOPS_GOOGLE_CLIENT_ID','test.apps.googleusercontent.com');vi.stubEnv('ORGOPS_GOOGLE_CLIENT_SECRET','test-secret');vi.stubEnv('ORGOPS_GOOGLE_REDIRECT_URI','https://nest.example/api/auth/google/callback');
 root=mkdtempSync(join(tmpdir(),'google-auth-'));system=createApp({dbPath:join(root,'db.sqlite'),dataDir:root,projectRoot:root,adminUser:'owner',adminPass:'password123'});
 const login=await system.app.request('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'owner',password:'password123'})});ownerCookie=login.headers.get('set-cookie')!.split(';')[0];
 expect((await system.app.request('/api/auth/google/settings',{method:'PUT',headers:headers(),body:JSON.stringify(cfg)})).status).toBe(200);
});
afterEach(()=>{system.db.close();rmSync(root,{recursive:true,force:true});vi.restoreAllMocks();vi.unstubAllEnvs();});
async function flow(overrides:Record<string,unknown>={}, options:{cookie?:boolean;tokenFailure?:boolean;verifyFailure?:boolean}={}){
 const start=await system.app.request('/api/auth/google/start?returnTo=https://evil.example');const url=new URL(start.headers.get('location')!);
 const cookie=start.headers.get('set-cookie')!.split(';')[0];
 const get=vi.spyOn(OAuth2Client.prototype,'getToken').mockImplementation(async()=>{if(options.tokenFailure)throw new Error('secret-provider-details');return {tokens:{id_token:'signed-test-token'}} as any;});
 const verify=vi.spyOn(OAuth2Client.prototype,'verifyIdToken').mockImplementation(async()=>{if(options.verifyFailure)throw new Error('bad signature');return {getPayload:()=>({sub:'subject-1',email:'person@camplight.net',email_verified:true,hd:'camplight.net',nonce:url.searchParams.get('nonce'),...overrides})} as any;});
 const callback=`/api/auth/google/callback?state=${url.searchParams.get('state')}&code=one-use-code`;
 const result=await system.app.request(callback,{headers:{cookie:options.cookie===false?'':cookie}});
 return {result,url,cookie,callback,get,verify};
}
describe('Google Workspace sign-in',()=>{
 it('provisions one stable human and team membership, issues session, rejects replay and preserves owner',async()=>{
  const first=await flow();expect(first.url.searchParams.get('code_challenge_method')).toBe('S256');expect(first.url.searchParams.get('hd')).toBe('camplight.net');expect(first.get).toHaveBeenCalledWith(expect.objectContaining({codeVerifier:expect.any(String)}));expect(first.verify).toHaveBeenCalledWith({idToken:'signed-test-token',audience:'test.apps.googleusercontent.com'});
  expect(first.result.headers.get('location')).toBe('/');
  const session=first.result.headers.getSetCookie().find(c=>c.startsWith('orgops_session='))!;expect(session).toContain('HttpOnly');expect(session).toContain('Max-Age=28800');
  const me=await system.app.request('/api/auth/me',{headers:{cookie:session.split(';')[0]}});expect(me.status).toBe(200);expect((await me.json()).mustChangePassword).toBe(false);
  expect((await system.app.request(first.callback,{headers:{cookie:first.cookie}})).headers.get('location')).toContain('google_state');
  const second=await flow({email:'renamed@camplight.net'});expect(second.result.headers.get('location')).toBe('/');
  expect(system.db.prepare('SELECT COUNT(*) n FROM humans').get()).toEqual({n:2});expect(system.db.prepare('SELECT COUNT(*) n FROM team_memberships').get()).toEqual({n:1});
  expect((await system.app.request('/api/auth/google/settings',{headers:{cookie:session.split(';')[0]}})).status).toBe(403);
 });
 it.each([{hd:'other.net'},{hd:undefined},{email_verified:false},{nonce:'wrong'},{email:'person@other.net'}])('rejects invalid Workspace identity %j',async bad=>{
  const {result}=await flow(bad);expect(result.headers.get('location')).toMatch(/authError=google_(domain|failed)/);expect(system.db.prepare('SELECT COUNT(*) n FROM humans').get()).toEqual({n:1});
 });
 it('requires the same browser and rejects failed token exchanges and invalid signatures',async()=>{
  expect((await flow({}, {cookie:false})).result.headers.get('location')).toContain('google_state');
  expect((await flow({}, {tokenFailure:true})).result.headers.get('location')).toBe('/?authError=google_failed');
  expect((await flow({}, {verifyFailure:true})).result.headers.get('location')).toBe('/?authError=google_failed');
 });
 it('does not link existing local accounts by email',async()=>{
  await system.app.request('/api/humans/invite',{method:'POST',headers:headers(),body:JSON.stringify({username:'person@camplight.net',tempPassword:'password123'})});
  expect((await flow()).result.headers.get('location')).toBe('/?authError=google_account_conflict');
  expect(system.db.prepare('SELECT COUNT(*) n FROM human_identities').get()).toEqual({n:0});
 });
 it('blocks password fallback even after a reset and expires Google sessions',async()=>{
  const {result}=await flow();const session=result.headers.getSetCookie().find(c=>c.startsWith('orgops_session='))!.split(';')[0];
  const human=system.db.prepare("SELECT id FROM humans WHERE username='person@camplight.net'").get() as {id:string};
  await system.app.request(`/api/humans/${human.id}/reset-temp-password`,{method:'POST',headers:headers(),body:JSON.stringify({tempPassword:'password123'})});
  expect((await system.app.request('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'person@camplight.net',password:'password123'})})).status).toBe(401);
  vi.spyOn(Date,'now').mockReturnValue(Date.now()+9*60*60*1000);
  expect((await system.app.request('/api/auth/me',{headers:{cookie:session}})).status).toBe(401);
 });
 it('restricts settings to owner, never reveals secrets, and revokes Google sessions when disabled',async()=>{
  expect((await system.app.request('/api/auth/google/settings')).status).toBe(401);
  expect((await system.app.request('/api/auth/google/settings',{headers:{'x-orgops-runner-token':'dev-runner-token'}})).status).toBe(403);
  const text=await (await system.app.request('/api/auth/google/settings',{headers:headers()})).text();expect(text).not.toContain('test-secret');
  const {result}=await flow();const session=result.headers.getSetCookie().find(c=>c.startsWith('orgops_session='))!.split(';')[0];
  await system.app.request('/api/auth/google/settings',{method:'PUT',headers:headers(),body:JSON.stringify({...cfg,enabled:false})});
  expect((await system.app.request('/api/auth/google/start')).status).toBe(503);
  expect((await system.app.request('/api/auth/me',{headers:{cookie:session}})).status).toBe(401);
  expect((await system.app.request('/api/auth/me',{headers:headers()})).status).toBe(200);
 });
 it('fails closed without server credentials',async()=>{
  vi.stubEnv('ORGOPS_GOOGLE_CLIENT_SECRET','');expect(await (await system.app.request('/api/auth/google/config')).json()).toEqual({enabled:false,allowedDomain:'camplight.net'});
  expect((await system.app.request('/api/auth/google/settings',{method:'PUT',headers:headers(),body:JSON.stringify(cfg)})).status).toBe(409);
 });
});


it('rejects expired authorization state before exchanging the code', async () => {
 const start=await system.app.request('/api/auth/google/start');
 const url=new URL(start.headers.get('location')!);
 const cookie=start.headers.get('set-cookie')!.split(';')[0];
 const exchange=vi.spyOn(OAuth2Client.prototype,'getToken');
 vi.spyOn(Date,'now').mockReturnValue(Date.now()+301_000);
 const result=await system.app.request(`/api/auth/google/callback?state=${url.searchParams.get('state')}&code=expired`,{headers:{cookie}});
 expect(result.headers.get('location')).toBe('/?authError=google_state');
 expect(exchange).not.toHaveBeenCalled();
});
