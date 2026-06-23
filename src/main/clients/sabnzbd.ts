import type { DownloadItem } from '../../shared/types.js';

export class SabnzbdClient {
  private url: string;
  private apiKey: string;
  private fetchFn: typeof fetch;

  constructor(url: string, apiKey: string, fetchFn: typeof fetch) {
    this.url = url.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.fetchFn = fetchFn;
  }

  private endpoint(mode: string, extra: Record<string, string> = {}): string {
    const p = new URLSearchParams({ apikey: this.apiKey, output: 'json', mode, ...extra });
    return `${this.url}/api?${p}`;
  }

  private async call<T>(mode: string, extra: Record<string, string> = {}): Promise<T> {
    const res = await this.fetchFn(this.endpoint(mode, extra), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`SABnzbd ${mode}: ${res.status}`);
    return res.json() as Promise<T>;
  }

  async ping(): Promise<boolean> {
    try {
      await this.call<{ version: string }>('version');
      return true;
    } catch {
      return false;
    }
  }

  async getQueue(): Promise<DownloadItem[]> {
    const data = await this.call<SabQueue>('queue', { start: '0', limit: '50' });
    const slots = data.queue?.slots ?? [];
    return slots.map(s => ({
      id: `sab-${s.nzo_id}`,
      source: 'sabnzbd' as const,
      name: s.filename,
      status: s.status,
      sizeBytes: parseSize(s.mb) * 1024 * 1024,
      sizeLeftBytes: parseSize(s.mbleft) * 1024 * 1024,
      speed: 0,
      eta: s.eta ?? '',
      progress: Number(s.percentage ?? 0),
      category: s.cat,
    }));
  }

  async getFullStatus(): Promise<SabFullStatus> {
    const data = await this.call<SabQueue>('queue', { start: '0', limit: '50' });
    const q = data.queue ?? {};
    return {
      status: String(q.status ?? 'Idle'),
      paused: Boolean(q.paused ?? q.paused_all),
      speedLimit: String(q.speedlimit ?? '0'),
      speed: String(q.speed ?? '0'),
      speedMb: parseSize(q.speed),
      sizeLeft: String(q.sizeleft ?? '0 B'),
      slots: (q.slots ?? []).map(s => ({
        id: `sab-${s.nzo_id}`,
        source: 'sabnzbd' as const,
        name: s.filename,
        status: s.status,
        sizeBytes: parseSize(s.mb) * 1024 * 1024,
        sizeLeftBytes: parseSize(s.mbleft) * 1024 * 1024,
        speed: 0,
        eta: s.eta ?? '',
        progress: Number(s.percentage ?? 0),
        category: s.cat,
      })),
    };
  }

  async pauseItem(nzoId: string): Promise<void> {
    await this.call('queue', { name: 'pause', value: nzoId });
  }

  async resumeItem(nzoId: string): Promise<void> {
    await this.call('queue', { name: 'resume', value: nzoId });
  }

  async pauseAll(): Promise<void> {
    await this.call('pause');
  }

  async resumeAll(): Promise<void> {
    await this.call('resume');
  }

  async deleteItem(nzoId: string, deleteFiles = true): Promise<void> {
    await this.call('queue', { name: 'delete', value: nzoId, del_files: deleteFiles ? '1' : '0' });
  }

  async getVersion(): Promise<string> {
    try {
      const data = await this.call<{ version: string }>('version');
      return data.version;
    } catch { return 'unknown'; }
  }

  async getHistory(limit = 20): Promise<SabHistoryItem[]> {
    const data = await this.call<{ history?: { slots?: SabHistorySlot[] } }>('history', { start: '0', limit: String(limit) });
    return (data.history?.slots ?? []).map(s => ({
      id: s.nzo_id ?? s.id ?? s.name,
      name: s.name,
      status: s.status,
      category: s.category ?? s.cat,
      size: s.size,
      completed: s.completed,
      failMessage: s.fail_message,
    }));
  }

  async getDiskSpace(): Promise<{ path: string; freeSpace: number; totalSpace: number }[]> {
    try {
      const data = await this.call<Record<string, string>>('diskspace');
      const gb = (v: string) => parseFloat(v || '0') * 1024 * 1024 * 1024;
      const results: { path: string; freeSpace: number; totalSpace: number }[] = [];
      if (data.diskspace1 != null) {
        results.push({ path: 'SABnzbd downloads', freeSpace: gb(data.diskspace1), totalSpace: gb(data.diskspace_total1 ?? '0') });
      }
      if (data.diskspace2 != null && data.diskspace2 !== data.diskspace1) {
        results.push({ path: 'SABnzbd complete', freeSpace: gb(data.diskspace2), totalSpace: gb(data.diskspace_total2 ?? '0') });
      }
      return results;
    } catch { return []; }
  }
}

function parseSize(val: unknown): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const n = parseFloat(val);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

interface SabSlot {
  nzo_id: string;
  filename: string;
  status: string;
  mb: string;
  mbleft: string;
  percentage?: string;
  eta?: string;
  cat?: string;
}

interface SabQueue {
  queue?: {
    paused?: boolean;
    paused_all?: boolean;
    status?: string;
    speed?: string;
    speedlimit?: string;
    sizeleft?: string;
    slots?: SabSlot[];
  };
}

export interface SabFullStatus {
  status: string;
  paused: boolean;
  speedLimit: string;
  speed: string;
  speedMb: number;
  sizeLeft: string;
  slots: DownloadItem[];
}

export interface SabHistoryItem {
  id?: string;
  name?: string;
  status?: string;
  category?: string;
  size?: string;
  completed?: number | string;
  failMessage?: string;
}

interface SabHistorySlot {
  id?: string;
  nzo_id?: string;
  name?: string;
  status?: string;
  category?: string;
  cat?: string;
  size?: string;
  completed?: number | string;
  fail_message?: string;
}
