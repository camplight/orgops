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
