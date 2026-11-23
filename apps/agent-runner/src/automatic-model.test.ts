import {expect,it} from 'vitest';
import {automaticTaskModel} from './automatic-model';
import type {Agent} from './types';
const saved:Agent={name:'Puff',modelId:'openrouter:z-ai/glm-5.3',workspacePath:'/tmp',desiredState:'RUNNING',runtimeState:'RUNNING',modelCapabilities:{textInput:true,textOutput:true,imageInput:false,toolCalling:true,contextWindowTokens:32000}};
const env={ORGOPS_TASK_MODEL_ROUTING:'openrouter-auto'};
it('routes ordinary runs without mutating defaults or confusing concurrent chat sessions',()=>{
 const a=automaticTaskModel(saved,'room-a',env)!, b=automaticTaskModel(saved,'room-b',env)!;
 expect(a.agent.modelId).toBe('openrouter:openrouter/auto');
 expect(a.agent.modelCapabilities).toMatchObject({imageInput:true,toolCalling:true,contextWindowTokens:32000});
 expect(a.routing.sessionId).not.toBe(b.routing.sessionId);
 expect(automaticTaskModel(saved,'room-a',env)!.routing.sessionId).toBe(a.routing.sessionId);
 expect(saved.modelId).toBe('openrouter:z-ai/glm-5.3');
 expect(saved.modelCapabilities?.imageInput).toBe(false);
});
it('does not reroute wrapped runtimes, other providers, or disabled installations',()=>{
 expect(automaticTaskModel(saved,'room',{})).toBeUndefined();
 for(const mode of ['WRAPPED','RLM_REPL'] as const) expect(automaticTaskModel({...saved,mode},'room',env)).toBeUndefined();
 expect(automaticTaskModel({...saved,modelId:'anthropic:claude'},'room',env)).toBeUndefined();
});
it('reads server policy, validates malformed policy, and keeps tool grants unchanged',()=>{
 expect(automaticTaskModel({...saved,enabledSkills:['drive']},'room',{...env,ORGOPS_TASK_MODEL_ALLOWED_MODELS:'google/*, anthropic/*',ORGOPS_TASK_MODEL_COST_TIER:'high'})).toMatchObject({agent:{enabledSkills:['drive']},routing:{costTier:'high',allowedModels:['google/*','anthropic/*']}});
 expect(()=>automaticTaskModel(saved,'room',{...env,ORGOPS_TASK_MODEL_COST_TIER:'free'})).toThrow();
 expect(()=>automaticTaskModel(saved,'room',{...env,ORGOPS_TASK_MODEL_ALLOWED_MODELS:' , '})).toThrow();
});
it('uses task complexity independently of availability and retains the saved model on classifier failure',()=>{
 expect(automaticTaskModel(saved,'room',env,{tier:'routine',reason:'classified'})).toBeUndefined();
 expect(automaticTaskModel(saved,'room',env,{tier:'default',reason:'unavailable'})).toBeUndefined();
 expect(automaticTaskModel(saved,'room',env,{tier:'complex',reason:'classified'})?.routing.costTier).toBe('high');
 expect(automaticTaskModel(saved,'room',env,{tier:'standard',reason:'classified'})?.routing.costTier).toBe('medium');
 expect(automaticTaskModel(saved,'room',env,{tier:'default',reason:'unavailable'},true)?.agent.modelCapabilities?.imageInput).toBe(true);
 expect(saved.modelId).toBe('openrouter:z-ai/glm-5.3');
});
