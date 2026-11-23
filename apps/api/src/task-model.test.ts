import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDb} from '@orgops/db';
import {createApp} from './app';
it('only accepts authorized human task overrides and preserves the agent default',async()=>{
 const dataDir=mkdtempSync(join(tmpdir(),'task-model-'));
 const db=openDb(':memory:');
 try {
 const {app}=createApp({db,dataDir,adminUser:'admin',adminPass:'admin'});
 const login=await app.request('http://localhost/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'admin'})});
 const cookie=login.headers.get('set-cookie')!;
 const post=(path:string,body:any)=>app.request('http://localhost'+path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)});
 const created=await post('/api/agents',{name:'Puff',modelId:'openrouter:z-ai/glm-5.3',workspacePath:'/tmp/puff'});
 expect(created.status).toBe(201);
 const channel=await post('/api/channels',{name:'test'});
 expect(channel.status).toBe(201);
 const id=(await channel.json() as any).id;
 const taskModel={agentName:'Puff',mode:'manual',modelId:'openrouter:a/vision'};
 const body={type:'message.created',channelId:id,source:'human:admin',payload:{text:'Look at this',taskModel}};
 expect((await post('/api/events',body)).status).toBe(201);
 expect((await post('/api/events',{...body,payload:{...body.payload,taskModel:{...taskModel,modelId:'anthropic:other'}}})).status).toBe(400);
 expect((await post('/api/events',{...body,payload:{...body.payload,taskModel:{...taskModel,agentName:'absent'}}})).status).toBe(400);
 const forged=await app.request('http://localhost/api/events',{method:'POST',headers:{'x-orgops-runner-token':'dev-runner-token','content-type':'application/json'},body:JSON.stringify({...body,source:'agent:Puff'})});
 expect(forged.status).toBe(400);
 const missingHuman=await app.request('http://localhost/api/events',{method:'POST',headers:{'x-orgops-runner-token':'dev-runner-token','content-type':'application/json'},body:JSON.stringify({...body,source:'human:absent'})});
 expect(missingHuman.status).toBe(400);
 const saved=await app.request('http://localhost/api/agents/Puff',{headers:{cookie}});
 expect((await saved.json() as any).modelId).toBe('openrouter:z-ai/glm-5.3');
 } finally {db.close();rmSync(dataDir,{recursive:true,force:true});}
});
