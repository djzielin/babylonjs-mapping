import { describe, expect, it, vi } from 'vitest';
import { LiveTrafficController, type TrafficResponse } from '../examples-local/live-traffic/src/LiveTrafficController';

type Snapshot = { id: string; errors?: Record<string, string>; sources?: Record<string, string> };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function response(snapshot: Snapshot): TrafficResponse<Snapshot> {
  return { ok: true, status: 200, json: async () => snapshot };
}

function harness() {
  const requests: { signal: AbortSignal; result: ReturnType<typeof deferred<TrafficResponse<Snapshot>>> }[] = [];
  const draw = vi.fn();
  const setStatus = vi.fn();
  const controller = new LiveTrafficController<Snapshot>({
    sample: { id: 'sample' },
    fetch: signal => {
      const result = deferred<TrafficResponse<Snapshot>>();
      requests.push({ signal, result });
      // Deliberately ignore abort, as a response or JSON parse may already be queued.
      return result.promise;
    },
    draw,
    setStatus,
  });
  controller.showSample();
  return { controller, requests, draw, setStatus };
}

describe('focused live traffic request ownership', () => {
  it('does not fetch during Sample mode and renders the current Live response', async () => {
    const { controller, requests, draw, setStatus } = harness();
    await controller.refresh();
    expect(requests).toHaveLength(0);
    const loading = controller.showLive();
    expect(setStatus).toHaveBeenLastCalledWith('Loading live data…');
    requests[0].result.resolve(response({ id: 'live' }));
    await loading;
    expect(draw).toHaveBeenLastCalledWith({ id: 'live' });
    expect(setStatus).toHaveBeenLastCalledWith('Live data');
  });

  it.each(['success', 'failure'] as const)('ignores a delayed Live %s after switching to Sample', async outcome => {
    const { controller, requests, draw, setStatus } = harness();
    const loading = controller.showLive();
    controller.showSample();
    if (outcome === 'success') requests[0].result.resolve(response({ id: 'old-live' }));
    else requests[0].result.reject(new Error('Old request failed'));
    await loading;
    expect(draw).toHaveBeenLastCalledWith({ id: 'sample' });
    expect(setStatus).toHaveBeenLastCalledWith('Sample data');
    expect(requests[0].signal.aborted).toBe(true);
  });

  it.each(['success', 'failure'] as const)('ignores an earlier session %s after Live → Sample → Live', async outcome => {
    const { controller, requests, draw, setStatus } = harness();
    const oldLoading = controller.showLive();
    controller.showSample();
    const currentLoading = controller.showLive();
    requests[1].result.resolve(response({ id: 'current-live' }));
    await currentLoading;
    if (outcome === 'success') requests[0].result.resolve(response({ id: 'old-live' }));
    else requests[0].result.reject(new Error('Old request failed'));
    await oldLoading;
    expect(draw).toHaveBeenLastCalledWith({ id: 'current-live' });
    expect(setStatus).toHaveBeenLastCalledWith('Live data');
  });

  it('gives a repeated Live click ownership over an outstanding refresh', async () => {
    const { controller, requests, draw, setStatus } = harness();
    const oldLoading = controller.showLive();
    const currentLoading = controller.showLive();
    requests[0].result.resolve(response({ id: 'old-live' }));
    await oldLoading;
    expect(draw).toHaveBeenLastCalledWith({ id: 'sample' });
    expect(setStatus).toHaveBeenLastCalledWith('Loading live data…');
    expect(requests[0].signal.aborted).toBe(true);
    requests[1].result.resolve(response({ id: 'current-live' }));
    await currentLoading;
    expect(draw).toHaveBeenLastCalledWith({ id: 'current-live' });
  });

  it.each(['success', 'failure'] as const)('ignores a delayed older refresh %s after the latest refresh succeeds', async outcome => {
    const { controller, requests, draw, setStatus } = harness();
    const oldLoading = controller.showLive();
    const currentLoading = controller.refresh();
    requests[1].result.resolve(response({ id: 'newest-live' }));
    await currentLoading;
    if (outcome === 'success') requests[0].result.resolve(response({ id: 'old-live' }));
    else requests[0].result.reject(new Error('Old request failed'));
    await oldLoading;
    expect(draw).toHaveBeenLastCalledWith({ id: 'newest-live' });
    expect(setStatus).toHaveBeenLastCalledWith('Live data');
  });

  it('does not replace the latest failure with an older success', async () => {
    const { controller, requests, draw, setStatus } = harness();
    const oldLoading = controller.showLive();
    const currentLoading = controller.refresh();
    requests[1].result.resolve({ ok: false, status: 503, json: vi.fn() });
    await currentLoading;
    requests[0].result.resolve(response({ id: 'old-live' }));
    await oldLoading;
    expect(draw).toHaveBeenLastCalledWith({ id: 'sample' });
    expect(setStatus).toHaveBeenLastCalledWith('Live feed unavailable: Error: Demo server returned 503');
  });

  it.each(['success', 'failure'] as const)('ignores delayed JSON %s after the next Live session has loaded', async outcome => {
    const { controller, requests, draw, setStatus } = harness();
    const oldJson = deferred<Snapshot>();
    const jsonStarted = deferred<void>();
    const oldLoading = controller.showLive();
    requests[0].result.resolve({ ok: true, status: 200, json: () => {
      jsonStarted.resolve();
      return oldJson.promise;
    } });
    await jsonStarted.promise;
    controller.showSample();
    const currentLoading = controller.showLive();
    requests[1].result.resolve(response({ id: 'newest-live' }));
    await currentLoading;
    if (outcome === 'success') oldJson.resolve({ id: 'old-live' });
    else oldJson.reject(new Error('Old JSON failed'));
    await oldLoading;
    expect(draw).toHaveBeenLastCalledWith({ id: 'newest-live' });
    expect(setStatus).toHaveBeenLastCalledWith('Live data');
  });

  it('does not parse an outdated response body', async () => {
    const { controller, requests } = harness();
    const oldLoading = controller.showLive();
    controller.showSample();
    const json = vi.fn(async () => ({ id: 'old-live' }));
    requests[0].result.resolve({ ok: true, status: 200, json });
    await oldLoading;
    expect(json).not.toHaveBeenCalled();
  });

  it('reports current source errors and missing ship credentials honestly', async () => {
    const { controller, requests, draw, setStatus } = harness();
    const loading = controller.showLive();
    requests[0].result.resolve(response({ id: 'partial-live', errors: { ships: 'AIS connection failed' } }));
    await loading;
    expect(draw).toHaveBeenLastCalledWith({ id: 'partial-live', errors: { ships: 'AIS connection failed' } });
    expect(setStatus).toHaveBeenLastCalledWith('AIS connection failed');
    const refresh = controller.refresh();
    requests[1].result.resolve(response({ id: 'no-ships', sources: { ships: 'AISStream key required' } }));
    await refresh;
    expect(setStatus).toHaveBeenLastCalledWith('Live · AIS key needed for ships');
  });
});
