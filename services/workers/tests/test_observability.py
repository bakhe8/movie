import sentry_sdk

from src import observability
from src.observability import capture_exception, init_observability, scrub_text, scrub_value


def teardown_function(_fn):
    # Every test that starts Sentry must leave the SDK closed so the next
    # test (in this file or the suite) does not report through a stale
    # transport pointed at a fake DSN.
    sentry_sdk.get_global_scope().set_client(None)
    observability._sentry_started = False


def test_off_when_dsn_unset():
    assert init_observability({}) is False
    capture_exception(ValueError("boom"))  # must not raise with nothing started


def test_starts_with_a_dsn():
    started = init_observability({"SENTRY_DSN": "https://key@o0.ingest.sentry.io/0"})
    assert started is True
    assert sentry_sdk.get_client().is_active()


def test_capture_exception_reports_through_the_started_client():
    init_observability({"SENTRY_DSN": "https://key@o0.ingest.sentry.io/0"})
    client = sentry_sdk.get_client()
    events = []
    client.transport.capture_envelope = lambda envelope: events.append(envelope)

    try:
        raise RuntimeError("training failed")
    except RuntimeError as error:
        capture_exception(error, tags={"jobId": "job-1"})

    assert len(events) == 1
    event = events[0].get_event()
    assert event["tags"]["jobId"] == "job-1"
    assert event["exception"]["values"][0]["value"] == "training failed"


def test_scrub_text_redacts_email_and_bearer_token():
    assert scrub_text("failed for person@example.com") == "failed for [redacted-email]"
    assert scrub_text("Authorization: Bearer abc.def.ghi") == "Authorization: [redacted-token]"


def test_scrub_value_redacts_sensitive_keys_without_scanning_their_shape():
    scrubbed = scrub_value({"tasteFingerprint": [0.1, 0.2], "jobId": "job-1"})
    assert scrubbed == {"tasteFingerprint": "[redacted]", "jobId": "job-1"}
