import type { DownloadItem } from '../../shared/types.js';

export class QbittorrentClient {
  private url: string;
  private apiKey: string;
  private fetchFn: typeof fetch;

  constructor(url: string, apiKey: string, fetchFn: typeof fetch) {
    this.url = url.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.fetchFn = fetchFn;
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  private async check(res: Response, action: string): Promise<void> {
    if (res.ok) return;
    const text = await res.text().catch(() => '');
    throw new Error(`qBit ${action}: ${res.status}${text ? ` ${text}` : ''}`);
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchFn(`${this.url}${path}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`qBit ${path}: ${res.status}`);
    return res.json() as Promise<T>;
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.fetchFn(`${this.url}/api/v2/app/version`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getTorrents(): Promise<DownloadItem[]> {
    const torrents = await this.get<QbTorrent[]>('/api/v2/torrents/info?limit=50');
    return torrents.map(normalizeTorrent);
  }

  async getGlobalStats(): Promise<{ dlSpeed: number; ulSpeed: number; freeSpace: number }> {
    const data = await this.get<{ server_state: QbServerState }>('/api/v2/sync/maindata?rid=0');
    const s = data.server_state ?? {};
    return {
      dlSpeed: s.dl_info_speed ?? 0,
      ulSpeed: s.up_info_speed ?? 0,
      freeSpace: s.free_space_on_disk ?? 0,
    };
  }

  async getTransferInfo(): Promise<QbTransferInfo> {
    return this.get<QbTransferInfo>('/api/v2/transfer/info');
  }

  async pauseTorrent(hash: string): Promise<void> {
    const body = new URLSearchParams({ hashes: hash });
    const res = await this.fetchFn(`${this.url}/api/v2/torrents/stop`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10000),
    });
    await this.check(res, 'pause torrent');
  }

  async resumeTorrent(hash: string): Promise<void> {
    const body = new URLSearchParams({ hashes: hash });
    const res = await this.fetchFn(`${this.url}/api/v2/torrents/start`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10000),
    });
    await this.check(res, 'resume torrent');
  }

  async deleteTorrent(hash: string, deleteFiles = true): Promise<void> {
    const body = new URLSearchParams({ hashes: hash, deleteFiles: String(deleteFiles) });
    const res = await this.fetchFn(`${this.url}/api/v2/torrents/delete`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10000),
    });
    await this.check(res, 'delete torrent');
  }

  async pauseAll(): Promise<void> {
    await this.pauseTorrent('all');
  }

  async resumeAll(): Promise<void> {
    await this.resumeTorrent('all');
  }

  async setDownloadLimit(bytesPerSecond: number): Promise<void> {
    const body = new URLSearchParams({ limit: String(Math.max(0, Math.floor(bytesPerSecond))) });
    const res = await this.fetchFn(`${this.url}/api/v2/transfer/setDownloadLimit`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10000),
    });
    await this.check(res, 'set download limit');
  }

  async setUploadLimit(bytesPerSecond: number): Promise<void> {
    const body = new URLSearchParams({ limit: String(Math.max(0, Math.floor(bytesPerSecond))) });
    const res = await this.fetchFn(`${this.url}/api/v2/transfer/setUploadLimit`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10000),
    });
    await this.check(res, 'set upload limit');
  }

  async getVersion(): Promise<string> {
    try {
      const res = await this.fetchFn(`${this.url}/api/v2/app/version`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok ? (await res.text()).trim() : 'unknown';
    } catch { return 'unknown'; }
  }
}

function normalizeTorrent(t: QbTorrent): DownloadItem {
  return {
    id: `qbt-${t.hash}`,
    source: 'qbittorrent',
    name: t.name,
    status: t.state,
    sizeBytes: t.size,
    sizeLeftBytes: t.amount_left,
    speed: t.dlspeed,
    eta: t.eta > 0 && t.eta < 8640000 ? formatEta(t.eta) : '',
    progress: Math.round(t.progress * 100),
    category: t.category || undefined,
  };
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

interface QbTorrent {
  hash: string;
  name: string;
  state: string;
  size: number;
  amount_left: number;
  dlspeed: number;
  progress: number;
  eta: number;
  category: string;
}

interface QbServerState {
  dl_info_speed?: number;
  up_info_speed?: number;
  free_space_on_disk?: number;
}

export interface QbTransferInfo {
  connection_status?: string;
  dht_nodes?: number;
  dl_info_data?: number;
  dl_info_speed?: number;
  dl_rate_limit?: number;
  up_info_data?: number;
  up_info_speed?: number;
  up_rate_limit?: number;
}
