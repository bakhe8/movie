import json
from unittest.mock import MagicMock

import pytest

from src.enrich_catalog import (
    DIMENSIONS,
    PARTIAL_DIMENSIONS,
    PLACEHOLDER_VERSION,
    build_evidence,
    enrich_entry,
    main,
    make_partial,
    needs_extraction,
    placeholder_fingerprint,
)
from src.enrichment import EXTRACTOR_VERSION, FilmFingerprintV1


def _entry(**overrides):
    entry = {
        "internalId": "DEMO0001",
        "titleEn": "Cairo Station",
        "titleAr": "باب الحديد",
        "description": "Cairo Station is a 1958 Egyptian drama film.",
        "descriptionSource": "wikipedia:en",
        "descriptionAr": "باب الحديد فيلم مصري.",
        "releaseYear": 1958,
        "genres": ["Drama", "Crime"],
        "country": "EG",
        "originalLanguage": "ar",
        "evidence": {"plotSummary": "A newspaper seller...", "plotSource": "wikipedia:en:Cairo Station", "sourceIds": ["wikidata:Q765535", "wikipedia:en:Cairo Station"]},
        "fingerprint": None,
    }
    entry.update(overrides)
    return entry


class TestBuildEvidence:
    def test_uses_the_english_lead_and_the_films_facts(self):
        evidence = build_evidence(_entry())

        assert evidence["title"] == "Cairo Station"
        assert evidence["description"].startswith("Cairo Station is")
        assert evidence["plot_summary"] == "A newspaper seller..."
        assert "Year: 1958" in evidence["additional_context"]
        assert "Genres: Drama, Crime" in evidence["additional_context"]
        assert "Arabic title: باب الحديد" in evidence["additional_context"]
        assert evidence["source_ids"] == ["wikidata:Q765535", "wikipedia:en:Cairo Station"]
        assert evidence["has_plot"] is True

    def test_prefers_the_arabic_lead_when_the_english_description_is_a_wikidata_stub(self):
        evidence = build_evidence(_entry(description="1958 film", descriptionSource="wikidata"))

        assert evidence["description"] == "باب الحديد فيلم مصري."

    def test_flags_lead_only_plot_evidence(self):
        entry = _entry()
        entry["evidence"]["plotSource"] = "wikipedia:en:Cairo Station:lead"

        assert "only the article lead" in build_evidence(entry)["additional_context"]

    def test_never_includes_anything_but_the_film(self):
        evidence = build_evidence(_entry())
        payload = json.dumps(evidence, ensure_ascii=False)

        for forbidden in ("user", "profile", "ranking", "preference", "email"):
            assert forbidden not in payload.lower()


class TestNeedsExtraction:
    def test_missing_fingerprint_needs_extraction(self):
        assert needs_extraction(_entry()) is True

    def test_current_version_is_done(self):
        assert needs_extraction(_entry(fingerprint={"extractorVersion": EXTRACTOR_VERSION})) is False

    def test_current_partial_version_is_done(self):
        assert needs_extraction(_entry(fingerprint={"extractorVersion": f"{EXTRACTOR_VERSION}+partial"})) is False

    def test_older_or_placeholder_version_needs_extraction(self):
        assert needs_extraction(_entry(fingerprint={"extractorVersion": "enrichment-worker-v1"})) is True
        assert needs_extraction(_entry(fingerprint={"extractorVersion": PLACEHOLDER_VERSION})) is True

    def test_force_overrides(self):
        assert needs_extraction(_entry(fingerprint={"extractorVersion": EXTRACTOR_VERSION}), force=True) is True


