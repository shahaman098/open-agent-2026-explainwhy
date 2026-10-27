import {describe,it,expect} from 'vitest';
import {addMinutes,classifyAdvertising,observeAds,scoreCriterion,type AdObservationEvent} from '@/outcomes/measurement';

const anchor='2026-10-23T19:00:00.000Z';
function sample(startAt:string,spendMinor:number,orders:number,revenueMinor:number,offset=0):AdObservationEvent{
 const endAt=addMinutes(startAt,60);
 return {eventId:`event_${startAt}_${offset}`,occurredAt:endAt,receivedAt:addMinutes(endAt,offset),payload:{campaignId:'campaign_A',window:{startAt,endAt},spendMinor,impressions:1000,clicks:20,attributedOrders:orders,attributedRevenueMinor:revenueMinor,currency:'GBP'}};
}
const w=(startAt:string,hours:number)=>({startAt,endAt:addMinutes(startAt,hours*60)});
describe('deterministic campaign observation',()=>{
 it('compares exact equal-duration windows using actual recorded spend and revenue',()=>{
   const before=observeAds([sample(addMinutes(anchor,-120),100,1,1000),sample(addMinutes(anchor,-60),100,1,1000)],w(addMinutes(anchor,-120),2),anchor);
   const after=observeAds([sample(anchor,80,1,1200),sample(addMinutes(anchor,60),80,1,1200)],w(anchor,2),addMinutes(anchor,120));
   expect(before.complete).toBe(true);expect(after.complete).toBe(true);
   expect(after.metrics).toMatchObject({spendMinor:160,impressions:2000,clicks:40,ctr:.02,attributedOrders:2,attributedRevenueMinor:2400,roas:15,costPerAcquisitionMinor:80});
   expect(classifyAdvertising(before,after)).toBe('improved');
   expect(scoreCriterion('cac_minor','decrease',undefined,before,after).met).toBe(true);
 });
 it('detects deterioration even when reduced spend improves cost per acquisition',()=>{
   const before=observeAds([sample(addMinutes(anchor,-60),100,1,1000)],w(addMinutes(anchor,-60),1),anchor);
   const after=observeAds([sample(anchor,80,1,200)],w(anchor,1),addMinutes(anchor,60));
   expect(scoreCriterion('cac_minor','decrease',undefined,before,after).met).toBe(true);
   expect(classifyAdvertising(before,after)).toBe('deteriorated');
 });
 it('rejects gaps, overlaps, conflicts and incomplete simulated time',()=>{
   const window=w(anchor,2),first=sample(anchor,100,1,1000),second=sample(addMinutes(anchor,60),100,1,1000);
   expect(observeAds([first],window,window.endAt).complete).toBe(false);
   expect(observeAds([first,second],window,addMinutes(anchor,60)).complete).toBe(false);
   expect(observeAds([first,second,{...first,eventId:'changed',payload:{...first.payload,spendMinor:200}}],window,window.endAt).complete).toBe(false);
   expect(observeAds([first,{...second,payload:{...second.payload,window:{startAt:addMinutes(anchor,30),endAt:window.endAt}}}],window,window.endAt).complete).toBe(false);
 });
 it('does not manufacture a rate from zero denominators or duplicate observations',()=>{
   const zero=observeAds([sample(anchor,0,0,0)],w(anchor,1),addMinutes(anchor,60));
   expect(zero.metrics.roas).toBeNull();expect(zero.metrics.costPerAcquisitionMinor).toBeNull();
   expect(scoreCriterion('cac_minor','decrease',undefined,zero,zero).met).toBeNull();
   expect(classifyAdvertising(zero,zero)).toBe('inconclusive');
   const duplicate=observeAds([sample(anchor,80,1,200),sample(anchor,80,1,200,1)],w(anchor,1),addMinutes(anchor,60));
   expect(duplicate.metrics.spendMinor).toBe(80);expect(duplicate.eventIds).toHaveLength(1);
 });
});
