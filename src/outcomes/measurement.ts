import type { BusinessOutcomeAssessmentT } from './schema';

type Observation = NonNullable<BusinessOutcomeAssessmentT['before']>;
export interface AdObservationEvent {
  eventId:string; occurredAt:string; receivedAt:string;
  payload:{campaignId:string;window:{startAt:string;endAt:string};spendMinor:number;impressions:number;clicks:number;
    attributedOrders:number;attributedRevenueMinor:number;currency:string};
}
const ms=(date:string)=>Date.parse(date);
export function addMinutes(date:string, minutes:number){return new Date(ms(date)+minutes*60_000).toISOString()}

/** Identical campaign/hour semantics to analytics/metrics, with strict full-window coverage for comparison. */
export function observeAds(events:AdObservationEvent[], window:{startAt:string;endAt:string}, virtualTime:string, snapshotIds:string[]=[]):Observation {
  const unique=new Map<string,AdObservationEvent>();let conflict=false;
  for(const event of events.sort((a,b)=>a.receivedAt.localeCompare(b.receivedAt)||a.eventId.localeCompare(b.eventId))){
    const w=event.payload.window;
    if(w.startAt<window.startAt||w.endAt>window.endAt||w.endAt>virtualTime||w.endAt!==event.occurredAt||ms(w.endAt)<=ms(w.startAt)||event.payload.currency!=='GBP')continue;
    const prior=unique.get(w.startAt);
    if(prior){if(JSON.stringify(prior.payload)!==JSON.stringify(event.payload)) conflict=true;continue}
    unique.set(w.startAt,event);
  }
  const rows=[...unique.values()].sort((a,b)=>a.payload.window.startAt.localeCompare(b.payload.window.startAt));
  let cursor=window.startAt,covered=0;
  for(const event of rows){const w=event.payload.window;if(w.startAt!==cursor){conflict=true;break}covered+=(ms(w.endAt)-ms(w.startAt))/60_000;cursor=w.endAt}
  const sums=rows.reduce((o,e)=>({spendMinor:o.spendMinor+e.payload.spendMinor,impressions:o.impressions+e.payload.impressions,
    clicks:o.clicks+e.payload.clicks,attributedOrders:o.attributedOrders+e.payload.attributedOrders,
    attributedRevenueMinor:o.attributedRevenueMinor+e.payload.attributedRevenueMinor}),
  {spendMinor:0,impressions:0,clicks:0,attributedOrders:0,attributedRevenueMinor:0});
  const required=(ms(window.endAt)-ms(window.startAt))/60_000;
  return {window,coveredMinutes:covered,requiredMinutes:required,complete:!conflict&&cursor===window.endAt&&ms(virtualTime)>=ms(window.endAt),
    metrics:{...sums,ctr:sums.impressions>0?sums.clicks/sums.impressions:null,
      roas:sums.spendMinor>0?sums.attributedRevenueMinor/sums.spendMinor:null,
      costPerAcquisitionMinor:sums.attributedOrders>0?Math.round(sums.spendMinor/sums.attributedOrders):null},
    eventIds:rows.map(e=>e.eventId),snapshotIds,
    series:rows.map(e=>({startAt:e.payload.window.startAt,spendMinor:e.payload.spendMinor,attributedRevenueMinor:e.payload.attributedRevenueMinor,
      attributedOrders:e.payload.attributedOrders,impressions:e.payload.impressions,clicks:e.payload.clicks}))};
}

export function criterionValue(metric:string, o:Observation):number|null {
  const m=o.metrics;
  switch(metric){
    case 'ad_spend_minor':return m.spendMinor;
    case 'ctr':return m.ctr;
    case 'orders':return m.attributedOrders; // campaign-attributed, never whole-business orders
    case 'revenue_minor':return m.attributedRevenueMinor;
    case 'cac_minor':return m.costPerAcquisitionMinor;
    default:return null;
  }
}
export function scoreCriterion(metric:string,direction:string,target:number|undefined,before:Observation|null,after:Observation|null){
  const b=before?.complete?criterionValue(metric,before):null,a=after?.complete?criterionValue(metric,after):null;
  if(b===null||a===null||b===undefined||a===undefined)return {metric,direction,target:target??null,before:b??null,after:a??null,met:null,
    reason:'A complete, comparable campaign window and nonzero rate denominator are required.'};
  const met=target!==undefined?(direction==='increase'?a>=target:direction==='decrease'?a<=target:a>=target)
    :direction==='increase'?a>b:direction==='decrease'?a<b:a>=b;
  return {metric,direction,target:target??null,before:b,after:a,met,
    reason:target!==undefined?'Compared with the plan’s explicit target.':'Compared exact values in equal-length campaign windows; no tolerance was invented.'};
}
export function classifyAdvertising(before:Observation|null,after:Observation|null):BusinessOutcomeAssessmentT['businessEffect']{
  if(!before?.complete||!after?.complete||before.metrics.roas===null||after.metrics.roas===null)return 'inconclusive';
  const b=before.metrics,a=after.metrics,bRoas=b.roas!,aRoas=a.roas!;
  if(aRoas<bRoas||a.attributedOrders<b.attributedOrders)return 'deteriorated';
  if(aRoas>bRoas&&a.attributedOrders>=b.attributedOrders&&a.attributedRevenueMinor>=b.attributedRevenueMinor)return 'improved';
  return 'unchanged';
}