class TestPlaceholder:
    def test_is_deterministic_complete_and_in_range(self):
        first = placeholder_fingerprint(_entry())
        second = placeholder_fingerprint(_entry())

        # Only the generation timestamp may differ between two runs.
        assert {k: v for k, v in first.items() if k != "generatedAt"} == {k: v for k, v in second.items() if k != "generatedAt"}
        for dimension in DIMENSIONS:
            assert 0.0 <= first[dimension] <= 1.0
        assert first["confidence"] == {dimension: 0.3 for dimension in DIMENSIONS}

    def test_is_labelled_as_a_placeholder_never_an_extraction(self):
        fingerprint = placeholder_fingerprint(_entry())

        assert fingerprint["extractorVersion"] == PLACEHOLDER_VERSION
        assert fingerprint["generatedBy"] == "placeholder"
        assert fingerprint["modelVersion"] is None
        assert fingerprint["licenseStatus"] == "unknown"
        assert fingerprint["reviewStatus"] == "unreviewed"

    def test_different_films_get_different_vectors(self):
        assert placeholder_fingerprint(_entry()) != placeholder_fingerprint(_entry(internalId="DEMO0002"))

    def test_unknown_genres_fall_back_to_the_neutral_centroid(self):
        fingerprint = placeholder_fingerprint(_entry(genres=["Nonexistent"]))

        assert all(0.35 <= fingerprint[dimension] <= 0.65 for dimension in DIMENSIONS)


class TestMakePartial:
    def test_removes_two_dimensions_and_marks_the_version(self):
        fingerprint = placeholder_fingerprint(_entry())

        partial = make_partial(fingerprint)

        for dimension in PARTIAL_DIMENSIONS:
            assert dimension not in partial
            assert dimension not in partial["confidence"]
        assert partial["extractorVersion"] == f"{PLACEHOLDER_VERSION}+partial"
        assert partial["pacing"] == fingerprint["pacing"]

    def test_is_idempotent_on_the_version_suffix(self):
        partial = make_partial(make_partial(placeholder_fingerprint(_entry())))

        assert partial["extractorVersion"].count("+partial") == 1


class TestEnrichEntry:
    def test_passes_the_evidence_to_the_worker_and_returns_a_json_dict(self):
        fake = FilmFingerprintV1(**{dimension: 0.5 for dimension in DIMENSIONS})
        fake.extractorVersion = EXTRACTOR_VERSION
        fake.generatedBy = "anthropic"
        worker = MagicMock()
        worker.generate_fingerprint = MagicMock(return_value=fake)

        result = enrich_entry(worker, _entry())

        call = worker.generate_fingerprint.call_args
        assert call.kwargs["title"] == "Cairo Station"
        assert call.kwargs["plot_summary"] == "A newspaper seller..."
        assert call.kwargs["source_ids"] == ["wikidata:Q765535", "wikipedia:en:Cairo Station"]
        assert result["extractorVersion"] == EXTRACTOR_VERSION
        assert result["generatedBy"] == "anthropic"
        assert isinstance(result, dict) and result["pacing"] == 0.5


class TestV2Extraction:
    def test_needs_v2_only_where_a_v1_fingerprint_exists_and_no_current_block(self):
        from src.enrich_catalog import needs_v2_extraction
        from src.enrichment import V2_EXTRACTOR_VERSION

        assert needs_v2_extraction(_entry()) is False  # no V1 fingerprint to attach to
        v1 = {"extractorVersion": EXTRACTOR_VERSION, "pacing": 0.4}
        assert needs_v2_extraction(_entry(fingerprint=v1)) is True
        assert needs_v2_extraction(_entry(fingerprint={**v1, "v2": {"extractorVersion": V2_EXTRACTOR_VERSION}})) is False
        assert needs_v2_extraction(_entry(fingerprint={**v1, "v2": {"extractorVersion": "older"}})) is True
        assert needs_v2_extraction(_entry(fingerprint={**v1, "v2": {"extractorVersion": V2_EXTRACTOR_VERSION}}), force=True) is True

    def test_v2_run_attaches_the_block_without_touching_v1(self, tmp_path, monkeypatch):
        fixture = tmp_path / "catalog.demo.json"
        v1 = {"extractorVersion": EXTRACTOR_VERSION, "pacing": 0.4, "confidence": {"pacing": 0.9}}
        fixture.write_text(json.dumps([_entry(fingerprint=dict(v1)), _entry(internalId="DEMO0002")]), encoding="utf-8")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
        worker = MagicMock()
        worker.generate_fingerprint_v2 = MagicMock(
            return_value={"schemaVersion": "film-fingerprint-v2", "features": {"tone.irony": 0.8}, "extractorVersion": "enrichment-worker-v2-families-v1", "modelVersion": "m"}
        )
        monkeypatch.setattr("src.enrich_catalog.FilmEnrichmentWorker", lambda: worker)

        assert main(["--fixture", str(fixture), "--v2", "--concurrency", "1"]) == 0

        written = json.loads(fixture.read_text(encoding="utf-8"))
        assert written[0]["fingerprint"]["pacing"] == 0.4 and written[0]["fingerprint"]["confidence"] == {"pacing": 0.9}
        assert written[0]["fingerprint"]["v2"]["features"]["tone.irony"] == 0.8
        assert written[1]["fingerprint"] is None  # no V1: skipped, never fabricated
        call = worker.generate_fingerprint_v2.call_args
        assert call.kwargs["title"] == "Cairo Station" and call.kwargs["plot_summary"] == "A newspaper seller..."
        report = (tmp_path / "catalog.demo.enrichment-v2-report.md").read_text(encoding="utf-8")
        assert "enrichment-worker-v2-families-v1 / m | 1" in report and "mode: v2" in report

    def test_v2_and_placeholder_are_exclusive(self, tmp_path):
        fixture = tmp_path / "catalog.demo.json"
        fixture.write_text(json.dumps([_entry()]), encoding="utf-8")
        assert main(["--fixture", str(fixture), "--v2", "--placeholder"]) == 2


