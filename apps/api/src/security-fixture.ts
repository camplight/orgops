import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from './app';

export async function securityFixture() {
  const dir=mkdtempSync(join(tmpdir(),'orgops-security-'));
  const prior=process.env.ORGOPS_FEDERATION_SYNC_INTERVAL_MS;
  process.env.ORGOPS_FEDERATION_SYNC_INTERVAL_MS='0';
  let engine:ReturnType<typeof createApp>;
  try {engine=createApp({dbPath:':memory:',projectRoot:dir,adminUser:'operator',adminPass:'operator-password',runnerToken:'test-global-runner'});}
  finally {if(prior===undefined)delete process.env.ORGOPS_FEDERATION_SYNC_INTERVAL_MS;else process.env.ORGOPS_FEDERATION_SYNC_INTERVAL_MS=prior;}
  const login=async(username:string,password:string)=>{
    const r=await engine.app.request('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});
    if(!r.ok)throw Error('Fixture login failed');
    return {'content-type':'application/json',cookie:r.headers.getSetCookie()[0].split(';')[0]};
  };
  const owner=await login('operator','operator-password');
  const request=(path:string,body?:unknown,headers:Record<string,string>=owner,method=body===undefined?'GET':'POST')=>engine.app.request(path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  const invited=await (await request('/api/humans/invite',{username:'member',tempPassword:'member-password'})).json() as {id:string};
  const member=await login('member','member-password');
  const changed=await request('/api/auth/profile',{newPassword:'member-password'},member,'PATCH');
  if(!changed.ok)throw Error('Fixture password setup failed');
  const rotated=changed.headers.getSetCookie()[0];if(rotated)member.cookie=rotated.split(';')[0];
  return {engine,dir,owner,member,memberId:invited.id,request,login,close:()=>{engine.db.close();rmSync(dir,{recursive:true,force:true});}};
}
