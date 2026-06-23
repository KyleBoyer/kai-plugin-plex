import esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { copyFileSync, mkdirSync, readFileSync } from 'fs';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes('--watch');
const isDev = process.argv.includes('--dev');

const manifest = JSON.parse(readFileSync(resolve(__dirname, 'plugin.json'), 'utf-8'));
const pluginName = manifest.name;

const outputDir = isDev
  ? resolve(homedir(), '.kai', 'plugins', pluginName)
  : resolve(__dirname, 'dist');

const builtins = new Set([
  'fs', 'path', 'child_process', 'crypto', 'events', 'stream', 'util',
  'http', 'https', 'net', 'os', 'url', 'zlib', 'buffer', 'process',
  'assert', 'constants', 'dns', 'domain', 'dgram', 'querystring',
  'readline', 'repl', 'string_decoder', 'sys', 'timers', 'tls', 'tty', 'vm',
]);

// Make React imports resolve from globalThis.React (injected by Kai host)
const reactGlobalPlugin = {
  name: 'react-global',
  setup(build) {
    build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, args => ({
      path: args.path,
      namespace: 'react-global',
    }));
    build.onLoad({ filter: /.*/, namespace: 'react-global' }, () => ({
      contents: `
        const R = () => globalThis.React;
        export default new Proxy({}, { get: (_, k) => R()[k] });
        export const useState = (...a) => R().useState(...a);
        export const useEffect = (...a) => R().useEffect(...a);
        export const useRef = (...a) => R().useRef(...a);
        export const useCallback = (...a) => R().useCallback(...a);
        export const useMemo = (...a) => R().useMemo(...a);
        export const useContext = (...a) => R().useContext(...a);
        export const createElement = (...a) => R().createElement(...a);
        export const Fragment = Symbol.for('react.fragment');
      `,
      loader: 'js',
    }));
  },
};

const backendOptions = {
  entryPoints: ['./src/backend/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: resolve(outputDir, 'backend.js'),
  sourcemap: true,
  target: 'node18',
  external: [...builtins],
};

const frontendOptions = {
  entryPoints: ['./src/frontend/index.ts'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  outfile: resolve(outputDir, 'frontend.js'),
  sourcemap: true,
  target: 'es2020',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  plugins: [reactGlobalPlugin],
};

mkdirSync(outputDir, { recursive: true });
copyFileSync(resolve(__dirname, 'plugin.json'), resolve(outputDir, 'plugin.json'));

if (isWatch) {
  const backendCtx = await esbuild.context(backendOptions);
  const frontendCtx = await esbuild.context(frontendOptions);
  await Promise.all([backendCtx.watch(), frontendCtx.watch()]);
  console.log(`Watching... (output: ${outputDir})`);
} else {
  await Promise.all([
    esbuild.build(backendOptions),
    esbuild.build(frontendOptions),
  ]).catch(() => process.exit(1));
  console.log(isDev ? `Built to ~/.kai/plugins/${pluginName}/` : 'Built to dist/');
}