class TestV3Extraction:
    def test_needs_v3_is_independent_of_the_v2_block(self):
        from src.enrich_catalog import needs_v3_extraction
        from src.enrichment import V2_EXTRACTOR_VERSION, V3_EXTRACTOR_VERSION

        assert needs_v3_extraction(_entry()) is False  # no V1 fingerprint to attach to
        v1 = {"extractorVersion": EXTRACTOR_VERSION, "pacing": 0.4, "v2": {"extractorVersion": V2_EXTRACTOR_VERSION}}
        assert needs_v3_extraction(_entry(fingerprint=v1)) is True
        assert needs_v3_extraction(_entry(fingerprint={**v1, "v3": {"extractorVersion": V3_EXTRACTOR_VERSION}})) is False
        assert needs_v3_extraction(_entry(fingerprint={**v1, "v3": {"extractorVersion": "older"}})) is True

    def test_v3_run_attaches_the_block_without_touching_v1_or_v2(self, tmp_path, monkeypatch):
        fixture = tmp_path / "catalog.demo.json"
        v1 = {"extractorVersion": EXTRACTOR_VERSION, "pacing": 0.4, "v2": {"features": {"tone.irony": 0.8}, "extractorVersion": "enrichment-worker-v2-families-v1"}}
        fixture.write_text(json.dumps([_entry(fingerprint=dict(v1)), _entry(internalId="DEMO0002")]), encoding="utf-8")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
        worker = MagicMock()
        worker.generate_fingerprint_v3 = MagicMock(
            return_value={
                "schemaVersion": "film-fingerprint-v3",
                "features": {"style.scale": 0.7},
                "confidence": {"style.scale": 0.5},
                "extractorVersion": "enrichment-worker-v3-form-v1",
                "modelVersion": "m",
            }
        )
        monkeypatch.setattr("src.enrich_catalog.FilmEnrichmentWorker", lambda: worker)

        assert main(["--fixture", str(fixture), "--v3", "--concurrency", "1"]) == 0

        written = json.loads(fixture.read_text(encoding="utf-8"))
        assert written[0]["fingerprint"]["pacing"] == 0.4
        assert written[0]["fingerprint"]["v2"]["features"]["tone.irony"] == 0.8
        assert written[0]["fingerprint"]["v3"]["features"]["style.scale"] == 0.7
        assert written[1]["fingerprint"] is None
        assert worker.generate_fingerprint_v2.call_count == 0
        report = (tmp_path / "catalog.demo.enrichment-v3-report.md").read_text(encoding="utf-8")
        assert "enrichment-worker-v3-form-v1 / m | 1" in report and "mode: v3" in report
        assert "| `style.scale` | 0.50 |" in report  # per-feature confidence table for the block

    def test_v2_and_v3_are_one_block_per_run(self, tmp_path):
        fixture = tmp_path / "catalog.demo.json"
        fixture.write_text(json.dumps([_entry()]), encoding="utf-8")
        assert main(["--fixture", str(fixture), "--v2", "--v3"]) == 2
        assert main(["--fixture", str(fixture), "--v3", "--placeholder"]) == 2


