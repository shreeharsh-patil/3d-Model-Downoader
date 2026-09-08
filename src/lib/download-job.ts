import type { DownloadJob, DownloadJobStatus, WebsiteId } from './types';

const TERMINAL = new Set<DownloadJobStatus>(['completed', 'cancelled', 'error']);

export class DownloadJobController {
  private sequence = 0;
  private job: DownloadJob | null = null;

  get current(): DownloadJob | null {
    return this.job;
  }

  begin(provider: WebsiteId, modelKey: string, generation: number, sourceUrl?: string): DownloadJob | null {
    if (this.job && !TERMINAL.has(this.job.status)) return null;
    this.sequence += 1;
    this.job = {
      id: `${provider}-${Date.now()}-${this.sequence}`,
      provider,
      modelKey,
      generation,
      sourceUrl,
      startedAt: Date.now(),
      status: 'queued',
    };
    return this.job;
  }

  isCurrent(job: DownloadJob, modelKey?: string, generation?: number): boolean {
    return this.job?.id === job.id &&
      !TERMINAL.has(job.status) &&
      (modelKey === undefined || job.modelKey === modelKey) &&
      (generation === undefined || job.generation === generation);
  }

  transition(job: DownloadJob, status: DownloadJobStatus, error?: string): boolean {
    if (this.job?.id !== job.id || TERMINAL.has(job.status)) return false;
    job.status = status;
    job.error = error;
    return true;
  }

  cancel(reason = 'Model selection changed.'): void {
    if (this.job && !TERMINAL.has(this.job.status)) {
      this.job.status = 'cancelled';
      this.job.error = reason;
    }
  }

  reset(): void {
    this.cancel();
    this.job = null;
  }
}
