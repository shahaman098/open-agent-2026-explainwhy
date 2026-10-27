import { z } from 'zod';
import { SuccessCriterion } from '@normal/contracts';

export const OutcomeScope = z.object({
  businessId: z.string().regex(/^[a-z0-9_]{1,64}$/),
  simulationRunId: z.string().regex(/^[a-z0-9_]{1,64}$/),
}).strict();
export const EvaluateInput = OutcomeScope.extend({
  planId: z.string().min(1).max(180),
  planVersion: z.number().int().positive(),
  actionId: z.string().min(1).max(180),
  windowStartAt: z.string().datetime({offset:true}).optional(),
}).strict();
export type EvaluateInputT = z.infer<typeof EvaluateInput>;
const Window = z.object({startAt:z.string().datetime({offset:true}),endAt:z.string().datetime({offset:true})}).strict();
const Reference = z.object({collection:z.string().min(1),recordId:z.string().min(1)}).strict();
const MetricValues = z.object({
  spendMinor:z.number().int().nonnegative(),impressions:z.number().int().nonnegative(),clicks:z.number().int().nonnegative(),
  ctr:z.number().nullable(),attributedOrders:z.number().int().nonnegative(),attributedRevenueMinor:z.number().int().nonnegative(),
  roas:z.number().nullable(),costPerAcquisitionMinor:z.number().int().nonnegative().nullable(),
}).strict();
const Observation = z.object({window:Window,coveredMinutes:z.number().nonnegative(),requiredMinutes:z.number().positive(),
  complete:z.boolean(),metrics:MetricValues,eventIds:z.array(z.string()),snapshotIds:z.array(z.string()),
  series:z.array(z.object({startAt:z.string(),spendMinor:z.number(),attributedRevenueMinor:z.number(),attributedOrders:z.number(),impressions:z.number(),clicks:z.number()}).strict()),
}).strict();
export const BusinessOutcomeAssessment = z.object({
  schemaVersion:z.literal(1),assessmentId:z.string(),businessId:z.string(),simulationRunId:z.string(),
  planId:z.string(),planVersion:z.number().int().positive(),investigationId:z.string(),diagnosisId:z.string(),
  approvalId:z.string(),executionId:z.string(),actionId:z.string(),idempotencyKey:z.string(),
  actionType:z.string(),actionTitle:z.string(),targetId:z.string().nullable(),
  strategy:z.string(),strategyKey:z.string().nullable().optional(),diagnosis:z.string(),
  status:z.enum(['pending_measurement','ready_to_evaluate','evaluating','completed','insufficient_data','failed']),
  businessEffect:z.enum(['improved','unchanged','deteriorated','inconclusive']),
  actionApplied:z.boolean(),targetStateAchieved:z.boolean().nullable(),
  successCriteriaMet:z.boolean().nullable(),successCriteria:z.array(SuccessCriterion),
  criterionResults:z.array(z.object({metric:z.string(),direction:z.string(),target:z.number().nullable(),before:z.number().nullable(),after:z.number().nullable(),met:z.boolean().nullable(),reason:z.string()}).strict()),
  beforeValue:z.number().nullable(),afterValue:z.number().nullable(),currency:z.string().nullable(),
  before:Observation.nullable(),after:Observation.nullable(),
  window:Window,beforeWindow:Window,anchorAt:z.string().datetime({offset:true}),virtualTime:z.string().datetime({offset:true}),
  receiptId:z.string(),receiptEventIds:z.array(z.string()),sourceReferences:z.array(Reference),
  operational:z.record(z.union([z.string(),z.number(),z.boolean(),z.null()])),
  summary:z.string(),limitations:z.array(z.string()),
  createdAt:z.string().datetime({offset:true}),updatedAt:z.string().datetime({offset:true}),evaluatedAt:z.string().datetime({offset:true}).nullable(),
  error:z.string().nullable(),
}).strict();
export type BusinessOutcomeAssessmentT = z.infer<typeof BusinessOutcomeAssessment>;