class TestArabicEvidence:
    def _entry_ar(self, plot_len=500, **overrides):
        entry = _entry(**overrides)
        entry["evidence"] = {**entry["evidence"], "plotSummary": "x" * plot_len, "plotSummaryAr": "قصة الفيلم بالعربية", "plotSourceAr": "wikipedia:ar:باب الحديد (فيلم)"}
        return entry

    def test_appends_the_arabic_plot_only_when_the_english_plot_is_short(self):
        from src.enrich_catalog import PLOT_SHORT_CHARS, build_evidence, uses_arabic_evidence

        short = build_evidence(self._entry_ar(500))
        assert uses_arabic_evidence(self._entry_ar(500)) is True
        assert short["plot_summary"].startswith("x" * 500) and "قصة الفيلم بالعربية" in short["plot_summary"]
        assert "[Plot section of the Arabic Wikipedia article]" in short["plot_summary"]
        assert short["source_ids"][-1] == "wikipedia:ar:باب الحديد (فيلم)" and short["uses_arabic_evidence"] is True
        assert "second evidence for the same film" in short["additional_context"]

        long = build_evidence(self._entry_ar(PLOT_SHORT_CHARS))
        assert "قصة" not in long["plot_summary"] and long["uses_arabic_evidence"] is False
        assert "wikipedia:ar" not in " ".join(long["source_ids"])
        # No Arabic plot in the fixture: nothing changes, nothing is invented.
        assert build_evidence(_entry())["uses_arabic_evidence"] is False

    def test_selection_and_version_stamp(self):
        from src.enrich_catalog import AR_EVIDENCE_SUFFIX, needs_arabic_evidence_extraction, stamp_arabic_evidence

        v1 = {"extractorVersion": EXTRACTOR_VERSION, "pacing": 0.4}
        assert needs_arabic_evidence_extraction(self._entry_ar(500)) is False  # no fingerprint yet: the normal run makes it
        assert needs_arabic_evidence_extraction(self._entry_ar(500, fingerprint=dict(v1))) is True
        assert needs_arabic_evidence_extraction(self._entry_ar(500, fingerprint={**v1, "extractorVersion": EXTRACTOR_VERSION + AR_EVIDENCE_SUFFIX})) is False
        assert needs_arabic_evidence_extraction(self._entry_ar(3000, fingerprint=dict(v1))) is False  # long English plot: no change of evidence
        stamped = stamp_arabic_evidence({"extractorVersion": EXTRACTOR_VERSION})
        assert stamped["extractorVersion"] == EXTRACTOR_VERSION + AR_EVIDENCE_SUFFIX
        assert stamp_arabic_evidence(stamped)["extractorVersion"] == EXTRACTOR_VERSION + AR_EVIDENCE_SUFFIX  # idempotent

    def test_re_extraction_replaces_v1_keeps_the_nested_blocks_and_stamps_the_version(self, tmp_path, monkeypatch):
        fixture = tmp_path / "catalog.demo.json"
        v1 = {"extractorVersion": EXTRACTOR_VERSION, "pacing": 0.4, "confidence": {"pacing": 0.3}, "v2": {"features": {"tone.irony": 0.8}}, "v3": {"features": {"style.scale": 0.2}}}
        entries = [self._entry_ar(500, fingerprint=dict(v1)), self._entry_ar(2500, internalId="DEMO0002", fingerprint=dict(v1))]
        fixture.write_text(json.dumps(entries), encoding="utf-8")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
        fake = FilmFingerprintV1(**{dimension: 0.5 for dimension in DIMENSIONS})
        fake.pacing = 0.7
        fake.extractorVersion = EXTRACTOR_VERSION
        fake.generatedBy = "anthropic"
        worker = MagicMock()
        worker.generate_fingerprint = MagicMock(return_value=fake)
        monkeypatch.setattr("src.enrich_catalog.FilmEnrichmentWorker", lambda: worker)

        assert main(["--fixture", str(fixture), "--ar-evidence", "--concurrency", "1", "--partial-ids", ""]) == 0

        written = json.loads(fixture.read_text(encoding="utf-8"))
        first = written[0]["fingerprint"]
        assert first["pacing"] == 0.7 and first["generatedBy"] == "anthropic"
        assert first["extractorVersion"] == EXTRACTOR_VERSION + "+ar-evidence"
        assert first["v2"] == {"features": {"tone.irony": 0.8}} and first["v3"] == {"features": {"style.scale": 0.2}}
        assert written[1]["fingerprint"]["pacing"] == 0.4  # long English plot: untouched
        assert worker.generate_fingerprint.call_count == 1
        call = worker.generate_fingerprint.call_args
        assert "قصة الفيلم بالعربية" in call.kwargs["plot_summary"] and "wikipedia:ar:باب الحديد (فيلم)" in call.kwargs["source_ids"]
        report = (tmp_path / "catalog.demo.enrichment-ar-evidence-report.md").read_text(encoding="utf-8")
        assert "mode: ar-evidence" in report and "+ar-evidence | 1" in report
        assert main(["--fixture", str(fixture), "--ar-evidence", "--v2"]) == 2


