import type { ToolDefinition } from '../shared/types.js';
import type { RadarrClient } from './clients/radarr.js';
import type { SonarrClient } from './clients/sonarr.js';
import type { TautulliClient } from './clients/tautulli.js';
import type { SabnzbdClient } from './clients/sabnzbd.js';
import type { QbittorrentClient } from './clients/qbittorrent.js';
import type { SeerClient } from './clients/seer.js';
import type { PlexClient, PlexLibraryItem } from './clients/plex.js';
import type { BazarrClient } from './clients/bazarr.js';
import type { ProwlarrClient } from './clients/prowlarr.js';
import type { TdarrClient } from './clients/tdarr.js';
import type { WizarrClient } from './clients/wizarr.js';

interface ToolClients {
  radarr?: RadarrClient;
  sonarr?: SonarrClient;
  tautulli?: TautulliClient;
  sabnzbd?: SabnzbdClient;
  qbittorrent?: QbittorrentClient;
  seer?: SeerClient;
  plex?: PlexClient;
  bazarr?: BazarrClient;
  prowlarr?: ProwlarrClient;
  tdarr?: TdarrClient;
  wizarr?: WizarrClient;
}

type AnyRecord = Record<string, unknown>;

function stringParam(value: unknown): string {
  return String(value ?? '').trim();
}

function stringFilters(...values: unknown[]): string[] {
  return values.flatMap(value => {
    if (Array.isArray(value)) return value.map(stringParam);
    return stringParam(value).split(',');
  }).map(value => value.trim()).filter(Boolean);
}

function numberFilters(...values: unknown[]): number[] {
  return values.flatMap(value => Array.isArray(value) ? value : [value])
    .filter(value => value != null && value !== '')
    .map(value => Number(value))
    .filter(Number.isFinite);
}

function boolParam(value: unknown): boolean | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return undefined;
}

