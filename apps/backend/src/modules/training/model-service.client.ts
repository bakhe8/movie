import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Mirror of services/workers/src/model_service.py's Job -- keep both in sync
// by hand (the same rule as every other cross-language shape in this repo).
export type ModelServiceJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface ModelServiceJobResult {
  modelVersion: string;
  trainingTriadCount: number;
  heldOutTriadCount: number;
  heldOutNll: number | null;
  heldOutPairwiseAccuracy: number | null;
  trainingGenreDiversity: number | null;
  trainingLanguageDiversity: number | null;
  trainingDirectorDiversity: number | null;
  chosenRegularization: number;
}

export interface ModelServiceJob {
  id: string;
  profileId: string;
  status: ModelServiceJobStatus;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorKind: 'invalid' | 'error' | null;
  error: string | null;
  result: ModelServiceJobResult | null;
}

export class ModelServiceError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'ModelServiceError';
  }
}

// The backend's only channel to the Python model service (ADR-25): plain
// HTTP with a shared bearer token, no queue. `enabled` is false when
// MODEL_SERVICE_URL is unset -- training then stays the manual CLI and the
// automatic trigger is a no-op, which is what every e2e suite that isn't
// about training relies on.
@Injectable()
export class ModelServiceClient {
  private readonly logger = new Logger(ModelServiceClient.name);
  private readonly baseUrl: string | null;
  private readonly token: string | null;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    const url = config.get<string>('MODEL_SERVICE_URL')?.trim();
    this.baseUrl = url ? url.replace(/\/+$/, '') : null;
    this.token = config.get<string>('MODEL_SERVICE_TOKEN')?.trim() || null;
    this.timeoutMs = Number(config.get<string>('MODEL_SERVICE_TIMEOUT_MS') ?? 5000);
    if (!this.baseUrl) {
      this.logger.warn('MODEL_SERVICE_URL is not set: automatic training is disabled (manual CLI only)');
    }
  }

  get enabled(): boolean {
    return this.baseUrl !== null;
  }

  async requestTraining(profileId: string): Promise<ModelServiceJob> {
    return this.call<ModelServiceJob>('POST', '/train', { profileId });
  }

  async getJob(jobId: string): Promise<ModelServiceJob | null> {
    try {
      return await this.call<ModelServiceJob>('GET', `/train/${encodeURIComponent(jobId)}`);
    } catch (error) {
      if (error instanceof ModelServiceError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async getLatestJob(profileId: string): Promise<ModelServiceJob | null> {
    const body = await this.call<{ job: ModelServiceJob | null }>(
      'GET',
      `/train?profileId=${encodeURIComponent(profileId)}`,
    );
    return body.job;
  }

  // Readiness (ADR-100, remediation brief P0-02): a live reachability check,
  // not a status poll -- true only on an actual 200 from /health, false for
  // "not configured" and for any network failure, never thrown.
  async reachable(): Promise<boolean> {
    if (!this.baseUrl) {
      return false;
    }
    try {
      await this.call<{ status: string }>('GET', '/health');
      return true;
    } catch {
      return false;
    }
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (!this.baseUrl) {
      throw new ModelServiceError('Model service is not configured (MODEL_SERVICE_URL)', null);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }
      if (this.token) {
        headers.Authorization = `Bearer ${this.token}`;
      }
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ModelServiceError(`Model service answered ${response.status} for ${method} ${path}`, response.status);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ModelServiceError) {
        throw error;
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new ModelServiceError(`Model service unreachable for ${method} ${path}: ${reason}`, null);
    } finally {
      clearTimeout(timer);
    }
  }
}
