import {it,expect} from 'vitest';
import {serve} from '@hono/node-server';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import type {AddressInfo} from 'node:net';
import {securityFixture} from './security-fixture';

it('filters private events on org-wide topics and rechecks membership on every delivery',async()=>{
 const f=await securityFixture();const server=serve({fetch:f.engine.app.fetch,port:0});f.engine.injectWebSocket(server);await once(server,'listening');
 const socket=new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`,{headers:{cookie:f.member.cookie}});
 const received:any[]=[];socket.on('message',data=>received.push(JSON.parse(String(data))));await once(socket,'open');
 try{
  const channel=await(await f.request('/api/channels',{name:'restricted',visibility:'PRIVATE'})).json();
  socket.send(JSON.stringify({type:'subscribe',topic:'org:events'}));
  await new Promise(resolve=>setTimeout(resolve,20));
  const emit=()=>f.request('/api/events',{type:'message.created',channelId:channel.id,source:'human:operator',payload:{text:'synthetic private fixture'}});
  await emit();await new Promise(resolve=>setTimeout(resolve,30));
  expect(received.filter(e=>e.type==='event')).toHaveLength(0);
  await f.request(`/api/channels/${channel.id}/subscribe`,{subscriberType:'HUMAN',subscriberId:'member'});
  await emit();await new Promise(resolve=>setTimeout(resolve,30));
  const count=received.filter(e=>e.type==='event'&&e.data.type==='message.created').length;expect(count).toBe(1);
  await f.request(`/api/channels/${channel.id}/unsubscribe`,{subscriberType:'HUMAN',subscriberId:'member'});
  await emit();await new Promise(resolve=>setTimeout(resolve,30));
  expect(received.filter(e=>e.type==='event'&&e.data.type==='message.created')).toHaveLength(count);
  socket.send('{bad json');await new Promise(resolve=>setTimeout(resolve,20));
  expect(received.some(e=>e.type==='error'&&e.message==='Invalid message')).toBe(true);
 }finally{socket.close();await once(socket,'close');await new Promise<void>(resolve=>server.close(()=>resolve()));f.close();}
});

it('downloads active content inertly while preserving safe image previews',async()=>{
 const f=await securityFixture();
 try{
  for(const mime of ['text/html','image/svg+xml','image/png']){
   const data=new FormData();data.set('file',new File(['<script>synthetic-test</script>'],'sample.html',{type:mime}));
   const uploaded=await f.engine.app.request('/api/files',{method:'POST',headers:{cookie:f.member.cookie},body:data});expect(uploaded.status).toBe(201);
   const response=await f.request(`/api/files/${(await uploaded.json()).id}`,undefined,f.member);
   expect(response.headers.get('x-content-type-options')).toBe('nosniff');expect(response.headers.get('content-security-policy')).toContain('sandbox');
   expect(response.headers.get('content-type')).toBe(mime==='image/png'?'image/png':'application/octet-stream');
   expect(response.headers.get('content-disposition')).toMatch(mime==='image/png'?/^inline/:/^attachment/);
  }
 }finally{f.close();}
});
