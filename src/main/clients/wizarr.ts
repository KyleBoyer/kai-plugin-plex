import type { WizarrUser, WizarrInvitation, WizarrLibrary, WizarrServer } from '../../shared/types.js';

export class WizarrClient {
  private url: string;
  private apiKey: string;
  private fetchFn: typeof fetch;
  private versionCache?: { value: string; expiresAt: number };

  constructor(url: string, apiKey: string, fetchFn: typeof fetch) {
    this.url = url.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.fetchFn = fetchFn;
  }

  private headers(json = false): Record<string, string> {
    return {
      'X-API-Key': this.apiKey,
      Accept: 'application/json',
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  private legacyHeaders(json = false): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  private async request<T>(path: string, init: RequestInit = {}, legacy = false): Promise<T> {
    const res = await this.fetchFn(`${this.url}${path}`, {
      ...init,
      headers: {
        ...(legacy ? this.legacyHeaders(Boolean(init.body)) : this.headers(Boolean(init.body))),
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Wizarr ${path}: ${res.status}${text ? ` ${text}` : ''}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  private async get<T>(paths: string[]): Promise<T> {
    let lastError: unknown;
    for (const path of paths) {
      try {
        return await this.request<T>(path);
      } catch (e) {
        lastError = e;
        const message = String(e);
        if (!message.includes(': 404')) break;
      }
    }
    for (const path of paths) {
      try {
        return await this.request<T>(path, {}, true);
      } catch (e) {
        lastError = e;
        const message = String(e);
        if (!message.includes(': 404')) break;
      }
    }
    throw lastError;
  }

  private collection<T>(data: unknown, keys: string[]): T[] {
    if (Array.isArray(data)) return data as T[];
    if (!data || typeof data !== 'object') return [];
    const record = data as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) return value as T[];
    }
    return [];
  }

  private normalizeInvitation(inv: WizarrInvitationRaw): WizarrInvitation {
    const code = inv.code ?? inv.token ?? String(inv.id ?? '');
    return {
      id: inv.id,
      code,
      url: inv.url,
      status: inv.status,
      used: inv.used ?? ((inv.status === 'used') || Boolean(inv.used_at ?? inv.usedAt)),
      usesLeft: inv.uses_left ?? inv.usesLeft,
      duration: inv.duration,
      specificLibraries: inv.specific_libraries ?? inv.specificLibraries,
      unlimited: inv.unlimited,
      createdAt: inv.created ?? inv.created_at ?? inv.createdAt,
      expiresAt: inv.expires ?? inv.expiresAt,
      usedAt: inv.used_at ?? inv.usedAt,
      usedBy: inv.used_by ?? inv.usedBy,
      displayName: inv.display_name ?? inv.displayName,
      serverNames: inv.server_names ?? inv.serverNames,
    };
  }

  async ping(): Promise<boolean> {
    const attempts = [
      { path: '/api/status',             auth: true },
      { path: '/api/users',              auth: true },
      { path: '/api/invitations',        auth: true },
      { path: '/api/v1/users',           auth: 'legacy' },
      { path: '/api/v1/invitations',     auth: 'legacy' },
      { path: '/api/v1/settings/public', auth: false },
      { path: '/api/v1/health',          auth: false },
      { path: '/',                       auth: false },
    ];
    for (const { path, auth } of attempts) {
      try {
        const headers: Record<string, string> = auth === true
          ? this.headers()
          : auth === 'legacy'
          ? this.legacyHeaders()
          : {};
        const res = await this.fetchFn(`${this.url}${path}`, { headers, signal: AbortSignal.timeout(8000) });
        if (res.status < 500) return true;
      } catch { /* try next */ }
    }
    return false;
  }

  async getVersion(): Promise<string> {
    const cached = this.versionCache;
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    for (const path of ['/api/status', '/api/v1/health']) {
      try {
        const data = await this.request<unknown>(path);
        const version = this.versionFrom(data);
        if (version) return this.cacheVersion(version, 5 * 60 * 1000);
      } catch { /* try next */ }
    }

    const releaseVersion = await this.getLatestReleaseVersion();
    return this.cacheVersion(releaseVersion ?? 'unknown', releaseVersion ? 60 * 60 * 1000 : 5 * 60 * 1000);
  }

  private versionFrom(data: unknown): string | null {
    if (!data || typeof data !== 'object') return null;
    const record = data as Record<string, unknown>;
    for (const key of ['version', 'app_version', 'appVersion', 'buildVersion']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
  }

  private cacheVersion(value: string, ttlMs: number): string {
    this.versionCache = { value, expiresAt: Date.now() + ttlMs };
    return value;
  }

  private async getLatestReleaseVersion(): Promise<string | null> {
    try {
      const res = await this.fetchFn('https://api.github.com/repos/wizarrrr/wizarr/releases/latest', {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'kai-plugin-plex',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const data = await res.json() as { tag_name?: unknown; name?: unknown };
      const version = typeof data.tag_name === 'string'
        ? data.tag_name
        : typeof data.name === 'string'
        ? data.name
        : '';
      return version.trim() || null;
    } catch {
      return null;
    }
  }

  async getUsers(): Promise<WizarrUser[]> {
    try {
      const data = await this.get<WizarrUserRaw[] | { users?: WizarrUserRaw[]; items?: WizarrUserRaw[] }>(['/api/users', '/api/v1/users']);
      const items = this.collection<WizarrUserRaw>(data, ['users', 'items']);
      return items.map(u => ({
        id: u.id,
        username: u.username ?? u.name ?? String(u.id),
        email: u.email,
        token: u.token,
        expires: u.expires ?? u.expiry ?? u.expires_at,
        auth: u.auth ?? u.authType,
        server: u.server,
        serverType: u.server_type ?? u.serverType,
        createdAt: u.created_at ?? u.createdAt,
      }));
    } catch { return []; }
  }

  async getInvitations(): Promise<WizarrInvitation[]> {
    try {
      const data = await this.get<WizarrInvitationRaw[] | { invitations?: WizarrInvitationRaw[]; items?: WizarrInvitationRaw[] }>(['/api/invitations', '/api/v1/invitations']);
      const items = this.collection<WizarrInvitationRaw>(data, ['invitations', 'items']);
      return items.map(inv => this.normalizeInvitation(inv));
    } catch { return []; }
  }

  async getLibraries(): Promise<WizarrLibrary[]> {
    try {
      const data = await this.get<WizarrLibraryRaw[] | { libraries?: WizarrLibraryRaw[]; items?: WizarrLibraryRaw[] }>(['/api/libraries']);
      const items = this.collection<WizarrLibraryRaw>(data, ['libraries', 'items']);
      return items.map(l => ({
        id: Number(l.id),
        name: l.name ?? String(l.id),
        externalId: l.external_id ?? l.externalId,
        serverId: l.server_id ?? l.serverId ?? null,
        serverName: l.server_name ?? l.serverName,
        enabled: l.enabled,
      })).filter(l => Number.isFinite(l.id));
    } catch { return []; }
  }

  async getServers(): Promise<WizarrServer[]> {
    try {
      const data = await this.get<WizarrServerRaw[] | { servers?: WizarrServerRaw[]; items?: WizarrServerRaw[] }>(['/api/servers']);
      const items = this.collection<WizarrServerRaw>(data, ['servers', 'items']);
      return items.map(s => ({
        id: Number(s.id),
        name: s.name ?? String(s.id),
        serverType: s.server_type ?? s.serverType,
        verified: s.verified,
        allowDownloads: s.allow_downloads ?? s.allowDownloads,
        allowLiveTv: s.allow_live_tv ?? s.allowLiveTv,
      })).filter(s => Number.isFinite(s.id));
    } catch { return []; }
  }

  async createInvitation(input: WizarrCreateInvitationInput): Promise<WizarrInvitation> {
    const expiresInDays = input.expiresInDays ?? 7;
    const unlimited = input.unlimited ?? true;
    const duration = unlimited ? 'unlimited' : String(input.durationDays ?? expiresInDays);
    const serverIds = input.serverIds?.length ? input.serverIds : (await this.getServers()).map(s => s.id);
    const body: Record<string, unknown> = {
      server_ids: serverIds,
      expires_in_days: expiresInDays,
      duration,
      unlimited,
    };
    if (input.libraryIds?.length) {
      body.library_ids = input.libraryIds;
      body.libraries = input.libraryIds;
    }

    const data = await this.request<WizarrInvitationRaw | { invitation?: WizarrInvitationRaw }>('/api/invitations', {
      method: 'POST',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const raw = 'invitation' in (data as Record<string, unknown>)
      ? ((data as { invitation?: WizarrInvitationRaw }).invitation ?? {})
      : data as WizarrInvitationRaw;
    return this.normalizeInvitation(raw);
  }

  async deleteInvitation(id: number | string): Promise<void> {
    await this.request<void>(`/api/invitations/${id}`, { method: 'DELETE' });
  }

  async deleteUser(id: number | string): Promise<void> {
    await this.request<void>(`/api/users/${id}`, { method: 'DELETE' });
  }
}

export interface WizarrCreateInvitationInput {
  expiresInDays?: number;
  durationDays?: number;
  unlimited?: boolean;
  libraryIds?: number[];
  serverIds?: number[];
}

interface WizarrUserRaw {
  id: number | string;
  username?: string;
  name?: string;
  email?: string;
  token?: string;
  expires?: string;
  expiry?: string;
  expires_at?: string;
  auth?: string;
  authType?: string;
  server?: string;
  server_type?: string;
  serverType?: string;
  created_at?: string;
  createdAt?: string;
}

interface WizarrInvitationRaw {
  id?: number | string;
  code?: string;
  token?: string;
  url?: string;
  status?: string;
  used?: boolean;
  uses_left?: number;
  usesLeft?: number;
  duration?: number | string;
  specific_libraries?: number[] | string;
  specificLibraries?: number[] | string;
  unlimited?: boolean;
  created?: string;
  created_at?: string;
  createdAt?: string;
  expires?: string;
  expiresAt?: string;
  used_at?: string;
  usedAt?: string;
  used_by?: string;
  usedBy?: string;
  display_name?: string;
  displayName?: string;
  server_names?: string[];
  serverNames?: string[];
}

interface WizarrLibraryRaw {
  id: number | string;
  name?: string;
  external_id?: string;
  externalId?: string;
  server_id?: number | null;
  serverId?: number | null;
  server_name?: string;
  serverName?: string;
  enabled?: boolean;
}

interface WizarrServerRaw {
  id: number | string;
  name?: string;
  server_type?: string;
  serverType?: string;
  verified?: boolean;
  allow_downloads?: boolean;
  allowDownloads?: boolean;
  allow_live_tv?: boolean;
  allowLiveTv?: boolean;
}
