import {spawn} from './process.mjs';
import {chmod, mkdtemp, open, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

export const MAX_CONFIG_BYTES = 262144;

const editorError = (code, message, recoveryFile, details = {}) => Object.assign(
  new Error(message), {code, ...(recoveryFile ? {recoveryFile} : {}), ...details},
);

/** Split an editor command into literal argv; never expand variables or run a shell. */
export function parseEditorCommand(command) {
  if (typeof command !== 'string' || !command.trim() || /[\0\r\n]/.test(command)) {
    throw editorError('EDITOR_COMMAND_INVALID', 'Choose an editor executable, optionally followed by arguments.');
  }
  const args = [];
  let word = '', quote = '', started = false;
  for (let index = 0; index < command.length; index++) {
    const char = command[index], next = command[index + 1];
    if (quote === "'") {
      if (char === "'") quote = '';
      else word += char;
    } else if (quote === '"') {
      if (char === '"') quote = '';
      else if (char === '\\' && next === '"') { word += next; index++; }
      else word += char;
    } else if (/\s/.test(char)) {
      if (started) { args.push(word); word = ''; started = false; }
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (char === '\\' && next && (/\s/.test(next) || next === '"' || next === "'")) {
      word += next;
      started = true;
      index++;
    } else {
      word += char;
      started = true;
    }
  }
  if (quote) throw editorError('EDITOR_COMMAND_INVALID', 'The editor command contains an unmatched quote.');
  if (started) args.push(word);
  if (!args[0]) throw editorError('EDITOR_COMMAND_INVALID', 'Choose a nonempty editor executable.');
  return args;
}

function launchEditor(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({code, signal}));
  });
}

async function readBounded(file) {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const {bytesRead} = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_CONFIG_BYTES) throw editorError('CONFIG_TOO_LARGE', 'The configuration exceeds the 256 KiB limit.', file);
    return buffer.subarray(0, length).toString('utf8').replace(/^\uFEFF/, '');
  } finally {
    await handle.close();
  }
}

/**
 * Edit a temporary copy, leaving the active configuration untouched.
 * The caller validates and saves config, then calls cleanup only after success.
 * An error after creating the copy includes recoveryFile; its contents are never
 * included in errors. Inject launch(command, args, options) for noninteractive use.
 */
export async function editConfig(config, {
  editor, env = process.env, launch = launchEditor, platform = process.platform,
  tempRoot = tmpdir(), cwd = process.cwd(),
} = {}) {
  const command = editor ?? [env.VISUAL, env.EDITOR].find(value => typeof value === 'string' && value.trim())
    ?? (platform === 'win32' ? 'notepad.exe' : 'vi');
  const [executable, ...args] = parseEditorCommand(command);
  let serialized;
  try { serialized = JSON.stringify(config, null, 2); }
  catch { throw editorError('CONFIG_SERIALIZE_FAILED', 'The configuration cannot be encoded as JSON.'); }
  if (serialized === undefined) throw editorError('CONFIG_SERIALIZE_FAILED', 'The configuration cannot be encoded as JSON.');
  serialized += '\n';
  if (Buffer.byteLength(serialized) > MAX_CONFIG_BYTES) throw editorError('CONFIG_TOO_LARGE', 'The configuration exceeds the 256 KiB limit.');

  const directory = await mkdtemp(path.join(tempRoot, 'subagent-bridge-config-'));
  const file = path.join(directory, 'config.json');
  try {
    await chmod(directory, 0o700);
    await writeFile(file, serialized, {mode: 0o600, flag: 'wx'});
  } catch {
    await rm(directory, {recursive: true, force: true});
    throw editorError('EDITOR_TEMP_FAILED', 'Could not create a temporary configuration file.');
  }

  let result;
  try { result = await launch(executable, [...args, file], {env, cwd, stdio: 'inherit', shell: false}); }
  catch { throw editorError('EDITOR_LAUNCH_FAILED', 'Could not start the editor. Check its executable path and arguments.', file); }
  const code = typeof result === 'number' ? result : result?.code;
  const signal = typeof result === 'object' ? result?.signal : undefined;
  if (code !== 0 || signal) {
    throw editorError('EDITOR_EXIT_FAILED', 'The editor did not finish successfully. The edited copy has been retained.', file,
      {exitCode: code ?? null, ...(signal ? {signal} : {})});
  }

  let contents;
  try {
    // Editors sometimes replace the file when saving; restore its private mode.
    await chmod(file, 0o600);
    contents = await readBounded(file);
  } catch (error) {
    if (error.code === 'CONFIG_TOO_LARGE') throw error;
    throw editorError('CONFIG_READ_FAILED', 'Could not read the edited configuration. The edited copy has been retained.', file);
  }
  let edited;
  try { edited = JSON.parse(contents); }
  catch { throw editorError('CONFIG_JSON_INVALID', 'The edited configuration is not valid JSON. The edited copy has been retained.', file); }
  return {config: edited, file, cleanup: () => rm(directory, {recursive: true, force: true})};
}
