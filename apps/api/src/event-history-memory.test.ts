import {it,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
it('reads oversized retained history within a 256 MiB heap without dropping receipts or data',async()=>{
 const root=mkdtempSync(join(tmpdir(),'orgops-history-memory-'));
 try {
  const {stdout}=await promisify(execFile)(process.execPath,['--max-old-space-size=256','--import','tsx',fileURLToPath(new URL('./fixtures/event-history-memory.ts',import.meta.url)),root],{
   timeout:45_000,maxBuffer:128*1024,env:{...process.env,ORGOPS_FEDERATION_SYNC_INTERVAL_MS:'0'},
  });
  expect(stdout).toContain('PASS: 280 MiB history');
  console.log(stdout.trim());
 } finally {rmSync(root,{recursive:true,force:true});}
},60_000);

it('keeps invalid limits bounded even with all=1',async()=>{
 const root=mkdtempSync(join(tmpdir(),'orgops-history-limit-'));
 const {createApp}=await import('./app');
 const {app,db}=createApp({dbPath:':memory:',dataDir:root,adminUser:'synthetic',adminPass:'synthetic',runnerToken:'limit-fixture',systemAgentModel:''});
 try {
  db.exec("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<120) INSERT INTO events(id,type,payload_json,source,created_at,status) SELECT 'limit-'||x,'message.created','{}','human:synthetic',x,'DELIVERED' FROM n");
  for(const [limit,expected] of [['-1',100],['NaN',100],['0',100],['Infinity',100],['2.8',2]] as const){
   const response=await app.request('http://localhost/api/events?all=1&limit='+limit,{headers:{'x-orgops-runner-token':'limit-fixture'}});
   expect(response.status).toBe(200);
   expect((await response.json() as unknown[]).length).toBe(expected);
  }
 } finally {db.close();rmSync(root,{recursive:true,force:true});}
});

it('delivers bounded file-backed inputs completely and keeps later receipts pending',async()=>{
 const root=mkdtempSync(join(tmpdir(),'orgops-blob-delivery-'));
 const {createApp}=await import('./app');
 const {app,db}=createApp({dbPath:':memory:',dataDir:root,projectRoot:root,adminUser:'synthetic',adminPass:'synthetic',runnerToken:'blob-fixture',systemAgentModel:''});
 const headers={'x-orgops-runner-token':'blob-fixture','content-type':'application/json'};
 try{
  db.prepare("INSERT INTO agents(id,name,model_id,workspace_path,created_at,updated_at) VALUES('a','tester','openai:test',?,0,0)").run(root);
  db.exec("INSERT INTO channels(id,name,created_at) VALUES('c','synthetic',0); INSERT INTO channel_subscriptions(channel_id,subscriber_type,subscriber_id) VALUES('c','AGENT','tester')");
  const ids:string[]=[];
  for(let i=0;i<2;i++){
   const r=await app.request('http://localhost/api/events',{method:'POST',headers,body:JSON.stringify({type:'message.created',source:'human:synthetic',channelId:'c',payload:{text:'x'.repeat(600_000),targetAgentNames:['tester']}})});
   expect(r.status).toBe(201);ids.push((await r.json() as {id:string}).id);
  }
  const history=await(await app.request('http://localhost/api/events?channelId=c&limit=100',{headers})).json() as any[];
  expect(history).toHaveLength(2);expect(history.every(row=>row.payloadTruncated&&row.payloadRef?.storage==='file')).toBe(true);
  for(let i=0;i<2;i++){
   const response=await app.request('http://localhost/api/events?agentName=tester&status=PENDING&limit=100',{headers});
   const text=await response.text();expect(Buffer.byteLength(text)).toBeLessThan(1_200_000);
   const rows=JSON.parse(text);expect(rows).toHaveLength(1);expect(rows[0].id).toBe(ids[i]);
   expect(rows[0].payloadTruncated).toBeUndefined();expect(rows[0].payload.text).toHaveLength(600_000);expect(rows[0].payload.targetAgentNames).toEqual(['tester']);
   expect((db.prepare("SELECT count(*) AS n FROM event_receipts WHERE status='PENDING'").get() as {n:number}).n).toBe(1-i);
  }
  const chunk=await(await app.request('http://localhost/api/events/'+ids[0]+'/payload?offset=0&limit=128',{headers})).json() as {chunk:string;done:boolean};
  expect(chunk.chunk).toHaveLength(128);expect(chunk.done).toBe(false);
  expect((db.prepare('SELECT count(*) AS n FROM event_payload_blobs').get() as {n:number}).n).toBe(2);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
