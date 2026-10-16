import path from 'node:path';
import {home, load, configRevision} from './core.mjs';
import {editorState} from './editor-state.mjs';
import {validateConfigInput} from './mcp-config.mjs';

export const MAX_CONFIGURATION_BYTES = 262144;

export function configurationPaths(directory = home) {
  return {path: path.resolve(directory, 'config.json'), draftPath: path.resolve(directory, 'editor-draft.json')};
}

// Read both versions from the same active revision; never save, apply, or discover.
export async function configurationState({read = load, state = editorState, directory = home} = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await state(), activeConfig = await read();
    if (configRevision(activeConfig) === current.activeRevision) {
      return {...configurationPaths(directory), ...current, activeConfig};
    }
  }
  throw Object.assign(new Error('Configuration changed while reading. Refresh and try again.'), {code: 'CONFIG_CONFLICT'});
}

export function validateConfiguration(value) {
  let serialized;
  try { serialized = JSON.stringify(value); }
  catch { throw new Error('Configuration must be valid JSON.'); }
  if (serialized === undefined) throw new Error('Configuration must be valid JSON.');
  if (Buffer.byteLength(serialized, 'utf8') > MAX_CONFIGURATION_BYTES) throw new Error('Configuration exceeds the 256 KiB limit.');
  return {config: validateConfigInput(value)};
}
