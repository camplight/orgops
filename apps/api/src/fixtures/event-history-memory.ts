// Synthetic history only. Run in a child process with the production heap budget.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {createApp} from '../app';
const root=process.argv[2]!;
const {app,db}=createApp({dbPath:join(root,'history.sqlite'),dataDir:root,adminUser:'synthetic',adminPass:'synthetic',runnerToken:'memory-fixture',systemAgentModel:''});
db.prepare('INSERT INTO agents(id,name,model_id,workspace_path,created_at,updated_at) VALUES(?,?,?,?,0,0)').run('fixture-agent','tester','openai:test',root);
db.prepare('INSERT INTO channels(id,name,created_at) VALUES(?,?,0)').run('fixture-channel','synthetic history');
db.prepare("INSERT INTO channel_subscriptions(channel_id,subscriber_type,subscriber_id) VALUES(?,'AGENT',?)").run('fixture-channel','tester');
const insert=db.prepare("INSERT INTO events(id,type,payload_json,source,channel_id,created_at,status) VALUES(?,?,json_object('text',printf('%.*c',?,?)),'human:synthetic','fixture-channel',?,'PENDING')");
// 280 MiB of old outputs, including single events close to the production size.
for(let i=0;i<7;i++) insert.run('huge-'+i,'tool.executed',40*1024*1024,'x',i+1);
// Each row fits individually; their combined UTF-8 payloads exceed a page budget.
for(let i=0;i<32;i++) insert.run('medium-'+i,'message.created',20_000,'界',i+10);
insert.run('unicode','message.created',30_000,'界',50);
insert.run('small','message.created',5,'x',51);
db.prepare("INSERT INTO event_receipts(event_id,agent_name,status) SELECT id,'tester','PENDING' FROM events").run();
const before=db.prepare('SELECT count(*) AS count,sum(length(CAST(payload_json AS BLOB))) AS bytes FROM events').get() as {count:number;bytes:number};
assert.ok(before.bytes>280*1024*1024);
const headers={'x-orgops-runner-token':'memory-fixture'};
for(const query of ['all=1&limit=500&order=asc','agentName=tester&status=PENDING&limit=500&order=asc','limit=500&order=desc']) {
 const response=await app.request('http://localhost/api/events?'+query,{headers});
 assert.equal(response.status,200);
 const text=await response.text();
 assert.ok(Buffer.byteLength(text)<1_200_000,'The whole response must have a byte budget');
 const events=JSON.parse(text);
 assert.equal(events.length,41);
 assert.equal(events.filter((event:any)=>event.id.startsWith('huge-')&&event.payloadTruncated).length,7);
 assert.equal(events.find((event:any)=>event.id==='unicode').payloadTruncated,true);
 assert.equal(events.find((event:any)=>event.id==='small').payload.text,'xxxxx');
 assert.ok(events.some((event:any)=>event.id.startsWith('medium-')&&event.payloadTruncated));
 assert.equal((await app.request('http://localhost/health')).status,200);
}
assert.equal((db.prepare("SELECT count(*) AS n FROM event_receipts WHERE status='PENDING'").get() as {n:number}).n,0);
assert.deepEqual(db.prepare('SELECT count(*) AS count,sum(length(CAST(payload_json AS BLOB))) AS bytes FROM events').get(),before,'Listing must preserve original history');
db.close();
console.log('PASS: 280 MiB history, UTF-8 page budget, receipt delivery and retained history under 256 MiB V8 heap');
console.log(JSON.stringify({peakRssMiB:Math.round(process.resourceUsage().maxRSS/1024)}));
