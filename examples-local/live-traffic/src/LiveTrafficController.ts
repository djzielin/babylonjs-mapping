type TrafficSourceStatus = {
  errors?: Record<string, string>;
  sources?: Record<string, string>;
};

export type TrafficResponse<T> = {
  ok: boolean;
  status: number;
  json(): Promise<T>;
};

type LiveTrafficOptions<T> = {
  sample: T;
  fetch(signal: AbortSignal): Promise<TrafficResponse<T>>;
  draw(snapshot: T): void;
  setStatus(status: string): void;
};

/** Keeps the focused demo's rendered data and status in the selected mode. */
export class LiveTrafficController<T extends TrafficSourceStatus> {
  private mode: 'sample' | 'live' = 'sample';
  private generation = 0;
  private pendingRequest?: AbortController;

  constructor(private readonly options: LiveTrafficOptions<T>) {}

  showSample(): void {
    this.mode = 'sample';
    this.invalidateRequest();
    this.options.draw(this.options.sample);
    this.options.setStatus('Sample data');
  }

  async showLive(): Promise<void> {
    this.mode = 'live';
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.mode !== 'live') return;
    this.invalidateRequest();
    const generation = this.generation;
    const request = new AbortController();
    this.pendingRequest = request;
    // Aborting alone cannot invalidate work already waiting on a response body.
    const isCurrent = () => this.mode === 'live' && generation === this.generation;
    this.options.setStatus('Loading live data…');
    try {
      const response = await this.options.fetch(request.signal);
      if (!isCurrent()) return;
      if (!response.ok) throw new Error(`Demo server returned ${response.status}`);
      const data = await response.json();
      if (!isCurrent()) return;
      this.options.draw(data);
      const failures = Object.values(data.errors ?? {});
      this.options.setStatus(failures.length ? failures.join(' · ') : data.sources?.ships === 'AISStream key required' ? 'Live · AIS key needed for ships' : 'Live data');
    } catch (error) {
      if (!isCurrent()) return;
      this.options.setStatus(`Live feed unavailable: ${String(error)}`);
    } finally {
      if (isCurrent()) this.pendingRequest = undefined;
    }
  }

  private invalidateRequest(): void {
    this.generation++;
    this.pendingRequest?.abort();
    this.pendingRequest = undefined;
  }
}