class TestMainPlaceholderRun:
    def test_fills_placeholders_writes_the_fixture_and_the_report(self, tmp_path):
        fixture = tmp_path / "catalog.demo.json"
        entries = [_entry(), _entry(internalId="DEMO0002", titleEn="Other"), _entry(internalId="DEMO0003", fingerprint={"extractorVersion": EXTRACTOR_VERSION, "pacing": 0.1})]
        fixture.write_text(json.dumps(entries), encoding="utf-8")

        exit_code = main(["--fixture", str(fixture), "--placeholder", "--partial-ids", "DEMO0002"])

        assert exit_code == 0
        written = json.loads(fixture.read_text(encoding="utf-8"))
        assert written[0]["fingerprint"]["extractorVersion"] == PLACEHOLDER_VERSION
        assert written[1]["fingerprint"]["extractorVersion"] == f"{PLACEHOLDER_VERSION}+partial"
        assert "soundscapeComplexity" not in written[1]["fingerprint"]
        # The already-current entry is left exactly as it was.
        assert written[2]["fingerprint"] == {"extractorVersion": EXTRACTOR_VERSION, "pacing": 0.1}
        report = (tmp_path / "catalog.demo.enrichment-report.md").read_text(encoding="utf-8")
        assert "extracted this run: 2" in report and "skipped (already current): 1" in report

    def test_dry_run_changes_nothing(self, tmp_path, capsys):
        fixture = tmp_path / "catalog.demo.json"
        fixture.write_text(json.dumps([_entry()]), encoding="utf-8")
        before = fixture.read_text(encoding="utf-8")

        assert main(["--fixture", str(fixture), "--dry-run"]) == 0

        assert fixture.read_text(encoding="utf-8") == before
        assert "DEMO0001 Cairo Station" in capsys.readouterr().out

    def test_a_failing_extraction_is_reported_not_fabricated(self, tmp_path, monkeypatch):
        fixture = tmp_path / "catalog.demo.json"
        fixture.write_text(json.dumps([_entry()]), encoding="utf-8")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

        failing = MagicMock()
        failing.generate_fingerprint = MagicMock(side_effect=ValueError("The model refused to fingerprint this film: x"))
        monkeypatch.setattr("src.enrich_catalog.FilmEnrichmentWorker", lambda: failing)

        exit_code = main(["--fixture", str(fixture), "--concurrency", "1"])

        assert exit_code == 1
        written = json.loads(fixture.read_text(encoding="utf-8"))
        assert written[0]["fingerprint"] is None
        report = (tmp_path / "catalog.demo.enrichment-report.md").read_text(encoding="utf-8")
        assert "refused" in report and "Refusals among them: 1" in report


@pytest.mark.parametrize("dimension", DIMENSIONS)
def test_every_dimension_has_a_centroid_value_for_every_genre(dimension):
    from src.enrich_catalog import GENRE_CENTROIDS

    index = DIMENSIONS.index(dimension)
    for values in GENRE_CENTROIDS.values():
        assert len(values) == len(DIMENSIONS)
        assert 0.0 <= values[index] <= 1.0
