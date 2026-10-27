import { z } from "zod";
import { SOURCE_TASK } from "../investigator/source-task";

const ConsoleStatus = z.object({
  origin: z.literal("mubit_console"), task: z.literal(SOURCE_TASK), model: z.string(), datasetHash: z.string(), fingerprint: z.string(),
  mubitTaskId: z.string().min(1), observedAt: z.string().datetime(), taskUrl: z.string().url(),
  trainingStatus: z.enum(["reviewing_examples", "collecting_examples", "training", "testing", "passed", "failed"]),
  callsObserved: z.number().int().nonnegative(), keptExamples: z.number().int().nonnegative(), rejectedExamples: z.number().int().nonnegative(),
  waitingForReview: z.number().int().nonnegative(), reviewQueued: z.number().int().nonnegative(), reviewRunning: z.number().int().nonnegative(),
  firstTrainingStarted: z.boolean(), adapterVersionId: z.string().min(1).nullable(),
  evidencePaths: z.array(z.string().min(1)).min(1),
}).strict();

export function readConsoleStatus(value: unknown, expected: { model: string; datasetHash: string; fingerprint: string }) {
  const status = ConsoleStatus.parse(value);
  if (status.model !== expected.model || status.datasetHash !== expected.datasetHash || status.fingerprint !== expected.fingerprint) throw new Error("console_status_experiment_mismatch");
  if (status.trainingStatus === "passed" && (!status.firstTrainingStarted || !status.adapterVersionId)) throw new Error("passed_status_requires_adapter_identity");
  return status;
}
