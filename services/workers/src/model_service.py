"""
HTTP front for the trainer (ADR-25, blueprint §12.1-§12.2; ALPHA_PLAN §2 phase 1).

The backend never runs Python itself. It asks this service to train a
profile (`POST /train`), gets a job id back at once (202), and reads the
job's state later (`GET /train/{jobId}` or `GET /train?profileId=`). The
work is `training.train_profile()` unchanged -- this module adds only the
queue, the job ledger and the transport, nothing to the model.

Design limits, all deliberate for Alpha (revisit triggers: BP §12.3):

- One worker thread, so trainings run one after another. Training is
  seconds per profile today; serialising them avoids two BFGS fits
  contending for the same database at once. A real queue (Redis/BullMQ,
  ADR-10/ADR-25) arrives only when §12.3's triggers fire.
- The job ledger is in memory. A restart forgets queued jobs; the backend
  treats an unknown job as "idle" and asks again on the next threshold, so
  nothing is lost for good, only delayed to the next completed triad.
- At most one *queued* job per profile: a second request while one is
  waiting returns the waiting job (idempotent). A request while a job is
  *running* queues one more, so the triads ranked during that run are not
  missed.
- Authentication is a shared bearer token (`MODEL_SERVICE_TOKEN`). When the
  variable is empty the service accepts everything -- acceptable only while
  it binds to 127.0.0.1, which is the default (`MODEL_SERVICE_HOST`).
"""

from __future__ import annotations

import hmac
import logging
import os
import threading
import uuid
from collections import deque
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Deque, Dict, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from .training import MODEL_VERSION, TrainingResult, train_profile

logger = logging.getLogger("model_service")

Trainer = Callable[[str], TrainingResult]

# Finished jobs kept for status polling before the oldest are dropped.
JOB_HISTORY_LIMIT = 1000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Job:
    id: str
    profileId: str
    status: str  # queued | running | succeeded | failed
    requestedAt: str
    startedAt: Optional[str] = None
    finishedAt: Optional[str] = None
    # 'invalid' = the profile has nothing trainable yet (a ValueError from the
    # trainer: no completed triads, or none with complete fingerprints);
    # 'error' = anything else (database down, a bug). The backend surfaces
    # the first as a product state and the second as a failure.
    errorKind: Optional[str] = None
    error: Optional[str] = None
    result: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def summarize(result: TrainingResult) -> Dict[str, Any]:
    """The subset of TrainingResult the backend and the UI need; no weights."""
    return {
        "modelVersion": MODEL_VERSION,
        "trainingTriadCount": result.training_triad_count,
        "heldOutTriadCount": result.held_out_triad_count,
        "heldOutNll": result.held_out_nll,
        "heldOutPairwiseAccuracy": result.held_out_pairwise_accuracy,
        "trainingGenreDiversity": result.training_genre_diversity,
        "trainingLanguageDiversity": result.training_language_diversity,
        "trainingDirectorDiversity": result.training_director_diversity,
        "chosenRegularization": result.chosen_regularization,
    }


