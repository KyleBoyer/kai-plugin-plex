import { PlexPanel } from './components/PlexPanel';
import { PlexSettings } from './components/PlexSettings';

export function register(env: {
  React: unknown;
  registerComponents: (pluginName: string, components: Record<string, unknown>) => void;
}) {
  (globalThis as Record<string, unknown>).React = env.React;
  env.registerComponents('plex', {
    PanelView: PlexPanel,
    SettingsView: PlexSettings,
  });
}