function intParam(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function getPaging(input: AnyRecord, defaultLimit: number, maxLimit: number): { limit: number; offset: number } {
  return {
    limit: intParam(input.limit, defaultLimit, 1, maxLimit),
    offset: intParam(input.offset, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

function pageItems<T>(items: T[], limit: number, offset: number): T[] {
  return items.slice(offset, offset + limit);
}

function pageMeta(total: number, returned: number, limit: number, offset: number): AnyRecord {
  return {
    total,
    returned,
    limit,
    offset,
    hasMore: offset + returned < total,
  };
}

function includesText(value: unknown, needle: string): boolean {
  return String(value ?? '').toLowerCase().includes(needle);
}

function matchesQuery(query: string, ...values: unknown[]): boolean {
  if (!query) return true;
  const normalized = query.toLowerCase();
  return values.some(value => includesText(value, normalized));
}

function matchesStringFilters(value: unknown, filters: string[]): boolean {
  if (!filters.length) return true;
  return filters.some(filter => includesText(value, filter.toLowerCase()));
}

function matchesNumberFilters(value: unknown, filters: number[]): boolean {
  if (!filters.length) return true;
  const n = Number(value);
  return Number.isFinite(n) && filters.includes(n);
}

function matchesOptionalBool(value: unknown, filter: boolean | undefined): boolean {
  return filter == null || Boolean(value) === filter;
}

function firstString(item: AnyRecord, keys: string[]): string {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function filterRecords<T extends AnyRecord>(
  items: T[],
  options: {
    query?: string;
    queryKeys?: string[];
    stringFilters?: { keys: string[]; filters: string[] }[];
    numberFilters?: { keys: string[]; filters: number[] }[];
    boolFilters?: { key: string; value: boolean | undefined }[];
  },
): T[] {
  const query = options.query ?? '';
  return items.filter(item => {
    if (query && !matchesQuery(query, ...(options.queryKeys ?? []).map(key => item[key]))) return false;
    for (const filter of options.stringFilters ?? []) {
      if (!filter.filters.length) continue;
      if (!filter.keys.some(key => matchesStringFilters(item[key], filter.filters))) return false;
    }
    for (const filter of options.numberFilters ?? []) {
      if (!filter.filters.length) continue;
      if (!filter.keys.some(key => matchesNumberFilters(item[key], filter.filters))) return false;
    }
    for (const filter of options.boolFilters ?? []) {
      if (!matchesOptionalBool(item[filter.key], filter.value)) return false;
    }
    return true;
  });
}

// Ordinal certification ladders, least to most restrictive. Used for ratingOperator
// comparisons (lt/lte/gt/gte) so callers can say "PG-13 or below" instead of enumerating
// every rating in that range. eq/ne comparisons work on any string, ranked or not.
const MOVIE_RATING_ORDER = ['G', 'PG', 'PG-13', 'R', 'NC-17'];
const TV_RATING_ORDER = ['TV-Y', 'TV-Y7', 'TV-Y7-FV', 'TV-G', 'TV-PG', 'TV-14', 'TV-MA'];

// A deliberately small, auditable crosswalk for callers that provide one
// ceiling for a mixed movie/TV query. These systems are not literally the
// same scale, so the response reports the resolved pair. Callers can override
// either side explicitly when their household policy differs.
const MOVIE_TO_TV_RATING = new Map([
  ['G', 'TV-G'],
  ['PG', 'TV-PG'],
  ['PG-13', 'TV-14'],
  ['R', 'TV-MA'],
  ['NC-17', 'TV-MA'],
]);
const TV_TO_MOVIE_RATING = new Map([
  ['TV-Y', 'G'],
  ['TV-Y7', 'PG'],
  ['TV-Y7-FV', 'PG'],
  ['TV-G', 'G'],
  ['TV-PG', 'PG'],
  ['TV-14', 'PG-13'],
  ['TV-MA', 'R'],
]);

// Ratings are compared with dashes/spaces stripped so common formatting variants
// (e.g. "PG13", "PG 13", "PG-13") all resolve to the same ladder position.
function normalizeRatingKey(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function canonicalRatingKey(value: unknown, mediaType: 'movie' | 'show'): string {
  const key = normalizeRatingKey(value);
  // Common model/user shorthand. This is intentionally explicit rather than
  // fuzzy: unknown ratings must continue to fail closed.
  if (mediaType === 'show' && key === 'TV7') return 'TVY7';
  return key;
}

const MOVIE_RATING_RANK = new Map(MOVIE_RATING_ORDER.map((rating, idx) => [normalizeRatingKey(rating), idx]));
const TV_RATING_RANK = new Map(TV_RATING_ORDER.map((rating, idx) => [normalizeRatingKey(rating), idx]));

function ratingRank(rating: unknown, mediaType: 'movie' | 'show'): number | undefined {
  const ranks = mediaType === 'show' ? TV_RATING_RANK : MOVIE_RATING_RANK;
  return ranks.get(canonicalRatingKey(rating, mediaType));
}

function canonicalRating(value: unknown, mediaType: 'movie' | 'show'): string | undefined {
  const key = canonicalRatingKey(value, mediaType);
  const order = mediaType === 'show' ? TV_RATING_ORDER : MOVIE_RATING_ORDER;
  return order.find(rating => normalizeRatingKey(rating) === key);
}

function resolveMixedRatingCeilings(input: AnyRecord): {
  operator: string;
  movieValue: string;
  showValue: string;
  policy?: AnyRecord;
  error?: string;
} {
  const automaticValue = stringParam(input.maxContentRating);
  const legacyValue = stringParam(input.ratingValue);
  let movieValue = stringParam(input.movieMaxRating ?? input.movieRatingValue);
  let showValue = stringParam(input.showMaxRating ?? input.showRatingValue);
  let operator = stringParam(input.ratingOperator);
  let convertedFrom: string | undefined;

  if (automaticValue) {
    operator = operator || 'lte';
    const movie = canonicalRating(automaticValue, 'movie');
    const show = canonicalRating(automaticValue, 'show');
    if (movie) {
      movieValue ||= movie;
      showValue ||= MOVIE_TO_TV_RATING.get(movie) ?? '';
      convertedFrom = 'movie';
    } else if (show) {
      showValue ||= show;
      movieValue ||= TV_TO_MOVIE_RATING.get(show) ?? '';
      convertedFrom = 'show';
    } else {
      return {
        operator,
        movieValue,
        showValue,
        error: `Unrecognized maxContentRating "${automaticValue}". Use a movie rating (${MOVIE_RATING_ORDER.join(', ')}) or TV rating (${TV_RATING_ORDER.join(', ')}).`,
      };
    }
  } else {
    movieValue ||= legacyValue;
    showValue ||= legacyValue;
    if (input.movieMaxRating != null || input.showMaxRating != null) operator ||= 'lte';
  }

  const canonicalMovie = movieValue ? canonicalRating(movieValue, 'movie') : undefined;
  const canonicalShow = showValue ? canonicalRating(showValue, 'show') : undefined;
  if (canonicalMovie) movieValue = canonicalMovie;
  if (canonicalShow) showValue = canonicalShow;
  const policy = automaticValue ? {
    requestedMaxContentRating: automaticValue,
    convertedFrom,
    movieMaxRating: movieValue,
    showMaxRating: showValue,
    comparison: operator,
  } : undefined;
  return { operator, movieValue, showValue, policy };
}

// Loose contentRating matching: substring match (so "PG" matches "PG-13") OR'd with a
// dash/space/case-insensitive exact match (so "PG13" still matches "PG-13").
function matchesContentRatingFilters(rating: unknown, filters: string[]): boolean {
  if (!filters.length) return true;
  const normalizedRating = normalizeRatingKey(rating);
  return filters.some(filter => includesText(rating, filter.toLowerCase()) || normalizedRating === normalizeRatingKey(filter));
}

const RATING_OPERATORS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'];

// ratingOperator/ratingValue mistakes must fail loudly. Silently matching everything (an
// unrecognized operator) or matching nothing (a rating that isn't on the relevant ladder,
// e.g. a TV code used for a movie comparison) both look like a valid empty/full result to
// the caller, which is exactly the confusing failure mode this validation exists to avoid.
function validateRatingOperator(operator: string): string | undefined {
  if (!operator) return undefined;
  if (!RATING_OPERATORS.includes(operator)) {
    return `Unrecognized ratingOperator "${operator}". Use one of: ${RATING_OPERATORS.join(', ')}.`;
  }
  return undefined;
}

function validateRatingValue(operator: string, value: string, mediaType: 'movie' | 'show'): string | undefined {
  if (!operator || operator === 'eq' || operator === 'ne' || !value) return undefined;
  if (ratingRank(value, mediaType) != null) return undefined;
  const order = mediaType === 'show' ? TV_RATING_ORDER : MOVIE_RATING_ORDER;
  const label = mediaType === 'show' ? 'TV' : 'movie';
  return `"${value}" is not a recognized ${label} rating for a ${operator} comparison. Valid ${label} ratings: ${order.join(', ')}.`;
}

function matchesRatingOperator(rating: unknown, mediaType: 'movie' | 'show', operator: string, value: string): boolean {
  const normalizedRating = canonicalRatingKey(rating, mediaType);
  const normalizedValue = canonicalRatingKey(value, mediaType);
  if (operator === 'eq') return normalizedRating === normalizedValue;
  if (operator === 'ne') return normalizedRating !== normalizedValue;
  const ratingIdx = ratingRank(rating, mediaType);
  const valueIdx = ratingRank(value, mediaType);
  if (ratingIdx == null || valueIdx == null) return false;
  switch (operator) {
    case 'lt': return ratingIdx < valueIdx;
    case 'lte': return ratingIdx <= valueIdx;
    case 'gt': return ratingIdx > valueIdx;
    case 'gte': return ratingIdx >= valueIdx;
    default: return false;
  }
}

function combinedLocationDecision(
  item: AnyRecord,
  includeFilters: string[],
  excludeFilters: string[],
): { include: boolean; unknown: boolean } {
  if (!includeFilters.length && !excludeFilters.length) return { include: true, unknown: false };
  const sectionKnown = Boolean(item.plexLibrarySectionKnown);
  const rootMatchesInclude = includeFilters.length > 0 && matchesStringFilters(item.rootFolderPath, includeFilters);
  const sectionMatchesInclude = includeFilters.length > 0 && sectionKnown && matchesStringFilters(item.plexLibrarySectionName, includeFilters);
  const rootMatchesExclude = excludeFilters.length > 0 && matchesStringFilters(item.rootFolderPath, excludeFilters);
  const sectionMatchesExclude = excludeFilters.length > 0 && sectionKnown && matchesStringFilters(item.plexLibrarySectionName, excludeFilters);

  if (includeFilters.length && !rootMatchesInclude && !sectionMatchesInclude) {
    return { include: false, unknown: !sectionKnown };
  }
  if (rootMatchesExclude || sectionMatchesExclude) return { include: false, unknown: false };
  // When exclusion depends on either source, an item that is outside the root
  // term but could not be cross-referenced to Plex is ambiguous. Fail closed
  // instead of falsely declaring it outside the named location.
  if (excludeFilters.length && !sectionKnown) return { include: false, unknown: true };
  return { include: true, unknown: false };
}

// Cross-references Radarr/Sonarr titles against Plex's own library sections, so a title's
// Radarr/Sonarr root folder can be compared against the Plex library it actually landed in.
// Mirrors the matching logic in poller.ts (kept local rather than shared so each file stays
// independently loadable by the test harness's single-file TS transpiler).
interface PlexCatalogIndex {
  movieByTmdb: Map<number, PlexLibraryItem>;
  showByTvdb: Map<number, PlexLibraryItem>;
  titleYear: Map<string, PlexLibraryItem>;
  titleOnly: Map<string, PlexLibraryItem | null>;
}

interface PlexCatalogLookupItem {
  type: 'movie' | 'show';
  title: string;
  year?: number;
  tmdbId?: number;
  tvdbId?: number;
}

function normalizeCatalogTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function catalogTitleKey(type: 'movie' | 'show', title: string, year?: number): string {
  return `${type}:${normalizeCatalogTitle(title)}:${year ?? ''}`;
}

function catalogTitleOnlyKey(type: 'movie' | 'show', title: string): string {
  return `${type}:${normalizeCatalogTitle(title)}`;
}

function buildPlexCatalogIndex(items: PlexLibraryItem[]): PlexCatalogIndex {
  const index: PlexCatalogIndex = {
    movieByTmdb: new Map(),
    showByTvdb: new Map(),
    titleYear: new Map(),
    titleOnly: new Map(),
  };

  for (const item of items) {
    if (item.type === 'movie' && item.tmdbId) index.movieByTmdb.set(item.tmdbId, item);
    if (item.type === 'show' && item.tvdbId) index.showByTvdb.set(item.tvdbId, item);
    if (item.title) {
      index.titleYear.set(catalogTitleKey(item.type, item.title, item.year), item);
      const simpleKey = catalogTitleOnlyKey(item.type, item.title);
      const existing = index.titleOnly.get(simpleKey);
      index.titleOnly.set(simpleKey, existing && existing.sectionId !== item.sectionId ? null : item);
    }
  }

  return index;
}

function findPlexCatalogMatch(item: PlexCatalogLookupItem, index: PlexCatalogIndex): PlexLibraryItem | undefined {
  let match: PlexLibraryItem | undefined;
  if (item.type === 'movie' && item.tmdbId) match = index.movieByTmdb.get(item.tmdbId);
  if (!match && item.type === 'show' && item.tvdbId) match = index.showByTvdb.get(item.tvdbId);
  if (!match) {
    match = index.titleYear.get(catalogTitleKey(item.type, item.title, item.year)) ??
      index.titleOnly.get(catalogTitleOnlyKey(item.type, item.title)) ??
      undefined;
  }
  return match ?? undefined;
}

function sortRecords<T extends AnyRecord>(items: T[], sortBy: string, direction: string): T[] {
  if (!sortBy) return items;
  const factor = direction === 'desc' || direction === 'descending' ? -1 : 1;
  return [...items].sort((a, b) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor;
    return String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true, sensitivity: 'base' }) * factor;
  });
}

export function buildPlexTools(clients: ToolClients): ToolDefinition[] {
  async function listLibrarySections(input: AnyRecord): Promise<unknown> {
    if (!clients.plex) return { error: 'Plex not configured' };
    try {
      const query = stringParam(input.query).toLowerCase();
      const mediaTypes = stringFilters(input.mediaType, input.mediaTypes, input.type);
      const { limit, offset } = getPaging(input, 50, 100);
      const libs = await clients.plex.getLibraryCounts();
      const filtered = filterRecords(libs as unknown as AnyRecord[], {
        query,
        queryKeys: ['id', 'name', 'type'],
        stringFilters: [{ keys: ['type'], filters: mediaTypes }],
      });
      const paged = pageItems(filtered, limit, offset);
      return { ...pageMeta(filtered.length, paged.length, limit, offset), libraries: paged };
    } catch (e) {
      return { error: String(e) };
    }
  }

  // Section name/id filters are free-text against a dynamic, per-server list — unlike
  // ratings there's no fixed enum to check client-side, so a typo (e.g. "Kidz Movies")
  // would otherwise silently match zero items with no explanation. Validate against the
  // real configured sections and fail loudly, listing what's actually available.
  async function validatePlexSectionFilters(names: string[], ids: string[], excludeNames: string[]): Promise<string | undefined> {
    if (!names.length && !ids.length && !excludeNames.length) return undefined;
    if (!clients.plex) return undefined;
    let sections: { id: string; name: string }[];
    try {
      sections = await clients.plex.getLibraries();
    } catch {
      return undefined; // best effort; the caller's own Plex fetch will surface the real error
    }
    const unknownNames = names.filter(n => !sections.some(s => includesText(s.name, n.toLowerCase())));
    const unknownExcludeNames = excludeNames.filter(n => !sections.some(s => includesText(s.name, n.toLowerCase())));
    const unknownIds = ids.filter(id => !sections.some(s => String(s.id) === id));
    if (!unknownNames.length && !unknownExcludeNames.length && !unknownIds.length) return undefined;
    const problems = [
      unknownNames.length ? `section name(s) ${JSON.stringify(unknownNames)}` : '',
      unknownExcludeNames.length ? `exclude section name(s) ${JSON.stringify(unknownExcludeNames)}` : '',
      unknownIds.length ? `section id(s) ${JSON.stringify(unknownIds)}` : '',
    ].filter(Boolean).join(', ');
    const knownList = sections.length ? sections.map(s => `"${s.name}" (id ${s.id})`).join(', ') : '(no Plex library sections found)';
    return `No configured Plex library section matches ${problems}. Known sections: ${knownList}.`;
  }

  return [
    {
      name: 'plex_search_media',
      description: 'Search for movies and TV shows across Radarr and Sonarr. Returns title, year, type, and whether it\'s already in the library.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term (title or partial title)' },
          type: { type: 'string', enum: ['all', 'movie', 'show'], description: 'Filter by media type', default: 'all' },
          limit: { type: 'number', default: 10, description: 'Maximum search results per media type. Capped at 25.' },
        },
        required: ['query'],
      },
      async execute(input) {
        const query = String(input.query ?? '');
        const type = String(input.type ?? 'all');
        const limit = intParam(input.limit, 10, 1, 25);
        const results = [];

        if ((type === 'all' || type === 'movie') && clients.radarr) {
          try {
            const movies = await clients.radarr.lookupMovies(query);
            results.push(...clients.radarr.moviesAsSearchResults(movies.slice(0, limit)));
          } catch (e) {
            results.push({ error: `Radarr search failed: ${e}` });
          }
        }

        if ((type === 'all' || type === 'show') && clients.sonarr) {
          try {
            const series = await clients.sonarr.lookupSeries(query);
            results.push(...clients.sonarr.seriesAsSearchResults(series.slice(0, limit)));
          } catch (e) {
            results.push({ error: `Sonarr search failed: ${e}` });
          }
        }

        return { results, total: results.length, limit };
      },
    },


    {
      name: 'plex_list_library',
      description: 'List existing Radarr movies and Sonarr shows, filtered by content-rating ceiling and/or location. For a mixed query, maxContentRating automatically translates between the movie and TV rating systems and the response reports the resolved pair; movieMaxRating/showMaxRating can override either side. includeLocationName/excludeLocationName match the caller-supplied text against EITHER the root folder path OR Plex library section name, so installations do not need prescribed folder or section names. Check movieHasMore/seriesHasMore and increase offset to page.',
      inputSchema: {
        type: 'object',
        properties: {
          mediaType: { type: 'string', enum: ['all', 'movie', 'show'], default: 'all' },
          query: { type: 'string', description: 'Optional case-insensitive title/id/rating/status search term.' },
          maxContentRating: { type: 'string', enum: [...MOVIE_RATING_ORDER, ...TV_RATING_ORDER], description: 'Maximum allowed rating. Supply one movie OR TV code; for mediaType=all the plugin converts it to the other system (for example PG-13 resolves to movie PG-13 and TV-14). The resolved pair is returned. Use the explicit overrides for a custom household policy.' },
          movieMaxRating: { type: 'string', enum: MOVIE_RATING_ORDER, description: 'Optional movie-specific maximum; overrides the converted movie ceiling.' },
          showMaxRating: { type: 'string', enum: TV_RATING_ORDER, description: 'Optional TV-specific maximum; overrides the converted TV ceiling.' },
          includeLocationName: { type: ['string', 'array'], items: { type: 'string' }, description: 'Caller-defined location text to include. A title matches when the text appears in either its root folder path or its Plex library section name.' },
          excludeLocationName: { type: ['string', 'array'], items: { type: 'string' }, description: 'Caller-defined location text to exclude. A title is excluded when the text appears in either its root folder path or its Plex library section name.' },
          limit: { type: 'number', default: 50, description: 'Maximum items returned per media type. Capped at 200.' },
          offset: { type: 'number', default: 0, description: 'Offset per media type for paging.' },
        },
        // Older API clients can continue sending the former advanced filters,
        // but those fields are no longer advertised to a planning model.
        additionalProperties: true,
      },
      async execute(input) {
        const mediaType = String(input.mediaType ?? 'all');
        const query = stringParam(input.query).toLowerCase();
        const rootFolderFilters = stringFilters(input.rootFolderPath, input.rootFolder, input.rootFolderQuery);
        const excludeRootFolderFilters = stringFilters(input.excludeRootFolderPath, input.excludeRootFolderPaths);
        const qualityProfileIds = numberFilters(input.qualityProfileId, input.qualityProfileIds);
        const qualityProfileNames = stringFilters(input.qualityProfileName, input.qualityProfileNames);
        const contentRatings = stringFilters(input.contentRating, input.contentRatings, input.certification);
        const resolvedRatings = resolveMixedRatingCeilings(input);
        if (resolvedRatings.error) return { error: resolvedRatings.error };
        const ratingOperator = resolvedRatings.operator;
        const movieRatingValue = resolvedRatings.movieValue;
        const showRatingValue = resolvedRatings.showValue;
        const statusFilters = stringFilters(input.status);
        const years = numberFilters(input.year, input.years);
        const monitored = boolParam(input.monitored);
        const hasFile = boolParam(input.hasFile);
        const minYear = input.minYear == null ? undefined : Number(input.minYear);
        const maxYear = input.maxYear == null ? undefined : Number(input.maxYear);
        const plexSectionNames = stringFilters(input.plexLibrarySectionName, input.plexLibrarySectionNames, input.libraryName);
        const plexSectionIds = stringFilters(input.plexLibrarySectionId, input.plexLibrarySectionIds);
        const excludePlexSectionNames = stringFilters(input.excludePlexLibrarySectionName, input.excludePlexLibrarySectionNames);
        const includeLocationFilters = stringFilters(input.includeLocationName, input.includeLocationNames);
        const excludeLocationFilters = stringFilters(input.excludeLocationName, input.excludeLocationNames);
        const hasCombinedLocationFilter = includeLocationFilters.length > 0 || excludeLocationFilters.length > 0;
        const needsPlexSection = Boolean(input.includePlexSection) || plexSectionNames.length > 0 || plexSectionIds.length > 0 || excludePlexSectionNames.length > 0 || hasCombinedLocationFilter;
        const { limit, offset } = getPaging(input, 50, 200);
        const sortBy = stringParam(input.sortBy);
        const sortDirection = stringParam(input.sortDirection || 'asc');
        const result: Record<string, unknown> = resolvedRatings.policy ? { ratingPolicy: resolvedRatings.policy } : {};

        const operatorError = validateRatingOperator(ratingOperator);
        if (operatorError) return { error: operatorError };

        let plexCatalogIndex: ReturnType<typeof buildPlexCatalogIndex> | undefined;
        if (hasCombinedLocationFilter && !clients.plex) {
          return { error: 'includeLocationName/excludeLocationName require Plex so both root folders and library section names can be checked.' };
        }
        if (needsPlexSection && clients.plex) {
          const sectionFilterError = await validatePlexSectionFilters(plexSectionNames, plexSectionIds, excludePlexSectionNames);
          if (sectionFilterError) return { error: sectionFilterError };
          try {
            plexCatalogIndex = buildPlexCatalogIndex(await clients.plex.getLibraryMedia());
          } catch (e) {
            if (hasCombinedLocationFilter) {
              return { error: `Cannot safely apply the combined root-folder/Plex-section location filter: ${e}` };
            }
            result.plexSectionError = String(e);
          }
        }

        const movieRatingError = validateRatingValue(ratingOperator, movieRatingValue, 'movie');
        if ((mediaType === 'all' || mediaType === 'movie') && clients.radarr && movieRatingError) {
          result.moviesError = movieRatingError;
        } else if ((mediaType === 'all' || mediaType === 'movie') && clients.radarr) {
          try {
            let profileNames = new Map<number, string>();
            if (qualityProfileNames.length || sortBy === 'qualityProfileName') {
              const profiles = await clients.radarr.getQualityProfiles();
              profileNames = new Map(profiles.map(profile => [profile.id, profile.name]));
            }
            let movies = await clients.radarr.getMovies();
            let mapped = movies.map(m => {
              const record = m as typeof m & AnyRecord;
              const contentRating = firstString(record, ['contentRating', 'certification']);
              const plexMatch = plexCatalogIndex ? findPlexCatalogMatch({ type: 'movie', title: m.title, year: m.year, tmdbId: m.tmdbId }, plexCatalogIndex) : undefined;
              return {
                id: m.id,
                title: m.title,
                year: m.year,
                tmdbId: m.tmdbId,
                monitored: m.monitored,
                hasFile: m.hasFile,
                status: m.status,
                qualityProfileId: m.qualityProfileId,
                qualityProfileName: m.qualityProfileId == null ? undefined : profileNames.get(m.qualityProfileId),
                rootFolderPath: m.rootFolderPath,
                contentRating: contentRating || undefined,
                plexLibrarySectionId: plexMatch?.sectionId,
                plexLibrarySectionName: plexMatch?.sectionName,
                plexLibrarySectionKnown: Boolean(plexMatch),
              };
            });
            mapped = filterRecords(mapped, {
              query,
              queryKeys: ['title', 'tmdbId', 'rootFolderPath', 'qualityProfileName', 'contentRating', 'status'],
              stringFilters: [
                { keys: ['rootFolderPath'], filters: rootFolderFilters },
                { keys: ['qualityProfileName'], filters: qualityProfileNames },
                { keys: ['status'], filters: statusFilters },
                { keys: ['plexLibrarySectionName'], filters: plexSectionNames },
                { keys: ['plexLibrarySectionId'], filters: plexSectionIds },
              ],
              numberFilters: [
                { keys: ['qualityProfileId'], filters: qualityProfileIds },
                { keys: ['year'], filters: years },
              ],
              boolFilters: [
                { key: 'monitored', value: monitored },
                { key: 'hasFile', value: hasFile },
              ],
            });
            let movieLocationUnknown = 0;
            mapped = mapped.filter(m => {
              if (!matchesContentRatingFilters(m.contentRating, contentRatings)) return false;
              if (Number.isFinite(minYear) && Number(m.year) < Number(minYear)) return false;
              if (Number.isFinite(maxYear) && Number(m.year) > Number(maxYear)) return false;
              if (ratingOperator && movieRatingValue && !matchesRatingOperator(m.contentRating, 'movie', ratingOperator, movieRatingValue)) return false;
              if (excludeRootFolderFilters.length && matchesStringFilters(m.rootFolderPath, excludeRootFolderFilters)) return false;
              if (excludePlexSectionNames.length && matchesStringFilters(m.plexLibrarySectionName, excludePlexSectionNames)) return false;
              const location = combinedLocationDecision(m, includeLocationFilters, excludeLocationFilters);
              if (location.unknown) movieLocationUnknown += 1;
              if (!location.include) return false;
              return true;
            });
            mapped = sortRecords(mapped, sortBy, sortDirection);
            const paged = pageItems(mapped, limit, offset);
            result.movies = paged.map(m => ({
              id: m.id,
              title: m.title,
              year: m.year,
              tmdbId: m.tmdbId,
              monitored: m.monitored,
              hasFile: m.hasFile,
              status: m.status,
              qualityProfileId: m.qualityProfileId,
              qualityProfileName: m.qualityProfileName,
              rootFolderPath: m.rootFolderPath,
              contentRating: m.contentRating,
              ...(plexCatalogIndex ? { plexLibrarySectionId: m.plexLibrarySectionId, plexLibrarySectionName: m.plexLibrarySectionName } : {}),
            }));
            result.movieTotal = mapped.length;
            result.movieReturned = paged.length;
            result.movieHasMore = offset + paged.length < mapped.length;
            if (hasCombinedLocationFilter) result.movieLocationUnknownExcluded = movieLocationUnknown;
          } catch (e) {
            result.moviesError = String(e);
          }
        }

        const showRatingError = validateRatingValue(ratingOperator, showRatingValue, 'show');
        if ((mediaType === 'all' || mediaType === 'show') && clients.sonarr && showRatingError) {
          result.seriesError = showRatingError;
        } else if ((mediaType === 'all' || mediaType === 'show') && clients.sonarr) {
          try {
            let profileNames = new Map<number, string>();
            if (qualityProfileNames.length || sortBy === 'qualityProfileName') {
              const profiles = await clients.sonarr.getQualityProfiles();
              profileNames = new Map(profiles.map(profile => [profile.id, profile.name]));
            }
            let series = await clients.sonarr.getSeries();
            let mapped = series.map(s => {
              const record = s as typeof s & AnyRecord;
              const contentRating = firstString(record, ['contentRating', 'certification']);
              const seriesHasFile = Number(s.episodeFileCount ?? 0) > 0;
              const plexMatch = plexCatalogIndex ? findPlexCatalogMatch({ type: 'show', title: s.title, year: s.year, tvdbId: s.tvdbId }, plexCatalogIndex) : undefined;
              return {
                id: s.id,
                title: s.title,
                year: s.year,
                tvdbId: s.tvdbId,
                monitored: s.monitored,
                hasFile: seriesHasFile,
                status: s.status,
                episodeCount: s.episodeCount,
                episodeFileCount: s.episodeFileCount,
                qualityProfileId: s.qualityProfileId,
                qualityProfileName: s.qualityProfileId == null ? undefined : profileNames.get(s.qualityProfileId),
                rootFolderPath: s.rootFolderPath,
                contentRating: contentRating || undefined,
                plexLibrarySectionId: plexMatch?.sectionId,
                plexLibrarySectionName: plexMatch?.sectionName,
                plexLibrarySectionKnown: Boolean(plexMatch),
              };
            });
            mapped = filterRecords(mapped, {
              query,
              queryKeys: ['title', 'tvdbId', 'rootFolderPath', 'qualityProfileName', 'contentRating', 'status'],
              stringFilters: [
                { keys: ['rootFolderPath'], filters: rootFolderFilters },
                { keys: ['qualityProfileName'], filters: qualityProfileNames },
                { keys: ['status'], filters: statusFilters },
                { keys: ['plexLibrarySectionName'], filters: plexSectionNames },
                { keys: ['plexLibrarySectionId'], filters: plexSectionIds },
              ],
              numberFilters: [
                { keys: ['qualityProfileId'], filters: qualityProfileIds },
                { keys: ['year'], filters: years },
              ],
              boolFilters: [
                { key: 'monitored', value: monitored },
                { key: 'hasFile', value: hasFile },
              ],
            });
            let seriesLocationUnknown = 0;
            mapped = mapped.filter(s => {
              if (!matchesContentRatingFilters(s.contentRating, contentRatings)) return false;
              if (Number.isFinite(minYear) && Number(s.year) < Number(minYear)) return false;
              if (Number.isFinite(maxYear) && Number(s.year) > Number(maxYear)) return false;
              if (ratingOperator && showRatingValue && !matchesRatingOperator(s.contentRating, 'show', ratingOperator, showRatingValue)) return false;
              if (excludeRootFolderFilters.length && matchesStringFilters(s.rootFolderPath, excludeRootFolderFilters)) return false;
              if (excludePlexSectionNames.length && matchesStringFilters(s.plexLibrarySectionName, excludePlexSectionNames)) return false;
              const location = combinedLocationDecision(s, includeLocationFilters, excludeLocationFilters);
              if (location.unknown) seriesLocationUnknown += 1;
              if (!location.include) return false;
              return true;
            });
            mapped = sortRecords(mapped, sortBy, sortDirection);
            const paged = pageItems(mapped, limit, offset);
            result.series = paged.map(s => ({
              id: s.id,
              title: s.title,
              year: s.year,
              tvdbId: s.tvdbId,
              monitored: s.monitored,
              hasFile: s.hasFile,
              status: s.status,
              episodeCount: s.episodeCount,
              episodeFileCount: s.episodeFileCount,
              qualityProfileId: s.qualityProfileId,
              qualityProfileName: s.qualityProfileName,
              rootFolderPath: s.rootFolderPath,
              contentRating: s.contentRating,
              ...(plexCatalogIndex ? { plexLibrarySectionId: s.plexLibrarySectionId, plexLibrarySectionName: s.plexLibrarySectionName } : {}),
            }));
            result.seriesTotal = mapped.length;
            result.seriesReturned = paged.length;
            result.seriesHasMore = offset + paged.length < mapped.length;
            if (hasCombinedLocationFilter) result.seriesLocationUnknownExcluded = seriesLocationUnknown;
          } catch (e) {
            result.seriesError = String(e);
          }
        }

        result.limit = limit;
        result.offset = offset;
        return result;
      },
    },

    {
      name: 'plex_list_library_media',
      description: 'List titles actually inside Plex library sections (as scanned by Plex itself), with content rating, so the AI can find e.g. kids-rated titles sitting in an adult library or mature titles sitting in a kids library. Use plex_get_library_stats first to find section ids/names, then pass sectionName/sectionId here. Combine with ratingOperator/ratingValue (or movieRatingValue/showRatingValue when movies and shows need different thresholds) to filter by rating.',
      inputSchema: {
        type: 'object',
        properties: {
          sectionId: { type: ['string', 'array'], items: { type: 'string' }, description: 'Optional Plex library section id filter (exact match against a real configured section id — errors listing known sections if none match).' },
          sectionName: { type: ['string', 'array'], items: { type: 'string' }, description: 'Optional Plex library section name filter, e.g. "Kids Movies". Partial match against a real configured section name — look up exact names with plex_list_library_sections first; a name that matches no configured section returns an error listing the real ones instead of silently matching zero items.' },
          mediaType: { type: 'string', enum: ['all', 'movie', 'show'], default: 'all' },
          query: { type: 'string', description: 'Optional case-insensitive title search term.' },
          contentRating: { type: ['string', 'array'], items: { type: 'string' }, description: 'Optional certification/content rating filter, such as PG-13 or TV-MA. Partial match; use ratingOperator/ratingValue for ladder comparisons.' },
          ratingOperator: { type: 'string', enum: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'], description: 'Optional comparison applied to each title\'s contentRating. lt/lte/gt/gte rank against the MPAA ladder (G < PG < PG-13 < R < NC-17) for movies and the TV ladder (TV-Y < TV-Y7 < TV-Y7-FV < TV-G < TV-PG < TV-14 < TV-MA) for shows; unrecognized ratings never match a ladder comparison. Rating text is matched loosely (dashes/spaces/case ignored), but must use the real codes above — there is no "TV-7", the code for young kids is "TV-Y7". Use e.g. gt with ratingValue "PG-13" to find mature movies in a kids library, or lte with ratingValue "TV-Y7" to find kids shows stranded in an adult library.' },
          ratingValue: { type: 'string', description: 'Default rating to compare against for both movies and shows when ratingOperator is set, e.g. "PG-13" or "TV-Y7". Overridden per media type by movieRatingValue/showRatingValue when those are also set. IMPORTANT: with mediaType "all" (the default), a single ratingValue must be valid on BOTH the movie and TV ladders to filter both types — since no rating code is ever valid on both, a bare ratingValue under mediaType "all" will error for whichever type it does not match. Set movieRatingValue and showRatingValue explicitly whenever mediaType is "all" and you want a rating filter applied (e.g. "PG-13 or below" for movies AND "TV-Y7 or below" for shows), or narrow mediaType to just "movie"/"show".' },
          movieRatingValue: { type: 'string', description: 'Rating to compare movies against when ratingOperator is set; overrides ratingValue for movies only.' },
          showRatingValue: { type: 'string', description: 'Rating to compare shows against when ratingOperator is set; overrides ratingValue for shows only.' },
          year: { type: ['number', 'array'], items: { type: 'number' }, description: 'Optional exact year filter.' },
          minYear: { type: 'number', description: 'Optional minimum release year.' },
          maxYear: { type: 'number', description: 'Optional maximum release year.' },
          sortBy: { type: 'string', enum: ['title', 'year', 'contentRating', 'sectionName', 'type'], description: 'Optional result sort key.' },
          sortDirection: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
          limit: { type: 'number', default: 100, description: 'Maximum items returned. Capped at 500.' },
          offset: { type: 'number', default: 0 },
        },
      },
      async execute(input) {
        if (!clients.plex) return { error: 'Plex not configured' };
        try {
          const sectionIds = stringFilters(input.sectionId, input.sectionIds);
          const sectionNames = stringFilters(input.sectionName, input.sectionNames, input.libraryName);
          const mediaType = String(input.mediaType ?? 'all');
          const query = stringParam(input.query).toLowerCase();
          const contentRatings = stringFilters(input.contentRating, input.contentRatings, input.certification);
          const ratingOperator = stringParam(input.ratingOperator);
          const ratingValue = stringParam(input.ratingValue);
          const movieRatingValue = stringParam(input.movieRatingValue) || ratingValue;
          const showRatingValue = stringParam(input.showRatingValue) || ratingValue;
          const years = numberFilters(input.year, input.years);
          const minYear = input.minYear == null ? undefined : Number(input.minYear);
          const maxYear = input.maxYear == null ? undefined : Number(input.maxYear);
          const sortBy = stringParam(input.sortBy);
          const sortDirection = stringParam(input.sortDirection || 'asc');
          const { limit, offset } = getPaging(input, 100, 500);

          const operatorError = validateRatingOperator(ratingOperator);
          if (operatorError) return { error: operatorError };
          if (mediaType === 'all' || mediaType === 'movie') {
            const err = validateRatingValue(ratingOperator, movieRatingValue, 'movie');
            if (err) return { error: err };
          }
          if (mediaType === 'all' || mediaType === 'show') {
            const err = validateRatingValue(ratingOperator, showRatingValue, 'show');
            if (err) return { error: err };
          }
          if (sectionIds.length || sectionNames.length) {
            const sectionFilterError = await validatePlexSectionFilters(sectionNames, sectionIds, []);
            if (sectionFilterError) return { error: sectionFilterError };
          }

          const media = await clients.plex.getLibraryMedia();
          let mapped = (mediaType === 'all' ? media : media.filter(item => item.type === mediaType)) as unknown as AnyRecord[];
          mapped = filterRecords(mapped, {
            query,
            queryKeys: ['title', 'sectionName', 'sectionId', 'contentRating'],
            stringFilters: [
              { keys: ['sectionId'], filters: sectionIds },
              { keys: ['sectionName'], filters: sectionNames },
            ],
            numberFilters: [{ keys: ['year'], filters: years }],
          }).filter(item => {
            if (!matchesContentRatingFilters(item.contentRating, contentRatings)) return false;
            if (Number.isFinite(minYear) && Number(item.year) < Number(minYear)) return false;
            if (Number.isFinite(maxYear) && Number(item.year) > Number(maxYear)) return false;
            if (ratingOperator) {
              const type = item.type === 'show' ? 'show' : 'movie';
              const effectiveValue = type === 'show' ? showRatingValue : movieRatingValue;
              if (effectiveValue && !matchesRatingOperator(item.contentRating, type, ratingOperator, effectiveValue)) return false;
            }
            return true;
          });
          mapped = sortRecords(mapped, sortBy, sortDirection);
          const paged = pageItems(mapped, limit, offset);
          return { ...pageMeta(mapped.length, paged.length, limit, offset), media: paged };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    {
      name: 'plex_get_root_folders',
      description: 'Return configured Radarr and/or Sonarr root folders, including path and free space, so the AI can choose the correct library assignment. Supports path/free-space filters and paging.',
      inputSchema: {
        type: 'object',
        properties: {
          mediaType: { type: 'string', enum: ['all', 'movie', 'show'], default: 'all' },
          query: { type: 'string', description: 'Optional case-insensitive path filter.' },
          minFreeSpaceBytes: { type: 'number', description: 'Only return root folders with at least this much free space.' },
          limit: { type: 'number', default: 50, description: 'Maximum folders returned per service. Capped at 100.' },
          offset: { type: 'number', default: 0 },
        },
      },
      async execute(input) {
        const mediaType = String(input.mediaType ?? 'all');
        const query = stringParam(input.query).toLowerCase();
        const minFreeSpaceBytes = input.minFreeSpaceBytes == null ? undefined : Number(input.minFreeSpaceBytes);
        const { limit, offset } = getPaging(input, 50, 100);
        const filterFolders = (folders: AnyRecord[]) => {
          const filtered = folders.filter(folder => {
            if (!matchesQuery(query, folder.path)) return false;
            if (Number.isFinite(minFreeSpaceBytes) && Number(folder.freeSpace ?? 0) < Number(minFreeSpaceBytes)) return false;
            return true;
          });
          const paged = pageItems(filtered, limit, offset);
          return { ...pageMeta(filtered.length, paged.length, limit, offset), folders: paged };
        };
        const result: Record<string, unknown> = {};
        if ((mediaType === 'all' || mediaType === 'movie') && clients.radarr) {
          try { result.radarr = filterFolders(await clients.radarr.getRootFolders()); }
          catch (e) { result.radarrError = String(e); }
        }
        if ((mediaType === 'all' || mediaType === 'show') && clients.sonarr) {
          try { result.sonarr = filterFolders(await clients.sonarr.getRootFolders()); }
          catch (e) { result.sonarrError = String(e); }
        }
        return result;
      },
    },

    {
      name: 'plex_get_quality_profiles',
      description: 'Return available Radarr and/or Sonarr quality profiles so the AI can resolve profile names to numeric ids. Supports name/id filters and paging.',
      inputSchema: {
        type: 'object',
        properties: {
          mediaType: { type: 'string', enum: ['all', 'movie', 'show'], default: 'all' },
          query: { type: 'string', description: 'Optional case-insensitive profile name filter.' },
          id: { type: ['number', 'array'], items: { type: 'number' }, description: 'Optional profile id filter.' },
          limit: { type: 'number', default: 50, description: 'Maximum profiles returned per service. Capped at 100.' },
          offset: { type: 'number', default: 0 },
        },
      },
      async execute(input) {
        const mediaType = String(input.mediaType ?? 'all');
        const query = stringParam(input.query).toLowerCase();
        const ids = numberFilters(input.id, input.ids, input.qualityProfileId, input.qualityProfileIds);
        const { limit, offset } = getPaging(input, 50, 100);
        const filterProfiles = (profiles: AnyRecord[]) => {
          const filtered = profiles.filter(profile => (
            matchesQuery(query, profile.name, profile.id) &&
            matchesNumberFilters(profile.id, ids)
          ));
          const paged = pageItems(filtered, limit, offset);
          return { ...pageMeta(filtered.length, paged.length, limit, offset), profiles: paged };
        };
        const result: Record<string, unknown> = {};
        if ((mediaType === 'all' || mediaType === 'movie') && clients.radarr) {
          try { result.radarr = filterProfiles(await clients.radarr.getQualityProfiles()); }
          catch (e) { result.radarrError = String(e); }
        }
        if ((mediaType === 'all' || mediaType === 'show') && clients.sonarr) {
          try { result.sonarr = filterProfiles(await clients.sonarr.getQualityProfiles()); }
          catch (e) { result.sonarrError = String(e); }
        }
        return result;
      },
    },

    {
      name: 'plex_move_media',
      description: 'Change an existing Radarr movie or Sonarr series root folder and/or quality profile, optionally moving files.',
      inputSchema: {
        type: 'object',
        properties: {
          mediaType: { type: 'string', enum: ['movie', 'show'] },
          id: { type: 'number', description: 'Radarr movie id or Sonarr series id.' },
          rootFolderPath: { type: 'string', description: 'New root folder path.' },
          qualityProfileId: { type: 'number', description: 'New quality profile id.' },
          moveFiles: { type: 'boolean', default: true, description: 'Whether Radarr/Sonarr should move files on disk.' },
        },
        required: ['mediaType', 'id'],
      },
      async execute(input) {
        const mediaType = String(input.mediaType);
        const changes: { qualityProfileId?: number; rootFolderPath?: string } = {};
        if (input.qualityProfileId != null) changes.qualityProfileId = Number(input.qualityProfileId);
        if (input.rootFolderPath != null) changes.rootFolderPath = String(input.rootFolderPath);
        if (!Object.keys(changes).length) return { success: false, error: 'rootFolderPath or qualityProfileId is required' };
        try {
          if (mediaType === 'movie') {
            if (!clients.radarr) return { success: false, error: 'Radarr not configured' };
            await clients.radarr.editMovie(Number(input.id), changes, input.moveFiles == null ? true : Boolean(input.moveFiles));
          } else if (mediaType === 'show') {
            if (!clients.sonarr) return { success: false, error: 'Sonarr not configured' };
            await clients.sonarr.editSeries(Number(input.id), changes, input.moveFiles == null ? true : Boolean(input.moveFiles));
          } else {
            return { success: false, error: `Unsupported mediaType: ${mediaType}` };
          }
          return { success: true, id: Number(input.id), mediaType, changes, moveFiles: input.moveFiles == null ? true : Boolean(input.moveFiles) };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },

    {
      name: 'plex_search_existing',
      description: 'Trigger a Radarr or Sonarr search/grab for an existing movie or series by id.',
      inputSchema: {
        type: 'object',
        properties: {
          mediaType: { type: 'string', enum: ['movie', 'show'] },
          id: { type: 'number', description: 'Radarr movie id or Sonarr series id.' },
        },
        required: ['mediaType', 'id'],
      },
      async execute(input) {
        const mediaType = String(input.mediaType);
        try {
          if (mediaType === 'movie') {
            if (!clients.radarr) return { success: false, error: 'Radarr not configured' };
            await clients.radarr.searchMovie(Number(input.id));
          } else if (mediaType === 'show') {
            if (!clients.sonarr) return { success: false, error: 'Sonarr not configured' };
            await clients.sonarr.searchSeries(Number(input.id));
          } else {
            return { success: false, error: `Unsupported mediaType: ${mediaType}` };
          }
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },

    {
      name: 'plex_remove_media',
      description: 'Remove a movie from Radarr or show from Sonarr.',
      inputSchema: {
        type: 'object',
        properties: {
          mediaType: { type: 'string', enum: ['movie', 'show'] },
          id: { type: 'number', description: 'Radarr movie id or Sonarr series id.' },
          deleteFiles: { type: 'boolean', default: false },
        },
        required: ['mediaType', 'id'],
      },
      async execute(input) {
        const mediaType = String(input.mediaType);
        try {
          if (mediaType === 'movie') {
            if (!clients.radarr) return { success: false, error: 'Radarr not configured' };
            await clients.radarr.removeMovie(Number(input.id), Boolean(input.deleteFiles));
          } else if (mediaType === 'show') {
            if (!clients.sonarr) return { success: false, error: 'Sonarr not configured' };
            await clients.sonarr.removeSeries(Number(input.id), Boolean(input.deleteFiles));
          } else {
            return { success: false, error: `Unsupported mediaType: ${mediaType}` };
          }
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },

    {
      name: 'plex_toggle_monitor',
      description: 'Set a Radarr movie or Sonarr series monitored/unmonitored by id.',
      inputSchema: {
        type: 'object',
        properties: {
          mediaType: { type: 'string', enum: ['movie', 'show'] },
          id: { type: 'number', description: 'Radarr movie id or Sonarr series id.' },
          monitored: { type: 'boolean' },
        },
        required: ['mediaType', 'id', 'monitored'],
      },
      async execute(input) {
        const mediaType = String(input.mediaType);
        try {
          if (mediaType === 'movie') {
            if (!clients.radarr) return { success: false, error: 'Radarr not configured' };
            await clients.radarr.toggleMonitor(Number(input.id), Boolean(input.monitored));
          } else if (mediaType === 'show') {
            if (!clients.sonarr) return { success: false, error: 'Sonarr not configured' };
            await clients.sonarr.toggleMonitor(Number(input.id), Boolean(input.monitored));
          } else {
            return { success: false, error: `Unsupported mediaType: ${mediaType}` };
          }
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },


    {
      name: 'plex_get_streams',
      description: 'Get currently active Plex streams (who is watching what right now), retrieved from Tautulli.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional case-insensitive title/user/player filter.' },
          user: { type: ['string', 'array'], items: { type: 'string' } },
          mediaType: { type: ['string', 'array'], items: { type: 'string' } },
          state: { type: ['string', 'array'], items: { type: 'string' } },
          transcodeDecision: { type: ['string', 'array'], items: { type: 'string' } },
          limit: { type: 'number', default: 25, description: 'Maximum streams returned. Capped at 100.' },
          offset: { type: 'number', default: 0 },
        },
      },
      async execute(input) {
        if (!clients.tautulli) return { error: 'Tautulli not configured' };
        try {
          const query = stringParam(input.query).toLowerCase();
          const users = stringFilters(input.user, input.users);
          const mediaTypes = stringFilters(input.mediaType, input.mediaTypes);
          const states = stringFilters(input.state, input.states);
          const transcodeDecisions = stringFilters(input.transcodeDecision, input.transcodeDecisions);
          const { limit, offset } = getPaging(input, 25, 100);
          const activity = await clients.tautulli.getActivity({ includeThumbnails: false });
          const streams = filterRecords(activity.sessions.map(s => ({
            user: s.user,
            title: s.grandparentTitle ? `${s.grandparentTitle} - ${s.title}` : s.title,
            mediaType: s.mediaType,
            state: s.state,
            progress: `${s.progressPercent}%`,
            progressPercent: s.progressPercent,
            transcodeDecision: s.transcodeDecision,
            player: s.player,
            ipAddress: s.ipAddress,
            sessionKey: s.sessionKey,
          })), {
            query,
            queryKeys: ['user', 'title', 'mediaType', 'state', 'transcodeDecision', 'player', 'ipAddress'],
            stringFilters: [
              { keys: ['user'], filters: users },
              { keys: ['mediaType'], filters: mediaTypes },
              { keys: ['state'], filters: states },
              { keys: ['transcodeDecision'], filters: transcodeDecisions },
            ],
          });
          const paged = pageItems(streams, limit, offset);
          return {
            streamCount: activity.streamCount,
            totalBandwidthKbps: activity.bandwidth,
            matchedStreams: streams.length,
            returnedStreams: paged.length,
            limit,
            offset,
            hasMore: offset + paged.length < streams.length,
            streams: paged,
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    {
      name: 'plex_get_downloads',
      description: 'Get the current download queue from SABnzbd (Usenet) and qBittorrent.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['all', 'sabnzbd', 'qbittorrent'], default: 'all' },
          query: { type: 'string', description: 'Optional case-insensitive download name/id/category filter.' },
          status: { type: ['string', 'array'], items: { type: 'string' } },
          category: { type: ['string', 'array'], items: { type: 'string' } },
          includeStatus: { type: 'boolean', default: true, description: 'Include global client status summaries.' },
          includeStatusSlots: { type: 'boolean', default: false, description: 'Include SABnzbd status slot details; normally omit to avoid duplicate large output.' },
          limit: { type: 'number', default: 50, description: 'Maximum download items returned. Capped at 200.' },
          offset: { type: 'number', default: 0 },
        },
      },
      async execute(input) {
        const source = String(input.source ?? 'all');
        const query = stringParam(input.query).toLowerCase();
        const statusFilters = stringFilters(input.status, input.statuses);
        const categoryFilters = stringFilters(input.category, input.categories);
        const includeStatus = input.includeStatus == null ? true : Boolean(input.includeStatus);
        const includeStatusSlots = Boolean(input.includeStatusSlots);
        const { limit, offset } = getPaging(input, 50, 200);
        const items: AnyRecord[] = [];
        const status: Record<string, unknown> = {};

        if ((source === 'all' || source === 'sabnzbd') && clients.sabnzbd) {
          try {
            const queue = await clients.sabnzbd.getQueue();
            items.push(...queue.map(i => ({ ...i, source: 'SABnzbd' })));
            if (includeStatus) {
              const fullStatus = await clients.sabnzbd.getFullStatus().catch(() => undefined);
              if (fullStatus) {
                const { slots: _slots, ...summary } = fullStatus;
                status.sabnzbd = includeStatusSlots ? fullStatus : summary;
              }
            }
          } catch (e) {
            items.push({ error: `SABnzbd: ${e}` });
          }
        }

        if ((source === 'all' || source === 'qbittorrent') && clients.qbittorrent) {
          try {
            const torrents = await clients.qbittorrent.getTorrents();
            items.push(...torrents.map(i => ({ ...i, source: 'qBittorrent' })));
            if (includeStatus) status.qbittorrent = await clients.qbittorrent.getTransferInfo().catch(() => undefined);
          } catch (e) {
            items.push({ error: `qBit: ${e}` });
          }
        }

        const filtered = filterRecords(items, {
          query,
          queryKeys: ['id', 'name', 'status', 'category', 'source', 'error'],
          stringFilters: [
            { keys: ['status'], filters: statusFilters },
            { keys: ['category'], filters: categoryFilters },
          ],
        });
        const paged = pageItems(filtered, limit, offset);
        return {
          totalItems: filtered.length,
          returnedItems: paged.length,
          limit,
          offset,
          hasMore: offset + paged.length < filtered.length,
          items: paged,
          status,
        };
      },
    },

    {
      name: 'plex_control_downloads',
      description: 'Pause/resume SABnzbd or qBittorrent globally, or set qBittorrent transfer limits.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['sabnzbd', 'qbittorrent', 'all'], default: 'all' },
          action: { type: 'string', enum: ['pause-all', 'resume-all', 'set-qbit-limits'] },
          downloadLimit: { type: 'number', description: 'qBittorrent download limit in bytes/sec; 0 means unlimited.' },
          uploadLimit: { type: 'number', description: 'qBittorrent upload limit in bytes/sec; 0 means unlimited.' },
        },
        required: ['action'],
      },
      async execute(input) {
        const source = String(input.source ?? 'all');
        const action = String(input.action ?? '');
        try {
          if (action === 'pause-all') {
            if ((source === 'all' || source === 'sabnzbd') && clients.sabnzbd) await clients.sabnzbd.pauseAll();
            if ((source === 'all' || source === 'qbittorrent') && clients.qbittorrent) await clients.qbittorrent.pauseAll();
            return { success: true };
          }
          if (action === 'resume-all') {
            if ((source === 'all' || source === 'sabnzbd') && clients.sabnzbd) await clients.sabnzbd.resumeAll();
            if ((source === 'all' || source === 'qbittorrent') && clients.qbittorrent) await clients.qbittorrent.resumeAll();
            return { success: true };
          }
          if (action === 'set-qbit-limits') {
            if (!clients.qbittorrent) return { success: false, error: 'qBittorrent not configured' };
            if (input.downloadLimit != null) await clients.qbittorrent.setDownloadLimit(Number(input.downloadLimit));
            if (input.uploadLimit != null) await clients.qbittorrent.setUploadLimit(Number(input.uploadLimit));
            return { success: true };
          }
          return { success: false, error: `Unsupported action: ${action}` };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },

    {
      name: 'plex_get_library_stats',
      description: 'Get Plex library statistics: movie/TV show counts per library section. Also returns each section\'s id and name — the exact values to pass to plexLibrarySectionName/plexLibrarySectionId/excludePlexLibrarySectionName (on plex_list_library) or sectionName/sectionId (on plex_list_library_media). Same lookup as plex_list_library_sections.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional case-insensitive library name/id filter.' },
          mediaType: { type: ['string', 'array'], items: { type: 'string' }, description: 'Optional Plex library type filter.' },
          limit: { type: 'number', default: 50, description: 'Maximum library sections returned. Capped at 100.' },
          offset: { type: 'number', default: 0 },
        },
      },
      async execute(input) {
        return listLibrarySections(input);
      },
    },

    {
      name: 'plex_list_library_sections',
      description: 'List Plex library sections (id, name, type, item count). Call this first to look up the exact section id/name to plug into plexLibrarySectionName/plexLibrarySectionId/excludePlexLibrarySectionName (on plex_list_library) or sectionName/sectionId (on plex_list_library_media) — those filters match against the `name` value returned here, e.g. "Kids Movies". Same lookup as plex_get_library_stats.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional case-insensitive library name/id filter.' },
          mediaType: { type: ['string', 'array'], items: { type: 'string' }, description: 'Optional Plex library type filter.' },
          limit: { type: 'number', default: 50, description: 'Maximum library sections returned. Capped at 100.' },
          offset: { type: 'number', default: 0 },
        },
      },
      async execute(input) {
        return listLibrarySections(input);
      },
    },

    {
      name: 'plex_refresh_library',
      description: 'Tell Plex to refresh/scan one library section, or all library sections when all is true.',
      inputSchema: {
        type: 'object',
        properties: {
          sectionId: { type: 'string', description: 'Plex library section id. Omit when all is true.' },
          all: { type: 'boolean', description: 'Refresh every Plex library section.', default: false },
        },
      },
      async execute(input) {
        if (!clients.plex) return { success: false, error: 'Plex not configured' };
        try {
          if (Boolean(input.all)) {
            const result = await clients.plex.refreshAllLibraries();
            return { success: true, refreshed: result.refreshed.map(lib => ({ id: lib.id, name: lib.name })) };
          }
          const sectionId = String(input.sectionId ?? '').trim();
          if (!sectionId) return { success: false, error: 'sectionId is required unless all is true' };
          await clients.plex.refreshLibrary(sectionId);
          return { success: true, refreshed: [{ id: sectionId }] };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },

    {
      name: 'plex_get_requests',
      description: 'List pending media requests from Seer (Overseerr). These are requests from users who want content added to Plex.',
      inputSchema: {
        type: 'object',
        properties: {
          filter: { type: 'string', enum: ['all', 'pending', 'approved'], default: 'pending' },
          query: { type: 'string', description: 'Optional case-insensitive title/requester/id filter.' },
          mediaType: { type: 'string', enum: ['all', 'movie', 'tv'], default: 'all' },
          requestedBy: { type: ['string', 'array'], items: { type: 'string' } },
          status: { type: ['number', 'array'], items: { type: 'number' }, description: 'Optional raw Seer request status code filter.' },
          limit: { type: 'number', default: 20, description: 'Maximum requests returned. Capped at 100.' },
          offset: { type: 'number', default: 0 },
        },
      },
      async execute(input) {
        if (!clients.seer) return { error: 'Seer not configured' };
        const filter = (input.filter as 'all' | 'pending' | 'approved') ?? 'pending';
        try {
          const query = stringParam(input.query).toLowerCase();
          const requestedBy = stringFilters(input.requestedBy);
          const mediaType = String(input.mediaType ?? 'all');
          const statuses = numberFilters(input.status, input.statuses);
          const { limit, offset } = getPaging(input, 20, 100);
          const fetchLimit = Math.min(100, limit + offset);
          const requests = await clients.seer.getRequests(fetchLimit, 0, filter);
          const filtered = filterRecords(requests as unknown as AnyRecord[], {
            query,
            queryKeys: ['id', 'title', 'type', 'year', 'requestedBy', 'tmdbId', 'tvdbId'],
            stringFilters: [
              { keys: ['requestedBy'], filters: requestedBy },
              { keys: ['type'], filters: mediaType === 'all' ? [] : [mediaType] },
            ],
            numberFilters: [{ keys: ['status'], filters: statuses }],
          });
          const paged = pageItems(filtered, limit, offset);
          return { ...pageMeta(filtered.length, paged.length, limit, offset), fetched: requests.length, requests: paged };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    {
      name: 'plex_add_movie',
      description: 'Add a movie to Radarr for download.',
      inputSchema: {
        type: 'object',
        properties: {
          tmdbId: { type: 'number', description: 'TMDB ID of the movie (get from plex_search_media)' },
          title: { type: 'string', description: 'Movie title' },
          year: { type: 'number', description: 'Release year' },
          qualityProfileId: { type: 'number', description: 'Radarr quality profile id' },
          rootFolderPath: { type: 'string', description: 'Radarr root folder path' },
          monitored: { type: 'boolean', default: true },
          searchOnAdd: { type: 'boolean', default: true },
          minimumAvailability: { type: 'string', default: 'released' },
        },
        required: ['tmdbId', 'title', 'year', 'qualityProfileId', 'rootFolderPath'],
      },
      async execute(input) {
        if (!clients.radarr) return { error: 'Radarr not configured' };
        try {
          const movie = await clients.radarr.addMovie(
            Number(input.tmdbId),
            String(input.title),
            Number(input.year),
            {
              qualityProfileId: Number(input.qualityProfileId),
              rootFolderPath: String(input.rootFolderPath),
              monitored: input.monitored == null ? true : Boolean(input.monitored),
              searchOnAdd: input.searchOnAdd == null ? true : Boolean(input.searchOnAdd),
              minimumAvailability: String(input.minimumAvailability ?? 'released'),
            },
          );
          return { success: true, id: movie.id, title: movie.title, year: movie.year };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },

    {
      name: 'plex_add_show',
      description: 'Add a TV show to Sonarr for download.',
      inputSchema: {
        type: 'object',
        properties: {
          tvdbId: { type: 'number', description: 'TVDB ID of the show (get from plex_search_media)' },
          title: { type: 'string', description: 'Show title' },
          qualityProfileId: { type: 'number', description: 'Sonarr quality profile id' },
          rootFolderPath: { type: 'string', description: 'Sonarr root folder path' },
          monitored: { type: 'boolean', default: true },
          searchOnAdd: { type: 'boolean', default: true },
          seasonFolder: { type: 'boolean', default: true },
          seriesType: { type: 'string', enum: ['standard', 'daily', 'anime'], default: 'standard' },
          seasons: { type: 'array', items: { type: 'object' }, description: 'Optional Sonarr season monitor settings.' },
        },
        required: ['tvdbId', 'title', 'qualityProfileId', 'rootFolderPath'],
      },
      async execute(input) {
        if (!clients.sonarr) return { error: 'Sonarr not configured' };
        try {
          const series = await clients.sonarr.addSeries(
            Number(input.tvdbId),
            String(input.title),
            {
              qualityProfileId: Number(input.qualityProfileId),
              rootFolderPath: String(input.rootFolderPath),
              monitored: input.monitored == null ? true : Boolean(input.monitored),
              searchOnAdd: input.searchOnAdd == null ? true : Boolean(input.searchOnAdd),
              seasonFolder: input.seasonFolder == null ? true : Boolean(input.seasonFolder),
              seriesType: String(input.seriesType ?? 'standard'),
              seasons: Array.isArray(input.seasons) ? input.seasons as any : undefined,
            },
          );
          return { success: true, id: series.id, title: series.title };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },

    {
      name: 'plex_request_media',
      description: 'Submit a media request via Seer (Overseerr).',
      inputSchema: {
        type: 'object',
        properties: {
          mediaType: { type: 'string', enum: ['movie', 'tv'], description: 'Type of media' },
          mediaId: { type: 'number', description: 'TMDB ID for movies and TV shows' },
          seasons: { type: 'array', items: { type: 'number' }, description: 'Optional TV season numbers to request.' },
        },
        required: ['mediaType', 'mediaId'],
      },
      async execute(input) {
        if (!clients.seer) return { error: 'Seer not configured' };
        try {
          if (input.mediaType === 'movie') {
            await clients.seer.requestMovie(Number(input.mediaId));
          } else {
            const seasons = Array.isArray(input.seasons) ? input.seasons.map(Number).filter(Number.isFinite) : [];
            await clients.seer.requestTv(Number(input.mediaId), seasons);
          }
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },

    {
      name: 'plex_bazarr_get_subtitle_health',
      description: 'Get Bazarr subtitle health, wanted subtitle counts, provider status, and recent wanted movie/episode subtitle rows.',
      inputSchema: {
        type: 'object',
        properties: {
          mediaType: { type: 'string', enum: ['all', 'movie', 'episode'], default: 'all' },
          query: { type: 'string', description: 'Optional case-insensitive wanted-title/scene/tag filter.' },
          language: { type: ['string', 'array'], items: { type: 'string' }, description: 'Optional missing subtitle language filter.' },
          providerQuery: { type: 'string', description: 'Optional provider name filter.' },
          providerStatus: { type: ['string', 'array'], items: { type: 'string' } },
          includeProviders: { type: 'boolean', default: true },
          wantedLimit: { type: 'number', default: 10, description: 'Wanted rows returned per media type. Capped at 100.' },
          wantedOffset: { type: 'number', default: 0 },
        },
      },
      async execute(input) {
        if (!clients.bazarr) return { error: 'Bazarr not configured' };
        try {
          const mediaType = String(input.mediaType ?? 'all');
          const query = stringParam(input.query).toLowerCase();
          const languages = stringFilters(input.language, input.languages);
          const providerQuery = stringParam(input.providerQuery).toLowerCase();
          const providerStatuses = stringFilters(input.providerStatus, input.providerStatuses);
          const includeProviders = input.includeProviders == null ? true : Boolean(input.includeProviders);
          const wantedLimit = intParam(input.wantedLimit ?? input.limit, 10, 0, 100);
          const wantedOffset = intParam(input.wantedOffset ?? input.offset, 0, 0, Number.MAX_SAFE_INTEGER);
          const emptyWanted = { data: [], total: 0 };
          const [status, health, badges, providers, movies, episodes] = await Promise.all([
            clients.bazarr.getStatus(),
            clients.bazarr.getHealth(),
            clients.bazarr.getBadges(),
            includeProviders ? clients.bazarr.getProviders() : Promise.resolve([]),
            mediaType === 'all' || mediaType === 'movie'
              ? clients.bazarr.getWantedMovies(wantedOffset, wantedLimit)
              : Promise.resolve(emptyWanted),
            mediaType === 'all' || mediaType === 'episode'
              ? clients.bazarr.getWantedEpisodes(wantedOffset, wantedLimit)
              : Promise.resolve(emptyWanted),
          ]);
          const matchesLanguage = (row: AnyRecord): boolean => {
            if (!languages.length) return true;
            const missing = Array.isArray(row.missing_subtitles) ? row.missing_subtitles as AnyRecord[] : [];
            return missing.some(language => languages.some(filter => (
              includesText(language.name, filter.toLowerCase()) ||
              includesText(language.code2, filter.toLowerCase()) ||
              includesText(language.code3, filter.toLowerCase())
            )));
          };
          const filterWanted = <T extends AnyRecord>(rows: T[], titleKeys: string[]): T[] => rows.filter(row => (
            matchesQuery(query, ...titleKeys.map(key => row[key]), row.sceneName, row.tags) &&
            matchesLanguage(row)
          ));
          const wantedMovies = filterWanted(movies.data as unknown as AnyRecord[], ['title']);
          const wantedEpisodes = filterWanted(episodes.data as unknown as AnyRecord[], ['seriesTitle', 'episodeTitle', 'episode_number']);
          const filteredProviders = filterRecords(providers as AnyRecord[], {
            query: providerQuery,
            queryKeys: ['name', 'provider', 'status'],
            stringFilters: [{ keys: ['status'], filters: providerStatuses }],
          });
          return {
            status,
            health,
            badges,
            providers: includeProviders ? filteredProviders : undefined,
            wantedLimit,
            wantedOffset,
            wantedMovies: { total: movies.total, returned: wantedMovies.length, data: wantedMovies },
            wantedEpisodes: { total: episodes.total, returned: wantedEpisodes.length, data: wantedEpisodes },
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    {
      name: 'plex_bazarr_search_subtitles',
      description: 'Search Bazarr providers for subtitles for one Radarr movie or Sonarr episode. This only searches; use the subtitle download tool to download a result.',
      inputSchema: {
        type: 'object',
        properties: {
          mediaType: { type: 'string', enum: ['movie', 'episode'] },
          radarrId: { type: 'number', description: 'Required for movie searches.' },
          episodeId: { type: 'number', description: 'Sonarr episode id; required for episode searches.' },
          provider: { type: ['string', 'array'], items: { type: 'string' } },
          language: { type: ['string', 'array'], items: { type: 'string' } },
          forced: { type: 'boolean' },
          hi: { type: 'boolean', description: 'Filter hearing-impaired subtitle results.' },
          limit: { type: 'number', default: 25, description: 'Maximum subtitle candidates returned. Capped at 100.' },
          offset: { type: 'number', default: 0 },
        },
        required: ['mediaType'],
      },
      async execute(input) {
        if (!clients.bazarr) return { error: 'Bazarr not configured' };
        try {
          const providers = stringFilters(input.provider, input.providers);
          const languages = stringFilters(input.language, input.languages);
          const forced = boolParam(input.forced);
          const hi = boolParam(input.hi);
          const { limit, offset } = getPaging(input, 25, 100);
          const results = input.mediaType === 'episode'
            ? await clients.bazarr.searchEpisodeSubtitles(Number(input.episodeId))
            : await clients.bazarr.searchMovieSubtitles(Number(input.radarrId));
          const candidates = results.map(candidate => {
            const record = candidate as AnyRecord;
            const language = record.language as AnyRecord | string | undefined;
            const languageText = typeof language === 'string'
              ? language
              : [language?.name, language?.code2, language?.code3].filter(Boolean).join(' ');
            return { ...record, languageText };
          });
          const filtered = filterRecords(candidates, {
            stringFilters: [
              { keys: ['provider'], filters: providers },
              { keys: ['languageText'], filters: languages },
            ],
            boolFilters: [
              { key: 'forced', value: forced },
              { key: 'hearing_impaired', value: hi },
            ],
          });
          const paged = pageItems(filtered, limit, offset).map(({ languageText: _languageText, ...candidate }) => candidate);
          return { total: filtered.length, returned: paged.length, limit, offset, hasMore: offset + paged.length < filtered.length, results: paged };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    {
      name: 'plex_bazarr_download_subtitle',
      description: 'Download a subtitle through Bazarr.',
      inputSchema: {
        type: 'object',
        properties: {
          mediaType: { type: 'string', enum: ['movie', 'episode'] },
          radarrId: { type: 'number' },
          seriesId: { type: 'number' },
          episodeId: { type: 'number' },
          provider: { type: 'string' },
          subtitle: { type: 'string', description: 'Subtitle id/value returned by plex_bazarr_search_subtitles.' },
          forced: { type: 'boolean', default: false },
          hi: { type: 'boolean', default: false },
          originalFormat: { type: 'boolean', default: false },
        },
        required: ['mediaType', 'provider', 'subtitle'],
      },
      async execute(input) {
        if (!clients.bazarr) return { success: false, error: 'Bazarr not configured' };
        try {
          if (input.mediaType === 'episode') {
            await clients.bazarr.downloadEpisodeSubtitle({
              seriesId: Number(input.seriesId),
              episodeId: Number(input.episodeId),
              provider: String(input.provider),
              subtitle: String(input.subtitle),
              forced: Boolean(input.forced),
              hi: Boolean(input.hi),
              originalFormat: Boolean(input.originalFormat),
            });
          } else {
            await clients.bazarr.downloadMovieSubtitle({
              radarrId: Number(input.radarrId),
              provider: String(input.provider),
              subtitle: String(input.subtitle),
              forced: Boolean(input.forced),
              hi: Boolean(input.hi),
              originalFormat: Boolean(input.originalFormat),
            });
          }
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },

    {
      name: 'plex_bazarr_run_task',
      description: 'Run a Bazarr maintenance task.',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Bazarr task id from the task list.' },
        },
        required: ['taskId'],
      },
      async execute(input) {
        if (!clients.bazarr) return { success: false, error: 'Bazarr not configured' };
        try {
          await clients.bazarr.runTask(String(input.taskId));
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },

    {
      name: 'plex_prowlarr_search_releases',
      description: 'Search Prowlarr indexers for releases. Returns release objects that can be passed to plex_prowlarr_grab_release.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          type: { type: 'string', enum: ['search', 'tvsearch', 'moviesearch'], default: 'search' },
          indexerIds: { type: 'array', items: { type: 'number' }, description: 'Optional indexer ids; omit to search enabled indexers.' },
          categories: { type: 'array', items: { type: 'number' } },
          releaseQuery: { type: 'string', description: 'Optional case-insensitive filter applied to returned release titles/indexers.' },
          protocol: { type: ['string', 'array'], items: { type: 'string' } },
          indexer: { type: ['string', 'array'], items: { type: 'string' } },
          minSeeders: { type: 'number' },
          maxSizeBytes: { type: 'number' },
          sortBy: { type: 'string', enum: ['title', 'indexer', 'protocol', 'size', 'seeders', 'publishDate'] },
          sortDirection: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
          limit: { type: 'number', default: 25, description: 'Maximum releases requested and returned. Capped at 100.' },
          offset: { type: 'number', default: 0 },
        },
        required: ['query'],
      },
      async execute(input) {
        if (!clients.prowlarr) return { error: 'Prowlarr not configured' };
        try {
          const { limit, offset } = getPaging(input, 25, 100);
          const releaseQuery = stringParam(input.releaseQuery).toLowerCase();
          const protocols = stringFilters(input.protocol, input.protocols);
          const indexers = stringFilters(input.indexer, input.indexers);
          const minSeeders = input.minSeeders == null ? undefined : Number(input.minSeeders);
          const maxSizeBytes = input.maxSizeBytes == null ? undefined : Number(input.maxSizeBytes);
          const sortBy = stringParam(input.sortBy);
          const sortDirection = stringParam(input.sortDirection || 'desc');
          const releases = await clients.prowlarr.searchReleases({
            query: String(input.query),
            type: String(input.type ?? 'search'),
            indexerIds: Array.isArray(input.indexerIds) ? input.indexerIds.map(Number).filter(Number.isFinite) : undefined,
            categories: Array.isArray(input.categories) ? input.categories.map(Number).filter(Number.isFinite) : undefined,
            limit,
            offset,
          });
          let filtered = filterRecords(releases as AnyRecord[], {
            query: releaseQuery,
            queryKeys: ['title', 'indexer', 'protocol', 'guid'],
            stringFilters: [
              { keys: ['protocol'], filters: protocols },
              { keys: ['indexer'], filters: indexers },
            ],
          }).filter(release => {
            if (Number.isFinite(minSeeders) && Number(release.seeders ?? 0) < Number(minSeeders)) return false;
            if (Number.isFinite(maxSizeBytes) && Number(release.size ?? 0) > Number(maxSizeBytes)) return false;
            return true;
          });
          filtered = sortRecords(filtered, sortBy, sortDirection);
          return { total: filtered.length, returned: filtered.length, limit, offset, releases: filtered };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    {
      name: 'plex_prowlarr_grab_release',
      description: 'Grab a Prowlarr release and send it to the configured download client.',
      inputSchema: {
        type: 'object',
        properties: {
          release: { type: 'object', description: 'A release object returned by plex_prowlarr_search_releases.' },
        },
        required: ['release'],
      },
      async execute(input) {
        if (!clients.prowlarr) return { success: false, error: 'Prowlarr not configured' };
        try {
          await clients.prowlarr.grabRelease(input.release as any);
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },

    {
      name: 'plex_tdarr_get_nodes',
      description: 'Get Tdarr status, nodes, active workers, staged jobs, and resource statistics.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional case-insensitive node name/id/address filter.' },
          status: { type: ['string', 'array'], items: { type: 'string' } },
          workerType: { type: ['string', 'array'], items: { type: 'string' } },
          includeWorkers: { type: 'boolean', default: true },
          includeStagedJobs: { type: 'boolean', default: true },
          stagedQuery: { type: 'string', description: 'Optional staged job id/status/node filter.' },
          stagedStatus: { type: ['string', 'array'], items: { type: 'string' } },
          nodeLimit: { type: 'number', default: 25, description: 'Maximum nodes returned. Capped at 100.' },
          nodeOffset: { type: 'number', default: 0 },
          stagedLimit: { type: 'number', default: 25, description: 'Maximum staged jobs returned. Capped at 100.' },
          stagedOffset: { type: 'number', default: 0 },
        },
      },
      async execute(input) {
        if (!clients.tdarr) return { error: 'Tdarr not configured' };
        try {
          const query = stringParam(input.query).toLowerCase();
          const statuses = stringFilters(input.status, input.statuses);
          const workerTypes = stringFilters(input.workerType, input.workerTypes);
          const includeWorkers = input.includeWorkers == null ? true : Boolean(input.includeWorkers);
          const includeStagedJobs = input.includeStagedJobs == null ? true : Boolean(input.includeStagedJobs);
          const nodeLimit = intParam(input.nodeLimit ?? input.limit, 25, 1, 100);
          const nodeOffset = intParam(input.nodeOffset ?? input.offset, 0, 0, Number.MAX_SAFE_INTEGER);
          const stagedLimit = intParam(input.stagedLimit, 25, 0, 100);
          const stagedOffset = intParam(input.stagedOffset, 0, 0, Number.MAX_SAFE_INTEGER);
          const stagedQuery = stringParam(input.stagedQuery).toLowerCase();
          const stagedStatuses = stringFilters(input.stagedStatus, input.stagedStatuses);
          const [status, nodes, resourceStats, stagedJobs] = await Promise.all([
            clients.tdarr.getStatus(),
            clients.tdarr.getNodes(),
            clients.tdarr.getResourceStats(),
            includeStagedJobs ? clients.tdarr.getStagedJobs() : Promise.resolve([]),
          ]);
          const filteredNodes = filterRecords(nodes as AnyRecord[], {
            query,
            queryKeys: ['id', '_id', 'nodeName', 'remoteAddress', 'status'],
            stringFilters: [{ keys: ['status'], filters: statuses }],
          }).filter(node => {
            if (!workerTypes.length) return true;
            const workers = Array.isArray(node.workerList) ? node.workerList as AnyRecord[] : [];
            return workers.some(worker => matchesStringFilters(worker.workerType, workerTypes));
          });
          const pagedNodes = pageItems(filteredNodes, nodeLimit, nodeOffset).map(node => {
            if (includeWorkers) return node;
            const { workers: _workers, workerList: _workerList, processes: _processes, ...slimNode } = node;
            return slimNode;
          });
          const filteredStagedJobs = filterRecords(stagedJobs as AnyRecord[], {
            query: stagedQuery,
            queryKeys: ['_id', 'workerType', 'status', 'nodeID'],
            stringFilters: [{ keys: ['status'], filters: stagedStatuses }],
          });
          const pagedStagedJobs = includeStagedJobs ? pageItems(filteredStagedJobs, stagedLimit, stagedOffset) : [];
          return {
            status,
            resourceStats,
            nodes: pagedNodes,
            nodesTotal: filteredNodes.length,
            nodesReturned: pagedNodes.length,
            nodeLimit,
            nodeOffset,
            nodesHasMore: nodeOffset + pagedNodes.length < filteredNodes.length,
            stagedJobs: pagedStagedJobs,
            stagedJobsTotal: filteredStagedJobs.length,
            stagedJobsReturned: pagedStagedJobs.length,
            stagedLimit,
            stagedOffset,
            stagedJobsHasMore: stagedOffset + pagedStagedJobs.length < filteredStagedJobs.length,
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    {
      name: 'plex_tdarr_control_node',
      description: 'Pause, resume, restart, or disconnect a Tdarr node.',
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string' },
          action: { type: 'string', enum: ['pause', 'resume', 'restart', 'disconnect'] },
        },
        required: ['nodeId', 'action'],
      },
      async execute(input) {
        if (!clients.tdarr) return { success: false, error: 'Tdarr not configured' };
        try {
          const nodeId = String(input.nodeId);
          const action = String(input.action);
          if (action === 'pause') await clients.tdarr.setNodePaused(nodeId, true);
          else if (action === 'resume') await clients.tdarr.setNodePaused(nodeId, false);
          else if (action === 'restart') await clients.tdarr.restartNode(nodeId);
          else if (action === 'disconnect') await clients.tdarr.disconnectNode(nodeId);
          else return { success: false, error: `Unsupported action: ${action}` };
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },

    {
      name: 'plex_tdarr_control_worker',
      description: 'Change Tdarr worker limits, cancel a worker item, or kill a worker.',
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string' },
          action: { type: 'string', enum: ['increase-limit', 'decrease-limit', 'cancel', 'kill'] },
          workerType: { type: 'string', enum: ['healthcheckcpu', 'healthcheckgpu', 'transcodecpu', 'transcodegpu'] },
          workerId: { type: 'string' },
        },
        required: ['nodeId', 'action'],
      },
      async execute(input) {
        if (!clients.tdarr) return { success: false, error: 'Tdarr not configured' };
        try {
          const nodeId = String(input.nodeId);
          const action = String(input.action);
          if (action === 'increase-limit' || action === 'decrease-limit') {
            await clients.tdarr.alterWorkerLimit(nodeId, action === 'increase-limit' ? 'increase' : 'decrease', String(input.workerType ?? 'transcodecpu') as any);
          } else if (action === 'cancel') {
            await clients.tdarr.cancelWorkerItem(nodeId, String(input.workerId), 'user');
          } else if (action === 'kill') {
            await clients.tdarr.killWorker(nodeId, String(input.workerId), 'single');
          } else {
            return { success: false, error: `Unsupported action: ${action}` };
          }
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },


    {
      name: 'plex_manage_request',
      description: 'Approve or deny a pending Seer/Overseerr media request by id.',
      inputSchema: {
        type: 'object',
        properties: {
          requestId: { type: 'number' },
          action: { type: 'string', enum: ['approve', 'deny'] },
        },
        required: ['requestId', 'action'],
      },
      async execute(input) {
        if (!clients.seer) return { success: false, error: 'Seer not configured' };
        try {
          const action = String(input.action);
          if (action === 'approve') await clients.seer.approveRequest(Number(input.requestId));
          else if (action === 'deny') await clients.seer.denyRequest(Number(input.requestId));
          else return { success: false, error: `Unsupported action: ${action}` };
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },

    {
      name: 'plex_control_download_item',
      description: 'Pause, resume, or delete a single SABnzbd/qBittorrent download item by id/hash.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['sabnzbd', 'qbittorrent'] },
          action: { type: 'string', enum: ['pause', 'resume', 'delete'] },
          id: { type: 'string', description: 'SABnzbd nzo_id or qBittorrent hash; sab-/qbt- prefixes are accepted.' },
          deleteFiles: { type: 'boolean', default: false },
        },
        required: ['source', 'action', 'id'],
      },
      async execute(input) {
        const source = String(input.source);
        const action = String(input.action);
        const id = String(input.id).replace(/^(sab|qbt)-/, '');
        const deleteFiles = input.deleteFiles == null ? false : Boolean(input.deleteFiles);
        try {
          if (source === 'sabnzbd') {
            if (!clients.sabnzbd) return { success: false, error: 'SABnzbd not configured' };
            if (action === 'pause') await clients.sabnzbd.pauseItem(id);
            else if (action === 'resume') await clients.sabnzbd.resumeItem(id);
            else if (action === 'delete') await clients.sabnzbd.deleteItem(id, deleteFiles);
            else return { success: false, error: `Unsupported action: ${action}` };
          } else if (source === 'qbittorrent') {
            if (!clients.qbittorrent) return { success: false, error: 'qBittorrent not configured' };
            if (action === 'pause') await clients.qbittorrent.pauseTorrent(id);
            else if (action === 'resume') await clients.qbittorrent.resumeTorrent(id);
            else if (action === 'delete') await clients.qbittorrent.deleteTorrent(id, deleteFiles);
            else return { success: false, error: `Unsupported action: ${action}` };
          } else {
            return { success: false, error: `Unsupported source: ${source}` };
          }
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },

    {
      name: 'plex_terminate_stream',
      description: 'Terminate an active Plex stream through Tautulli by session key.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionKey: { type: 'string' },
          message: { type: 'string', default: 'Stream terminated by admin' },
        },
        required: ['sessionKey'],
      },
      async execute(input) {
        if (!clients.tautulli) return { success: false, error: 'Tautulli not configured' };
        try {
          await clients.tautulli.terminateSession(String(input.sessionKey), String(input.message ?? 'Stream terminated by admin'));
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },

    {
      name: 'plex_bazarr_download_missing',
      description: 'Download missing/wanted subtitles for one Bazarr movie or episode.',
      inputSchema: {
        type: 'object',
        properties: {
          mediaType: { type: 'string', enum: ['movie', 'episode'] },
          radarrId: { type: 'number', description: 'Required for movie.' },
          seriesId: { type: 'number', description: 'Required for episode.' },
          episodeId: { type: 'number', description: 'Required for episode.' },
          language: { type: 'string' },
          forced: { type: 'boolean', default: false },
          hi: { type: 'boolean', default: false },
        },
        required: ['mediaType', 'language'],
      },
      async execute(input) {
        if (!clients.bazarr) return { success: false, error: 'Bazarr not configured' };
        try {
          if (input.mediaType === 'episode') {
            await clients.bazarr.downloadMissingEpisodeSubtitle({
              seriesId: Number(input.seriesId),
              episodeId: Number(input.episodeId),
              language: String(input.language),
              forced: Boolean(input.forced),
              hi: Boolean(input.hi),
            });
          } else {
            await clients.bazarr.downloadMissingMovieSubtitle({
              radarrId: Number(input.radarrId),
              language: String(input.language),
              forced: Boolean(input.forced),
              hi: Boolean(input.hi),
            });
          }
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },

    {
      name: 'plex_bazarr_manage_subtitle',
      description: 'Delete a Bazarr subtitle, apply a Bazarr subtitle tool, or reset Bazarr providers.',
      inputSchema: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['delete', 'apply-tool', 'reset-providers'] },
          mediaType: { type: 'string', enum: ['movie', 'episode'] },
          radarrId: { type: 'number' },
          seriesId: { type: 'number' },
          episodeId: { type: 'number' },
          language: { type: 'string' },
          path: { type: 'string' },
          forced: { type: 'boolean', default: false },
          hi: { type: 'boolean', default: false },
          subtitleToolAction: { type: 'string', description: 'Bazarr subtitle tool action for apply-tool.' },
          id: { type: 'number', description: 'Bazarr subtitle tool target id.' },
          type: { type: 'string', enum: ['movie', 'episode'] },
          originalFormat: { type: 'boolean' },
          reference: { type: 'string' },
          maxOffsetSeconds: { type: ['string', 'number'] },
          noFixFramerate: { type: 'boolean' },
          gss: { type: 'string' },
        },
        required: ['operation'],
      },
      async execute(input) {
        if (!clients.bazarr) return { success: false, error: 'Bazarr not configured' };
        try {
          const operation = String(input.operation);
          if (operation === 'reset-providers') {
            await clients.bazarr.resetProviders();
          } else if (operation === 'delete') {
            if (input.mediaType === 'episode') {
              await clients.bazarr.deleteEpisodeSubtitle({
                seriesId: Number(input.seriesId),
                episodeId: Number(input.episodeId),
                language: String(input.language),
                path: String(input.path),
                forced: Boolean(input.forced),
                hi: Boolean(input.hi),
              });
            } else {
              await clients.bazarr.deleteMovieSubtitle({
                radarrId: Number(input.radarrId),
                language: String(input.language),
                path: String(input.path),
                forced: Boolean(input.forced),
                hi: Boolean(input.hi),
              });
            }
          } else if (operation === 'apply-tool') {
            await clients.bazarr.applySubtitleTool({
              action: String(input.subtitleToolAction),
              language: String(input.language),
              path: String(input.path),
              type: String(input.type ?? input.mediaType ?? 'movie'),
              id: Number(input.id),
              forced: input.forced == null ? undefined : Boolean(input.forced),
              hi: input.hi == null ? undefined : Boolean(input.hi),
              originalFormat: input.originalFormat == null ? undefined : Boolean(input.originalFormat),
              reference: input.reference == null ? undefined : String(input.reference),
              maxOffsetSeconds: input.maxOffsetSeconds as string | number | undefined,
              noFixFramerate: input.noFixFramerate == null ? undefined : Boolean(input.noFixFramerate),
              gss: input.gss == null ? undefined : String(input.gss),
            });
          } else {
            return { success: false, error: `Unsupported operation: ${operation}` };
          }
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },

    {
      name: 'plex_prowlarr_bulk_grab',
      description: 'Grab multiple Prowlarr releases and send them to the configured download client.',
      inputSchema: {
        type: 'object',
        properties: {
          releases: { type: 'array', items: { type: 'object' }, description: 'Release objects returned by plex_prowlarr_search_releases.' },
        },
        required: ['releases'],
      },
      async execute(input) {
        if (!clients.prowlarr) return { success: false, error: 'Prowlarr not configured' };
        try {
          const releases = Array.isArray(input.releases) ? input.releases as any[] : [];
          if (!releases.length) return { success: false, error: 'At least one release is required' };
          const grabbed = await clients.prowlarr.grabReleases(releases as any);
          return { success: true, total: grabbed.length, grabbed };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },

    {
      name: 'plex_tdarr_scan',
      description: 'Trigger a Tdarr scan for an individual file, rescan a known file record, or scan a library/config.',
      inputSchema: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['file', 'library', 'rescan-file'] },
          file: { type: 'object', description: 'Tdarr file object for file/rescan-file scopes.' },
          scanTypes: { type: 'object', description: 'Optional Tdarr scanTypes for file scope.' },
          scanConfig: { type: 'object', description: 'Tdarr scan config for library scope.' },
        },
        required: ['scope'],
      },
      async execute(input) {
        if (!clients.tdarr) return { success: false, error: 'Tdarr not configured' };
        try {
          const scope = String(input.scope);
          if (scope === 'file') await clients.tdarr.scanIndividualFile(input.file ?? input, input.scanTypes as any);
          else if (scope === 'rescan-file') await clients.tdarr.rescanFile((input.file ?? input) as any);
          else if (scope === 'library') await clients.tdarr.scanFiles(input.scanConfig ?? input);
          else return { success: false, error: `Unsupported scope: ${scope}` };
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },

    {
      name: 'plex_wizarr_create_invitation',
      description: 'Create a Wizarr invitation with expiry/duration, unlimited flag, and optional library/server scope; returns the invitation/code.',
      inputSchema: {
        type: 'object',
        properties: {
          expiresInDays: { type: 'number', default: 7 },
          durationDays: { type: 'number' },
          unlimited: { type: 'boolean', default: true },
          libraryIds: { type: 'array', items: { type: 'number' } },
          serverIds: { type: 'array', items: { type: 'number' } },
        },
      },
      async execute(input) {
        if (!clients.wizarr) return { success: false, error: 'Wizarr not configured' };
        try {
          const invitation = await clients.wizarr.createInvitation({
            expiresInDays: Number(input.expiresInDays ?? 7),
            durationDays: input.durationDays == null ? undefined : Number(input.durationDays),
            unlimited: input.unlimited == null ? true : Boolean(input.unlimited),
            libraryIds: Array.isArray(input.libraryIds) ? input.libraryIds.map(Number).filter(Number.isFinite) : undefined,
            serverIds: Array.isArray(input.serverIds) ? input.serverIds.map(Number).filter(Number.isFinite) : undefined,
          });
          return { success: true, invitation };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },

    {
      name: 'plex_wizarr_manage',
      description: 'Delete a Wizarr invitation or remove a Wizarr user by id.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['delete-invitation', 'delete-user'] },
          id: { type: ['string', 'number'] },
        },
        required: ['action', 'id'],
      },
      async execute(input) {
        if (!clients.wizarr) return { success: false, error: 'Wizarr not configured' };
        try {
          const action = String(input.action);
          const id = input.id as string | number;
          if (action === 'delete-invitation') await clients.wizarr.deleteInvitation(id);
          else if (action === 'delete-user') await clients.wizarr.deleteUser(id);
          else return { success: false, error: `Unsupported action: ${action}` };
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },

    {
      name: 'plex_get_history',
      description: 'Return recent Tautulli watch history and/or SABnzbd completed download history.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['all', 'tautulli', 'sabnzbd'], default: 'all' },
          query: { type: 'string', description: 'Optional case-insensitive title/user/category/status filter.' },
          mediaType: { type: ['string', 'array'], items: { type: 'string' }, description: 'Optional Tautulli media_type filter.' },
          user: { type: ['string', 'array'], items: { type: 'string' }, description: 'Optional Tautulli user filter.' },
          status: { type: ['string', 'array'], items: { type: 'string' }, description: 'Optional SABnzbd status filter.' },
          category: { type: ['string', 'array'], items: { type: 'string' }, description: 'Optional SABnzbd category filter.' },
          limit: { type: 'number', default: 20, description: 'Maximum history rows returned per source. Capped at 100.' },
          offset: { type: 'number', default: 0 },
        },
      },
      async execute(input) {
        const source = String(input.source ?? 'all');
        const query = stringParam(input.query).toLowerCase();
        const mediaTypes = stringFilters(input.mediaType, input.mediaTypes);
        const users = stringFilters(input.user, input.users);
        const statuses = stringFilters(input.status, input.statuses);
        const categories = stringFilters(input.category, input.categories);
        const { limit, offset } = getPaging(input, 20, 100);
        const fetchLimit = Math.min(200, limit + offset);
        const result: Record<string, unknown> = {};
        if ((source === 'all' || source === 'tautulli') && clients.tautulli) {
          try {
            const history = await clients.tautulli.getHistory(fetchLimit);
            const filtered = filterRecords(history as unknown as AnyRecord[], {
              query,
              queryKeys: ['row_id', 'full_title', 'user', 'media_type'],
              stringFilters: [
                { keys: ['media_type'], filters: mediaTypes },
                { keys: ['user'], filters: users },
              ],
            });
            const paged = pageItems(filtered, limit, offset);
            result.tautulli = { ...pageMeta(filtered.length, paged.length, limit, offset), history: paged };
          }
          catch (e) { result.tautulliError = String(e); }
        }
        if ((source === 'all' || source === 'sabnzbd') && clients.sabnzbd) {
          try {
            const history = await clients.sabnzbd.getHistory(fetchLimit);
            const filtered = filterRecords(history as AnyRecord[], {
              query,
              queryKeys: ['id', 'name', 'status', 'category', 'failMessage'],
              stringFilters: [
                { keys: ['status'], filters: statuses },
                { keys: ['category'], filters: categories },
              ],
            });
            const paged = pageItems(filtered, limit, offset);
            result.sabnzbd = { ...pageMeta(filtered.length, paged.length, limit, offset), history: paged };
          }
          catch (e) { result.sabnzbdError = String(e); }
        }
        return result;
      },
    },

    {
      name: 'plex_get_watch_stats',
      description: 'Return Tautulli home/watch stats such as most-watched media and top users over a time range.',
      inputSchema: {
        type: 'object',
        properties: {
          timeRange: { type: 'number', default: 30, description: 'Time range in days.' },
          count: { type: 'number', default: 10, description: 'Rows requested from Tautulli per stat. Capped at 100.' },
          statType: { type: ['string', 'array'], items: { type: 'string' }, description: 'Optional stat_type/stat_id filter.' },
          query: { type: 'string', description: 'Optional case-insensitive row title/user filter.' },
          rowLimit: { type: 'number', description: 'Rows returned per stat after filtering. Defaults to count.' },
          includeEmptyStats: { type: 'boolean', default: false },
        },
      },
      async execute(input) {
        if (!clients.tautulli) return { error: 'Tautulli not configured' };
        try {
          const count = intParam(input.count, 10, 1, 100);
          const rowLimit = intParam(input.rowLimit ?? count, count, 1, 100);
          const query = stringParam(input.query).toLowerCase();
          const statTypes = stringFilters(input.statType, input.statTypes, input.statId, input.statIds);
          const includeEmptyStats = Boolean(input.includeEmptyStats);
          const stats = await clients.tautulli.getHomeStats(Number(input.timeRange ?? 30), count);
          const filteredStats = stats
            .filter(stat => !statTypes.length || matchesStringFilters(stat.stat_type, statTypes) || matchesStringFilters(stat.stat_id, statTypes))
            .map(stat => {
              const rows = (stat.rows ?? []).filter(row => matchesQuery(query, row.title, row.user));
              return {
                ...stat,
                rowTotal: rows.length,
                rowReturned: Math.min(rows.length, rowLimit),
                rows: rows.slice(0, rowLimit),
                rowsHasMore: rows.length > rowLimit,
              };
            })
            .filter(stat => includeEmptyStats || stat.rowTotal > 0);
          return { stats: filteredStats, count, rowLimit };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    {
      name: 'plex_get_disk_space',
      description: 'Return Radarr and/or Sonarr disk space information including path, free space, and total space.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['all', 'radarr', 'sonarr'], default: 'all' },
          query: { type: 'string', description: 'Optional case-insensitive disk path filter.' },
          minFreeSpaceBytes: { type: 'number' },
          limit: { type: 'number', default: 50, description: 'Maximum disk rows returned per source. Capped at 100.' },
          offset: { type: 'number', default: 0 },
        },
      },
      async execute(input) {
        const source = String(input.source ?? 'all');
        const query = stringParam(input.query).toLowerCase();
        const minFreeSpaceBytes = input.minFreeSpaceBytes == null ? undefined : Number(input.minFreeSpaceBytes);
        const { limit, offset } = getPaging(input, 50, 100);
        const filterDisks = (disks: AnyRecord[]) => {
          const filtered = disks.filter(disk => {
            if (!matchesQuery(query, disk.path)) return false;
            if (Number.isFinite(minFreeSpaceBytes) && Number(disk.freeSpace ?? 0) < Number(minFreeSpaceBytes)) return false;
            return true;
          });
          const paged = pageItems(filtered, limit, offset);
          return { ...pageMeta(filtered.length, paged.length, limit, offset), disks: paged };
        };
        const result: Record<string, unknown> = {};
        if ((source === 'all' || source === 'radarr') && clients.radarr) {
          try { result.radarr = filterDisks(await clients.radarr.getDiskSpace()); }
          catch (e) { result.radarrError = String(e); }
        }
        if ((source === 'all' || source === 'sonarr') && clients.sonarr) {
          try { result.sonarr = filterDisks(await clients.sonarr.getDiskSpace()); }
          catch (e) { result.sonarrError = String(e); }
        }
        return result;
      },
    },


    {
      name: 'plex_tdarr_requeue_library',
      description: 'Requeue all transcode or health-check jobs for a Tdarr library.',
      inputSchema: {
        type: 'object',
        properties: {
          libraryId: { type: 'string' },
          queue: { type: 'string', enum: ['transcode', 'healthcheck'], default: 'transcode' },
        },
        required: ['libraryId'],
      },
      async execute(input) {
        if (!clients.tdarr) return { success: false, error: 'Tdarr not configured' };
        try {
          await clients.tdarr.requeueLibrary(String(input.libraryId), String(input.queue ?? 'transcode'));
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },
  ];
}