class JobStore:
    """Thread-safe ledger plus FIFO queue. `run_next()` is the worker's unit of work."""

    def __init__(self, trainer: Trainer = train_profile) -> None:
        self._trainer = trainer
        self._lock = threading.Lock()
        self._jobs: Dict[str, Job] = {}
        self._order: Deque[str] = deque()
        self._queue: Deque[str] = deque()
        self._latest_by_profile: Dict[str, str] = {}
        self._wakeup = threading.Event()

    def request(self, profile_id: str) -> tuple[Job, bool]:
        """Return (job, created). A queued job for the same profile is reused."""
        with self._lock:
            latest_id = self._latest_by_profile.get(profile_id)
            if latest_id is not None:
                latest = self._jobs[latest_id]
                if latest.status == "queued":
                    return latest, False
            job = Job(id=str(uuid.uuid4()), profileId=profile_id, status="queued", requestedAt=_now())
            self._jobs[job.id] = job
            self._order.append(job.id)
            self._queue.append(job.id)
            self._latest_by_profile[profile_id] = job.id
            self._prune_locked()
            self._wakeup.set()
            return job, True

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def latest_for_profile(self, profile_id: str) -> Optional[Job]:
        with self._lock:
            job_id = self._latest_by_profile.get(profile_id)
            return self._jobs.get(job_id) if job_id else None

    def pending(self) -> int:
        with self._lock:
            return len(self._queue)

    def run_next(self) -> Optional[Job]:
        """Run one queued job to completion on the calling thread. None when idle."""
        with self._lock:
            if not self._queue:
                return None
            job = self._jobs[self._queue.popleft()]
            job.status = "running"
            job.startedAt = _now()
        try:
            result = self._trainer(job.profileId)
        except ValueError as error:
            self._finish(job, "failed", errorKind="invalid", error=str(error))
        except Exception as error:  # noqa: BLE001 -- the ledger must record any failure
            logger.exception("training failed for profile %s", job.profileId)
            self._finish(job, "failed", errorKind="error", error=f"{type(error).__name__}: {error}")
        else:
            self._finish(job, "succeeded", result=summarize(result))
        return job

    def wait(self, timeout: float) -> None:
        """Block until a job is requested or `timeout` seconds pass."""
        self._wakeup.wait(timeout)
        self._wakeup.clear()

    def _finish(self, job: Job, final_status: str, **fields: Any) -> None:
        with self._lock:
            job.status = final_status
            job.finishedAt = _now()
            for name, value in fields.items():
                setattr(job, name, value)

    def _prune_locked(self) -> None:
        while len(self._order) > JOB_HISTORY_LIMIT:
            oldest_id = self._order[0]
            oldest = self._jobs[oldest_id]
            if oldest.status in ("queued", "running"):
                break
            self._order.popleft()
            del self._jobs[oldest_id]
            if self._latest_by_profile.get(oldest.profileId) == oldest_id:
                del self._latest_by_profile[oldest.profileId]


def run_worker(store: JobStore, stop: threading.Event) -> None:
    while not stop.is_set():
        if store.run_next() is None:
            store.wait(timeout=1.0)


class TrainRequest(BaseModel):
    profileId: uuid.UUID = Field(description="Profile whose completed triads are fitted")


def create_app(trainer: Trainer = train_profile, token: Optional[str] = None, start_worker: bool = True) -> FastAPI:
    """
    Build the service. Tests pass a fake `trainer` and `start_worker=False`,
    then drive `app.state.store.run_next()` by hand instead of racing a thread.
    """
    store = JobStore(trainer)
    stop = threading.Event()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if start_worker:
            threading.Thread(target=run_worker, args=(store, stop), name="training-worker", daemon=True).start()
        yield
        stop.set()

    app = FastAPI(title="movie model service", version="1", lifespan=lifespan)
    app.state.store = store

    def authorize(authorization: Optional[str] = Header(default=None)) -> None:
        if not token:
            return
        expected = f"Bearer {token}"
        if authorization is None or not hmac.compare_digest(authorization, expected):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing service token")

    @app.get("/health")
    def health() -> Dict[str, Any]:
        return {"status": "ok", "modelVersion": MODEL_VERSION, "pending": store.pending()}

    @app.post("/train", status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(authorize)])
    def request_training(body: TrainRequest, response: Response) -> Dict[str, Any]:
        job, created = store.request(str(body.profileId))
        if not created:
            response.status_code = status.HTTP_200_OK
        return job.to_dict()

    @app.get("/train", dependencies=[Depends(authorize)])
    def latest_job(profileId: uuid.UUID = Query(...)) -> Dict[str, Any]:
        job = store.latest_for_profile(str(profileId))
        # A profile with no job on record is a normal state, not an error --
        # the backend asks this on every status poll.
        return {"job": job.to_dict() if job else None}

    @app.get("/train/{job_id}", dependencies=[Depends(authorize)])
    def get_job(job_id: uuid.UUID) -> Dict[str, Any]:
        job = store.get(str(job_id))
        if job is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown job (the service may have restarted)")
        return job.to_dict()

    return app


def main() -> None:
    import uvicorn

    load_dotenv(Path(__file__).resolve().parents[3] / ".env", override=False)
    logging.basicConfig(level=logging.INFO)
    host = os.environ.get("MODEL_SERVICE_HOST", "127.0.0.1")
    port = int(os.environ.get("MODEL_SERVICE_PORT", "8001"))
    token = os.environ.get("MODEL_SERVICE_TOKEN") or None
    if not token and host not in ("127.0.0.1", "localhost"):
        raise RuntimeError("MODEL_SERVICE_TOKEN is required when MODEL_SERVICE_HOST is not loopback")
    uvicorn.run(create_app(token=token), host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
