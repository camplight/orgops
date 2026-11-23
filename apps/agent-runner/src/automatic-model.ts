import type { OpenRouterRouting } from '@orgops/llm';
import type { TaskRouting } from '@orgops/schemas';
import type { Agent } from './types';

/** Instance policy, never read from a user message or written to the agent row. */
export function automaticTaskModel(agent: Agent, channelId: string, env: NodeJS.ProcessEnv = process.env, task?: TaskRouting, needsImages = false):
  {agent: Agent; routing: OpenRouterRouting} | undefined {
  if (env.ORGOPS_TASK_MODEL_ROUTING !== 'openrouter-auto' ||
      (agent.mode ?? 'CLASSIC') !== 'CLASSIC' || !/^(openrouter|or):/.test(agent.modelId)) return;
  // A failed classifier does not block ordinary work. Images still need a capable router.
  if (task && ['routine', 'default'].includes(task.tier) && !needsImages) return;
  const costTier = task?.tier === 'complex'
    ? (env.ORGOPS_TASK_MODEL_COMPLEX_COST_TIER ?? 'high')
    : (env.ORGOPS_TASK_MODEL_COST_TIER ?? 'medium');
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
