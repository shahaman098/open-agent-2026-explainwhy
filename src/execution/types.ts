import type {z} from 'zod';
import type {PlanHandoff} from '@normal/contracts';
export type PlanHandoffT=z.infer<typeof PlanHandoff>;
