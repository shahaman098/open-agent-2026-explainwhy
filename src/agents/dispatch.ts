import 'server-only';
import type {ActionProposalT} from '@normal/contracts';
import {setDailyBudget,sendDelayNotice,publishBanner,type ActionContext,type AdapterResult} from '@/adapters';
import {ExecutionError} from '@/execution/errors';
// Partner agents' allowlisted tool dispatch, bound only to Normal's simulator.
export const agentTools = {marketing:'ads.set_daily_budget',customer_care:'customer.send_delay_notice',storefront:'storefront.publish_banner'} as const;
export function assertAgentScope(action:ActionProposalT) {
 if (!(action.agent in agentTools) || agentTools[action.agent as keyof typeof agentTools] !== action.actionType) throw new ExecutionError('The action is outside this agent’s supported tools.','agent_scope');
}
export async function dispatchAction(action:ActionProposalT,ctx:ActionContext):Promise<AdapterResult<unknown>> {
 assertAgentScope(action);
 switch(action.actionType){
  case 'ads.set_daily_budget':return setDailyBudget(ctx,action.params);
  case 'customer.send_delay_notice':return sendDelayNotice(ctx,action.params);
  case 'storefront.publish_banner':return publishBanner(ctx,action.params);
  default:throw new ExecutionError('Unsupported action.','unsupported_action');
 }
}
