import {it,expect} from 'vitest';
import {mkdirSync,writeFileSync,symlinkSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {securityFixture} from './security-fixture';
import {canonicalPath} from './workspace-boundary';

it('generates member workspaces and refuses privileged configs and ownership reassignment',async()=>{
 const f=await securityFixture();
 try{
  const body={name:'MemberAgent',modelId:'fixture',workspacePath:'/etc'};
  expect((await f.request('/api/agents',body,f.member)).status).toBe(201);
  const agent=await(await f.request('/api/agents/MemberAgent',undefined,f.member)).json();
  expect(agent.workspacePath).toBe(canonicalPath(join(f.dir,'.orgops-data/workspaces',agent.id)));expect(agent.ownerHumanId).toBe(f.memberId);
  expect((await f.request('/api/agents/MemberAgent',{description:'updated'},f.member,'PATCH')).status).toBe(200);
  expect((await(await f.request('/api/agents/MemberAgent',undefined,f.member)).json()).ownerHumanId).toBe(f.memberId);
  expect((await f.request('/api/agents/MemberAgent',{workspacePath:'/etc'},f.member,'PATCH')).status).toBe(403);
  for(const extra of [{mode:'WRAPPED',wrappedConfig:{setup:{command:'synthetic-only'}}},{allowOutsideWorkspace:true},{additionalSkillRoots:['/etc']}]){
   expect((await f.request('/api/agents',{...body,name:crypto.randomUUID(),...extra},f.member)).status).toBe(403);
  }
  const ownerId=(await(await f.request('/api/auth/me')).json()).id;
  expect((await f.request('/api/agents',{...body,name:'OtherOwner',visibility:'PRIVATE',ownerHumanId:ownerId},f.member)).status).toBe(403);
  for(const action of ['copy','move'])expect((await f.request('/api/agents/MemberAgent/'+action,{name:'copy'},f.member)).status).toBe(403);
 }finally{f.close();}
});

it('blocks symlink escapes and refuses destructive cleanup outside the managed root',async()=>{
 const f=await securityFixture();
 try{
  const workspace=join(f.dir,'.orgops-data/workspaces/Approved');const outside=join(f.dir,'outside');
  mkdirSync(workspace,{recursive:true});mkdirSync(outside);writeFileSync(join(outside,'sentinel.txt'),'private fixture');symlinkSync(outside,join(workspace,'escape'));
  await f.request('/api/agents',{name:'Approved',modelId:'fixture',workspacePath:workspace});
  expect((await f.request('/api/agents/Approved/workspace/download?path=escape/sentinel.txt')).status).toBe(400);
  await f.request('/api/agents',{name:'External',modelId:'fixture',workspacePath:outside});
  expect((await f.request('/api/agents/External/cleanup-workspace',{})).status).toBe(400);
  expect(existsSync(join(outside,'sentinel.txt'))).toBe(true);
  expect((await f.request('/api/agents/External/workspace/download?path=sentinel.txt',undefined,f.member)).status).toBe(403);
 }finally{f.close();}
});
