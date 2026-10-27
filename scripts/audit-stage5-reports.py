#!/usr/bin/env python3
"""Audit saved Stage 5 run artifacts without altering the database or answer keys."""
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("files", nargs="+", type=Path)
parser.add_argument("--output", type=Path)
args = parser.parse_args()
rows = []
for path in args.files:
    artifact = json.loads(path.read_text())
    result = artifact["result"]
    state, report = result["state"], result["report"]
    assert report, f"{path}: missing report"
    diagnosis = report["diagnosis"]
    ledger = {entry["evidenceId"]: entry for entry in report["ledger"]}
    sources = {source["sourceId"]: source for source in result["sources"]}
    checks = {
        "validated": report["validation"]["passed"] is True,
        "shared_diagnosis": report["diagnosisId"] == diagnosis["diagnosisId"] == report["handoff"]["diagnosisId"],
        "shared_brief": report["executiveBrief"]["explanation"] == diagnosis["summary"],
        "saved_report_id": report["reportId"] == state["reportId"],
        "saved_timeline": report["timeline"] == state["steps"],
        "saved_hypotheses": report["hypotheses"] == state["hypotheses"],
        "claim_references_resolve": all(ref in ledger for claim in report["claims"] for ref in claim["evidenceIds"] + claim["counterEvidenceIds"] + claim["sourceIds"]),
        "diagnosis_references_resolve": all(ref in ledger and ledger[ref]["origin"] == "internal" for hypothesis in diagnosis["hypotheses"] for ref in hypothesis["evidenceIds"] + hypothesis["counterEvidenceIds"]),
        "external_sources_resolve": all(ref in sources for claim in report["claims"] for ref in claim["sourceIds"]),
        "impact_reference_resolves": report["impact"]["evidenceId"] is None or report["impact"]["evidenceId"] in ledger,
        "handoff_not_executable": report["handoff"]["executable"] is False,
        "status_consistent": (state["status"] == "completed" and diagnosis["primaryCause"] != "unknown" and report["handoff"]["ready"] is True) or (state["status"] == "insufficient_evidence" and diagnosis["primaryCause"] == "unknown" and report["handoff"]["ready"] is False) or (state["status"] == "failed" and diagnosis["primaryCause"] == "unknown" and report["handoff"]["ready"] is False and bool(state.get("error")) and any(call.get("validationStatus") == "provider_failed" for call in result["calls"])),
        "provider_requests_attributed": all(call["metadata"].get("requestId", "").startswith("mreq_") for call in result["calls"] if call.get("metadata") and call["metadata"].get("provider") == "mubit"),
    }
    rows.append({"artifact": str(path), "investigationId": state["investigationId"], "status": state["status"], "primaryCause": diagnosis["primaryCause"], "sections": len(report["sections"]), "claims": len(report["claims"]), "internalEvidence": sum(entry["origin"] == "internal" for entry in ledger.values()), "externalSources": len(sources), "checks": checks, "passed": all(checks.values())})
summary = {"reports": len(rows), "passed": sum(row["passed"] for row in rows), "rows": rows}
if args.output:
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps({"reports": summary["reports"], "passed": summary["passed"], "failed": [row["artifact"] for row in rows if not row["passed"]]}))
if summary["passed"] != summary["reports"]:
    raise SystemExit(1)
