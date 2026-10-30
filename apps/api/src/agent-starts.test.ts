import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from './app';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'orgops-agent-starts-'));roots.push(root);
 const engine=createApp({dbPath:join(root,'engine.sqlite'),dataDir:root,projectRoot:root,adminUser:'owner',adminPass:'password',runnerToken:'runner',systemAgentModel:''});
 const {db,app}=engine;
 db.prepare("INSERT INTO agents(id,name,model_id,workspace_path,created_at,updated_at) VALUES('agent','Pip','openai:test',?,0,0)").run(root);
 const post=(type:string,source:string,created:number,payload:unknown)=>db.prepare('INSERT INTO events(id,type,source,payload_json,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),type,source,JSON.stringify(payload),created);
 const get=async(path:string)=>{const response=await app.request('http://localhost'+path,{headers:{'x-orgops-runner-token':'runner'}});expect(response.status).toBe(200);return response.json();};
 return {db,app,post,get};
}
describe('durable agent restart boundary',()=>{
 it('returns null on legacy agents, then the same trusted boundary on list/detail',async()=>{
  const {db,get,post}=fixture();
  try{
   expect((await get('/api/agents/Pip')).lastStartedAt).toBeNull();
   post('agent.lifecycle.started','system:runner',100,{targetAgentName:'Pip',startedAt:999999,text:'private lifecycle context'});
   post('agent.lifecycle.started','human:owner',400,{targetAgentName:'Pip'});
   post('agent.turn.phase','agent:Pip',500,{targetAgentName:'Pip'});
   post('agent.lifecycle.started','system:runner',600,{targetAgentName:'Other'});
   db.prepare("UPDATE agents SET runtime_state='RUNNING',last_heartbeat_at=10000,updated_at=10000").run();
   expect((await get('/api/agents/Pip')).lastStartedAt).toBe(100);
   expect((await get('/api/agents'))[0].lastStartedAt).toBe(100);
   post('wrapper.lifecycle.started','system:runner:wrapper',700,{targetAgentName:'Pip'});
   expect((await get('/api/agents/Pip')).lastStartedAt).toBe(700);
   expect((await get('/api/agents'))[0].lastStartedAt).toBe(700);
  }finally{db.close();}
 });
 it('ignores malformed/oversized lifecycle data and never returns hidden agent metadata',async()=>{
  const {app,db,get,post}=fixture();
  try{
   post('agent.lifecycle.started','system:runner',100,{targetAgentName:'Pip'});
   post('agent.lifecycle.started','system:runner',200,{targetAgentName:'Pip',text:'x'.repeat(80000)});
   db.prepare("INSERT INTO events(id,type,source,payload_json,created_at) VALUES('malformed','agent.lifecycle.started','system:runner','{',300)").run();
   expect((await get('/api/agents/Pip')).lastStartedAt).toBe(100);
   db.prepare("UPDATE agents SET visibility='PRIVATE',owner_human_id=NULL").run();
   const login=await app.request('http://localhost/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'owner',password:'password'})});
   const cookie=login.headers.get('set-cookie')!.split(';')[0];
   const list=await app.request('http://localhost/api/agents',{headers:{cookie}});expect(await list.json()).toEqual([]);
   const detail=await app.request('http://localhost/api/agents/Pip',{headers:{cookie}});expect([403,404]).toContain(detail.status);
  }finally{db.close();}
 });
});
