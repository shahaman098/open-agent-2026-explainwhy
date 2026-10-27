'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import type {ActionExecutionT,ActionProposalT} from '@normal/contracts';
import type {BusinessOutcomeAssessmentT} from '@/outcomes/schema';
import {api,q} from './api';

interface Row{execution:ActionExecutionT;plan:{planId:string;planVersion:number;investigationId:string;objective:string;summary?:string;successCriteria?:BusinessOutcomeAssessmentT['successCriteria']};action:ActionProposalT;
  receipt:{idempotencyKey:string;actionId:string;toolName:string;recordedAt:string;verification:string;emittedEventIds:string[];affectedEntityIds:string[];state:unknown}|null;
  latest:(BusinessOutcomeAssessmentT&{feedback?:{note:string;rating:string;recordedAt:string}|null})|null;history:BusinessOutcomeAssessmentT[]}
interface ResponseData{businessId:string;simulationRunId:string;rows:Row[];counts:{actionsExecuted:number;awaitingMeasurement:number;measuredImprovement:number;noObservedImprovement:number;inconclusiveOrFailed:number}}
export type OutcomeDetailRow = Row;
const pounds=(n:number|null|undefined)=>n===null||n===undefined?'—':`£${(n/100).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const number=(n:number|null|undefined)=>n===null||n===undefined?'—':n.toLocaleString('en-GB');
const rate=(n:number|null|undefined)=>n===null||n===undefined?'—':`${(n*100).toFixed(2)}%`;
type Observation=NonNullable<BusinessOutcomeAssessmentT['before']>;
function observed(o:Observation|null,metric:keyof Observation['metrics'],format:'money'|'number'|'rate'|'roas'){
  if(!o||o.coveredMinutes===0)return '—';
  const value=o.metrics[metric];
  const text=format==='money'?pounds(value):format==='rate'?rate(value):format==='roas'?value===null?'—':value.toFixed(2):number(value);
  return o.complete?text:`${text} · partial`;
}
function criterionDisplay(metric:string,value:number|null){if(value===null)return '—';return ['ad_spend_minor','revenue_minor','cac_minor'].includes(metric)?pounds(value):['ctr','conversion_rate','late_delivery_rate'].includes(metric)?rate(value):number(value)}
const statusLabel=(s:string)=>s.replaceAll('_',' ');
const compactCopy=(value:string,max=150)=>{const first=value.split(/\n|(?<=[.!?])\s+(?=[A-Z])/)[0].trim();return first.length<=max?first:`${first.slice(0,max).trimEnd()}…`};

function MetricChart({assessment}:{assessment:BusinessOutcomeAssessmentT}){
  const before=assessment.before,after=assessment.after;
  if(!before?.series.length&&!after?.series.length)return <div className="outcome-empty-plot">No post-action campaign observations have been recorded in this run.</div>;
  const max=Math.max(1,...(before?.series??[]).map(s=>s.spendMinor),...(after?.series??[]).map(s=>s.spendMinor));
  return <div className="outcome-chart" aria-label="Recorded campaign spend by simulated hour">
    {[['Before',before],['After',after]] .map(([label,part])=>{const o=part as typeof before;return <div className="outcome-chart-row" key={label as string}>
      <div className="outcome-chart-caption"><strong>{label as string}</strong><small>{o?.coveredMinutes??0}/{o?.requiredMinutes??0} min observed</small></div>
      <div className="outcome-chart-bars">{o?.series.map(s=><span key={s.startAt} className={label==='After'?'post':''} style={{height:`${Math.max(3,s.spendMinor/max*100)}%`}} title={`${new Date(s.startAt).toLocaleString('en-GB')} · ${pounds(s.spendMinor)} spend · ${s.attributedOrders} attributed orders`} />)}</div>
    </div>})}<div className="outcome-chart-axis">Simulated event windows · recorded spend, GBP</div>
  </div>;
}

function FeedbackPanel({assessment,feedback,onSaved}:{assessment:BusinessOutcomeAssessmentT;feedback:{note:string;rating?:string;recordedAt:string}|null|undefined;onSaved:()=>Promise<void>}){
  const [note,setNote]=useState(''),[rating,setRating]=useState<'helpful'|'concern'|'uncertain'>('uncertain'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const submit=async()=>{setBusy(true);setError('');try{await api('/api/outcomes/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({businessId:assessment.businessId,
    simulationRunId:assessment.simulationRunId,assessmentId:assessment.assessmentId,rating,note})});await onSaved()}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
  return <section className="outcome-section"><div className="outcome-section-head"><h3>Operator feedback</h3><span>Human note · separate from measured result</span></div>
    {feedback?<p className="outcome-note"><strong>{feedback.rating??'Feedback'}</strong> · {feedback.note} · {new Date(feedback.recordedAt).toLocaleString('en-GB')}</p>
      :<div className="outcome-feedback"><select aria-label="Feedback rating" value={rating} onChange={e=>setRating(e.target.value as typeof rating)}><option value="uncertain">Uncertain</option><option value="helpful">Helpful</option><option value="concern">Concern</option></select><textarea aria-label="Operator note" placeholder="What did you observe?" value={note} onChange={e=>setNote(e.target.value)} maxLength={1000}/><button className="btn sm" disabled={busy||!note.trim()} onClick={()=>void submit()}>{busy?'Saving…':'Save feedback'}</button></div>}
    {error?<p role="alert" className="outcome-limit">{error}</p>:null}</section>;
}

export function AssessmentDetail({row,assessment,runId,onFeedbackSaved,compact=false}:{row:Row;assessment:BusinessOutcomeAssessmentT|null;runId:string;onFeedbackSaved:()=>Promise<void>;compact?:boolean}){
  const approvalUrl=`/dashboard/approvals?run=${encodeURIComponent(runId)}`;
  const investigationUrl=`/dashboard/investigations/${encodeURIComponent(row.plan.investigationId)}?run=${encodeURIComponent(runId)}`;
  return <div className={`outcome-detail${compact?' outcome-detail-compact':''}`} data-testid="outcome-detail">
    <div className="outcome-detail-head"><div><span className="outcome-eyebrow">{compact?'Action result':'Intervention dossier'}</span><h2>{row.action.title}</h2><p>{compact?compactCopy(row.plan.objective):row.plan.objective}</p></div><span className={`outcome-state ${assessment?.businessEffect??'inconclusive'}`}>{assessment?statusLabel(assessment.status):'Not assessed'}</span></div>
    <div className="outcome-proof"><div><small>Execution</small><strong>{row.execution.status}</strong><span>{compact?compactCopy(row.execution.result?.verification??'No verification recorded'):row.execution.result?.verification??'No verification recorded'}</span></div><div><small>Business effect</small><strong>{assessment?statusLabel(assessment.businessEffect):'Unmeasured'}</strong><span>{compact?compactCopy(assessment?.summary??'Run a read-only assessment to inspect subsequent records.'):assessment?.summary??'Run a read-only assessment to inspect subsequent records.'}</span></div></div>
    <div className="outcome-links"><Link href={investigationUrl}>Open investigation ↗</Link><Link href={approvalUrl}>Reviewed plan v{row.plan.planVersion} ↗</Link><code>{row.plan.planId}</code></div>
    {assessment?<>
      <section className="outcome-section"><div className="outcome-section-head"><h3>What changed</h3><span>Actual adapter state</span></div>
        <div className="outcome-values"><div><small>Before</small><strong>{row.action.actionType==='ads.set_daily_budget'?pounds(assessment.beforeValue):'—'}</strong></div><div className="outcome-arrow">→</div><div><small>After</small><strong>{row.action.actionType==='ads.set_daily_budget'?pounds(assessment.afterValue):'—'}</strong></div><div><small>Target achieved</small><strong>{assessment.targetStateAchieved===null?'Unknown':assessment.targetStateAchieved?'Verified':'Not verified'}</strong></div></div>
        {row.action.actionType==='customer.send_delay_notice'?<p className="outcome-note">{assessment.operational.reachedRecipients}/{assessment.operational.intendedRecipients} intended recipients reached · {assessment.operational.duplicateMessages} duplicate messages.</p>:null}
        {row.action.actionType==='storefront.publish_banner'?<p className="outcome-note">Scheduled {String(assessment.operational.scheduledFrom)} → {String(assessment.operational.scheduledTo)} · visible at the saved virtual time: {assessment.operational.visibleAtVirtualTime?'yes':'no'}.</p>:null}
      </section>
      <section className="outcome-section"><div className="outcome-section-head"><h3>Subsequent observations</h3><span>{new Date(assessment.window.startAt).toLocaleString('en-GB')} → {new Date(assessment.window.endAt).toLocaleString('en-GB')}</span></div>
        {assessment.actionType==='ads.set_daily_budget'?<><MetricChart assessment={assessment}/><div className="outcome-metric-table"><div><strong>Campaign metric</strong><strong>Before</strong><strong>After</strong></div>
          <div><span>Spend</span><span>{observed(assessment.before,'spendMinor','money')}</span><span>{observed(assessment.after,'spendMinor','money')}</span></div>
          <div><span>Impressions</span><span>{observed(assessment.before,'impressions','number')}</span><span>{observed(assessment.after,'impressions','number')}</span></div>
          <div><span>Clicks</span><span>{observed(assessment.before,'clicks','number')}</span><span>{observed(assessment.after,'clicks','number')}</span></div>
          <div><span>CTR</span><span>{observed(assessment.before,'ctr','rate')}</span><span>{observed(assessment.after,'ctr','rate')}</span></div>
          <div><span>Attributed orders</span><span>{observed(assessment.before,'attributedOrders','number')}</span><span>{observed(assessment.after,'attributedOrders','number')}</span></div>
          <div><span>Attributed revenue</span><span>{observed(assessment.before,'attributedRevenueMinor','money')}</span><span>{observed(assessment.after,'attributedRevenueMinor','money')}</span></div>
          <div><span>ROAS</span><span>{observed(assessment.before,'roas','roas')}</span><span>{observed(assessment.after,'roas','roas')}</span></div></div></>:<p className="outcome-note">No action-specific comparable business cohort is available. Operational delivery and publication are reported above.</p>}
        <p className="outcome-note">{assessment.before?.complete?'Complete pre-action window':'Pre-action coverage incomplete'} · {assessment.after?.complete?'Complete post-action window':'Post-action coverage incomplete or awaiting the simulation clock'}</p>
      </section>
      <section className="outcome-section"><div className="outcome-section-head"><h3>Plan criteria</h3><span>{assessment.successCriteriaMet===null?'Not fully assessable':assessment.successCriteriaMet?'All met':'One or more unmet'}</span></div>
        {assessment.successCriteria.map((c,i)=>{const result=assessment.criterionResults[i];return <div className="outcome-criterion" key={`${c.metric}:${i}`}><strong>{c.metric.replaceAll('_',' ')} · {c.direction}</strong><span>{result?`${criterionDisplay(c.metric,result.before)} → ${criterionDisplay(c.metric,result.after)}`:'No comparable action-specific metric'}</span><em>{result?.met===null||!result?'Inconclusive':result.met?'Met':'Not met'}</em></div>})}
      </section>
      <section className="outcome-section"><div className="outcome-section-head"><h3>Evidence and limits</h3><span>{assessment.sourceReferences.length} saved references</span></div>
        <p className="outcome-note">Diagnosis: {assessment.diagnosis}</p>{assessment.limitations.map((l,i)=><p className="outcome-limit" key={i}>{l}</p>)}
        <details><summary>Source records and original receipt</summary><div className="outcome-refs">{row.receipt?<pre>{JSON.stringify(row.receipt,null,2)}</pre>:<p>Receipt unavailable in this scope.</p>}{assessment.sourceReferences.map(r=><code key={`${r.collection}:${r.recordId}`}>{r.collection} / {r.recordId}</code>)}<code>execution / {assessment.executionId}</code><code>approval / {assessment.approvalId}</code></div></details>
      </section>
      <section className="outcome-section"><div className="outcome-section-head"><h3>Assessment history</h3><span>{row.history.length} saved window{row.history.length===1?'':'s'}</span></div>{row.history.map(h=><div className="outcome-history" key={h.assessmentId}><span>{new Date(h.window.startAt).toLocaleString('en-GB')} · {statusLabel(h.status)} · {statusLabel(h.businessEffect)}</span><code>{h.assessmentId}</code></div>)}</section>
      <FeedbackPanel key={assessment.assessmentId} assessment={assessment} feedback={row.latest?.feedback} onSaved={onFeedbackSaved}/>
    </>:<div className="outcome-empty-plot">No assessment has been saved for this executed action.</div>}
  </div>;
}

export function InvestigationOutcomes({investigationId,businessId,simulationRunId}:{investigationId:string;businessId:string;simulationRunId:string}){
  const [data,setData]=useState<ResponseData|null>(null);
  useEffect(()=>{let active=true;void api<ResponseData>(`/api/outcomes?${q({businessId,simulationRunId,investigationId})}`).then(r=>{if(active)setData(r)}).catch(()=>{if(active)setData(null)});return()=>{active=false}},[businessId,simulationRunId,investigationId]);
  return <section className="card" data-testid="investigation-outcomes"><div className="card-head"><h3>Outcome verification</h3><span className="pill">{data?.rows.length??0} executed</span></div><div className="card-body"><p className="muted small">Executed action state and later business observations are assessed separately.</p>
    {data?.rows.map(r=><div className="outcome-investigation-row" key={r.execution.executionId}><strong>{r.action.title}</strong><span>Execution {r.execution.status} · {r.latest?statusLabel(r.latest.status):'not assessed'} · {r.latest?statusLabel(r.latest.businessEffect):'business effect unmeasured'}</span><Link href={`/dashboard/outcomes?run=${encodeURIComponent(simulationRunId)}&action=${encodeURIComponent(r.action.actionId)}`}>Inspect outcome ↗</Link></div>)}
    {!data?.rows.length?<p className="muted small">No executed action for this investigation in this run.</p>:null}
    <Link className="btn sm" href={`/dashboard/outcomes?run=${encodeURIComponent(simulationRunId)}`}>Open Outcomes</Link>
  </div></section>;
}
