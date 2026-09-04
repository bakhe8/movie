import json

import pytest

from src.enrichment_acceptance import (
    compute_drift,
    drift_gate,
    feature_value,
    format_drift_report,
    main,
    summarize_drift,
)


def _fp(pacing=0.5, linearity=0.5, irony=None):
    fp = {"pacing": pacing, "linearity": linearity}
    if irony is not None:
        fp["v2"] = {"features": {"tone.irony": irony}}
    return fp


def test_feature_value_reads_v1_and_namespaced_and_is_none_for_unknown():
    assert feature_value(_fp(pacing=0.7), "pacing") == 0.7
    assert feature_value(_fp(irony=0.9), "tone.irony") == 0.9
    assert feature_value(_fp(), "tone.irony") is None
    assert feature_value(None, "pacing") is None
    assert feature_value({"pacing": "not a number"}, "pacing") is None


def test_compute_drift_only_compares_titles_and_keys_known_in_both_snapshots():
    baseline = {"DEMO0001": _fp(pacing=0.5, linearity=0.5), "DEMO0002": _fp(pacing=0.3)}
    current = {"DEMO0001": _fp(pacing=0.6, linearity=0.5), "DEMO0003": _fp(pacing=0.9)}
    rows = compute_drift(baseline, current, keys=("pacing", "linearity"))
    # DEMO0002 (baseline only) and DEMO0003 (current only) are absent from both snapshots' overlap.
    assert {(r.internal_id, r.key) for r in rows} == {("DEMO0001", "pacing"), ("DEMO0001", "linearity")}
    pacing_row = next(r for r in rows if r.key == "pacing")
    assert pacing_row.delta == pytest.approx(0.1)
    linearity_row = next(r for r in rows if r.key == "linearity")
    assert linearity_row.delta == pytest.approx(0.0)


def test_unknown_in_either_snapshot_is_not_a_comparison_never_a_zero_delta():
    baseline = {"DEMO0001": _fp(irony=0.8)}
    current = {"DEMO0001": _fp()}  # v2 dropped: unknown now, not 0
    rows = compute_drift(baseline, current, keys=("tone.irony",))
    assert rows == []


def test_summarize_and_gate_flag_the_dimension_that_actually_drifted():
    rows = compute_drift(
        {"DEMO0001": _fp(pacing=0.50, linearity=0.85), "DEMO0002": _fp(pacing=0.52, linearity=0.80)},
        {"DEMO0001": _fp(pacing=0.51, linearity=0.15), "DEMO0002": _fp(pacing=0.50, linearity=0.20)},
        keys=("pacing", "linearity"),
    )
    summaries = summarize_drift(rows)
    by_key = {s.key: s for s in summaries}
    assert by_key["pacing"].mean_abs_delta == pytest.approx(0.015)
    assert by_key["linearity"].mean_abs_delta == pytest.approx(0.65)
    assert by_key["linearity"].flagged == 2  # both exceed the 0.4 per-title flag marker
    assert summaries[0].key == "linearity"  # least stable first

    assert drift_gate(summaries, threshold=0.08) == ["linearity"]
    assert drift_gate(summaries, threshold=0.9) == []  # a lenient bound passes everything


def test_report_names_the_gate_result_and_the_failing_dimensions():
    rows = compute_drift({"DEMO0001": _fp(linearity=0.85)}, {"DEMO0001": _fp(linearity=0.15)}, keys=("linearity",))
    summaries = summarize_drift(rows)
    failing = drift_gate(summaries, threshold=0.08)
    report = format_drift_report(summaries, 0.08, failing)
    assert "FAIL" in report and "`linearity`" in report and "do not cite these as displayed reasons" in report

    passing_report = format_drift_report(summaries, 0.9, [])
    assert "PASS" in passing_report and "No dimension exceeded" in passing_report


def test_cli_exits_nonzero_and_writes_a_report_on_a_real_failure(tmp_path):
    baseline = tmp_path / "baseline.json"
    current = tmp_path / "current.json"
    baseline.write_text(json.dumps([{"internalId": "DEMO0001", "fingerprint": {"linearity": 0.85, "pacing": 0.5}}]), encoding="utf-8")
    current.write_text(json.dumps([{"internalId": "DEMO0001", "fingerprint": {"linearity": 0.15, "pacing": 0.51}}]), encoding="utf-8")

    exit_code = main(["drift", "--baseline", str(baseline), "--current", str(current)])

    assert exit_code == 1
    report = (tmp_path / "current.drift-report.md").read_text(encoding="utf-8")
    assert "FAIL" in report and "linearity" in report

    exit_code_pass = main(["drift", "--baseline", str(baseline), "--current", str(current), "--threshold", "0.9"])
    assert exit_code_pass == 0


def test_cli_only_scopes_the_comparison_to_a_batch(tmp_path):
    baseline = tmp_path / "baseline.json"
    current = tmp_path / "current.json"
    baseline.write_text(json.dumps([
        {"internalId": "DEMO0001", "fingerprint": {"linearity": 0.85}},
        {"internalId": "DEMO0002", "fingerprint": {"linearity": 0.50}},
    ]), encoding="utf-8")
    current.write_text(json.dumps([
        {"internalId": "DEMO0001", "fingerprint": {"linearity": 0.15}},  # in the batch: drifted
        {"internalId": "DEMO0002", "fingerprint": {"linearity": 0.50}},  # not in the batch: unchanged
    ]), encoding="utf-8")

    # Unscoped: the untouched title's zero delta would still show up as its own dimension row (still just one dimension here, so no dilution to observe) --
    # scoped to the batch, only DEMO0001 counts.
    exit_code = main(["drift", "--baseline", str(baseline), "--current", str(current), "--only", "DEMO0001"])
    assert exit_code == 1
    report = (tmp_path / "current.drift-report.md").read_text(encoding="utf-8")
    assert "| `linearity` | 1 |" in report
