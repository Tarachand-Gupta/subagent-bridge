import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const bin = path.join(root, 'bin.mjs');
const sandbox = await mkdtemp(path.join(tmpdir(), 'bridge-cli-tests-'));
const emptyPath = path.join(sandbox, 'empty-bin');
await mkdir(emptyPath);
// Never discover the user's harnesses or read/write their actual configuration.
const baseEnv = {
  HOME: sandbox, USERPROFILE: sandbox, PATH: emptyPath, TMPDIR: sandbox,
  TEMP: sandbox, TMP: sandbox, HARNESS_BRIDGE_HOME: path.join(sandbox, 'unused-default'),
  ...(process.env.SystemRoot ? {SystemRoot: process.env.SystemRoot} : {}),
  ...(process.env.WINDIR ? {WINDIR: process.env.WINDIR} : {}),
  ...(process.env.PATHEXT ? {PATHEXT: process.env.PATHEXT} : {}),
};
const makeConfig = task => ({version: 1, routes: [{
  id: 'review', parents: ['pi'], workers: ['opencode'], models: [],
  task, reasoning: '', enabled: false, usage: 'can',
}]});
async function fixture(name) {
  const dir = path.join(sandbox, name);
  await mkdir(dir);
  return {dir, home: path.join(dir, 'shared-home'), file: path.join(dir, 'rules.json')};
}
async function cli(home, args, {json = true} = {}) {
  let output;
  try {
    output = {...await exec(process.execPath, [bin, '--home', home, ...args, ...(json ? ['--json'] : [])], {
      cwd: root, env: baseEnv, timeout: 20000, maxBuffer: 1024 * 1024,
    }), code: 0};
  } catch (error) {
    if (typeof error.code !== 'number') throw error;
    output = {stdout: error.stdout, stderr: error.stderr, code: error.code};
  }
  return {...output, ...(json && output.stdout.trim() ? {data: JSON.parse(output.stdout)} : {})};
}
async function readEditorState(home) {
  const source = `import {editorState} from ${JSON.stringify(pathToFileURL(path.join(root, 'lib/editor-state.mjs')).href)}; console.log(JSON.stringify(await editorState()));`;
  const {stdout} = await exec(process.execPath, ['--input-type=module', '-e', source], {
    cwd: root, env: {...baseEnv, HARNESS_BRIDGE_HOME: home}, timeout: 10000,
  });
  return JSON.parse(stdout);
}
const exists = file => stat(file).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error));

test('CLI help/version and explicit home work without opening the UI or creating configuration', async () => {
  const {home} = await fixture('help');
  const help = await cli(home, ['--help']);
  assert.equal(help.code, 0);
  assert.match(help.data.help, /config import/);
  assert.match(help.data.help, /config apply/);
  const version = await cli(home, ['--version']);
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(version.data.version, pkg.version);
  const paths = await cli(home, ['config', 'path']);
  assert.equal(paths.data.config, path.join(home, 'config.json'));
  assert.equal(paths.data.draft, path.join(home, 'editor-draft.json'));
  const plain = await cli(home, ['config', 'path'], {json: false});
  assert.equal(plain.stdout.trim(), path.join(home, 'config.json'));
  assert.equal(await exists(home), false);
  assert.equal(await exists(baseEnv.HARNESS_BRIDGE_HOME), false);
});

test('raw config export/import shares the desktop draft while leaving active rules unchanged', async () => {
  const {home, file, dir} = await fixture('round-trip');
  const initial = (await cli(home, ['config', 'status'])).data;
  await writeFile(file, JSON.stringify(makeConfig('Research')));
  const imported = await cli(home, ['config', 'import', '--file', file, '--revision', initial.revision]);
  assert.equal(imported.code, 0);
  assert.equal(imported.data.applied, false);
  assert.equal(imported.data.saved, true);
  assert.equal(await exists(path.join(home, 'config.json')), false);
  const desktop = await readEditorState(home);
  assert.equal(desktop.config.routes[0].task, 'Research');
  assert.equal(desktop.revision, imported.data.revision);
  assert.equal(desktop.applied, false);
  const shown = (await cli(home, ['config', 'show'])).data;
  assert.equal(shown.routes[0].task, 'Research');
  assert.equal(shown.config, undefined, 'show is raw JSON, not the read envelope');
  assert.deepEqual((await cli(home, ['config', 'show', '--active'])).data.routes, []);
  assert.deepEqual((await cli(home, ['config', 'read'])).data.config.routes, []);
  const status = (await cli(home, ['config', 'status'])).data;
  assert.equal(status.pendingDraft, true);
  assert.notEqual(status.revision, status.activeRevision);
  const before = await readFile(path.join(home, 'editor-draft.json'), 'utf8');
  const preview = (await cli(home, ['config', 'preview'])).data;
  assert.equal(preview.saved, false);
  assert.equal(preview.changes[0].kind, 'added');
  assert.match(preview.instructions[0], /Research/);
  assert.equal((await cli(home, ['config', 'validate'])).data.scope, 'structure');
  assert.equal(await readFile(path.join(home, 'editor-draft.json'), 'utf8'), before);
  const exported = path.join(dir, 'exported.json');
  assert.equal((await cli(home, ['config', 'show', '--output', exported])).code, 0);
  assert.deepEqual(JSON.parse(await readFile(exported, 'utf8')), shown);
  const refused = await cli(home, ['config', 'show', '--active', '--output', exported]);
  assert.equal(refused.code, 1);
  assert.equal(refused.data.error.code, 'EEXIST');
  assert.deepEqual(JSON.parse(await readFile(exported, 'utf8')), shown);
});

