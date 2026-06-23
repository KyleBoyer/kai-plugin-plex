import React, { useState, useCallback, useEffect } from 'react';
import type { SearchResult, QualityProfile, RootFolder, LibraryStat } from '../../shared/types.js';

type MediaFilter = 'all' | 'movie' | 'show';

function libraryMatchesItem(item: SearchResult, selectedLibrary: LibraryStat | undefined): boolean {
  if (!selectedLibrary) return true;
  if (selectedLibrary.type === 'movie' && item.type !== 'movie') return false;
  if (selectedLibrary.type === 'show' && item.type !== 'show') return false;
  if (item.plexLibrarySectionId) return item.plexLibrarySectionId === selectedLibrary.id;

  const path = (item.rootFolderPath ?? '').toLowerCase();
  if (!path) return true;

  const name = selectedLibrary.name.toLowerCase();
  const libraryIsKids = /\b(kid|kids|children|family)\b/.test(name);
  const pathIsKids = /(^|[/\\\s_-])(kid|kids|children|family)([/\\\s_-]|$)/.test(path);
  if (libraryIsKids !== pathIsKids) return false;

  const generic = new Set(['movie', 'movies', 'tv', 'show', 'shows', 'series', 'kid', 'kids', 'children', 'family']);
  const hints = name.split(/[^a-z0-9]+/).filter(token => token && !generic.has(token));
  return hints.length === 0 || hints.some(token => path.includes(token));
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    'in-library':   { label: 'In Library', cls: 'bg-green-500/20 text-green-400 border-green-500/30' },
    'monitored':    { label: 'Monitored',  cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    'missing-file': { label: 'Missing',    cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
    'not-added':    { label: 'Not Added',  cls: 'bg-muted/50 text-muted-foreground border-border/50' },
  };
  const s = map[status] ?? map['not-added'];
  return <span className={`text-xs px-1.5 py-0.5 rounded border ${s.cls}`}>{s.label}</span>;
}

function SourceBadge({ source }: { source: string }) {
  const cls = source === 'radarr'
    ? 'text-orange-400/70 border-orange-500/20'
    : 'text-sky-400/70 border-sky-500/20';
  return <span className={`text-xs px-1.5 py-0.5 rounded border ${cls}`}>{source === 'radarr' ? 'Radarr' : 'Sonarr'}</span>;
}

function ManagePanel({
  result,
  qualityProfiles,
  rootFolders,
  onAction,
  onClose,
}: {
  result: SearchResult;
  qualityProfiles: QualityProfile[];
  rootFolders: RootFolder[];
  onAction: (a: string, d?: unknown) => void;
  onClose: () => void;
}) {
  const mediaId = result.source === 'radarr' ? result.radarrId : result.sonarrId;

  // Pre-select current values (initialised once on mount; useState ignores later prop changes)
  const initQp = result.qualityProfileId ? String(result.qualityProfileId) : '';
  const initRf = result.rootFolderPath ?? '';

  const [selectedQp, setSelectedQp] = useState(initQp);
  const [selectedRf, setSelectedRf] = useState(initRf);
  const [moveFiles, setMoveFiles] = useState(true);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [saving, setSaving] = useState(false);

  const currentQpName = qualityProfiles.find(p => p.id === result.qualityProfileId)?.name;
  const currentRfPath = result.rootFolderPath;
  // Best-effort: the current folder might not be in the dropdown list — show it as plain text too
  const currentRfInList = currentRfPath ? rootFolders.some(f => f.path === currentRfPath) : false;

  const qpChanged = Boolean(selectedQp) && selectedQp !== String(result.qualityProfileId ?? '');
  const rfChanged = Boolean(selectedRf) && selectedRf !== (result.rootFolderPath ?? '');
  const canSave = qpChanged || rfChanged;

  const handleSearch = useCallback(() => {
    onAction('search-media', { source: result.source, id: mediaId, title: result.title });
    onClose();
  }, [result, mediaId, onAction, onClose]);

  const handleMonitor = useCallback(() => {
    onAction('toggle-monitor', { source: result.source, id: mediaId, monitored: !result.monitored });
    onClose();
  }, [result, mediaId, onAction, onClose]);

  const handleRemove = useCallback(() => {
    if (result.source === 'radarr') {
      onAction('remove-movie', { radarrId: result.radarrId, title: result.title });
    } else {
      onAction('remove-show', { sonarrId: result.sonarrId, title: result.title });
    }
    onClose();
  }, [result, onAction, onClose]);

  const handleSave = useCallback(() => {
    if (!canSave || !mediaId) return;
    setSaving(true);
    const payload: Record<string, unknown> = { source: result.source, id: mediaId, title: result.title, moveFiles };
    if (qpChanged) payload.qualityProfileId = Number(selectedQp);
    if (rfChanged) payload.rootFolderPath = selectedRf;
    onAction('edit-media', payload);
    setSaving(false);
    onClose();
  }, [canSave, mediaId, result, selectedQp, selectedRf, moveFiles, qpChanged, rfChanged, onAction, onClose]);

  const btnBase = 'px-2.5 py-1 text-xs rounded border transition-colors';

  return (
    <div className="mt-2 rounded-md border border-border/30 bg-muted/20 p-3 space-y-3">
      {/* Monitor toggle */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Monitoring</span>
        <button
          className={`${btnBase} ${result.monitored
            ? 'bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20'
            : 'bg-muted/30 text-muted-foreground border-border/40 hover:bg-muted/50'}`}
          onClick={handleMonitor}
        >{result.monitored ? '👁 Monitored — click to unmonitor' : '👁 Not monitored — click to monitor'}</button>
      </div>

      {/* Force search */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Force search for missing files</span>
        <button className={`${btnBase} bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20`} onClick={handleSearch}>
          🔍 Search Now
        </button>
      </div>

      {/* Quality profile */}
      {qualityProfiles.length > 0 && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">
            Quality profile{currentQpName ? ` — current: ${currentQpName}` : ''}
          </label>
          <select
            value={selectedQp}
            onChange={e => setSelectedQp((e.target as HTMLSelectElement).value)}
            className="w-full rounded border border-border/40 bg-muted/30 px-2 py-1.5 text-xs focus:outline-none"
          >
            <option value="">— keep current —</option>
            {qualityProfiles.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
          </select>
        </div>
      )}

      {/* Root folder */}
      {rootFolders.length > 0 && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Root folder</label>
          {currentRfPath && !currentRfInList && (
            <div className="text-xs font-mono text-muted-foreground/70 bg-muted/20 rounded px-2 py-1">
              Current: {currentRfPath} <span className="text-muted-foreground/40">(not in list)</span>
            </div>
          )}
          <select
            value={selectedRf}
            onChange={e => setSelectedRf((e.target as HTMLSelectElement).value)}
            className="w-full rounded border border-border/40 bg-muted/30 px-2 py-1.5 text-xs font-mono focus:outline-none"
          >
            <option value="">
              {currentRfPath && currentRfInList ? `Current: ${currentRfPath}` : '— keep current —'}
            </option>
            {rootFolders.map(f => (
              <option key={f.path} value={f.path}>
                {f.path === currentRfPath ? `✓ ${f.path}` : f.path} ({formatBytes(f.freeSpace)} free)
              </option>
            ))}
          </select>
          {rfChanged && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={moveFiles} onChange={e => setMoveFiles((e.target as HTMLInputElement).checked)} />
              Also move files to new location
            </label>
          )}
        </div>
      )}

      {/* Apply / Close */}
      <div className="flex gap-2 pt-1">
        <button
          className={`${btnBase} ${canSave
            ? 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20'
            : 'bg-muted/20 text-muted-foreground/40 border-border/20 cursor-not-allowed'}`}
          onClick={handleSave}
          disabled={!canSave || saving}
        >{saving ? 'Saving...' : 'Apply Changes'}</button>
        <button className={`${btnBase} bg-muted/20 text-muted-foreground border-border/30 hover:bg-muted/40`} onClick={onClose}>Close</button>
      </div>

      {/* Remove — kept at bottom, dangerous zone */}
      <div className="pt-1 border-t border-border/20">
        {!confirmRemove ? (
          <button
            className={`${btnBase} bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20`}
            onClick={() => setConfirmRemove(true)}
          >🗑 Remove from {result.source === 'radarr' ? 'Radarr' : 'Sonarr'}</button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-400/80">Remove "{result.title}"?</span>
            <button className={`${btnBase} bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30`} onClick={handleRemove}>Confirm Remove</button>
            <button className={`${btnBase} bg-muted/20 text-muted-foreground border-border/30`} onClick={() => setConfirmRemove(false)}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

function AddPanel({
  result,
  qualityProfiles,
  rootFolders,
  onAction,
  onClose,
}: {
  result: SearchResult;
  qualityProfiles: QualityProfile[];
  rootFolders: RootFolder[];
  onAction: (a: string, d?: unknown) => void;
  onClose: () => void;
}) {
  const [selectedQp, setSelectedQp] = useState(qualityProfiles[0] ? String(qualityProfiles[0].id) : '');
  const [selectedRf, setSelectedRf] = useState(rootFolders[0]?.path ?? '');
  const [monitored, setMonitored] = useState(true);
  const [searchOnAdd, setSearchOnAdd] = useState(true);
  const [minimumAvailability, setMinimumAvailability] = useState('released');
  const [seriesType, setSeriesType] = useState('standard');
  const [seasonFolder, setSeasonFolder] = useState(true);
  const [seasonText, setSeasonText] = useState('');
  const canAdd = Boolean(selectedQp && selectedRf);
  const btnBase = 'px-2.5 py-1 text-xs rounded border transition-colors';

  const submit = useCallback(() => {
    if (!canAdd) return;
    if (result.type === 'movie') {
      onAction('add-movie', {
        tmdbId: result.tmdbId,
        title: result.title,
        year: result.year,
        qualityProfileId: Number(selectedQp),
        rootFolderPath: selectedRf,
        monitored,
        searchOnAdd,
        minimumAvailability,
      });
    } else {
      const seasons = seasonText.split(',')
        .map(s => Number(s.trim()))
        .filter(Number.isFinite)
        .map(seasonNumber => ({ seasonNumber, monitored: true }));
      onAction('add-show', {
        tvdbId: result.tvdbId,
        title: result.title,
        qualityProfileId: Number(selectedQp),
        rootFolderPath: selectedRf,
        monitored,
        searchOnAdd,
        seriesType,
        seasonFolder,
        seasons: seasons.length ? seasons : undefined,
      });
    }
    onClose();
  }, [canAdd, result, selectedQp, selectedRf, monitored, searchOnAdd, minimumAvailability, seriesType, seasonFolder, seasonText, onAction, onClose]);

  return (
    <div className="mt-2 rounded-md border border-primary/25 bg-primary/5 p-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Quality profile</span>
          <select value={selectedQp} onChange={e => setSelectedQp((e.target as HTMLSelectElement).value)} className="w-full rounded border border-border/40 bg-muted/30 px-2 py-1.5 text-xs focus:outline-none">
            <option value="">Choose profile</option>
            {qualityProfiles.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Root folder</span>
          <select value={selectedRf} onChange={e => setSelectedRf((e.target as HTMLSelectElement).value)} className="w-full rounded border border-border/40 bg-muted/30 px-2 py-1.5 text-xs font-mono focus:outline-none">
            <option value="">Choose folder</option>
            {rootFolders.map(f => <option key={f.path} value={f.path}>{f.path} ({formatBytes(f.freeSpace)} free)</option>)}
          </select>
        </label>
      </div>
      <div className="flex gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={monitored} onChange={e => setMonitored((e.target as HTMLInputElement).checked)} />
          Monitored
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={searchOnAdd} onChange={e => setSearchOnAdd((e.target as HTMLInputElement).checked)} />
          Search on add
        </label>
        {result.type === 'show' && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={seasonFolder} onChange={e => setSeasonFolder((e.target as HTMLInputElement).checked)} />
            Season folders
          </label>
        )}
      </div>
      {result.type === 'movie' ? (
        <label className="space-y-1 block">
          <span className="text-xs text-muted-foreground">Minimum availability</span>
          <select value={minimumAvailability} onChange={e => setMinimumAvailability((e.target as HTMLSelectElement).value)} className="w-full rounded border border-border/40 bg-muted/30 px-2 py-1.5 text-xs focus:outline-none">
            <option value="released">Released</option>
            <option value="inCinemas">In cinemas</option>
            <option value="announced">Announced</option>
          </select>
        </label>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Series type</span>
            <select value={seriesType} onChange={e => setSeriesType((e.target as HTMLSelectElement).value)} className="w-full rounded border border-border/40 bg-muted/30 px-2 py-1.5 text-xs focus:outline-none">
              <option value="standard">Standard</option>
              <option value="daily">Daily</option>
              <option value="anime">Anime</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Seasons</span>
            <input value={seasonText} onChange={e => setSeasonText((e.target as HTMLInputElement).value)} placeholder="All, or 1,2,3" className="w-full rounded border border-border/40 bg-muted/30 px-2 py-1.5 text-xs focus:outline-none" />
          </label>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button className={`${btnBase} bg-muted/20 text-muted-foreground border-border/30 hover:bg-muted/40`} onClick={onClose}>Cancel</button>
        <button className={`${btnBase} ${canAdd ? 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20' : 'bg-muted/20 text-muted-foreground/40 border-border/20 cursor-not-allowed'}`} disabled={!canAdd} onClick={submit}>Add</button>
      </div>
    </div>
  );
}

function ResultRow({
  result,
  qualityProfiles,
  rootFolders,
  libraryItems,
  onAction,
}: {
  result: SearchResult;
  qualityProfiles: QualityProfile[];
  rootFolders: RootFolder[];
  libraryItems: SearchResult[];
  onAction: (action: string, data?: unknown) => void;
}) {
  // Search results from lookup API may lack rootFolderPath/qualityProfileId for in-library items.
  // Merge from the library cache (populated by the slow poll) when missing.
  const enriched: SearchResult = (() => {
    if (result.rootFolderPath && result.qualityProfileId) return result;
    const match = libraryItems.find(item =>
      (result.radarrId && item.radarrId === result.radarrId) ||
      (result.sonarrId && item.sonarrId === result.sonarrId)
    );
    if (!match) return result;
    return {
      ...result,
      rootFolderPath: result.rootFolderPath ?? match.rootFolderPath,
      qualityProfileId: result.qualityProfileId ?? match.qualityProfileId,
      poster: result.poster ?? match.poster,
    };
  })();
  const [showManage, setShowManage] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const inLibrary = enriched.status !== 'not-added';
  const btnBase = 'px-2 py-0.5 text-xs rounded border transition-colors';

  return (
    <div className="py-2.5 border-b border-border/20 last:border-0">
      <div className="flex items-start gap-3">
        {enriched.poster && (
          <img
            src={enriched.poster}
            alt=""
            className="flex-shrink-0 w-9 h-14 object-cover rounded shadow-sm opacity-90"
            loading="lazy"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{enriched.title}</span>
            {enriched.year && <span className="text-xs text-muted-foreground">{enriched.year}</span>}
            <SourceBadge source={enriched.source} />
            <StatusBadge status={enriched.status} />
          </div>
          {enriched.overview && (
            <p className="text-xs text-muted-foreground/70 mt-0.5 line-clamp-2">{enriched.overview}</p>
          )}
        </div>
        <div className="flex gap-1.5 flex-shrink-0 mt-0.5">
          {!inLibrary ? (
            <button
              className={`${btnBase} bg-primary/10 text-primary border-primary/20 hover:bg-primary/20`}
              onClick={() => setShowAdd(p => !p)}
            >+ Add</button>
          ) : (
            <button
              className={`${btnBase} ${showManage ? 'bg-muted/50 text-foreground border-border/60' : 'bg-muted/20 text-muted-foreground border-border/30 hover:bg-muted/40'}`}
              onClick={() => setShowManage(p => !p)}
              title="Manage"
            >⚙ Manage</button>
          )}
        </div>
      </div>
      {showManage && inLibrary && (
        <ManagePanel
          result={enriched}
          qualityProfiles={qualityProfiles}
          rootFolders={rootFolders}
          onAction={onAction}
          onClose={() => setShowManage(false)}
        />
      )}
      {showAdd && !inLibrary && (
        <AddPanel
          result={enriched}
          qualityProfiles={qualityProfiles}
          rootFolders={rootFolders}
          onAction={onAction}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

export function LibraryBrowser({ onAction, pluginState }: {
  onAction: (action: string, data?: unknown) => void;
  pluginState?: Record<string, unknown>;
}) {
  const state = (pluginState ?? {}) as any;
  const searchResults = (state.searchResults ?? []) as SearchResult[];
  const searchLoading = Boolean(state.searchLoading);
  const libraryItems = (state.libraryItems ?? []) as SearchResult[];
  const libraryLoading = Boolean(state.libraryLoading);
  const rawQp = (state.qualityProfiles ?? {}) as { radarr?: QualityProfile[]; sonarr?: QualityProfile[] };
  const rawRf = (state.rootFolders ?? {}) as { radarr?: RootFolder[]; sonarr?: RootFolder[] };
  const libraryStats = (state.libraryStats ?? []) as LibraryStat[];

  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<MediaFilter>('all');
  const [tab, setTab] = useState<'all' | 'in-library' | 'missing'>('all');
  const [plexSectionId, setPlexSectionId] = useState<'all' | string>('all');

  const hasQuery = Boolean(query.trim());
  const matchesTypeFilter = (item: SearchResult): boolean => {
    if (typeFilter === 'all') return true;
    if (item.type === typeFilter) return true;
    if (typeFilter === 'movie') return item.source === 'radarr';
    return item.source === 'sonarr';
  };

  const doSearch = useCallback(() => {
    const q = query.trim();
    if (!q) return;
    onAction('search', { query: q, type: typeFilter });
  }, [query, typeFilter, onAction]);

  useEffect(() => {
    if (!query.trim()) return;
    const timer = setTimeout(doSearch, 500);
    return () => clearTimeout(timer);
  }, [doSearch, query, typeFilter]);

  const selectedLibrary = plexSectionId === 'all' ? undefined : libraryStats.find(l => l.id === plexSectionId);
  const typedLibraryItems = libraryItems.filter(matchesTypeFilter).filter(item => libraryMatchesItem(item, selectedLibrary));
  const typedSearchResults = searchResults.filter(matchesTypeFilter).filter(item => libraryMatchesItem(item, selectedLibrary));
  const baseItems = hasQuery ? typedSearchResults : typedLibraryItems;
  const isLoading = hasQuery ? searchLoading : libraryLoading;

  const filtered = baseItems.filter(r => {
    if (tab === 'in-library') return r.status === 'in-library' || r.status === 'monitored';
    if (tab === 'missing') return r.status === 'missing-file';
    return true;
  });

  const inLibraryCount = typedLibraryItems.filter(r => r.status === 'in-library' || r.status === 'monitored').length;
  const missingCount = typedLibraryItems.filter(r => r.status === 'missing-file').length;

  const tabCls = (active: boolean) =>
    `px-3 py-1.5 text-xs rounded-md cursor-pointer transition-colors ${active ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`;

  const refreshPlexLibrary = useCallback(() => {
    if (plexSectionId === 'all') {
      onAction('refresh-all-plex-libraries');
      return;
    }
    const lib = libraryStats.find(l => l.id === plexSectionId);
    onAction('refresh-plex-library', { sectionId: plexSectionId, name: lib?.name ?? plexSectionId });
  }, [plexSectionId, libraryStats, onAction]);

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={e => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={e => e.key === 'Enter' && doSearch()}
          placeholder="Search movies & shows..."
          className="flex-1 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-sm placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none"
        />
        <select
          value={typeFilter}
          onChange={e => setTypeFilter((e.target as HTMLSelectElement).value as MediaFilter)}
          className="rounded-lg border border-border/50 bg-muted/30 px-2 py-2 text-sm focus:outline-none"
        >
          <option value="all">All</option>
          <option value="movie">Movies</option>
          <option value="show">Shows</option>
        </select>
        <button
          onClick={() => onAction('refresh')}
          className="px-3 py-2 rounded-lg bg-muted/20 hover:bg-muted/40 border border-border/40 text-sm transition-colors"
          title="Reload plugin data"
        >↻</button>
      </div>
      {libraryStats.length > 0 && (
        <div className="flex gap-2 items-center">
          <select
            value={plexSectionId}
            onChange={e => setPlexSectionId((e.target as HTMLSelectElement).value)}
            className="flex-1 rounded-lg border border-border/50 bg-muted/20 px-2 py-1.5 text-xs focus:outline-none"
            title="Filter catalog by Plex library"
          >
            <option value="all">All Plex libraries</option>
            {libraryStats.map(lib => (
              <option key={lib.id} value={lib.id}>{lib.name} ({lib.count.toLocaleString()})</option>
            ))}
          </select>
          <button
            onClick={refreshPlexLibrary}
            className="px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 border border-primary/20 text-xs text-primary transition-colors"
            title="Ask Plex to refresh the selected library"
          >
            {plexSectionId === 'all' ? 'Refresh All' : 'Refresh Library'}
          </button>
        </div>
      )}
      <div className="flex gap-1">
        <button className={tabCls(tab === 'all')} onClick={() => setTab('all')}>
          All {!hasQuery && typedLibraryItems.length > 0 && <span className="ml-1 text-muted-foreground/60">({typedLibraryItems.length})</span>}
        </button>
        <button className={tabCls(tab === 'in-library')} onClick={() => setTab('in-library')}>
          In Library {inLibraryCount > 0 && <span className="ml-1 text-muted-foreground/60">({inLibraryCount})</span>}
        </button>
        <button className={tabCls(tab === 'missing')} onClick={() => setTab('missing')}>
          Missing {missingCount > 0 && <span className="ml-1 text-muted-foreground/60">({missingCount})</span>}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading && !filtered.length ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            {hasQuery ? 'Searching...' : 'Loading library...'}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground/50 text-sm">
            {hasQuery ? 'No results' : libraryItems.length === 0 ? 'Library loading...' : 'Nothing here'}
          </div>
        ) : (
          <div>
            <div className="text-xs text-muted-foreground mb-2 flex items-center gap-2">
              <span>{filtered.length} {hasQuery ? 'result' : 'item'}{filtered.length !== 1 ? 's' : ''}</span>
              {isLoading && <span className="text-muted-foreground/50 animate-pulse">refreshing...</span>}
            </div>
            {filtered.map(r => (
              <ResultRow
                key={r.id}
                result={r}
                qualityProfiles={r.source === 'radarr' ? (rawQp.radarr ?? []) : (rawQp.sonarr ?? [])}
                rootFolders={r.source === 'radarr' ? (rawRf.radarr ?? []) : (rawRf.sonarr ?? [])}
                libraryItems={libraryItems}
                onAction={onAction}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '—';
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
