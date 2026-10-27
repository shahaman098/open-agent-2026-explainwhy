import { describe, expect, it } from "vitest";
import { buildAugmentedRequest } from "@/intelligence/training/profile-augment";
import { sourceTaskRequest } from "@/intelligence/investigator/source-task";

describe("task profiles", () => {
  it("injects capped reference examples into the user payload", () => {
    const base = sourceTaskRequest("nvidia/test", [{ sourceId: "s1", claim: "c", actualPassage: "p", publisherHost: null }]);
    const profile = {
      profileId: "tp_test", taskKey: "normal.source_support.v1", promptFingerprint: "fp", promptVersion: "1.0.1", status: "promoted" as const,
      examples: [{ input: [{ sourceId: "s0", claim: "old", actualPassage: "x", publisherHost: null }], output: { assessments: [] }, approvedAt: new Date().toISOString() }],
      promotedAt: null, evalSummary: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const augmented = buildAugmentedRequest(base, profile);
    expect(augmented.system).toContain("Reference examples");
    expect(augmented.input).toMatchObject({ referenceExamples: [{ input: profile.examples[0].input }], input: base.input });
  });
});
