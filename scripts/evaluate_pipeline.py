#!/usr/bin/env python3
"""
Evaluate the HealthMap pipeline against ground truth mappings.

Sends Fehler (error) test files through the ML pipeline, compares column mappings
against known correct mappings, and reports precision/recall/F1 per file and overall.

Usage:
    python scripts/evaluate_pipeline.py [--api-url http://localhost:8080]

Requires: the full stack running (docker compose up)
"""

import argparse
import json
import sys
import time
from pathlib import Path

import requests

PROJECT_ROOT = Path(__file__).resolve().parent.parent
GROUND_TRUTH_PATH = PROJECT_ROOT / "api" / "testdata" / "ground_truth.json"
TESTDATA_DIR = PROJECT_ROOT / "api" / "testdata"


def send_file(api_url: str, filepath: Path) -> dict:
    """Upload a file to the ML pipeline and return the ML mapping response."""
    with open(filepath, "rb") as f:
        resp = requests.post(
            f"{api_url}/api/upload",
            files={"file": (filepath.name, f)},
            timeout=600,
        )
    resp.raise_for_status()
    data = resp.json()
    # Upload returns a list of UploadResponse objects [{file: ..., mapping: ...}]
    if isinstance(data, list) and len(data) > 0:
        return data[0].get("mapping") or data[0].get("Mapping") or {}
    return data


def evaluate_mappings(actual: dict[str, str], expected: dict[str, str]) -> dict:
    """Compare actual vs expected mappings. Returns precision, recall, F1, details."""
    # Only evaluate columns that have a non-null expected mapping
    expected_mappable = {src: tgt for src, tgt in expected.items() if tgt is not None}

    correct = 0
    wrong = 0
    missed = 0
    details = []

    for src, expected_tgt in expected_mappable.items():
        actual_tgt = actual.get(src)
        if actual_tgt is None:
            missed += 1
            details.append({"source": src, "expected": expected_tgt, "actual": None, "status": "MISSED"})
        elif actual_tgt.lower() == expected_tgt.lower():
            correct += 1
            details.append({"source": src, "expected": expected_tgt, "actual": actual_tgt, "status": "CORRECT"})
        else:
            wrong += 1
            details.append({"source": src, "expected": expected_tgt, "actual": actual_tgt, "status": "WRONG"})

    # Columns mapped that shouldn't have been (expected null but got a mapping)
    false_positives = 0
    for src, actual_tgt in actual.items():
        if src in expected and expected[src] is None and actual_tgt:
            false_positives += 1
            details.append({"source": src, "expected": None, "actual": actual_tgt, "status": "FALSE_POS"})

    total_expected = len(expected_mappable)
    total_actual = correct + wrong

    precision = correct / total_actual if total_actual > 0 else 0.0
    recall = correct / total_expected if total_expected > 0 else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

    return {
        "correct": correct,
        "wrong": wrong,
        "missed": missed,
        "false_positives": false_positives,
        "total_expected": total_expected,
        "precision": round(precision, 3),
        "recall": round(recall, 3),
        "f1": round(f1, 3),
        "details": details,
    }


