export class TdarrClient {
  private url: string;
  private apiKey: string;
  private fetchFn: typeof fetch;

  constructor(url: string, apiKey: string, fetchFn: typeof fetch) {
    this.url = url.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.fetchFn = fetchFn;
  }

  private authHeaders(contentType = false): HeadersInit {
    return contentType
      ? { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' }
      : { 'x-api-key': this.apiKey };
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    timeoutMs = 15000,
  ): Promise<T> {
    const init: RequestInit = {
      method,
      headers: this.authHeaders(body !== undefined),
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await this.fetchFn(`${this.url}${path}`, {
      ...init,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Tdarr ${method} ${path}: ${res.status}${text ? ` ${text}` : ''}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  private async get<T>(path: string, timeoutMs?: number): Promise<T> {
    return this.request<T>('GET', path, undefined, timeoutMs);
  }

  private async post<T>(path: string, data: unknown = {}, timeoutMs?: number): Promise<T> {
    return this.request<T>('POST', path, { data }, timeoutMs);
  }

  async ping(): Promise<boolean> {
    try {
      const data = await this.get<{ status: string }>('/api/v2/status');
      return data.status === 'good';
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<TdarrStatus> {
    return this.get<TdarrStatus>('/api/v2/status');
  }

  async getNodes(): Promise<TdarrNode[]> {
    try {
      const data = await this.get<Record<string, TdarrRawNode>>('/api/v2/get-nodes');
      return Object.entries(data).map(([id, node]) => normalizeNode(id, node));
    } catch {
      return [];
    }
  }

  async getResourceStats(): Promise<TdarrResourceStats> {
    return this.post<TdarrResourceStats>('/api/v2/get-res-stats', {});
  }

  async getDbStatuses(): Promise<Record<string, TdarrDbStatus>> {
    return this.post<Record<string, TdarrDbStatus>>('/api/v2/get-db-statuses', {});
  }

  async getLibraries(): Promise<TdarrLibrary[]> {
    return this.crud<TdarrLibrary[]>('LibrarySettingsJSONDB', 'getAll');
  }

  async getStagedJobs(): Promise<TdarrStagedJob[]> {
    return this.crud<TdarrStagedJob[]>('StagedJSONDB', 'getAll');
  }

  async getRecentJobs(limit = 100): Promise<TdarrJob[]> {
    const jobs = await this.crud<TdarrJob[]>('JobsJSONDB', 'getAll', '', {}, undefined, 30000);
    return jobs.slice(-limit).reverse();
  }

  async crud<T>(
    collection: string,
    mode: string,
    docID = '',
    obj: unknown = {},
    filters?: unknown,
    timeoutMs = 15000,
  ): Promise<T> {
    return this.post<T>('/api/v2/cruddb', {
      collection,
      mode,
      docID,
      obj,
      ...(filters ? { filters } : {}),
    }, timeoutMs);
  }

  async updateNode(nodeID: string, nodeUpdates: Record<string, unknown>): Promise<unknown> {
    return this.post('/api/v2/update-node', { nodeID, nodeUpdates });
  }

  async setNodePaused(nodeID: string, paused: boolean): Promise<unknown> {
    return this.updateNode(nodeID, { nodePaused: paused });
  }

  async restartNode(nodeID: string): Promise<unknown> {
    return this.post('/api/v2/restart-node', { nodeID }, 30000);
  }

  async disconnectNode(nodeID: string): Promise<unknown> {
    return this.post('/api/v2/disconnect-node', { nodeID }, 30000);
  }

  async alterWorkerLimit(nodeID: string, process: 'increase' | 'decrease', workerType: TdarrWorkerType): Promise<unknown> {
    return this.post('/api/v2/alter-worker-limit', { nodeID, process, workerType });
  }

  async cancelWorkerItem(nodeID: string, workerID: string, cause = 'user'): Promise<unknown> {
    return this.post('/api/v2/cancel-worker-item', { nodeID, workerID, cause }, 30000);
  }

  async killWorker(nodeID: string, workerID: string, mode: 'single' | 'all' = 'single'): Promise<unknown> {
    return this.post('/api/v2/kill-worker', { nodeID, workerID, mode }, 30000);
  }

  async scanFiles(scanConfig: unknown): Promise<unknown> {
    return this.post('/api/v2/scan-files', { scanConfig }, 30000);
  }

  async scanIndividualFile(file: unknown, scanTypes: TdarrScanTypes = defaultScanTypes): Promise<unknown> {
    return this.post('/api/v2/scan-individual-file', { file, scanTypes }, 30000);
  }

  async rescanFile(file: { _id: string; DB: string }): Promise<unknown> {
    return this.post('/api/v2/rescan-file', { _id: file._id, DB: file.DB }, 30000);
  }

  async setAllStatus(dbID: string, mode: string, table = '', processStatus = 'Queued'): Promise<unknown> {
    return this.post('/api/v2/set-all-status', { dbID, mode, table, processStatus }, 30000);
  }

  async requeueLibrary(libraryId: string, queue: 'transcode' | 'healthcheck' | string): Promise<unknown> {
    const mode = queue === 'healthcheck' ? 'HealthCheck' : queue === 'transcode' ? 'TranscodeDecisionMaker' : queue;
    return this.setAllStatus(libraryId, mode, '', 'Queued');
  }
}

const defaultScanTypes: TdarrScanTypes = {
  exifToolScan: true,
  mediaInfoScan: true,
  closedCaptionScan: true,
};

function normalizeNode(id: string, node: TdarrRawNode): TdarrNode {
  const workers = node.workers ?? {};
  const workerList = Object.entries(workers).map(([workerId, worker]) => ({
    ...(worker as TdarrWorker),
    id: workerId,
    _id: (worker as TdarrWorker)._id ?? workerId,
    nodeId: node._id ?? id,
    nodeName: node.nodeName,
  }));
  return {
    ...node,
    id: node._id ?? id,
    _id: node._id ?? id,
    status: node.nodePaused ? 'paused' : 'online',
    workerCount: workerList.length,
    workers,
    workerList,
  };
}

export interface TdarrStatus {
  status: string;
  version: string;
  uptime: number;
  isProduction: boolean;
  os?: string;
  buildDate?: string;
  serverEngine?: string;
}

export type TdarrWorkerType = 'healthcheckcpu' | 'healthcheckgpu' | 'transcodecpu' | 'transcodegpu';

export interface TdarrRawNode {
  _id?: string;
  nodeName: string;
  remoteAddress?: string;
  config?: Record<string, unknown>;
  workerLimits?: Partial<Record<TdarrWorkerType, number>>;
  schedule?: unknown;
  nodeTags?: string[];
  nodePaused?: boolean;
  scheduleEnabled?: boolean;
  workers?: Record<string, TdarrWorker>;
  processes?: Record<string, unknown>;
  resStats?: TdarrResourceStats;
  queueLengths?: Partial<Record<TdarrWorkerType, number>>;
  nodeEngine?: string;
  protocolVersion?: string;
  priority?: number;
  [key: string]: unknown;
}

export interface TdarrNode extends TdarrRawNode {
  id: string;
  _id: string;
  nodeName: string;
  status: string;
  workerCount: number;
  workerList: TdarrWorker[];
}

export interface TdarrWorker {
  id?: string;
  _id?: string;
  nodeId?: string;
  nodeName?: string;
  workerType?: TdarrWorkerType | string;
  percentage?: number;
  fps?: number;
  eta?: string;
  status?: string;
  step?: string;
  stepTime?: number;
  totalTime?: number;
  startTime?: number;
  idle?: boolean;
  enabled?: boolean;
  title?: string;
  plugin?: string;
  job?: {
    start?: number;
    title?: string;
    file?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface TdarrResourceStats {
  process?: { uptime?: number; heapUsedMB?: string | number; heapTotalMB?: string | number };
  os?: { cpuPerc?: string | number; memUsedGB?: string | number; memTotalGB?: string | number };
}

export interface TdarrDbStatus {
  activity?: string;
  type?: string;
  count?: number;
  totalCount?: number;
}

export interface TdarrLibrary {
  _id: string;
  name?: string;
  folder?: string;
  output?: string;
  cache?: string;
  processLibrary?: boolean;
  processTranscodes?: boolean;
  processHealthChecks?: boolean;
  totalTranscodeCount?: number;
  totalHealthCheckCount?: number;
  [key: string]: unknown;
}

export interface TdarrStagedJob {
  _id: string;
  workerType?: string;
  start?: number;
  job?: Record<string, unknown>;
  originalLibraryFile?: Record<string, unknown>;
  status?: string;
  handling?: boolean;
  nodeID?: string;
  inLimbo?: boolean;
  stagedLog?: string;
  [key: string]: unknown;
}

export interface TdarrJob {
  _id: string;
  start?: number;
  end?: number;
  duration?: number;
  job?: Record<string, unknown>;
  file?: string;
  DB?: string;
  nodeID?: string;
  nodeNames?: string[];
  status?: string;
  [key: string]: unknown;
}

export interface TdarrScanTypes {
  exifToolScan?: boolean;
  mediaInfoScan?: boolean;
  closedCaptionScan?: boolean;
}