test('stale revisions and typo options cannot silently overwrite an existing draft', async () => {
  const {home, file} = await fixture('conflicts');
  const original = (await cli(home, ['config', 'status'])).data;
  await writeFile(file, JSON.stringify(makeConfig('First')));
  assert.equal((await cli(home, ['config', 'import', '--file', file])).code, 0);
  const saved = await readFile(path.join(home, 'editor-draft.json'), 'utf8');
  await writeFile(file, JSON.stringify(makeConfig('Second')));
  for (const args of [
    ['config', 'import', '--file', file, '--revision', original.revision],
    ['config', 'apply', '--revision', original.revision],
  ]) {
    const result = await cli(home, args);
    assert.equal(result.code, 1);
    assert.equal(result.data.error.code, 'CONFIG_CONFLICT');
  }
  for (const args of [
    ['config', 'import', '--file', file, '--aply'],
    ['config', 'import', '--file', file, 'unexpected'],
    ['config', 'apply', '--file', file],
    ['config', 'import', '--file', file, '--file', file],
    ['config', 'import', '--file'],
    ['config', 'aply'],
  ]) assert.equal((await cli(home, args)).code, 1, args.join(' '));
  assert.equal(await readFile(path.join(home, 'editor-draft.json'), 'utf8'), saved);
  assert.equal(await exists(path.join(home, 'config.json')), false);
});

test('invalid versions, fields, JSON, and oversized imports never change configuration', async () => {
  const {home, file} = await fixture('invalid');
  await writeFile(file, JSON.stringify(makeConfig('Keep this')));
  assert.equal((await cli(home, ['config', 'import', '--file', file])).code, 0);
  const saved = await readFile(path.join(home, 'editor-draft.json'), 'utf8');
  const cases = [
    JSON.stringify({...makeConfig('Bad version'), version: 2}),
    JSON.stringify({...makeConfig('Unknown field'), typo: true}),
    JSON.stringify({routes: [{...makeConfig('Unknown route field').routes[0], typo: true}]}),
    '{not JSON',
    ' '.repeat(262145),
  ];
  for (const contents of cases) {
    await writeFile(file, contents);
    const imported = await cli(home, ['config', 'import', '--file', file]);
    assert.equal(imported.code, 1);
    assert.equal(imported.data.ok, false);
    assert.equal(await readFile(path.join(home, 'editor-draft.json'), 'utf8'), saved);
    assert.equal(await exists(path.join(home, 'config.json')), false);
  }
});

