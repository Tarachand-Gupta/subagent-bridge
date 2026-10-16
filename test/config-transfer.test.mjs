import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {tmpdir} from 'node:os';

const directory = await mkdtemp(path.join(tmpdir(), 'bridge-transfer-test-'));
process.env.HARNESS_BRIDGE_HOME = directory;
const {configurationPaths, configurationState, validateConfiguration, MAX_CONFIGURATION_BYTES} = await import('../lib/config-transfer.mjs');
const {configRevision, validate} = await import('../lib/core.mjs');
const route = {id: 'example', parents: ['pi'], workers: ['opencode'], models: [{worker: 'opencode', id: 'provider/example', reasoning: 'high'}], reasoning: '', task: 'Research', enabled: true, usage: 'should'};
const input = {version: 1, routes: [route]};
const active = validate(input), draft = validate({...input, routes: [{...route, task: 'Review'}]});

test('transfer validation preserves policy and model thinking without needing installed harnesses', () => {
  const result = validateConfiguration(input);
  assert.deepEqual(result.config, active);
  assert.equal(result.config.routes[0].models[0].reasoning, 'high');
  assert.equal(result.config.routes[0].usage, 'should');
  assert.deepEqual(validateConfiguration(JSON.parse(JSON.stringify(result.config))).config, active);
  assert.deepEqual(input.routes[0], route);
});

test('transfer validation rejects unsupported schema and enforces a byte limit', () => {
  for (const value of [null, [], {}, {routes: [], version: 99}, {routes: [], secret: 'unknown'},
    {routes: [{...route, extra: true}]}, {routes: [{...route, models: [{worker: 'opencode', id: 'model', extra: 'unsupported'}]}]},
    {routes: [{...route, workers: ['not-a-harness']}]}, {routes: [{...route, enabled: 'yes'}]}]) {
    assert.throws(() => validateConfiguration(value));
  }
  const unicode = {routes: [], workspace: '文'.repeat(Math.ceil(MAX_CONFIGURATION_BYTES / 3))};
  assert.ok(JSON.stringify(unicode).length < MAX_CONFIGURATION_BYTES);
  assert.throws(() => validateConfiguration(unicode), /256 KiB/);
  const circular = {}; circular.self = circular;
  assert.throws(() => validateConfiguration(circular), /valid JSON/);
});

test('configuration state exposes the same live paths and separates saved draft from applied rules', async () => {
  await writeFile(path.join(directory, 'config.json'), JSON.stringify(active));
  await writeFile(path.join(directory, 'editor-draft.json'), JSON.stringify({config: draft, baseRevision: configRevision(active)}));
  const before = await Promise.all(['config.json', 'editor-draft.json'].map(file => readFile(path.join(directory, file), 'utf8')));
  const current = await configurationState();
  assert.deepEqual(configurationPaths(), {path: path.join(directory, 'config.json'), draftPath: path.join(directory, 'editor-draft.json')});
  assert.deepEqual(current.config, draft);
  assert.deepEqual(current.activeConfig, active);
  assert.equal(current.applied, false);
  assert.equal(current.activeRevision, configRevision(active));
  assert.equal(current.revision, configRevision(draft));
  assert.deepEqual(await Promise.all(['config.json', 'editor-draft.json'].map(file => readFile(path.join(directory, file), 'utf8'))), before);
  assert.deepEqual((await readdir(directory)).sort(), ['config.json', 'editor-draft.json']);
});

test('configuration state preserves a superseded draft and refuses inconsistent snapshots', async () => {
  const newer = validate({...input, routes: [{...route, task: 'New externally saved rule'}]});
  await writeFile(path.join(directory, 'config.json'), JSON.stringify(newer));
  const current = await configurationState();
  assert.deepEqual(current.preservedDraft, draft);
  assert.deepEqual(current.config, newer);
  assert.deepEqual(current.activeConfig, newer);
  assert.equal(current.applied, true);
  await assert.rejects(configurationState({state: async () => ({activeRevision: configRevision(active)}), read: async () => newer}), {code: 'CONFIG_CONFLICT'});
});

test('HTTP transfer endpoints validate read-only and retain same-origin write protection', async t => {
  const {serve} = await import('../lib/server.mjs');
  const server = await serve(0);
  t.after(() => new Promise(resolve => {server.close(resolve); server.closeAllConnections();}));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const html = await (await fetch(origin)).text();
  const token = html.match(/name="bridge-token" content="([a-f0-9]+)"/)[1];
  const headers = {'Content-Type': 'application/json', 'x-bridge-token': token};
  const before = await readFile(path.join(directory, 'config.json'), 'utf8');
  const state = await (await fetch(origin + '/api/configuration')).json();
  assert.equal(state.path, configurationPaths().path);
  const ui = await fetch(origin + '/configuration-ui.mjs');
  assert.equal(ui.status, 200); await ui.text();
  const accepted = await fetch(origin + '/api/configuration/validate', {method: 'POST', headers, body: JSON.stringify({config: input})});
  assert.equal(accepted.status, 200);
  assert.deepEqual((await accepted.json()).config, active);
  const denied = await fetch(origin + '/api/configuration/validate', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({config: input})});
  assert.equal(denied.status, 403);
  await denied.text();
  const invalid = await fetch(origin + '/api/configuration/validate', {method: 'POST', headers, body: JSON.stringify({config: {routes: [], credentials: 'do-not-echo'}})});
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.text()).includes('do-not-echo'), false);
  const oversized = await fetch(origin + '/api/configuration/validate', {method: 'POST', headers, body: JSON.stringify({config: {routes: [], workspace: '文'.repeat(MAX_CONFIGURATION_BYTES / 2)}})});
  assert.equal(oversized.status, 413);
  await oversized.text();
  assert.equal(await readFile(path.join(directory, 'config.json'), 'utf8'), before);
  assert.deepEqual((await readdir(directory)).sort(), ['config.json', 'editor-draft.json']);
});

function desktop(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [new URL('../desktop-bridge.mjs', import.meta.url).pathname], {env: {...process.env, HARNESS_BRIDGE_HOME: directory}, stdio: ['pipe', 'pipe', 'pipe']});
    let output = '', stderr = '';
    child.stdout.on('data', data => {output += data;});
    child.stderr.on('data', data => {stderr += data;});
    child.once('error', reject);
    child.once('close', code => {try {resolve({code, ...JSON.parse(output), stderr});} catch {reject(new Error('Invalid desktop response'));}});
    child.stdin.end(JSON.stringify(request));
  });
}

test('native backend uses the same schema and resolves its path even if live JSON needs repair', async () => {
  const accepted = await desktop({method: 'POST', path: '/api/configuration/validate', body: {config: input}});
  assert.equal(accepted.code, 0);
  assert.deepEqual(accepted.result.config, active);
  const state = await desktop({method: 'GET', path: '/api/configuration'});
  assert.equal(state.result.path, configurationPaths().path);
  const invalid = await desktop({method: 'POST', path: '/api/configuration/validate', body: {config: {version: 2, routes: []}}});
  assert.equal(invalid.code, 1);
  assert.match(invalid.error, /version/);
  await writeFile(path.join(directory, 'config.json'), '{broken');
  const known = await desktop({method: 'GET', path: '/api/configuration-path'});
  assert.equal(known.code, 0);
  assert.deepEqual(known.result, configurationPaths());
  assert.equal(await readFile(path.join(directory, 'config.json'), 'utf8'), '{broken');
});

test.after(() => rm(directory, {recursive: true, force: true}));
