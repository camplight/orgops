import {it,expect} from 'vitest';
import {securityFixture} from './security-fixture';

it('requires the instance owner for global credentials, account administration and bulk deletion',async()=>{
  const f=await securityFixture();
  try{
    const ownerId=(await(await f.request('/api/auth/me')).json()).id;
    for(const [path,body,method] of [
      ['/api/runners/setup-config',undefined,'GET'],
      ['/api/runners/invites',{},'POST'],
      ['/api/humans/invite',{username:'intruder'},'POST'],
      [`/api/humans/${ownerId}/reset-temp-password`,{},'POST'],
      ['/api/events',undefined,'DELETE'],
      ['/api/events?type=message.created',undefined,'DELETE'],
    ] as const){const r=await f.request(path,body,f.member,method);expect(r.status,path).toBe(403);expect(await r.text()).not.toContain('test-global-runner');}
    expect((await f.request('/api/runners/setup-config')).status).toBe(200);
    const scoped=await(await f.request('/api/runners/invites',{})).json();
    const token=decodeURIComponent(new URL(scoped.invite.inviteUrl).pathname.split('/').at(-1)!);
    expect((await f.request('/api/events',undefined,{'x-orgops-runner-token':token},'DELETE')).status).toBe(403);
    const reset=await f.request(`/api/humans/${f.memberId}/reset-temp-password`,{});
    expect(reset.status).toBe(200);expect((await reset.json()).temporaryPassword.length).toBeGreaterThan(24);
    expect((await f.request('/api/auth/me',undefined,f.member)).status).toBe(401);
  }finally{f.close();}
});

it('does not let a posting participant clear a privately owned channel',async()=>{
  const f=await securityFixture();
  try{
    const ch=await(await f.request('/api/channels',{name:'owner-private',visibility:'PRIVATE'})).json();
    await f.request(`/api/channels/${ch.id}/subscribe`,{subscriberType:'HUMAN',subscriberId:'member'});
    expect((await f.request(`/api/channels/${ch.id}/messages`,undefined,f.member,'DELETE')).status).toBe(403);
    expect((await f.request(`/api/channels/${ch.id}/messages`,undefined,f.owner,'DELETE')).status).toBe(200);
  }finally{f.close();}
});
