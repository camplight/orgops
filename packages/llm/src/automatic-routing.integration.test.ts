import {createServer} from 'node:http';
import {expect,it} from 'vitest';
import {generate} from './index';

it('routes an image and tool loop through the real SDK and reports the serving model',async()=>{
 const requests:any[]=[];
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw);requests.push(body);
  res.setHeader('content-type','application/json');
  res.end(JSON.stringify({id:'test',object:'chat.completion',created:1,model:'test/vision',choices:[{index:0,message:requests.length===1?{role:'assistant',content:null,tool_calls:[{id:'call1',type:'function',function:{name:'inspect',arguments:'{}'}}]}:{role:'assistant',content:'Image inspected'},finish_reason:requests.length===1?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 let executed=0;
 try {
  const port=(server.address() as any).port;
  const {z}=await import('zod');
  const result=await generate('openrouter:openrouter/auto',[{role:'user',content:[{type:'text',text:'Inspect this image'},{type:'image',image:new Uint8Array([137,80,78,71]),mediaType:'image/png'}]}],{
   env:{OPENROUTER_API_KEY:'test-only',OPENROUTER_BASE_URL:`http://127.0.0.1:${port}`,ORGOPS_LLM_STUB:'0'},
   openrouterRouting:{sessionId:'agent:room',costTier:'medium',allowedModels:['test/vision']},maxSteps:2,
   tools:{inspect:{inputSchema:z.object({}),execute:async()=>{executed++;return 'ok';}}},
  });
  expect(executed).toBe(1);expect(requests).toHaveLength(2);
  expect(requests[0].messages[0].content).toContainEqual(expect.objectContaining({type:'image_url'}));
  for(const request of requests){expect(request.model).toBe('openrouter/auto');expect(request.session_id).toBe('agent:room');expect(request.plugins[0].allowed_models).toEqual(['test/vision']);}
  expect(result.text).toBe('Image inspected');expect(result.modelId).toBe('openrouter:test/vision');
 } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
