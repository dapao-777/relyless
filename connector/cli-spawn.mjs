// npm-installed CLIs on Windows are .cmd shims, which CreateProcess cannot
// execute directly — they must go through ComSpec. These helpers keep that
// handling identical across every connector backend.
const WINDOWS_SHIM = /\.(cmd|bat)$/i;

const cmdQuote = value => `"${String(value).replace(/"/g, '""')}"`;

// Returns {command, args, options} suitable for spawn()/spawnSync().
// Non-Windows platforms and real executables pass through untouched.
export function cliSpawnTarget(file, args, {platform = process.platform, comspec = process.env.ComSpec || process.env.COMSPEC} = {}) {
  if (platform !== 'win32' || !WINDOWS_SHIM.test(file)) return {command: file, args, options: {}};
  const line = [cmdQuote(file), ...args.map(cmdQuote)].join(' ');
  // windowsVerbatimArguments: Node must not re-quote the /c payload.
  return {command: comspec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], options: {windowsHide: true, windowsVerbatimArguments: true}};
}

// Candidate file names to probe per directory, honoring PATHEXT order so a
// native .exe wins over a .cmd shim when both exist.
export function executableNames(name, {platform = process.platform, pathext = process.env.PATHEXT} = {}) {
  if (platform !== 'win32') return [name];
  const exts = (pathext || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map(ext => ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`);
  const lower = name.toLowerCase();
  if (exts.some(ext => lower.endsWith(ext))) return [name];
  return [...exts.map(ext => `${name}${ext}`), name];
}