def main():
    parser = argparse.ArgumentParser(description="Evaluate HealthMap pipeline")
    parser.add_argument("--api-url", default="http://localhost:8080", help="API base URL")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show per-column details")
    args = parser.parse_args()

    if not GROUND_TRUTH_PATH.exists():
        print(f"Ground truth not found: {GROUND_TRUTH_PATH}", file=sys.stderr)
        sys.exit(1)

    with open(GROUND_TRUTH_PATH) as f:
        ground_truth = json.load(f)

    print(f"{'='*80}")
    print(f"HealthMap Pipeline Evaluation")
    print(f"API: {args.api_url}")
    print(f"Files: {len(ground_truth)} Fehler test files")
    print(f"{'='*80}\n")

    overall_correct = 0
    overall_wrong = 0
    overall_missed = 0
    overall_expected = 0
    results = []

    for gt in ground_truth:
        filepath = TESTDATA_DIR / gt["file"]
        if not filepath.exists():
            print(f"SKIP {gt['file']}: file not found")
            continue

        print(f"Processing {gt['file']}...", end=" ", flush=True)
        start = time.time()

        try:
            resp = send_file(args.api_url, filepath)
        except Exception as exc:
            print(f"FAILED: {exc}")
            results.append({"file": gt["file"], "error": str(exc)})
            continue

        elapsed = time.time() - start

        # Check classification
        got_table = resp.get("target_table", "UNKNOWN")
        classify_ok = got_table == gt["target_table"]

        # Build actual mapping dict from response
        actual_mappings = {}
        for cm in resp.get("column_mappings", []):
            actual_mappings[cm["file_column"]] = cm["db_column"]

        # Evaluate against ground truth
        eval_result = evaluate_mappings(actual_mappings, gt["expected_mappings"])

        # Collect anomalies
        anomalies = resp.get("anomalies", [])

        overall_correct += eval_result["correct"]
        overall_wrong += eval_result["wrong"]
        overall_missed += eval_result["missed"]
        overall_expected += eval_result["total_expected"]

        status = "PASS" if classify_ok and eval_result["f1"] >= 0.5 else "FAIL"
        print(f"{status} ({elapsed:.1f}s)")
        print(f"  Table: {'OK' if classify_ok else 'MISMATCH'} (expected={gt['target_table']}, got={got_table})")
        print(f"  Mapping: P={eval_result['precision']:.0%} R={eval_result['recall']:.0%} F1={eval_result['f1']:.0%}")
        print(f"  Correct={eval_result['correct']}/{eval_result['total_expected']} Wrong={eval_result['wrong']} Missed={eval_result['missed']}")
        print(f"  Confidence: {resp.get('confidence', 0):.2f}, Columns mapped: {len(actual_mappings)}, Rows: {resp.get('row_count', 0)}")
        if anomalies:
            print(f"  Anomalies: {len(anomalies)}")
            for a in anomalies[:3]:
                print(f"    [{a['severity']}] {a['column']}: {a['message']}")

        if args.verbose:
            for d in eval_result["details"]:
                icon = {"CORRECT": "+", "WRONG": "X", "MISSED": "-", "FALSE_POS": "?"}[d["status"]]
                print(f"    [{icon}] {d['source']} -> expected={d['expected']}, got={d['actual']}")

        print()

        results.append({
            "file": gt["file"],
            "classify_ok": classify_ok,
            "target_table": got_table,
            "elapsed_s": round(elapsed, 1),
            **eval_result,
        })

    # Overall summary
    overall_precision = overall_correct / (overall_correct + overall_wrong) if (overall_correct + overall_wrong) > 0 else 0
    overall_recall = overall_correct / overall_expected if overall_expected > 0 else 0
    overall_f1 = 2 * overall_precision * overall_recall / (overall_precision + overall_recall) if (overall_precision + overall_recall) > 0 else 0

    print(f"{'='*80}")
    print(f"OVERALL RESULTS")
    print(f"{'='*80}")
    print(f"Files tested: {len(results)}")
    classify_ok_count = sum(1 for r in results if r.get("classify_ok"))
    print(f"Classification: {classify_ok_count}/{len(results)} correct")
    print(f"Column Mapping:")
    print(f"  Precision: {overall_precision:.0%} ({overall_correct}/{overall_correct + overall_wrong} mapped correctly)")
    print(f"  Recall:    {overall_recall:.0%} ({overall_correct}/{overall_expected} expected columns found)")
    print(f"  F1:        {overall_f1:.0%}")
    print(f"  Correct: {overall_correct}  Wrong: {overall_wrong}  Missed: {overall_missed}")

    # Per-file summary table
    print(f"\n{'File':<45} {'Table':>5} {'P':>6} {'R':>6} {'F1':>6} {'Time':>6}")
    print("-" * 80)
    for r in results:
        if "error" in r:
            print(f"{r['file']:<45} {'ERR':>5}")
            continue
        t_icon = "OK" if r["classify_ok"] else "FAIL"
        print(f"{r['file']:<45} {t_icon:>5} {r['precision']:>5.0%} {r['recall']:>5.0%} {r['f1']:>5.0%} {r['elapsed_s']:>5.1f}s")

    # Save results
    out_path = PROJECT_ROOT / "eval_results.json"
    with open(out_path, "w") as f:
        json.dump({"overall": {"precision": overall_precision, "recall": overall_recall, "f1": overall_f1,
                                "correct": overall_correct, "wrong": overall_wrong, "missed": overall_missed},
                    "files": results}, f, indent=2)
    print(f"\nDetailed results saved to {out_path}")


if __name__ == "__main__":
    main()
