import React, { useState, useCallback, useEffect } from 'react';

type PluginComponentProps = {
  pluginName: string;
  props?: Record<string, unknown>;
  onAction: (action: string, data?: unknown) => void;
  onClose?: () => void;
  pluginConfig?: Record<string, unknown>;
  pluginState?: Record<string, unknown>;
  setPluginConfig?: (path: string, value: unknown) => Promise<void>;
};

const SERVICES: { key: string; label: string; keyLabel: string; placeholder: string }[] = [
  { key: 'plex',        label: 'Plex',        keyLabel: 'Token',   placeholder: 'yECBBY...' },
  { key: 'radarr',      label: 'Radarr',      keyLabel: 'API Key', placeholder: '99b29e...' },
  { key: 'sonarr',      label: 'Sonarr',      keyLabel: 'API Key', placeholder: '75a224...' },
  { key: 'tautulli',    label: 'Tautulli',    keyLabel: 'API Key', placeholder: '7a27ac...' },
  { key: 'bazarr',      label: 'Bazarr',      keyLabel: 'API Key', placeholder: '4e5f1d...' },
  { key: 'prowlarr',    label: 'Prowlarr',    keyLabel: 'API Key', placeholder: '3ebbad...' },
  { key: 'seer',        label: 'Seer',        keyLabel: 'API Key', placeholder: 'MTc2OD...' },
  { key: 'sabnzbd',     label: 'SABnzbd',     keyLabel: 'API Key', placeholder: '85d5ce...' },
  { key: 'qbittorrent', label: 'qBittorrent', keyLabel: 'API Key', placeholder: 'qbt_XS...' },
  { key: 'tdarr',       label: 'Tdarr',       keyLabel: 'API Key', placeholder: 'tapi_b...' },
  { key: 'wizarr',      label: 'Wizarr',      keyLabel: 'API Key', placeholder: 'qcbDEB...' },
];

function StatusDot({ status }: { status: string }) {
  const color = status === 'ok'
    ? 'bg-green-500'
    : status === 'error'
    ? 'bg-red-500'
    : status === 'loading'
    ? 'bg-yellow-400 animate-pulse'
    : 'bg-muted-foreground/30';
  const title = status === 'ok' ? 'Connected' : status === 'error' ? 'Connection failed' : status === 'loading' ? 'Connecting...' : 'Not configured';
  return <span className={`inline-block w-2 h-2 rounded-full ${color} flex-shrink-0`} title={title} />;
}

function ServiceRow({
  svc,
  serviceStatus,
  pluginConfig,
  setPluginConfig,
  onAction,
  lastTestResult,
}: {
  svc: typeof SERVICES[0];
  serviceStatus: Record<string, string>;
  pluginConfig: Record<string, any>;
  setPluginConfig: (path: string, value: unknown) => Promise<void>;
  onAction: (action: string, data?: unknown) => void;
  lastTestResult?: { service: string; result: 'ok' | 'error'; ts: number } | null;
}) {
  const cfg = (pluginConfig[svc.key] as Record<string, unknown>) ?? {};
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'error' | null>(null);
  const [pendingKey, setPendingKey] = useState('');
  const status = serviceStatus[svc.key] ?? 'unconfigured';
  const keyConfigured = Boolean(cfg.apiKey);

  const saveKey = useCallback(() => {
    const k = pendingKey.trim();
    if (!k) return;
    onAction('save-apikey', { service: svc.key, key: k });
    setPendingKey('');
  }, [pendingKey, svc.key, onAction]);

  const testConn = useCallback(() => {
    setTesting(true);
    setTestResult(null);
    onAction('test-connection', { service: svc.key });
  }, [svc.key, onAction]);

  // Backend publishes lastTestResult when a test completes; show inline feedback
  useEffect(() => {
    if (!lastTestResult) return;
    if (lastTestResult.service !== svc.key) return;
    setTesting(false);
    setTestResult(lastTestResult.result);
    const t = setTimeout(() => setTestResult(null), 4000);
    return () => clearTimeout(t);
  }, [lastTestResult?.ts]);

  const inputClass = 'w-full rounded border border-border/50 bg-muted/30 px-2 py-1.5 text-xs font-mono placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none';

  return (
    <div className="border border-border/30 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/20 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <StatusDot status={status} />
        <span className="text-sm font-medium flex-1">{svc.label}</span>
        <span className="text-xs text-muted-foreground">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-border/30 pt-2">
          <div className="flex items-center gap-2 mb-2">
            <input
              type="checkbox"
              id={`${svc.key}-enabled`}
              checked={cfg.enabled !== false}
              onChange={e => setPluginConfig(`${svc.key}.enabled`, (e.target as HTMLInputElement).checked)}
              className="rounded"
            />
            <label htmlFor={`${svc.key}-enabled`} className="text-xs text-muted-foreground cursor-pointer">
              Enabled
            </label>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">URL</label>
            <input
              type="text"
              className={inputClass}
              defaultValue={String(cfg.url ?? '')}
              placeholder="http://host:port"
              onBlur={e => setPluginConfig(`${svc.key}.url`, (e.target as HTMLInputElement).value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground flex items-center gap-1.5">
              {svc.keyLabel}
              {keyConfigured && <span className="text-green-500/80 text-xs">(stored in keychain)</span>}
            </label>
            <div className="flex gap-1.5">
              <input
                type="password"
                className={`${inputClass} flex-1`}
                value={pendingKey}
                placeholder={keyConfigured ? '••••••••  (enter new key to replace)' : svc.placeholder}
                onChange={e => setPendingKey((e.target as HTMLInputElement).value)}
                onKeyDown={e => e.key === 'Enter' && saveKey()}
              />
              {pendingKey.trim() && (
                <button
                  className="px-2 py-1 text-xs rounded bg-primary/10 hover:bg-primary/20 border border-primary/20"
                  onClick={saveKey}
                >
                  Save
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <button
              className="px-3 py-1 text-xs rounded bg-primary/10 hover:bg-primary/20 border border-primary/20 transition-colors disabled:opacity-50"
              onClick={testConn}
              disabled={testing}
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
            {testResult === 'ok' && (
              <span className="text-xs text-green-400">✓ Connected</span>
            )}
            {testResult === 'error' && (
              <span className="text-xs text-red-400">✗ Failed — check URL and key</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function PlexSettings({ onAction, pluginConfig, pluginState, setPluginConfig }: PluginComponentProps) {
  const config = (pluginConfig ?? {}) as Record<string, any>;
  const state = (pluginState ?? {}) as any;
  const serviceStatus = (state.serviceStatus ?? {}) as Record<string, string>;
  const lastTestResult = state.lastTestResult as { service: string; result: 'ok' | 'error'; ts: number } | undefined;
  const saveFn = setPluginConfig ?? (async () => {});

  const connectedCount = Object.values(serviceStatus).filter(s => s === 'ok').length;
  const errorCount = Object.values(serviceStatus).filter(s => s === 'error').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span>{connectedCount} connected</span>
        {errorCount > 0 && <span className="text-red-400">{errorCount} failed</span>}
      </div>
      <div className="space-y-2">
        {SERVICES.map(svc => (
          <ServiceRow
            key={svc.key}
            svc={svc}
            serviceStatus={serviceStatus}
            pluginConfig={config}
            setPluginConfig={saveFn}
            onAction={onAction}
            lastTestResult={lastTestResult}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground/60 pt-2">
        API keys are encrypted via the OS keychain (Electron safeStorage). URLs and enable flags are stored in plaintext.
      </p>
    </div>
  );
}