test('editor changes save a shared draft and a simultaneous external apply preserves recovery', async () => {
  const {home, dir} = await fixture('editor');
  const editor = path.join(dir, 'fake editor.mjs');
  const command = [process.execPath, editor].map(value => '"' + value.replaceAll('"', '\\"') + '"').join(' ');
  await writeFile(editor, `import {readFile,writeFile} from 'node:fs/promises';
const file=process.argv.at(-1); const config=JSON.parse(await readFile(file,'utf8'));
config.routes=${JSON.stringify(makeConfig('From the editor').routes)};
await writeFile(file,JSON.stringify(config));`);
  const edited = await cli(home, ['config', 'edit', '--editor', command]);
  assert.equal(edited.code, 0);
  assert.equal((await readEditorState(home)).config.routes[0].task, 'From the editor');
  assert.equal(await exists(path.join(home, 'config.json')), false);
  await writeFile(editor, `import {readFile,writeFile} from 'node:fs/promises';
import {save} from ${JSON.stringify(pathToFileURL(path.join(root, 'lib/core.mjs')).href)};
const file=process.argv.at(-1); const config=JSON.parse(await readFile(file,'utf8'));
config.routes[0].task='Unsaved editor work'; await writeFile(file,JSON.stringify(config));
await save(${JSON.stringify(makeConfig('External apply'))});`);
  const conflicted = await cli(home, ['config', 'edit', '--editor', command]);
  assert.equal(conflicted.code, 1);
  assert.equal(conflicted.data.error.code, 'CONFIG_CONFLICT');
  const recovery = conflicted.data.error.recoveryFile;
  assert.ok(recovery);
  assert.equal(JSON.parse(await readFile(recovery, 'utf8')).routes[0].task, 'Unsaved editor work');
  assert.equal((await readEditorState(home)).config.routes[0].task, 'External apply');
  assert.equal((await readEditorState(home)).preservedDraft.routes[0].task, 'From the editor');
  const preserved = (await cli(home, ['config', 'show', '--preserved'])).data;
  assert.equal(preserved.routes[0].task, 'From the editor');
  assert.equal((await cli(home, ['config', 'show', '--active', '--preserved'])).code, 1);
  const draftFile = path.join(home, 'editor-draft.json');
  const preservedBytes = await readFile(draftFile, 'utf8');
  const refusedApply = await cli(home, ['config', 'apply']);
  assert.equal(refusedApply.code, 1);
  assert.equal(refusedApply.data.error.code, 'CONFIG_CONFLICT');
  assert.equal(await readFile(draftFile, 'utf8'), preservedBytes);
  assert.equal((await readEditorState(home)).config.routes[0].task, 'External apply');
  const reconciled = path.join(dir, 'reconciled.json');
  await writeFile(reconciled, JSON.stringify(makeConfig('Reconciled draft')));
  const current = await readEditorState(home);
  const imported = await cli(home, ['config', 'import', '--file', reconciled, '--revision', current.revision]);
  assert.equal(imported.code, 0);
  const reconciledState = await readEditorState(home);
  assert.equal(reconciledState.config.routes[0].task, 'Reconciled draft');
  assert.equal(reconciledState.preservedDraft, undefined);
  assert.equal(reconciledState.applied, false);
  assert.equal((await cli(home, ['config', 'show', '--active'])).data.routes[0].task, 'External apply');
});

test('CLI apply reuses the desktop apply transaction and distinguishes draft from immediate import', async () => {
  const {home, file} = await fixture('shared-apply');
  // Run the injectable command in a child to give module-level home an isolated lifetime.
  const source = `
import assert from 'node:assert/strict';
import {configCommand} from ${JSON.stringify(pathToFileURL(path.join(root, 'lib/cli.mjs')).href)};
import {load,save,configRevision} from ${JSON.stringify(pathToFileURL(path.join(root, 'lib/core.mjs')).href)};
import {editorState,applyEditorRules} from ${JSON.stringify(pathToFileURL(path.join(root, 'lib/editor-state.mjs')).href)};
const calls=[];
const commit=async(config,options)=>{calls.push(options);const saved=await save(config,options);return {config:saved,revision:configRevision(saved),saved:true,warnings:['Fixture connection needs attention']};};
const applyRules=input=>applyEditorRules(input,{commit});
await save(${JSON.stringify(makeConfig('Active'))});
await configCommand(['import','--file',${JSON.stringify(file)}],{applyRules});
assert.equal((await load()).routes[0].task,'Active'); assert.equal(calls.length,0);
const before=await editorState();
await assert.rejects(configCommand(['apply'],{applyRules:input=>applyEditorRules(input,{commit:async()=>{throw new Error('Fixture discovery unavailable');}})}),/Fixture discovery unavailable/);
assert.equal((await load()).routes[0].task,'Active'); assert.equal((await editorState()).config.routes[0].task,'Imported');
const applied=await configCommand(['apply','--revision',before.revision],{applyRules});
assert.equal(applied.applied,true); assert.equal((await load()).routes[0].task,'Imported');
assert.equal(calls[0].expectedRevision,before.activeRevision);
assert.deepEqual(applied.warnings,['Fixture connection needs attention']);
assert.equal((await editorState()).applied,true);
await configCommand(['import','--file',${JSON.stringify(file)},'--apply'],{applyRules});
assert.equal(calls.length,2);
console.log(JSON.stringify({ok:true}));`;
  await writeFile(file, JSON.stringify(makeConfig('Imported')));
  const {stdout} = await exec(process.execPath, ['--input-type=module', '-e', source], {
    cwd: root, env: {...baseEnv, HARNESS_BRIDGE_HOME: home}, timeout: 20000,
  });
  assert.equal(JSON.parse(stdout).ok, true);
});

test.after(() => rm(sandbox, {recursive: true, force: true}));
