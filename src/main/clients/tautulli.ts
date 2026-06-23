import type { TautulliSession } from '../../shared/types.js';

export class TautulliClient {
  private url: string;
  private apiKey: string;
  private fetchFn: typeof fetch;

  constructor(url: string, apiKey: string, fetchFn: typeof fetch) {
    this.url = url.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.fetchFn = fetchFn;
  }

  private endpoint(cmd: string, extra: Record<string, string> = {}): string {
    const p = new URLSearchParams({ apikey: this.apiKey, cmd, ...extra });
    return `${this.url}/api/v2?${p}`;
  }

  private async call<T>(cmd: string, extra: Record<string, string> = {}): Promise<T> {
    const res = await this.fetchFn(this.endpoint(cmd, extra), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Tautulli ${cmd}: ${res.status}`);
    const json = await res.json() as { response: { result: string; data: T } };
    return json.response.data;
  }

  private firstImage(s: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = s[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    return undefined;
  }

  private streamPosterPath(s: Record<string, unknown>): string | undefined {
    const mediaType = String(s.media_type ?? '');
    if (mediaType === 'episode') {
      return this.firstImage(s, ['grandparent_thumb', 'parent_thumb', 'thumb']);
    }
    if (mediaType === 'track') {
      return this.firstImage(s, ['parent_thumb', 'grandparent_thumb', 'thumb']);
    }
    return this.firstImage(s, ['thumb', 'grandparent_thumb', 'parent_thumb']);
  }

  private async thumbnailDataUrl(thumbRaw: string | undefined): Promise<string | undefined> {
    if (!thumbRaw) return undefined;
    try {
      const res = await this.fetchFn(this.endpoint('pms_image_proxy', {
        img: thumbRaw,
        width: '180',
        height: '270',
        fallback: 'poster',
      }), { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return undefined;
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.startsWith('image/')) return undefined;
      const bytes = Buffer.from(await res.arrayBuffer());
      return `data:${contentType};base64,${bytes.toString('base64')}`;
    } catch {
      return undefined;
    }
  }

  private async normalizeSession(s: Record<string, unknown>): Promise<TautulliSession> {
    const viewOffset = Number(s.view_offset ?? 0);
    const duration = Number(s.duration ?? 0);
    const progress = duration > 0 ? Math.round((viewOffset / duration) * 100) : 0;
    const thumbRaw = this.streamPosterPath(s);
    const thumbDataUrl = await this.thumbnailDataUrl(thumbRaw);
    return {
      sessionKey: String(s.session_key ?? s.session_id ?? ''),
      user: String(s.user ?? s.friendly_name ?? ''),
      title: String(s.title ?? ''),
      parentTitle: String(s.parent_title ?? ''),
      grandparentTitle: String(s.grandparent_title ?? ''),
      mediaType: String(s.media_type ?? ''),
      state: String(s.state ?? ''),
      viewOffset,
      duration,
      progressPercent: progress,
      transcodeDecision: String(s.transcode_decision ?? 'direct play'),
      qualityProfile: String(s.quality_profile ?? ''),
      bandwidth: Number(s.bandwidth ?? 0),
      ipAddress: String(s.ip_address ?? ''),
      player: String(s.player ?? ''),
      thumb: thumbRaw,
      thumbDataUrl,
    };
  }

  async ping(): Promise<boolean> {
    try {
      await this.call('get_server_info');
      return true;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string> {
    try {
      const data = await this.call<{ tautulli_version?: string }>('get_tautulli_info');
      return data.tautulli_version ?? 'unknown';
    } catch { return 'unknown'; }
  }

  async getActivity(): Promise<{ sessions: TautulliSession[]; streamCount: number; bandwidth: number }> {
    const data = await this.call<TautulliActivityRaw>('get_activity');
    const sessions = await Promise.all((data.sessions ?? []).map(s => this.normalizeSession(s)));
    return {
      sessions,
      streamCount: Number(data.stream_count ?? 0),
      bandwidth: Number(data.total_bandwidth ?? 0),
    };
  }

  async getHomeStats(timeRange = 30, count = 10): Promise<TautulliHomeStat[]> {
    return this.call<TautulliHomeStat[]>('get_home_stats', {
      time_range: String(timeRange),
      count: String(count),
    });
  }

  async getHistory(length = 20): Promise<TautulliHistoryRow[]> {
    const data = await this.call<{ data: TautulliHistoryRow[] }>('get_history', { length: String(length) });
    return data.data ?? [];
  }

  async terminateSession(sessionKey: string, message = 'Stream terminated by admin'): Promise<void> {
    await this.call('terminate_session', { session_key: sessionKey, message });
  }
}

interface TautulliActivityRaw {
  stream_count?: number | string;
  total_bandwidth?: number | string;
  sessions?: Record<string, unknown>[];
}

export interface TautulliHomeStat {
  stat_id: string;
  stat_type: string;
  rows: { title: string; total_plays: number; user?: string }[];
}

export interface TautulliHistoryRow {
  row_id: number;
  full_title: string;
  user: string;
  date: number;
  duration: number;
  media_type: string;
}
