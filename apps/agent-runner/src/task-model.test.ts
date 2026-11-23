import { describe, expect, it } from 'vitest';
import { chooseTaskModel, firstTaskBatch, normalizeCandidates, paretoFrontier, resolveTaskModel } from './task-model';
import type { Candidate } from './task-model';
import type { Agent, Event } from './types';
const agent: Agent = {name:'Puff',modelId:'openrouter:z-ai/glm-5.3',workspacePath:'/tmp',desiredState:'RUNNING',runtimeState:'RUNNING'};
const request = {agentName:'Puff',mode:'economy' as const,minIntelligence:70,maxPricePerMillion:5,minContextTokens:32000};
const model = (id:string, price:number|null, intelligence:number|null, vision=true):Candidate => ({id,price,intelligence,vision,tools:true,context:128000});
const event = (id:string, override=false):Event => ({id,type:'message.created',source:'human:owner',channelId:'room',payload:{text:'Help',...(override?{taskModel:request}:{})}});
describe('task model routing',()=>{
 it('takes the cheapest capable frontier point above the quality floor',()=>{
   const rows=[model('a/cheap',0.1,50),model('b/good',1,75),model('c/dominated',2,70),model('d/best',4,90),model('e/unknown',null,100)];
   expect(paretoFrontier(rows).map(x=>x.id)).toEqual(['a/cheap','b/good','d/best']);
   expect(chooseTaskModel(request,rows,true).id).toBe('b/good');
 });
 it('filters capabilities before dominance and rejects missing data / impossible limits',()=>{
   expect(chooseTaskModel(request,[model('a/text',0,100,false),model('b/vision',2,80)],true).id).toBe('b/vision');
   expect(()=>chooseTaskModel(request,[model('a/unknown',0,null)],false)).toThrow();
   expect(()=>chooseTaskModel({...request,maxPricePerMillion:0},[model('a/good',1,80)],false)).toThrow();
 });
 it('does not silently fall back from an incompatible manual model',()=>{
   expect(()=>chooseTaskModel({agentName:'Puff',mode:'manual',modelId:'openrouter:a/text'},[model('a/text',1,80,false)],true)).toThrow();
 });
 it('isolates overrides on both sides of an ordinary batch',()=>{
   const rows=[event('before'),event('override',true),event('after')];
   expect(firstTaskBatch(agent,rows).map(x=>x.id)).toEqual(['before']);
   expect(firstTaskBatch(agent,rows.slice(1)).map(x=>x.id)).toEqual(['override']);
   expect(firstTaskBatch({...agent,name:'Other'},rows)).toEqual(rows);
 });
 it('rejects ambiguous benchmark rows and absent prices',()=>{
   const rows=normalizeCandidates({data:[{id:'a/model',architecture:{output_modalities:['text']},pricing:{prompt:'',completion:'0'},context_length:32000}]},{data:[{source:'artificial-analysis',model_permaslug:'a/model',intelligence_index:80},{source:'artificial-analysis',model_permaslug:'a/model',intelligence_index:90}]});
   expect(rows[0]).toMatchObject({price:null,intelligence:null});
 });
 it('uses a new agent value and never mutates the saved default, even in parallel',async()=>{
   const fetcher=async(url:any)=>Response.json(String(url).includes('benchmarks')?{data:[{source:'artificial-analysis',model_permaslug:'a/vision',intelligence_index:80}]}:{data:[{id:'a/vision',architecture:{input_modalities:['text','image'],output_modalities:['text']},supported_parameters:['tools'],pricing:{prompt:'0.000001',completion:'0.000001'},context_length:128000}]});
   const [a,b]=await Promise.all([resolveTaskModel(agent,event('one',true),{OPENROUTER_API_KEY:'test'},fetcher as typeof fetch),resolveTaskModel(agent,event('two',true),{OPENROUTER_API_KEY:'test'},fetcher as typeof fetch)]);
   expect(a.agent.modelId).toBe('openrouter:a/vision');
   expect(b.agent).not.toBe(a.agent);
   expect(agent.modelId).toBe('openrouter:z-ai/glm-5.3');
   await expect(resolveTaskModel(agent,event('fail',true),{OPENROUTER_API_KEY:'test'},(async()=>new Response('',{status:503})) as typeof fetch)).rejects.toThrow();
   expect(agent.modelId).toBe('openrouter:z-ai/glm-5.3');
 });
});

it('ends an unresolved override visibly without calling the model or changing its default',async()=>{
 const {createTurnExecutor}=await import('./turn-executor');
 const emitted:any[]=[];
 const execute=createTurnExecutor({api:{emitEvent:async(e:any)=>{emitted.push(e);},getPackageSecretsEnv:async()=>({})}} as any);
 const result=await execute(agent,[event('override',true)]);
 expect(result.handledEventIds).toEqual(['override']);
 expect(emitted.find(e=>e.type==='message.created')?.payload.text).toContain('saved default was not changed');
 expect(agent.modelId).toBe('openrouter:z-ai/glm-5.3');
});
it('keeps each classified human task separate for every participant',()=>{
 const routed={...event('routed'),payload:{text:'Plan',taskRouting:{tier:'complex',reason:'classified'}}};
 expect(firstTaskBatch(agent,[event('before'),routed,event('after')]).map(x=>x.id)).toEqual(['before']);
 expect(firstTaskBatch(agent,[routed,event('after')]).map(x=>x.id)).toEqual(['routed']);
 expect(firstTaskBatch(agent,[{...routed,source:'agent:Other'},event('after')])).toHaveLength(2);
});
