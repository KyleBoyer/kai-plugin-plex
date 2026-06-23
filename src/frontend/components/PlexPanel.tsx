import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { LibraryBrowser } from './LibraryBrowser';

type PluginComponentProps = {
  pluginName: string;
  props?: Record<string, unknown>;
  onAction: (action: string, data?: unknown) => void;
  onClose?: () => void;
  pluginConfig?: Record<string, unknown>;
  pluginState?: Record<string, unknown>;
  setPluginConfig?: (path: string, value: unknown) => Promise<void>;
};

// ─── Streams Tab ─────────────────────────────────────────────────────────────

function StreamsTab({ pluginState, onAction }: { pluginState: any; onAction: (a: string, d?: unknown) => void }) {
  const streams = (pluginState.streams ?? []) as any[];
  const [terminating, setTerminating] = useState<string | null>(null);
  const [terminateMsg, setTerminateMsg] = useState('Stream terminated by admin');

  if (streams.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <div className="text-4xl mb-2">📺</div>
        <div className="text-sm">No active streams</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">{streams.length} active stream{streams.length !== 1 ? 's' : ''}</div>
      {streams.map((s: any) => {
        const fullTitle = s.grandparentTitle ? `${s.grandparentTitle} — ${s.title}` : s.title;
        const isTranscode = s.transcodeDecision !== 'direct play' && s.transcodeDecision !== '';
        const isTerminating = terminating === s.sessionKey;
        return (
          <div key={s.sessionKey} className="rounded-lg border border-border/30 bg-muted/10 overflow-hidden">
            <div className="flex gap-3 p-3">
              {s.thumbDataUrl ? (
                <img
                  src={s.thumbDataUrl}
                  alt=""
                  className="flex-shrink-0 w-10 h-14 object-cover rounded opacity-90 shadow-sm"
                  loading="lazy"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <div className="flex-shrink-0 w-10 h-14 rounded bg-muted/30 border border-border/30 grid place-items-center text-muted-foreground/50 text-xs">
                  {s.mediaType === 'episode' ? 'TV' : s.mediaType === 'movie' ? 'MOV' : 'Plex'}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{fullTitle}</div>
                    <div className="text-xs text-muted-foreground">{s.user} · {s.player}</div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${isTranscode ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' : 'bg-green-500/20 text-green-400 border-green-500/30'}`}>
                      {isTranscode ? '⚡ TC' : '▶ DP'}
                    </span>
                    {!isTerminating ? (
                      <button className="px-2 py-0.5 text-xs rounded border bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20" onClick={() => setTerminating(s.sessionKey)}>Stop</button>
                    ) : (
                      <div className="flex items-center gap-1">
                        <input type="text" value={terminateMsg} onChange={e => setTerminateMsg((e.target as HTMLInputElement).value)} placeholder="Reason…" className="text-xs px-2 py-0.5 rounded border border-border/50 bg-muted/30 w-32 focus:outline-none" />
                        <button className="px-2 py-0.5 text-xs rounded border bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30" onClick={() => { onAction('terminate-stream', { sessionKey: s.sessionKey, message: terminateMsg }); setTerminating(null); }}>Confirm</button>
                        <button className="px-2 py-0.5 text-xs rounded border bg-muted/30 text-muted-foreground border-border/40" onClick={() => setTerminating(null)}>✕</button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-2 space-y-1">
                  <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                    <div className="h-full rounded-full bg-primary/60 transition-all" style={{ width: `${s.progressPercent}%` }} />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{formatMs(s.viewOffset)}</span>
                    <span>{s.qualityProfile || `${s.progressPercent}%`}</span>
                    <span>{formatMs(s.duration)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Downloads Tab ────────────────────────────────────────────────────────────

function DownloadRow({ d, onAction }: { d: any; onAction: (a: string, data?: unknown) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const isPaused = d.status === 'pausedDL' || d.status === 'Paused' || d.status === 'stalledDL';
  const sourceLabel = d.source === 'sabnzbd' ? 'SABnzbd' : 'qBit';

  return (
    <div className="rounded-lg border border-border/30 bg-muted/10 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground/60 mb-0.5">{sourceLabel}</div>
          <div className="text-sm font-medium truncate">{d.name}</div>
          <div className="text-xs text-muted-foreground">{formatBytes(d.sizeLeftBytes)} remaining · {d.status}{d.eta ? ` · ETA ${d.eta}` : ''}</div>
        </div>
        <div className="flex gap-1 flex-shrink-0 flex-wrap justify-end">
          {isPaused ? (
            <button className="px-2 py-0.5 text-xs rounded border bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20" onClick={() => onAction('resume-download', { id: d.id, source: d.source })}>▶ Resume</button>
          ) : (
            <button className="px-2 py-0.5 text-xs rounded border bg-muted/30 text-muted-foreground border-border/40 hover:bg-muted/50" onClick={() => onAction('pause-download', { id: d.id, source: d.source })}>⏸ Pause</button>
          )}
          {!confirming ? (
            <button className="px-2 py-0.5 text-xs rounded border bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20" onClick={() => setConfirming(true)}>🗑</button>
          ) : (
            <div className="flex items-center gap-1.5 mt-1 w-full">
              <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={deleteFiles} onChange={e => setDeleteFiles((e.target as HTMLInputElement).checked)} />
                Delete files from disk
              </label>
              <button className="px-2 py-0.5 text-xs rounded border bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30" onClick={() => { onAction('delete-download', { id: d.id, source: d.source, deleteFiles }); setConfirming(false); }}>Confirm</button>
              <button className="px-2 py-0.5 text-xs rounded border bg-muted/30 text-muted-foreground border-border/40" onClick={() => setConfirming(false)}>Cancel</button>
            </div>
          )}
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
        <div className="h-full rounded-full bg-primary/60 transition-all" style={{ width: `${d.progress}%` }} />
      </div>
    </div>
  );
}

function DownloadsTab({ pluginState, onAction }: { pluginState: any; onAction: (a: string, d?: unknown) => void }) {
  const downloads = (pluginState.downloads ?? []) as any[];
  const sabStatus = pluginState.sabFullStatus as any;
  const qbitInfo = pluginState.qbitTransferInfo as any;
  const [downloadLimit, setDownloadLimit] = useState(qbitInfo?.dl_rate_limit != null ? String(qbitInfo.dl_rate_limit) : '0');
  const [uploadLimit, setUploadLimit] = useState(qbitInfo?.up_rate_limit != null ? String(qbitInfo.up_rate_limit) : '0');
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border/30 bg-muted/10 p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            SABnzbd {sabStatus?.status ? `· ${sabStatus.status}` : ''} {sabStatus?.speed ? `· ${sabStatus.speed} B/s` : ''}
          </div>
          <div className="flex gap-1">
            <button className="px-2 py-0.5 text-xs rounded border bg-muted/20 text-muted-foreground border-border/30 hover:bg-muted/40" onClick={() => onAction('pause-all-downloads', { source: 'sabnzbd' })}>Pause SAB</button>
            <button className="px-2 py-0.5 text-xs rounded border bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20" onClick={() => onAction('resume-all-downloads', { source: 'sabnzbd' })}>Resume SAB</button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            qBittorrent {qbitInfo?.connection_status ? `· ${qbitInfo.connection_status}` : ''} · ↓ {formatBytes(qbitInfo?.dl_info_speed ?? 0)}/s · ↑ {formatBytes(qbitInfo?.up_info_speed ?? 0)}/s
          </div>
          <div className="flex gap-1">
            <button className="px-2 py-0.5 text-xs rounded border bg-muted/20 text-muted-foreground border-border/30 hover:bg-muted/40" onClick={() => onAction('pause-all-downloads', { source: 'qbittorrent' })}>Pause qBit</button>
            <button className="px-2 py-0.5 text-xs rounded border bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20" onClick={() => onAction('resume-all-downloads', { source: 'qbittorrent' })}>Resume qBit</button>
          </div>
        </div>
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">qBit download B/s</span>
            <input value={downloadLimit} onChange={e => setDownloadLimit((e.target as HTMLInputElement).value)} className="w-full rounded border border-border/40 bg-muted/30 px-2 py-1 text-xs font-mono focus:outline-none" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">qBit upload B/s</span>
            <input value={uploadLimit} onChange={e => setUploadLimit((e.target as HTMLInputElement).value)} className="w-full rounded border border-border/40 bg-muted/30 px-2 py-1 text-xs font-mono focus:outline-none" />
          </label>
          <button className="px-2 py-1 text-xs rounded border bg-primary/10 text-primary border-primary/20 hover:bg-primary/20" onClick={() => onAction('set-qbit-limits', { downloadLimit: Number(downloadLimit), uploadLimit: Number(uploadLimit) })}>Apply</button>
        </div>
      </div>
      {downloads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <div className="text-4xl mb-2">📥</div>
          <div className="text-sm">No active downloads</div>
        </div>
      ) : (
        <>
          <div className="text-xs text-muted-foreground">{downloads.length} item{downloads.length !== 1 ? 's' : ''}</div>
          {downloads.map((d: any) => <DownloadRow key={d.id} d={d} onAction={onAction} />)}
        </>
      )}
    </div>
  );
}

// ─── Stats Tab ────────────────────────────────────────────────────────────────

function DiskBar({ freeSpace, totalSpace, path, label }: { freeSpace: number; totalSpace: number; path?: string; label?: string }) {
  const usedPct = totalSpace > 0 ? Math.round(((totalSpace - freeSpace) / totalSpace) * 100) : 0;
  const barCls = usedPct > 90 ? 'bg-red-500/70' : usedPct > 75 ? 'bg-yellow-500/70' : 'bg-primary/60';
  return (
    <div className="rounded-md border border-border/30 bg-muted/10 p-2.5 space-y-1.5">
      <div className="flex justify-between items-center gap-2">
        <span className="text-xs font-mono text-muted-foreground truncate flex-1">{path ?? label}</span>
        {label && path && <span className="text-xs text-muted-foreground/50 flex-shrink-0">{label}</span>}
      </div>
      <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
        <div className={`h-full rounded-full ${barCls} transition-all`} style={{ width: `${usedPct}%` }} />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground/70">
        <span>{formatBytes(totalSpace - freeSpace)} used</span>
        <span>{usedPct}%</span>
        <span>{formatBytes(freeSpace)} free</span>
      </div>
    </div>
  );
}

function StatsTab({ pluginState }: { pluginState: any }) {
  const libs = (pluginState.libraryStats ?? []) as any[];
  const serviceStatus = (pluginState.serviceStatus ?? {}) as Record<string, string>;
  const prowlarrIndexers = Number(pluginState.prowlarrIndexerCount ?? 0);
  const tdarrStatus = pluginState.tdarrStatus as string | undefined;
  const bazarrBadges = (pluginState.bazarrBadges ?? {}) as any;
  const bazarrHealth = (pluginState.bazarrHealth ?? []) as any[];
  const prowlarrHealth = (pluginState.prowlarrHealth ?? []) as any[];
  const tdarrNodes = (pluginState.tdarrNodes ?? []) as any[];
  const diskSpace = (pluginState.diskSpace ?? []) as any[];
  const sabDiskSpace = (pluginState.sabDiskSpace ?? []) as any[];
  const qbitFreeSpace = pluginState.qbitFreeSpace as number | undefined;
  const versions = (pluginState.versions ?? {}) as Record<string, string>;
  const [dedupPaths, setDedupPaths] = useState(true);

  const services = ['plex','radarr','sonarr','tautulli','bazarr','prowlarr','seer','sabnzbd','qbittorrent','tdarr','wizarr'];
  const serviceLabel = (label: string) => ({
    radarr: 'Radarr',
    sonarr: 'Sonarr',
    sabnzbd: 'SABnzbd',
    qbittorrent: 'qBittorrent',
    plex: 'Plex',
    tautulli: 'Tautulli',
    bazarr: 'Bazarr',
    prowlarr: 'Prowlarr',
    seer: 'Seer',
    tdarr: 'Tdarr',
    wizarr: 'Wizarr',
  }[label.toLowerCase()] ?? label);

  // Combine all disk sources, optionally deduplicating by path
  const allDisk: { path: string; label: string; freeSpace: number; totalSpace: number }[] = [];
  const byPath = new Map<string, { path: string; label: Set<string>; freeSpace: number; totalSpace: number }>();
  const addDisk = (path: string, label: string, freeSpace: number, totalSpace: number) => {
    const displayLabel = serviceLabel(label);
    const key = path || label;
    const existing = byPath.get(key);
    if (existing) {
      existing.label.add(displayLabel);
      if (totalSpace > existing.totalSpace || freeSpace > existing.freeSpace) {
        existing.freeSpace = freeSpace;
        existing.totalSpace = totalSpace;
      }
      return;
    }
    byPath.set(key, { path, label: new Set([displayLabel]), freeSpace, totalSpace });
  };
  for (const d of diskSpace) {
    const labels = Array.isArray(d.sources) && d.sources.length > 0 ? d.sources : [d.source ?? 'media'];
    for (const label of labels) {
      if (dedupPaths) addDisk(d.path, String(label), d.freeSpace ?? 0, d.totalSpace ?? 0);
      else allDisk.push({ path: d.path, label: serviceLabel(String(label)), freeSpace: d.freeSpace ?? 0, totalSpace: d.totalSpace ?? 0 });
    }
  }
  for (const d of sabDiskSpace) {
    if (dedupPaths) addDisk(d.path, 'SABnzbd', d.freeSpace ?? 0, d.totalSpace ?? 0);
    else allDisk.push({ path: d.path, label: 'SABnzbd', freeSpace: d.freeSpace ?? 0, totalSpace: d.totalSpace ?? 0 });
  }
  if (dedupPaths) {
    allDisk.push(...Array.from(byPath.values()).map(d => ({
      path: d.path,
      label: Array.from(d.label).sort().join(' + '),
      freeSpace: d.freeSpace,
      totalSpace: d.totalSpace,
    })));
  }

  const formatVersion = (ver?: string): string | null => {
    if (!ver || ver === 'unknown') return null;
    const trimmed = ver.trim();
    return trimmed.match(/^v\d/i) ? trimmed : `v${trimmed}`;
  };

  return (
    <div className="space-y-5">
      {libs.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Libraries</h3>
          <div className="grid grid-cols-2 gap-2">
            {libs.map((lib: any) => (
              <div key={lib.id} className="rounded-md border border-border/30 bg-muted/10 p-2.5">
                <div className="text-lg font-bold">{lib.count.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground mt-0.5 truncate">{lib.name}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {allDisk.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Disk Space</h3>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={dedupPaths} onChange={e => setDedupPaths((e.target as HTMLInputElement).checked)} />
              Deduplicate paths
            </label>
          </div>
          <div className="space-y-1.5">
            {allDisk.map((d, i) => <DiskBar key={i} {...d} />)}
            {qbitFreeSpace != null && qbitFreeSpace > 0 && (
              <div className="rounded-md border border-border/30 bg-muted/10 p-2.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>qBittorrent</span>
                  <span>{formatBytes(qbitFreeSpace)} free</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Service Health</h3>
        <div className="space-y-1">
          {services.map(svc => {
            const s = serviceStatus[svc] ?? 'unconfigured';
            const dotCls = s === 'ok' ? 'bg-green-500' : s === 'error' ? 'bg-red-500' : s === 'loading' ? 'bg-yellow-400 animate-pulse' : 'bg-muted-foreground/30';
            const ver = formatVersion(versions[svc]);
            const extraParts: string[] = [];
            if (svc === 'bazarr') {
              const missing = Number(bazarrBadges.movies ?? 0) + Number(bazarrBadges.episodes ?? 0);
              if (missing > 0) extraParts.push(`${missing} subtitle gaps`);
              if (bazarrHealth.length > 0) extraParts.push(`${bazarrHealth.length} health`);
            }
            if (svc === 'prowlarr') {
              if (prowlarrIndexers > 0) extraParts.push(`${prowlarrIndexers} indexers`);
              if (prowlarrHealth.length > 0) extraParts.push(`${prowlarrHealth.length} health`);
            }
            if (svc === 'tdarr') {
              if (tdarrStatus) extraParts.push(tdarrStatus);
              if (tdarrNodes.length > 0) extraParts.push(`${tdarrNodes.length} nodes`);
            }
            return (
              <div key={svc} className="flex items-center gap-2 py-0.5">
                <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${dotCls}`} />
                <span className="capitalize text-sm flex-1">{svc}</span>
                {extraParts.length > 0 && <span className="text-xs text-muted-foreground/70">{extraParts.join(' · ')}</span>}
                {ver && <span className="text-xs text-muted-foreground/50 font-mono">{ver}</span>}
                {s === 'loading' && !ver && <span className="text-xs text-muted-foreground/50">connecting…</span>}
                {s === 'unconfigured' && <span className="text-xs text-muted-foreground/30">not configured</span>}
                {s === 'error' && <span className="text-xs text-red-400/60">unreachable</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Requests Tab ─────────────────────────────────────────────────────────────

const REQUEST_STATUS: Record<number, { label: string; cls: string }> = {
  1: { label: 'Pending',   cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  2: { label: 'Approved',  cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  3: { label: 'Declined',  cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
  4: { label: 'Partial',   cls: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  5: { label: 'Available', cls: 'bg-green-500/20 text-green-400 border-green-500/30' },
};

function RequestsTab({ pluginState, onAction }: { pluginState: any; onAction: (a: string, d?: unknown) => void }) {
  const pendingRequests = (pluginState.pendingRequests ?? []) as any[];
  const allRequests = (pluginState.allRequests ?? []) as any[];
  const [filter, setFilter] = useState<'pending' | 'all' | 'available' | 'declined'>('pending');

  const displayed = filter === 'pending' ? pendingRequests
    : filter === 'available' ? allRequests.filter((r: any) => r.status === 4 || r.status === 5)
    : filter === 'declined' ? allRequests.filter((r: any) => r.status === 3)
    : allRequests;

  const tabCls = (active: boolean) =>
    `px-3 py-1 text-xs rounded-md cursor-pointer transition-colors ${active ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`;

  const counts = {
    pending: pendingRequests.length,
    all: allRequests.length,
    available: allRequests.filter((r: any) => r.status === 4 || r.status === 5).length,
    declined: allRequests.filter((r: any) => r.status === 3).length,
  };

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex gap-1 flex-wrap">
        {(['pending','all','available','declined'] as const).map(f => (
          <button key={f} className={tabCls(filter === f)} onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {counts[f] > 0 && <span className="ml-1 text-muted-foreground/60">({counts[f]})</span>}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto space-y-2">
        {displayed.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground/50 text-sm">No requests</div>
        ) : displayed.map((r: any) => {
          const st = REQUEST_STATUS[r.status] ?? { label: String(r.status), cls: 'bg-muted/50 text-muted-foreground border-border/50' };
          return (
            <div key={r.id} className="rounded-lg border border-border/30 bg-muted/10 p-3">
              <div className="flex items-start gap-3">
                {r.posterUrl && (
                  <img src={r.posterUrl} alt="" className="flex-shrink-0 w-9 h-14 object-cover rounded shadow-sm opacity-90" loading="lazy" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{r.title}</span>
                    {r.year && <span className="text-xs text-muted-foreground">{r.year}</span>}
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${r.type === 'movie' ? 'bg-purple-500/20 text-purple-400 border-purple-500/30' : 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'}`}>
                      {r.type === 'movie' ? 'Movie' : 'TV'}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${st.cls}`}>{st.label}</span>
                  </div>
                  {r.requestedBy && <div className="text-xs text-muted-foreground mt-0.5">by {r.requestedBy}</div>}
                  {r.createdAt && <div className="text-xs text-muted-foreground/50">{new Date(r.createdAt).toLocaleDateString()}</div>}
                </div>
                {r.status === 1 && (
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <button className="px-2 py-0.5 text-xs rounded border bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20" onClick={() => onAction('approve-request', { requestId: r.id })}>✓ Approve</button>
                    <button className="px-2 py-0.5 text-xs rounded border bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20" onClick={() => onAction('deny-request', { requestId: r.id })}>✕ Deny</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Bazarr Subtitles Tab ───────────────────────────────────────────────────

function langLabel(lang: any): string {
  if (!lang) return 'Unknown';
  if (typeof lang === 'string') return lang;
  const base = lang.name ?? lang.code3 ?? lang.code2 ?? 'Unknown';
  const suffix = [lang.forced ? 'forced' : '', lang.hi ? 'HI' : ''].filter(Boolean).join(', ');
  return suffix ? `${base} (${suffix})` : base;
}

function langCode(lang: any): string {
  if (!lang) return '';
  if (typeof lang === 'string') return lang;
  return String(lang.code3 ?? lang.code2 ?? lang.name ?? '');
}

function candidateProvider(candidate: any): string {
  return String(candidate.provider ?? candidate.provider_name ?? candidate.source ?? '');
}

function candidateSubtitle(candidate: any): string {
  return String(candidate.subtitle ?? candidate.id ?? candidate.subs_id ?? candidate.path ?? candidate.downloadUrl ?? '');
}

function SubtitlesTab({ pluginState, onAction }: { pluginState: any; onAction: (a: string, d?: unknown) => void }) {
  const serviceStatus = (pluginState.serviceStatus ?? {}) as Record<string, string>;
  const status = serviceStatus.bazarr;
  const health = (pluginState.bazarrHealth ?? []) as any[];
  const badges = (pluginState.bazarrBadges ?? {}) as any;
  const movies = (pluginState.bazarrWantedMovies ?? []) as any[];
  const episodes = (pluginState.bazarrWantedEpisodes ?? []) as any[];
  const providers = (pluginState.bazarrProviders ?? []) as any[];
  const tasks = (pluginState.bazarrTasks ?? []) as any[];
  const searchResults = (pluginState.bazarrSubtitleSearchResults ?? []) as any[];
  const searchContext = (pluginState.bazarrSubtitleSearchContext ?? {}) as any;
  const searchLoading = Boolean(pluginState.bazarrSubtitleSearchLoading);
  const [confirming, setConfirming] = useState<string | null>(null);

  if (status === 'unconfigured') return <div className="flex items-center justify-center py-16 text-muted-foreground/50 text-sm">Bazarr not configured</div>;
  if (status === 'error') return <div className="flex items-center justify-center py-16 text-red-400/70 text-sm">Bazarr unreachable</div>;

  const wantedMovieCount = Number(pluginState.bazarrWantedMovieCount ?? badges.movies ?? movies.length);
  const wantedEpisodeCount = Number(pluginState.bazarrWantedEpisodeCount ?? badges.episodes ?? episodes.length);
  const providerCount = Number(badges.providers ?? providers.length);
  const signalOk = badges.sonarr_signalr === 'LIVE' && badges.radarr_signalr === 'LIVE';

  const downloadMissing = (kind: 'movie' | 'episode', item: any, lang: any) => {
    const payload = kind === 'movie'
      ? { mediaType: 'movie', radarrId: item.radarrId, title: item.title }
      : { mediaType: 'episode', seriesId: item.sonarrSeriesId, episodeId: item.sonarrEpisodeId, title: `${item.seriesTitle} - ${item.episodeTitle ?? item.episode_number ?? ''}` };
    onAction('download-bazarr-missing', { ...payload, language: langCode(lang), forced: Boolean(lang?.forced), hi: Boolean(lang?.hi) });
  };

  const searchItem = (kind: 'movie' | 'episode', item: any) => {
    if (kind === 'movie') onAction('search-bazarr-subtitles', { mediaType: 'movie', radarrId: item.radarrId, title: item.title });
    else onAction('search-bazarr-subtitles', { mediaType: 'episode', seriesId: item.sonarrSeriesId, episodeId: item.sonarrEpisodeId, title: `${item.seriesTitle} - ${item.episodeTitle ?? item.episode_number ?? ''}` });
  };

  const wantedRow = (kind: 'movie' | 'episode', item: any, key: string) => {
    const title = kind === 'movie' ? item.title : `${item.seriesTitle} - ${item.episodeTitle ?? item.episode_number ?? ''}`;
    const langs = (item.missing_subtitles ?? []) as any[];
    const firstLang = langs[0];
    return (
      <div key={key} className="rounded-md border border-border/30 bg-muted/10 p-2.5 flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{title}</div>
          {item.sceneName && <div className="text-xs text-muted-foreground/50 truncate">{item.sceneName}</div>}
          <div className="flex gap-1 flex-wrap mt-1">
            {langs.slice(0, 5).map((lang, i) => (
              <span key={i} className="text-xs px-1.5 py-0.5 rounded border bg-yellow-500/10 text-yellow-400 border-yellow-500/20">{langLabel(lang)}</span>
            ))}
            {langs.length > 5 && <span className="text-xs text-muted-foreground/50">+{langs.length - 5}</span>}
          </div>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button className="px-2 py-0.5 text-xs rounded border bg-muted/20 text-muted-foreground border-border/30 hover:bg-muted/40" onClick={() => searchItem(kind, item)}>Search</button>
          {firstLang && (
            confirming === `missing-${key}` ? (
              <div className="flex gap-1">
                <button className="px-2 py-0.5 text-xs rounded border bg-green-500/20 text-green-400 border-green-500/30" onClick={() => { downloadMissing(kind, item, firstLang); setConfirming(null); }}>Confirm</button>
                <button className="px-2 py-0.5 text-xs rounded border bg-muted/20 text-muted-foreground border-border/30" onClick={() => setConfirming(null)}>Cancel</button>
              </div>
            ) : (
              <button className="px-2 py-0.5 text-xs rounded border bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20" onClick={() => setConfirming(`missing-${key}`)}>Download</button>
            )
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-2">
        <MetricCard label="Movie gaps" value={wantedMovieCount} tone={wantedMovieCount > 0 ? 'warn' : 'ok'} />
        <MetricCard label="Episode gaps" value={wantedEpisodeCount} tone={wantedEpisodeCount > 0 ? 'warn' : 'ok'} />
        <MetricCard label="Providers" value={providerCount} />
        <MetricCard label="Signals" value={signalOk ? 'Live' : 'Check'} tone={signalOk ? 'ok' : 'warn'} />
      </div>

      {health.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Health</h3>
          <div className="space-y-1.5">
            {health.map((issue, i) => (
              <div key={i} className="rounded-md border border-red-500/20 bg-red-500/10 px-2.5 py-2 text-xs text-red-300">
                {issue.message ?? issue.issue ?? issue.object ?? 'Bazarr health issue'}
              </div>
            ))}
          </div>
        </div>
      )}

      {searchLoading || searchResults.length > 0 ? (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Manual Results</h3>
          {searchLoading ? <div className="text-sm text-muted-foreground py-4">Searching providers...</div> : (
            <div className="space-y-1.5">
              {searchResults.slice(0, 20).map((candidate, i) => {
                const provider = candidateProvider(candidate);
                const subtitle = candidateSubtitle(candidate);
                const key = `${provider}-${subtitle}-${i}`;
                const canDownload = provider && subtitle;
                return (
                  <div key={key} className="rounded-md border border-border/30 bg-muted/10 p-2.5 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{candidate.title ?? candidate.release ?? subtitle}</div>
                      <div className="text-xs text-muted-foreground/60 truncate">{provider || 'Unknown provider'} {candidate.score != null ? `- ${candidate.score}%` : ''}</div>
                    </div>
                    {confirming === `candidate-${key}` ? (
                      <div className="flex gap-1">
                        <button className="px-2 py-0.5 text-xs rounded border bg-green-500/20 text-green-400 border-green-500/30" onClick={() => { onAction('download-bazarr-subtitle', { ...searchContext, provider, subtitle, forced: Boolean(candidate.forced), hi: Boolean(candidate.hi ?? candidate.hearing_impaired), title: candidate.title }); setConfirming(null); }}>Confirm</button>
                        <button className="px-2 py-0.5 text-xs rounded border bg-muted/20 text-muted-foreground border-border/30" onClick={() => setConfirming(null)}>Cancel</button>
                      </div>
                    ) : (
                      <button disabled={!canDownload} className={`px-2 py-0.5 text-xs rounded border ${canDownload ? 'bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20' : 'bg-muted/20 text-muted-foreground/40 border-border/20'}`} onClick={() => setConfirming(`candidate-${key}`)}>Download</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Wanted Movies</h3>
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {movies.length === 0 ? <div className="text-xs text-muted-foreground/50 py-3">No missing movie subtitles</div> : movies.slice(0, 25).map((m, i) => wantedRow('movie', m, `movie-${m.radarrId ?? i}`))}
          </div>
        </div>
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Wanted Episodes</h3>
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {episodes.length === 0 ? <div className="text-xs text-muted-foreground/50 py-3">No missing episode subtitles</div> : episodes.slice(0, 25).map((e, i) => wantedRow('episode', e, `episode-${e.sonarrEpisodeId ?? i}`))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Providers</h3>
            <button className="px-2 py-0.5 text-xs rounded border bg-muted/20 text-muted-foreground border-border/30 hover:bg-muted/40" onClick={() => onAction('reset-bazarr-providers')}>Reset</button>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {providers.length === 0 ? <div className="text-xs text-muted-foreground/50 py-3">No provider details</div> : providers.map((p, i) => (
              <div key={p.name ?? p.provider ?? i} className="rounded-md border border-border/30 bg-muted/10 p-2 flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${p.status === 'error' || p.enabled === false ? 'bg-red-500' : 'bg-green-500'}`} />
                <span className="text-sm flex-1 truncate">{p.name ?? p.provider ?? `Provider ${i + 1}`}</span>
                <span className="text-xs text-muted-foreground/60">{p.status ?? (p.enabled === false ? 'disabled' : 'ok')}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Tasks</h3>
          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {tasks.length === 0 ? <div className="text-xs text-muted-foreground/50 py-3">No tasks reported</div> : tasks.slice(0, 20).map((task, i) => {
              const id = String(task.taskid ?? task.id ?? task.name ?? i);
              return (
                <div key={id} className="rounded-md border border-border/30 bg-muted/10 p-2 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{task.name ?? id}</div>
                    {task.next_run && <div className="text-xs text-muted-foreground/50">Next {String(task.next_run)}</div>}
                  </div>
                  {confirming === `task-${id}` ? (
                    <div className="flex gap-1">
                      <button className="px-2 py-0.5 text-xs rounded border bg-green-500/20 text-green-400 border-green-500/30" onClick={() => { onAction('run-bazarr-task', { taskId: id, name: task.name }); setConfirming(null); }}>Confirm</button>
                      <button className="px-2 py-0.5 text-xs rounded border bg-muted/20 text-muted-foreground border-border/30" onClick={() => setConfirming(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button className="px-2 py-0.5 text-xs rounded border bg-primary/10 text-primary border-primary/20 hover:bg-primary/20" onClick={() => setConfirming(`task-${id}`)}>Run</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: number | string; tone?: 'ok' | 'warn' | 'bad' }) {
  const toneCls = tone === 'bad' ? 'text-red-400' : tone === 'warn' ? 'text-yellow-400' : tone === 'ok' ? 'text-green-400' : 'text-foreground';
  return (
    <div className="rounded-md border border-border/30 bg-muted/10 p-2.5">
      <div className={`text-lg font-bold ${toneCls}`}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className="text-xs text-muted-foreground mt-0.5 truncate">{label}</div>
    </div>
  );
}

// ─── Prowlarr Indexers Tab ──────────────────────────────────────────────────

function releaseKey(release: any, index = 0): string {
  return String(release.guid ?? release.downloadUrl ?? `${release.indexerId ?? 'idx'}-${release.title ?? 'release'}-${release.size ?? index}`);
}

function IndexersTab({ pluginState, onAction }: { pluginState: any; onAction: (a: string, d?: unknown) => void }) {
  const serviceStatus = (pluginState.serviceStatus ?? {}) as Record<string, string>;
  const status = serviceStatus.prowlarr;
  const indexers = (pluginState.prowlarrIndexers ?? []) as any[];
  const indexerStatus = (pluginState.prowlarrIndexerStatus ?? []) as any[];
  const stats = (pluginState.prowlarrIndexerStats ?? []) as any[];
  const health = (pluginState.prowlarrHealth ?? []) as any[];
  const downloadClients = (pluginState.prowlarrDownloadClients ?? []) as any[];
  const history = (pluginState.prowlarrHistory ?? []) as any[];
  const releases = (pluginState.prowlarrSearchResults ?? []) as any[];
  const loading = Boolean(pluginState.prowlarrSearchLoading);
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState('search');
  const [protocol, setProtocol] = useState('all');
  const [showDownOnly, setShowDownOnly] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState<string | null>(null);

  if (status === 'unconfigured') return <div className="flex items-center justify-center py-16 text-muted-foreground/50 text-sm">Prowlarr not configured</div>;
  if (status === 'error') return <div className="flex items-center justify-center py-16 text-red-400/70 text-sm">Prowlarr unreachable</div>;

  const statusByIndexer = new Map(indexerStatus.map(s => [Number(s.indexerId), s]));
  const statsByIndexer = new Map(stats.map(s => [Number(s.indexerId), s]));
  const enabled = indexers.filter(i => i.enable).length;
  const downCount = indexers.filter(i => statusByIndexer.has(Number(i.id))).length;
  const protocols = Array.from(new Set(indexers.map(i => String(i.protocol ?? 'unknown'))));
  const filteredIndexers = indexers.filter(i => (protocol === 'all' || i.protocol === protocol) && (!showDownOnly || statusByIndexer.has(Number(i.id))));
  const selectedReleases = releases.filter((r, i) => selected[releaseKey(r, i)]);

  const runSearch = () => {
    const q = query.trim();
    if (!q) return;
    setSelected({});
    onAction('search-prowlarr', { query: q, type: searchType, limit: 50 });
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-2">
        <MetricCard label="Enabled" value={`${enabled}/${indexers.length}`} tone={enabled === indexers.length ? 'ok' : 'warn'} />
        <MetricCard label="Degraded" value={downCount} tone={downCount > 0 ? 'bad' : 'ok'} />
        <MetricCard label="Health" value={health.length} tone={health.length > 0 ? 'warn' : 'ok'} />
        <MetricCard label="Clients" value={downloadClients.length} />
      </div>

      <div className="flex gap-2 flex-wrap">
        <input value={query} onChange={e => setQuery((e.target as HTMLInputElement).value)} onKeyDown={e => e.key === 'Enter' && runSearch()} placeholder="Search indexers..." className="flex-1 min-w-48 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-sm placeholder:text-muted-foreground/40 focus:outline-none" />
        <select value={searchType} onChange={e => setSearchType((e.target as HTMLSelectElement).value)} className="rounded-lg border border-border/50 bg-muted/30 px-2 py-2 text-sm focus:outline-none">
          <option value="search">Any</option>
          <option value="moviesearch">Movie</option>
          <option value="tvsearch">TV</option>
        </select>
        <button onClick={runSearch} className="px-3 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 border border-primary/20 text-sm text-primary transition-colors">Search</button>
        {selectedReleases.length > 0 && (
          confirming === 'bulk-grab' ? (
            <div className="flex gap-1">
              <button className="px-3 py-2 text-sm rounded-lg border bg-green-500/20 text-green-400 border-green-500/30" onClick={() => { onAction('bulk-grab-prowlarr-releases', { releases: selectedReleases }); setConfirming(null); setSelected({}); }}>Confirm {selectedReleases.length}</button>
              <button className="px-3 py-2 text-sm rounded-lg border bg-muted/20 text-muted-foreground border-border/30" onClick={() => setConfirming(null)}>Cancel</button>
            </div>
          ) : (
            <button className="px-3 py-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 text-sm text-green-400" onClick={() => setConfirming('bulk-grab')}>Grab {selectedReleases.length}</button>
          )
        )}
      </div>

      {(loading || releases.length > 0) && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Release Results</h3>
          {loading ? <div className="text-sm text-muted-foreground py-5">Searching...</div> : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
              {releases.slice(0, 75).map((release, i) => {
                const key = releaseKey(release, i);
                return (
                  <div key={key} className="rounded-md border border-border/30 bg-muted/10 p-2.5 flex items-start gap-2">
                    <input type="checkbox" checked={Boolean(selected[key])} onChange={e => setSelected(prev => ({ ...prev, [key]: (e.target as HTMLInputElement).checked }))} className="mt-1" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{release.title}</div>
                      <div className="text-xs text-muted-foreground/60 truncate">{release.indexer ?? 'Indexer'} - {release.protocol ?? 'protocol'} - {formatBytes(release.size ?? 0)} {release.seeders != null ? `- S:${release.seeders}` : ''} {release.leechers != null ? `L:${release.leechers}` : ''}</div>
                    </div>
                    {confirming === `grab-${key}` ? (
                      <div className="flex gap-1">
                        <button className="px-2 py-0.5 text-xs rounded border bg-green-500/20 text-green-400 border-green-500/30" onClick={() => { onAction('grab-prowlarr-release', { release }); setConfirming(null); }}>Confirm</button>
                        <button className="px-2 py-0.5 text-xs rounded border bg-muted/20 text-muted-foreground border-border/30" onClick={() => setConfirming(null)}>Cancel</button>
                      </div>
                    ) : (
                      <button className="px-2 py-0.5 text-xs rounded border bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20" onClick={() => setConfirming(`grab-${key}`)}>Grab</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Indexers</h3>
            <div className="flex items-center gap-2">
              <select value={protocol} onChange={e => setProtocol((e.target as HTMLSelectElement).value)} className="rounded border border-border/40 bg-muted/20 px-2 py-1 text-xs">
                <option value="all">All</option>
                {protocols.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" checked={showDownOnly} onChange={e => setShowDownOnly((e.target as HTMLInputElement).checked)} />
                Degraded
              </label>
            </div>
          </div>
          <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
            {filteredIndexers.map(indexer => {
              const down = statusByIndexer.get(Number(indexer.id));
              const stat = statsByIndexer.get(Number(indexer.id));
              return (
                <div key={indexer.id} className="rounded-md border border-border/30 bg-muted/10 p-2.5">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${!indexer.enable ? 'bg-muted-foreground/30' : down ? 'bg-red-500' : 'bg-green-500'}`} />
                    <span className="text-sm font-medium flex-1 truncate">{indexer.name}</span>
                    <span className="text-xs text-muted-foreground/60">{indexer.protocol}</span>
                  </div>
                  <div className="text-xs text-muted-foreground/50 mt-1">
                    {down ? `Failure: ${down.mostRecentFailure ?? down.disabledTill ?? 'degraded'}` : 'Operational'}
                    {stat && ` - Q:${stat.numberOfQueries ?? 0} G:${stat.numberOfGrabs ?? 0} F:${(stat.numberOfFailedQueries ?? 0) + (stat.numberOfFailedGrabs ?? 0)}`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Download Clients</h3>
            <div className="space-y-1.5">
              {downloadClients.length === 0 ? <div className="text-xs text-muted-foreground/50 py-2">No download clients reported</div> : downloadClients.map(c => (
                <div key={c.id} className="rounded-md border border-border/30 bg-muted/10 p-2 flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${c.enable === false ? 'bg-muted-foreground/30' : 'bg-green-500'}`} />
                  <span className="text-sm flex-1 truncate">{c.name}</span>
                  <span className="text-xs text-muted-foreground/60">{c.implementationName ?? c.protocol}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Recent History</h3>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {history.length === 0 ? <div className="text-xs text-muted-foreground/50 py-2">No recent history</div> : history.slice(0, 20).map((h, i) => (
                <div key={h.id ?? i} className="rounded-md border border-border/30 bg-muted/10 p-2">
                  <div className="text-sm truncate">{h.sourceTitle ?? h.downloadId ?? h.eventType ?? 'History item'}</div>
                  <div className="text-xs text-muted-foreground/50">{h.indexer ?? `Indexer ${h.indexerId ?? ''}`} {h.date ? `- ${new Date(h.date).toLocaleString()}` : ''}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tdarr Transcodes Tab ───────────────────────────────────────────────────

const TDARR_WORKER_TYPES = [
  ['transcodecpu', 'Transcode CPU'],
  ['transcodegpu', 'Transcode GPU'],
  ['healthcheckcpu', 'Health CPU'],
  ['healthcheckgpu', 'Health GPU'],
] as const;

function flattenWorkers(nodes: any[]): any[] {
  return nodes.flatMap(node => {
    if (Array.isArray(node.workerList)) return node.workerList;
    return Object.entries(node.workers ?? {}).map(([id, worker]) => ({ ...(worker as any), id, _id: (worker as any)._id ?? id, nodeId: node.id ?? node._id, nodeName: node.nodeName }));
  });
}

function TranscodesTab({ pluginState, onAction }: { pluginState: any; onAction: (a: string, d?: unknown) => void }) {
  const serviceStatus = (pluginState.serviceStatus ?? {}) as Record<string, string>;
  const status = serviceStatus.tdarr;
  const nodes = (pluginState.tdarrNodes ?? []) as any[];
  const workers = ((pluginState.tdarrActiveWorkers ?? []) as any[]).length > 0 ? (pluginState.tdarrActiveWorkers as any[]) : flattenWorkers(nodes);
  const staged = (pluginState.tdarrStagedJobs ?? []) as any[];
  const resources = (pluginState.tdarrResourceStats ?? {}) as any;
  const dbStatuses = (pluginState.tdarrDbStatuses ?? {}) as Record<string, any>;
  const libraries = (pluginState.tdarrLibraries ?? []) as any[];
  const [confirming, setConfirming] = useState<string | null>(null);

  if (status === 'unconfigured') return <div className="flex items-center justify-center py-16 text-muted-foreground/50 text-sm">Tdarr not configured</div>;
  if (status === 'error') return <div className="flex items-center justify-center py-16 text-red-400/70 text-sm">Tdarr unreachable</div>;

  const pausedNodes = nodes.filter(n => n.nodePaused).length;
  const cpu = resources.os?.cpuPerc ?? '-';
  const mem = resources.os?.memUsedGB && resources.os?.memTotalGB ? `${resources.os.memUsedGB}/${resources.os.memTotalGB} GB` : '-';

  const confirmButton = (id: string, label: string, cls: string, action: () => void) => (
    confirming === id ? (
      <div className="flex gap-1">
        <button className="px-2 py-0.5 text-xs rounded border bg-green-500/20 text-green-400 border-green-500/30" onClick={() => { action(); setConfirming(null); }}>Confirm</button>
        <button className="px-2 py-0.5 text-xs rounded border bg-muted/20 text-muted-foreground border-border/30" onClick={() => setConfirming(null)}>Cancel</button>
      </div>
    ) : (
      <button className={cls} onClick={() => setConfirming(id)}>{label}</button>
    )
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-2">
        <MetricCard label="Nodes" value={`${nodes.length - pausedNodes}/${nodes.length}`} tone={pausedNodes > 0 ? 'warn' : 'ok'} />
        <MetricCard label="Workers" value={workers.length} />
        <MetricCard label="Staged" value={staged.length} tone={staged.length > 0 ? 'warn' : undefined} />
        <MetricCard label="CPU" value={typeof cpu === 'number' ? `${cpu}%` : String(cpu)} />
      </div>

      <div className="rounded-md border border-border/30 bg-muted/10 p-2.5 text-xs text-muted-foreground flex gap-4 flex-wrap">
        <span>Memory {mem}</span>
        <span>Heap {resources.process?.heapUsedMB ?? '-'} / {resources.process?.heapTotalMB ?? '-'}</span>
        <span>DBs {Object.keys(dbStatuses).length}</span>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Nodes</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {nodes.length === 0 ? <div className="text-xs text-muted-foreground/50 py-3">No Tdarr nodes reported</div> : nodes.map(node => {
            const nodeId = node.id ?? node._id;
            return (
              <div key={nodeId} className="rounded-md border border-border/30 bg-muted/10 p-3 space-y-3">
                <div className="flex items-start gap-2">
                  <span className={`w-2 h-2 rounded-full mt-1.5 ${node.nodePaused ? 'bg-yellow-500' : 'bg-green-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{node.nodeName}</div>
                    <div className="text-xs text-muted-foreground/60 truncate">{node.remoteAddress ?? node.nodeEngine ?? nodeId}</div>
                  </div>
                  <button className="px-2 py-0.5 text-xs rounded border bg-muted/20 text-muted-foreground border-border/30 hover:bg-muted/40" onClick={() => onAction('set-tdarr-node-paused', { nodeId, nodeName: node.nodeName, paused: !node.nodePaused })}>{node.nodePaused ? 'Resume' : 'Pause'}</button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {TDARR_WORKER_TYPES.map(([type, label]) => {
                    const count = Number(node.workerLimits?.[type] ?? 0);
                    const queue = Number(node.queueLengths?.[type] ?? 0);
                    return (
                      <div key={type} className="rounded border border-border/20 bg-muted/10 p-2">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs text-muted-foreground truncate">{label}</span>
                          <span className="text-xs font-mono">{count}</span>
                        </div>
                        <div className="flex gap-1 mt-1">
                          <button className="px-1.5 py-0.5 text-xs rounded border bg-muted/20 text-muted-foreground border-border/30" onClick={() => onAction('alter-tdarr-worker-limit', { nodeId, workerType: type, process: 'decrease' })}>-</button>
                          <button className="px-1.5 py-0.5 text-xs rounded border bg-primary/10 text-primary border-primary/20" onClick={() => onAction('alter-tdarr-worker-limit', { nodeId, workerType: type, process: 'increase' })}>+</button>
                          {queue > 0 && <span className="text-xs text-yellow-400/70 ml-auto">{queue} queued</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-1 flex-wrap">
                  {confirmButton(`restart-${nodeId}`, 'Restart', 'px-2 py-0.5 text-xs rounded border bg-yellow-500/10 text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/20', () => onAction('restart-tdarr-node', { nodeId, nodeName: node.nodeName }))}
                  {confirmButton(`disconnect-${nodeId}`, 'Disconnect', 'px-2 py-0.5 text-xs rounded border bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20', () => onAction('disconnect-tdarr-node', { nodeId, nodeName: node.nodeName }))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Active Workers</h3>
          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {workers.length === 0 ? <div className="text-xs text-muted-foreground/50 py-3">No active workers</div> : workers.map((worker, i) => {
              const workerId = worker._id ?? worker.id ?? String(i);
              const nodeId = worker.nodeId;
              return (
                <div key={`${nodeId}-${workerId}`} className="rounded-md border border-border/30 bg-muted/10 p-2.5 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{worker.title ?? worker.job?.title ?? worker.job?.file ?? workerId}</div>
                    <div className="text-xs text-muted-foreground/60 truncate">{worker.nodeName ?? nodeId} - {worker.workerType ?? 'worker'} {worker.percentage != null ? `- ${worker.percentage}%` : ''} {worker.fps != null ? `- ${worker.fps} fps` : ''}</div>
                  </div>
                  {confirmButton(`cancel-worker-${nodeId}-${workerId}`, 'Cancel', 'px-2 py-0.5 text-xs rounded border bg-yellow-500/10 text-yellow-400 border-yellow-500/20', () => onAction('cancel-tdarr-worker', { nodeId, workerId }))}
                  {confirmButton(`kill-worker-${nodeId}-${workerId}`, 'Kill', 'px-2 py-0.5 text-xs rounded border bg-red-500/10 text-red-400 border-red-500/20', () => onAction('kill-tdarr-worker', { nodeId, workerId }))}
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Staged Jobs</h3>
          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {staged.length === 0 ? <div className="text-xs text-muted-foreground/50 py-3">No staged jobs</div> : staged.slice(0, 30).map((job, i) => (
              <div key={job._id ?? i} className="rounded-md border border-border/30 bg-muted/10 p-2.5">
                <div className="text-sm truncate">{job.job?.title ?? job.originalLibraryFile?.file ?? job._id}</div>
                <div className="text-xs text-muted-foreground/60">{job.workerType ?? 'worker'} - {job.status ?? (job.inLimbo ? 'limbo' : 'staged')}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Libraries</h3>
        <div className="space-y-1.5">
          {libraries.length === 0 ? <div className="text-xs text-muted-foreground/50 py-3">No Tdarr libraries reported</div> : libraries.map(lib => (
            <div key={lib._id} className="rounded-md border border-border/30 bg-muted/10 p-2.5 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{lib.name ?? lib._id}</div>
                <div className="text-xs text-muted-foreground/60 truncate">{lib.folder ?? lib.output ?? lib.cache}</div>
              </div>
              {confirmButton(`scan-lib-${lib._id}`, 'Scan', 'px-2 py-0.5 text-xs rounded border bg-primary/10 text-primary border-primary/20', () => onAction('scan-tdarr-library', { name: lib.name, scanConfig: { dbID: lib._id, libraryId: lib._id } }))}
              {confirmButton(`requeue-trans-${lib._id}`, 'Requeue TC', 'px-2 py-0.5 text-xs rounded border bg-green-500/10 text-green-400 border-green-500/20', () => onAction('requeue-tdarr-library', { libraryId: lib._id, queue: 'transcode', name: lib.name }))}
              {confirmButton(`requeue-health-${lib._id}`, 'Requeue HC', 'px-2 py-0.5 text-xs rounded border bg-yellow-500/10 text-yellow-400 border-yellow-500/20', () => onAction('requeue-tdarr-library', { libraryId: lib._id, queue: 'healthcheck', name: lib.name }))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Wizarr Tab ───────────────────────────────────────────────────────────────

type WizarrServerView = {
  id: number;
  name: string;
  serverType?: string;
  verified?: boolean;
  allowDownloads?: boolean;
  allowLiveTv?: boolean;
};

type WizarrLibraryView = {
  id: number;
  name: string;
  externalId?: string;
  serverId?: number | null;
  serverName?: string;
  enabled?: boolean;
};

const INVITE_EXPIRY_OPTIONS = [
  { label: '1 day',  value: 1 },
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
];

const ACCESS_DURATION_OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
];

type LibraryPreset = 'enabled' | 'movies' | 'shows' | 'all';

function libraryPresetMatch(lib: WizarrLibraryView, preset: LibraryPreset): boolean {
  const name = lib.name.toLowerCase();
  if (preset === 'all') return true;
  if (lib.enabled === false) return false;
  if (preset === 'movies') return /\b(movie|movies|film|films)\b/.test(name);
  if (preset === 'shows') return /\b(tv|show|shows|series)\b/.test(name);
  return true;
}

function dedupeWizarrLibraries(libraries: WizarrLibraryView[], selectedServerIds: number[]): WizarrLibraryView[] {
  const selected = new Set(selectedServerIds);
  const scoped = selected.size > 0
    ? libraries.filter(lib => lib.serverId == null || selected.has(Number(lib.serverId)))
    : libraries;
  const score = (lib: WizarrLibraryView) =>
    (lib.serverId != null && selected.has(Number(lib.serverId)) ? 8 : 0) +
    (lib.serverId != null ? 4 : 0) +
    (lib.enabled !== false ? 2 : 0);
  const sorted = [...scoped].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
  const seenSpecific = new Set<string>();
  const seenGeneric = new Set<string>();
  const result: WizarrLibraryView[] = [];
  for (const lib of sorted) {
    const base = String(lib.externalId ?? lib.name).toLowerCase();
    if (lib.serverId != null) {
      const key = `${lib.serverId}:${base}`;
      if (seenSpecific.has(key)) continue;
      seenSpecific.add(key);
      seenGeneric.add(base);
      result.push(lib);
      continue;
    }
    if (seenGeneric.has(base)) continue;
    seenGeneric.add(base);
    result.push(lib);
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

function WizarrTab({ pluginState, onAction }: { pluginState: any; onAction: (a: string, d?: unknown) => void }) {
  const users = (pluginState.wizarrUsers ?? []) as any[];
  const invitations = (pluginState.wizarrInvitations ?? []) as any[];
  const rawLibraries = (pluginState.wizarrLibraries ?? []) as WizarrLibraryView[];
  const servers = (pluginState.wizarrServers ?? []) as WizarrServerView[];
  const serviceStatus = (pluginState.serviceStatus ?? {}) as Record<string, string>;
  const wizarrStatus = serviceStatus.wizarr;
  const [creating, setCreating] = useState(false);
  const [inviteExpiresInDays, setInviteExpiresInDays] = useState(7);
  const [accessDurationDays, setAccessDurationDays] = useState(30);
  const [createUnlimited, setCreateUnlimited] = useState(false);
  const [selectedServerIds, setSelectedServerIds] = useState<number[]>([]);
  const [serverSelectionTouched, setServerSelectionTouched] = useState(false);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<number[]>([]);
  const [librarySelectionTouched, setLibrarySelectionTouched] = useState(false);
  const [libraryPreset, setLibraryPreset] = useState<LibraryPreset>('enabled');
  const [libraryQuery, setLibraryQuery] = useState('');
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<string | number | null>(null);
  const [confirmDeleteInv, setConfirmDeleteInv] = useState<string | number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const defaultServerIds = useMemo(() => {
    const verified = servers.filter(s => s.verified !== false).map(s => s.id);
    return verified.length > 0 ? verified : servers.map(s => s.id);
  }, [servers]);

  useEffect(() => {
    if (!serverSelectionTouched && defaultServerIds.length > 0) {
      setSelectedServerIds(defaultServerIds);
    }
  }, [defaultServerIds.join(','), serverSelectionTouched]);

  const libraries = useMemo(
    () => dedupeWizarrLibraries(rawLibraries, selectedServerIds),
    [rawLibraries, selectedServerIds],
  );
  const libraryById = useMemo(() => new Map(libraries.map(lib => [Number(lib.id), lib])), [libraries]);
  const defaultLibraryIds = useMemo(
    () => libraries.filter(lib => lib.enabled !== false).map(lib => lib.id),
    [libraries],
  );

  useEffect(() => {
    if (!librarySelectionTouched && defaultLibraryIds.length > 0) {
      setSelectedLibraryIds(defaultLibraryIds);
    }
  }, [defaultLibraryIds.join(','), librarySelectionTouched]);

  const visibleLibraries = libraries.filter(lib => {
    if (!libraryPresetMatch(lib, libraryPreset)) return false;
    const q = libraryQuery.trim().toLowerCase();
    if (!q) return true;
    return lib.name.toLowerCase().includes(q) || String(lib.serverName ?? '').toLowerCase().includes(q);
  });

  const selectLibraryPreset = (preset: LibraryPreset) => {
    setLibraryPreset(preset);
    setLibrarySelectionTouched(true);
    setSelectedLibraryIds(libraries.filter(lib => libraryPresetMatch(lib, preset)).map(lib => lib.id));
  };

  const toggleServer = (serverId: number) => {
    setServerSelectionTouched(true);
    setLibrarySelectionTouched(false);
    setSelectedServerIds(prev => prev.includes(serverId) ? prev.filter(id => id !== serverId) : [...prev, serverId]);
  };

  const toggleLibrary = (libraryId: number) => {
    setLibrarySelectionTouched(true);
    setSelectedLibraryIds(prev => prev.includes(libraryId) ? prev.filter(id => id !== libraryId) : [...prev, libraryId]);
  };

  if (wizarrStatus === 'unconfigured') {
    return <div className="flex items-center justify-center py-16 text-muted-foreground/50 text-sm">Wizarr not configured</div>;
  }
  if (wizarrStatus === 'error') {
    return <div className="flex items-center justify-center py-16 text-red-400/70 text-sm">Wizarr unreachable</div>;
  }

  const copyCode = (code: string) => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(code);
      setTimeout(() => setCopied(c => c === code ? null : c), 2000);
    });
  };

  const selectedLibrarySet = new Set(selectedLibraryIds);
  const selectedLibraryCount = selectedLibraryIds.length;
  const selectedServerCount = selectedServerIds.length;
  const canCreateInvitation =
    (servers.length === 0 || selectedServerCount > 0) &&
    (libraries.length === 0 || selectedLibraryCount > 0);

  return (
    <div className="space-y-6">
      {/* Invitations */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Invitations {invitations.length > 0 && <span className="normal-case font-normal">({invitations.length})</span>}
          </h3>
          {!creating ? (
            <button className="px-2.5 py-1 text-xs rounded border bg-primary/10 text-primary border-primary/20 hover:bg-primary/20" onClick={() => setCreating(true)}>+ Create</button>
          ) : (
            <button className="px-2 py-1 text-xs rounded border bg-muted/20 text-muted-foreground border-border/30" onClick={() => setCreating(false)}>Cancel</button>
          )}
        </div>
        {creating && (
          <div className="rounded-md border border-border/30 bg-muted/10 p-3 mb-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Invite expires</span>
                <select value={inviteExpiresInDays} onChange={e => setInviteExpiresInDays(Number((e.target as HTMLSelectElement).value))} className="w-full text-xs rounded border border-border/40 bg-muted/30 px-2 py-1.5 focus:outline-none">
                  {INVITE_EXPIRY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Access duration</span>
                <select value={accessDurationDays} disabled={createUnlimited} onChange={e => setAccessDurationDays(Number((e.target as HTMLSelectElement).value))} className="w-full text-xs rounded border border-border/40 bg-muted/30 px-2 py-1.5 focus:outline-none disabled:opacity-50">
                  {ACCESS_DURATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={createUnlimited} onChange={e => setCreateUnlimited((e.target as HTMLInputElement).checked)} />
              Unlimited access
            </label>

            {servers.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground">Servers {selectedServerCount > 0 && <span className="text-muted-foreground/60">({selectedServerCount})</span>}</div>
                <div className="flex gap-1.5 flex-wrap">
                  {servers.map(server => (
                    <button
                      key={server.id}
                      className={`px-2 py-0.5 text-xs rounded border transition-colors ${selectedServerIds.includes(server.id) ? 'bg-primary/15 text-primary border-primary/25' : 'bg-muted/20 text-muted-foreground border-border/30 hover:bg-muted/40'}`}
                      onClick={() => toggleServer(server.id)}
                    >
                      {server.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {libraries.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-muted-foreground">Libraries <span className="text-muted-foreground/60">({selectedLibraryCount}/{libraries.length})</span></div>
                  <div className="flex gap-1 flex-wrap justify-end">
                    {([
                      ['enabled', 'Enabled'],
                      ['movies', 'Movies'],
                      ['shows', 'TV'],
                      ['all', 'All'],
                    ] as [LibraryPreset, string][]).map(([preset, label]) => (
                      <button
                        key={preset}
                        className={`px-2 py-0.5 text-xs rounded border transition-colors ${libraryPreset === preset ? 'bg-primary/15 text-primary border-primary/25' : 'bg-muted/20 text-muted-foreground border-border/30 hover:bg-muted/40'}`}
                        onClick={() => selectLibraryPreset(preset)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="text"
                  value={libraryQuery}
                  onChange={e => setLibraryQuery((e.target as HTMLInputElement).value)}
                  placeholder="Filter libraries..."
                  className="w-full rounded border border-border/40 bg-muted/20 px-2 py-1.5 text-xs placeholder:text-muted-foreground/40 focus:outline-none"
                />
                <div className="max-h-36 overflow-y-auto grid grid-cols-2 gap-1.5 pr-1">
                  {visibleLibraries.map(lib => (
                    <label key={lib.id} className="flex items-center gap-1.5 text-xs text-muted-foreground rounded border border-border/20 bg-muted/10 px-2 py-1 cursor-pointer">
                      <input type="checkbox" checked={selectedLibrarySet.has(lib.id)} onChange={() => toggleLibrary(lib.id)} />
                      <span className="truncate">{lib.name}</span>
                      {lib.enabled === false && <span className="text-muted-foreground/40">off</span>}
                    </label>
                  ))}
                  {visibleLibraries.length === 0 && (
                    <div className="col-span-2 text-xs text-muted-foreground/50 py-2">No libraries match</div>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button className="px-2 py-1 text-xs rounded border bg-muted/20 text-muted-foreground border-border/30" onClick={() => setCreating(false)}>Cancel</button>
              <button
                className={`px-2.5 py-1 text-xs rounded border ${canCreateInvitation ? 'bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20' : 'bg-muted/20 text-muted-foreground/40 border-border/20 cursor-not-allowed'}`}
                disabled={!canCreateInvitation}
                onClick={() => {
                  if (!canCreateInvitation) return;
                  onAction('create-invitation', {
                    expiresInDays: inviteExpiresInDays,
                    durationDays: accessDurationDays,
                    unlimited: createUnlimited,
                    libraryIds: selectedLibraryIds,
                    serverIds: selectedServerIds,
                  });
                  setCreating(false);
                }}
              >
                Create
              </button>
            </div>
          </div>
        )}
        {invitations.length === 0 ? (
          <div className="text-xs text-muted-foreground/50 py-3">No active invitations</div>
        ) : (
          <div className="space-y-2">
            {invitations.map((inv: any) => {
              const invLibraryIds = Array.isArray(inv.specificLibraries) ? inv.specificLibraries.map((id: unknown) => Number(id)).filter(Number.isFinite) : [];
              const invLibraryText = invLibraryIds.map((id: number) => libraryById.get(id)?.name ?? `Library ${id}`).join(', ');
              const copyValue = inv.url ?? inv.code;
              return (
                <div key={inv.id ?? inv.code} className="rounded-md border border-border/30 bg-muted/10 p-2.5 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-foreground">{inv.code}</span>
                      {inv.status && <span className="text-xs text-muted-foreground/50">{inv.status}</span>}
                      {inv.unlimited && <span className="text-xs text-purple-400/70">unlimited access</span>}
                      {inv.duration && !inv.unlimited && <span className="text-xs text-muted-foreground/60">{formatDuration(inv.duration)}</span>}
                      {inv.used && <span className="text-xs text-muted-foreground/40">used</span>}
                    </div>
                    {invLibraryText && <div className="text-xs text-muted-foreground/50 mt-0.5 truncate">{invLibraryText}</div>}
                    {inv.expiresAt && <div className="text-xs text-muted-foreground/50 mt-0.5">Expires {new Date(inv.expiresAt).toLocaleDateString()}</div>}
                  </div>
                  <button
                    className={`px-2 py-0.5 text-xs rounded border transition-colors ${copied === copyValue ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-muted/20 text-muted-foreground border-border/30 hover:bg-muted/40'}`}
                    onClick={() => copyCode(copyValue)}
                  >{copied === copyValue ? '✓ Copied' : 'Copy'}</button>
                  {confirmDeleteInv !== (inv.id ?? inv.code) ? (
                    <button className="px-2 py-0.5 text-xs rounded border bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20" onClick={() => setConfirmDeleteInv(inv.id ?? inv.code)}>Revoke</button>
                  ) : (
                    <div className="flex gap-1">
                      <button className="px-2 py-0.5 text-xs rounded border bg-red-500/20 text-red-400 border-red-500/30" onClick={() => { onAction('delete-invitation', { id: inv.id ?? inv.code }); setConfirmDeleteInv(null); }}>Confirm</button>
                      <button className="px-2 py-0.5 text-xs rounded border bg-muted/20 text-muted-foreground border-border/30" onClick={() => setConfirmDeleteInv(null)}>✕</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Users */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Users {users.length > 0 && <span className="normal-case font-normal">({users.length})</span>}
        </h3>
        {users.length === 0 ? (
          <div className="text-xs text-muted-foreground/50 py-3">No users yet</div>
        ) : (
          <div className="space-y-1.5">
            {users.map((u: any) => (
              <div key={u.id} className="rounded-md border border-border/30 bg-muted/10 p-2.5 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{u.username}</div>
                  {u.email && <div className="text-xs text-muted-foreground/60 truncate">{u.email}</div>}
                  {u.expires && <div className="text-xs text-muted-foreground/50">Expires {new Date(u.expires).toLocaleDateString()}</div>}
                </div>
                {confirmDeleteUser !== u.id ? (
                  <button className="px-2 py-0.5 text-xs rounded border bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20" onClick={() => setConfirmDeleteUser(u.id)}>Remove</button>
                ) : (
                  <div className="flex gap-1">
                    <button className="px-2 py-0.5 text-xs rounded border bg-red-500/20 text-red-400 border-red-500/30" onClick={() => { onAction('delete-wizarr-user', { id: u.id, username: u.username }); setConfirmDeleteUser(null); }}>Confirm</button>
                    <button className="px-2 py-0.5 text-xs rounded border bg-muted/20 text-muted-foreground border-border/30" onClick={() => setConfirmDeleteUser(null)}>✕</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function PlexPanel({ onAction, pluginState }: PluginComponentProps) {
  const state = (pluginState ?? {}) as any;
  const [tab, setTab] = useState('streams');
  const [refreshing, setRefreshing] = useState(false);
  const lastRefreshRef = useRef<number>(0);

  const streamCount = (state.streams ?? []).length;
  const downloadCount = (state.downloads ?? []).length;
  const pendingCount = Number(state.pendingRequestCount ?? 0);
  const subtitleGapCount = Number(state.bazarrWantedMovieCount ?? state.bazarrBadges?.movies ?? 0) + Number(state.bazarrWantedEpisodeCount ?? state.bazarrBadges?.episodes ?? 0);
  const prowlarrIssueCount = (state.prowlarrHealth ?? []).length + (state.prowlarrIndexerStatus ?? []).length;
  const tdarrWorkerCount = (state.tdarrActiveWorkers ?? []).length;
  const lastRefreshTs = state.lastRefresh as number | undefined;

  if (lastRefreshTs && lastRefreshTs !== lastRefreshRef.current) {
    lastRefreshRef.current = lastRefreshTs;
    if (refreshing) setRefreshing(false);
  }

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    onAction('refresh');
  }, [onAction]);

  const refreshTimeStr = lastRefreshTs ? new Date(lastRefreshTs).toLocaleTimeString() : '';

  const tabs = [
    { id: 'streams',   label: 'Streams',   badge: streamCount > 0 ? streamCount : undefined },
    { id: 'downloads', label: 'Downloads', badge: downloadCount > 0 ? downloadCount : undefined },
    { id: 'library',   label: 'Library' },
    { id: 'requests',  label: 'Requests',  badge: pendingCount > 0 ? pendingCount : undefined },
    { id: 'subtitles', label: 'Subtitles', badge: subtitleGapCount > 0 ? subtitleGapCount : undefined },
    { id: 'indexers',  label: 'Indexers',  badge: prowlarrIssueCount > 0 ? prowlarrIssueCount : undefined },
    { id: 'transcodes', label: 'Transcodes', badge: tdarrWorkerCount > 0 ? tdarrWorkerCount : undefined },
    { id: 'wizarr',    label: 'Wizarr' },
    { id: 'stats',     label: 'Stats' },
  ];

  const tabCls = (id: string) =>
    `px-3 py-1.5 text-sm rounded-md cursor-pointer transition-colors flex items-center gap-1.5 ${tab === id ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/20'}`;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <h2 className="text-base font-semibold">📺 Plex & Media Stack</h2>
        <div className="flex items-center gap-2">
          {refreshTimeStr && <span className="text-xs text-muted-foreground/60">Updated {refreshTimeStr}</span>}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className={`px-2 py-1 text-xs rounded border transition-colors ${refreshing ? 'text-muted-foreground/40 border-border/20 cursor-not-allowed' : 'text-muted-foreground border-border/40 hover:text-foreground hover:border-border/60 hover:bg-muted/20'}`}
          >
            <span style={refreshing ? { display: 'inline-block', animation: 'spin 1s linear infinite' } : {}}>↻</span>
            {refreshing ? ' Refreshing…' : ' Refresh'}
          </button>
        </div>
      </div>
      <div className="flex gap-1 px-4 py-2 border-b border-border/20 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} className={tabCls(t.id)} onClick={() => setTab(t.id)}>
            {t.label}
            {t.badge != null && (
              <span className="text-xs bg-primary/30 text-primary px-1.5 py-0.5 rounded-full leading-none">{t.badge}</span>
            )}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {tab === 'streams'   && <StreamsTab pluginState={state} onAction={onAction} />}
        {tab === 'downloads' && <DownloadsTab pluginState={state} onAction={onAction} />}
        {tab === 'library'   && <LibraryBrowser onAction={onAction} pluginState={state} />}
        {tab === 'requests'  && <RequestsTab pluginState={state} onAction={onAction} />}
        {tab === 'subtitles' && <SubtitlesTab pluginState={state} onAction={onAction} />}
        {tab === 'indexers'  && <IndexersTab pluginState={state} onAction={onAction} />}
        {tab === 'transcodes' && <TranscodesTab pluginState={state} onAction={onAction} />}
        {tab === 'wizarr'    && <WizarrTab pluginState={state} onAction={onAction} />}
        {tab === 'stats'     && <StatsTab pluginState={state} />}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatDuration(value: number | string): string {
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'unlimited') return 'unlimited access';
    const days = Number(value);
    if (Number.isFinite(days)) return `${days}d access`;
    return value;
  }
  const minutes = value;
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}
