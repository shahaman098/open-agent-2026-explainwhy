import type {z} from 'zod';
import type {PlanHandoff} from '@explainwhy/contracts';
export type PlanHandoffT=z.infer<typeof PlanHandoff>;
