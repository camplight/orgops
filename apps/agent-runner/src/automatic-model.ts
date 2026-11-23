import type { OpenRouterRouting } from '@orgops/llm';
import type { Agent } from './types';

/** Instance policy, never read from a user message or written to the agent row. */
export function automaticTaskModel(agent: Agent, channelId: string, env: NodeJS.ProcessEnv = process.env):
  {agent: Agent; routing: OpenRouterRouting} | undefined {
  if (env.ORGOPS_TASK_MODEL_ROUTING !== 'openrouter-auto' ||
      (agent.mode ?? 'CLASSIC') !== 'CLASSIC' || !/^(openrouter|or):/.test(agent.modelId)) return;
  const costTier = env.ORGOPS_TASK_MODEL_COST_TIER ?? 'medium';
  if (!['low','medium','high','xhigh','max'].includes(costTier)) throw Error('Invalid task routing cost tier.');
  const allowedModels = env.ORGOPS_TASK_MODEL_ALLOWED_MODELS?.split(',').map(x=>x.trim()).filter(Boolean);
  if (env.ORGOPS_TASK_MODEL_ALLOWED_MODELS !== undefined && !allowedModels?.length)
    throw Error('Task routing allowed models must not be empty.');
  return {
    agent: {...agent, modelId:'openrouter:openrouter/auto', openaiCompatibleReasoningEffort:null,
      // The router accepts images and tools; the selected endpoint must support them.
      // Keep the existing context budget rather than assuming the router's maximum.
      modelCapabilities:{...agent.modelCapabilities,textInput:true,textOutput:true,imageInput:true,toolCalling:true}},
    routing:{sessionId:JSON.stringify([agent.id ?? agent.name,channelId]),
      costTier:costTier as OpenRouterRouting['costTier'],...(allowedModels ? {allowedModels} : {})},
  };
}
