import {it,expect,vi} from 'vitest';
import {securityFixture} from './security-fixture';
import {hashPasswordAsync,verifyPasswordAsync,DUMMY_PASSWORD_HASH} from './passwords';

it('verifies legacy hashes asynchronously and rejects malformed or incorrect credentials',async()=>{
 const hash=await hashPasswordAsync('test-only-password');
 expect(await verifyPasswordAsync('test-only-password',hash)).toBe(true);
 expect(await verifyPasswordAsync('wrong-password',hash)).toBe(false);
 expect(await verifyPasswordAsync('wrong-password',DUMMY_PASSWORD_HASH)).toBe(false);
 expect(await verifyPasswordAsync('wrong-password','invalid')).toBe(false);
});
it('limits password attempts for existing and missing accounts and rejects malformed/large bodies',async()=>{
 const f=await securityFixture();
 try{
  expect((await f.engine.app.request('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:'{'})).status).toBe(400);
  expect((await f.request('/api/auth/login',{username:'x',password:'x'.repeat(5000)})).status).toBe(413);
  for(const username of ['member','missing']){
   for(let i=0;i<8;i++)await f.request('/api/auth/login',{username,password:'wrong-password'});
   const limited=await f.request('/api/auth/login',{username,password:'wrong-password'});
   expect(limited.status).toBe(429);expect(limited.headers.get('retry-after')).toBe('60');
  }
 }finally{f.close();}
});
it('expires password sessions and rotates credentials after a password change',async()=>{
 const f=await securityFixture();
 try{
  const other=await f.login('member','member-password');
  const change=await f.request('/api/auth/profile',{currentPassword:'member-password',newPassword:'replacement-password'},f.member,'PATCH');
  expect(change.status).toBe(200);
  const fresh={'content-type':'application/json',cookie:change.headers.getSetCookie()[0].split(';')[0]};
  expect(fresh.cookie).not.toBe(f.member.cookie);
  expect((await f.request('/api/auth/me',undefined,f.member)).status).toBe(401);
  expect((await f.request('/api/auth/me',undefined,other)).status).toBe(401);
  expect((await f.request('/api/auth/me',undefined,fresh)).status).toBe(200);
  const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+8*60*60*1000+1);
  try{expect((await f.request('/api/auth/me',undefined,fresh)).status).toBe(401);}finally{clock.mockRestore();}
 }finally{f.close();}
});
