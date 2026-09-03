import uuid
from types import SimpleNamespace

import numpy as np
from fastapi.testclient import TestClient

from src.model_service import JOB_HISTORY_LIMIT, JobStore, create_app, summarize
from src.training import MODEL_VERSION, TrainingResult


def _result(triads=7):
    return TrainingResult(
        weights=np.zeros(28),
        bias_terms={},
        training_triad_count=triads,
        pairwise_accuracy=0.9,
        held_out_triad_count=1,
        held_out_nll=0.8,
        held_out_pairwise_accuracy=0.75,
        standard_errors=None,
        training_genre_diversity=4,
        training_language_diversity=2,
        training_director_diversity=3,
        chosen_regularization=0.03,
    )


def _client(trainer, token=None):
    app = create_app(trainer=trainer, token=token, start_worker=False)
    client = TestClient(app)
    return client, app.state.store


def test_summary_carries_metrics_but_never_weights():
    summary = summarize(_result())
    assert summary["modelVersion"] == MODEL_VERSION
    assert summary["trainingTriadCount"] == 7
    assert summary["heldOutPairwiseAccuracy"] == 0.75
    assert summary["chosenRegularization"] == 0.03
    assert "weights" not in summary


def test_train_is_accepted_then_runs_to_success():
    trained = []

    def trainer(profile_id):
        trained.append(profile_id)
        return _result()

    client, store = _client(trainer)
    profile_id = str(uuid.uuid4())

    accepted = client.post("/train", json={"profileId": profile_id})
    assert accepted.status_code == 202
    job = accepted.json()
    assert job["status"] == "queued"
    assert job["profileId"] == profile_id

    assert client.get(f"/train/{job['id']}").json()["status"] == "queued"
    assert store.run_next() is not None
    assert trained == [profile_id]

    finished = client.get(f"/train/{job['id']}").json()
    assert finished["status"] == "succeeded"
    assert finished["result"]["trainingTriadCount"] == 7
    assert finished["finishedAt"] is not None

    latest = client.get("/train", params={"profileId": profile_id}).json()["job"]
    assert latest["id"] == job["id"]


def test_second_request_while_queued_returns_the_same_job():
    client, store = _client(lambda _profile_id: _result())
    profile_id = str(uuid.uuid4())
    first = client.post("/train", json={"profileId": profile_id})
    second = client.post("/train", json={"profileId": profile_id})
    assert first.status_code == 202
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert store.pending() == 1


def test_request_while_running_queues_one_more_run():
    store = JobStore(trainer=lambda _profile_id: _result())
    profile_id = str(uuid.uuid4())
    first, _ = store.request(profile_id)
    # Simulate the worker having picked the first job up.
    store.run_next()
    assert first.status == "succeeded"
    second, created = store.request(profile_id)
    assert created and second.id != first.id
    assert store.latest_for_profile(profile_id).id == second.id


def test_a_value_error_from_the_trainer_is_an_invalid_job_not_a_crash():
    def trainer(_profile_id):
        raise ValueError("No completed triads exist for this profile")

    client, store = _client(trainer)
    job_id = client.post("/train", json={"profileId": str(uuid.uuid4())}).json()["id"]
    store.run_next()
    job = client.get(f"/train/{job_id}").json()
    assert job["status"] == "failed"
    assert job["errorKind"] == "invalid"
    assert "No completed triads" in job["error"]


def test_any_other_exception_is_recorded_as_an_error():
    def trainer(_profile_id):
        raise RuntimeError("database unreachable")

    client, store = _client(trainer)
    job_id = client.post("/train", json={"profileId": str(uuid.uuid4())}).json()["id"]
    store.run_next()
    job = client.get(f"/train/{job_id}").json()
    assert job["status"] == "failed"
    assert job["errorKind"] == "error"
    assert job["error"] == "RuntimeError: database unreachable"


def test_unknown_job_and_unknown_profile():
    client, _ = _client(lambda _profile_id: _result())
    assert client.get(f"/train/{uuid.uuid4()}").status_code == 404
    assert client.get("/train", params={"profileId": str(uuid.uuid4())}).json() == {"job": None}
    assert client.post("/train", json={"profileId": "not-a-uuid"}).status_code == 422


def test_token_guards_every_route_except_health():
    client, _ = _client(lambda _profile_id: _result(), token="s3cret")
    profile_id = str(uuid.uuid4())
    assert client.get("/health").status_code == 200
    assert client.post("/train", json={"profileId": profile_id}).status_code == 401
    assert client.get("/train", params={"profileId": profile_id}).status_code == 401
    ok = client.post("/train", json={"profileId": profile_id}, headers={"Authorization": "Bearer s3cret"})
    assert ok.status_code == 202
    assert client.get(f"/train/{ok.json()['id']}", headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_history_is_pruned_but_never_drops_unfinished_jobs():
    store = JobStore(trainer=lambda _profile_id: _result())
    for _ in range(JOB_HISTORY_LIMIT + 5):
        job, _ = store.request(str(uuid.uuid4()))
        store.run_next()
    assert len(store._jobs) == JOB_HISTORY_LIMIT
    queued, _ = store.request(str(uuid.uuid4()))
    assert store.get(queued.id) is not None


def test_health_reports_pending_count():
    client, _ = _client(lambda _profile_id: _result())
    client.post("/train", json={"profileId": str(uuid.uuid4())})
    body = client.get("/health").json()
    assert body == {"status": "ok", "modelVersion": MODEL_VERSION, "pending": 1}


def test_run_next_is_a_noop_when_idle():
    store = JobStore(trainer=lambda _profile_id: SimpleNamespace())
    assert store.run_next() is None
