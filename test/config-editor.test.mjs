import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {editConfig, MAX_CONFIG_BYTES, parseEditorCommand} from '../lib/config-editor.mjs';

test('editor commands parse quoted paths, arguments and literal shell syntax', () => {
  assert.deepEqual(parseEditorCommand('code --wait --reuse-window'), ['code', '--wait', '--reuse-window']);
  assert.deepEqual(parseEditorCommand('"/Applications/My Editor.app/editor" --wait "two words"'),
    ['/Applications/My Editor.app/editor', '--wait', 'two words']);
  assert.deepEqual(parseEditorCommand("'/tmp/My Editor' --title='Configuration file' ''"),
    ['/tmp/My Editor', '--title=Configuration file', '']);
  assert.deepEqual(parseEditorCommand(String.raw`"C:\Program Files\Editor\editor.exe" --wait "C:\Users\Some User\file.json"`),
    [String.raw`C:\Program Files\Editor\editor.exe`, '--wait', String.raw`C:\Users\Some User\file.json`]);
  assert.deepEqual(parseEditorCommand(String.raw`"\\server\share\Editor.exe" --wait`),
    [String.raw`\\server\share\Editor.exe`, '--wait']);
  assert.deepEqual(parseEditorCommand(String.raw`/tmp/My\ Editor --title "a\"b"`), ['/tmp/My Editor', '--title', 'a"b']);
  assert.deepEqual(parseEditorCommand('editor $(touch nope) ; echo $HOME | cat'),
    ['editor', '$(touch', 'nope)', ';', 'echo', '$HOME', '|', 'cat']);
  for (const command of ['', '  ', '""', '"unfinished', 'a\0b', 'a\nb', 'a\rb']) {
    assert.throws(() => parseEditorCommand(command), {code: 'EDITOR_COMMAND_INVALID'});
  }
});

test('temporary edit uses a private copy and stays recoverable until the caller cleans up', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'bridge-editor-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const original = {routes: [], preferences: {showPromptPreview: false}};
  const expected = {routes: [], preferences: {showPromptPreview: true}};
  const env = {VISUAL: '"/my editor" --wait', EDITOR: 'ignored'};
  const result = await editConfig(original, {tempRoot: root, env, cwd: root, launch: async (command, args, options) => {
    assert.equal(command, '/my editor');
    assert.equal(args[0], '--wait');
    assert.equal(options.shell, false);
    assert.equal(options.stdio, 'inherit');
    assert.equal(options.env, env);
    assert.equal(options.cwd, root);
    assert.deepEqual(JSON.parse(await readFile(args.at(-1), 'utf8')), original);
    if (process.platform !== 'win32') {
      assert.equal((await stat(args.at(-1))).mode & 0o777, 0o600);
      assert.equal((await stat(path.dirname(args.at(-1)))).mode & 0o777, 0o700);
    }
    await writeFile(args.at(-1), JSON.stringify(expected));
    return {code: 0, signal: null};
  }});
  assert.deepEqual(result.config, expected);
  assert.equal(original.preferences.showPromptPreview, false);
  assert.deepEqual(JSON.parse(await readFile(result.file, 'utf8')), expected);
  await result.cleanup();
  await result.cleanup();
  await assert.rejects(stat(result.file), {code: 'ENOENT'});
});

test('editor selection honors explicit override, VISUAL, EDITOR and platform defaults', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'bridge-editor-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  for (const [options, expected] of [
    [{editor: 'custom --wait', env: {VISUAL: 'visual', EDITOR: 'fallback'}}, 'custom'],
    [{env: {VISUAL: 'visual', EDITOR: 'fallback'}}, 'visual'],
    [{env: {VISUAL: ' ', EDITOR: 'fallback'}}, 'fallback'],
    [{env: {}, platform: 'win32'}, 'notepad.exe'],
    [{env: {}, platform: 'linux'}, 'vi'],
  ]) {
    const edited = await editConfig({}, {...options, tempRoot: root, launch: async command => {
      assert.equal(command, expected); return 0;
    }});
    assert.deepEqual(edited.config, {});
    await edited.cleanup();
  }
});

test('invalid JSON, oversized output, failed exit and launch errors retain the edited file without exposing its contents', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'bridge-editor-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const secret = 'private-value-not-for-error-messages';
  for (const [expectedCode, edit] of [
    ['CONFIG_JSON_INVALID', async file => {await writeFile(file, `{${secret}`); return 0;}],
    ['CONFIG_TOO_LARGE', async file => {await writeFile(file, ' '.repeat(MAX_CONFIG_BYTES + 1)); return 0;}],
    ['EDITOR_EXIT_FAILED', async file => {await writeFile(file, secret); return 7;}],
    ['EDITOR_EXIT_FAILED', async () => ({code: null, signal: 'SIGTERM'})],
    ['EDITOR_LAUNCH_FAILED', async () => {throw new Error(secret);}],
  ]) {
    let failure;
    try { await editConfig({secret}, {tempRoot: root, editor: 'test-editor', launch: async (_, args) => edit(args.at(-1))}); }
    catch (error) {failure = error;}
    assert.equal(failure?.code, expectedCode);
    assert.equal(failure.message.includes(secret), false);
    assert.equal(JSON.stringify(failure).includes(secret), false);
    assert.equal(path.basename(failure.recoveryFile), 'config.json');
    assert.equal((await stat(failure.recoveryFile)).isFile(), true);
  }
});

test('a real child editor receives arguments without shell evaluation and UTF-8 BOM is accepted', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'bridge-editor-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const script = path.join(root, 'fake editor.mjs');
  await writeFile(script, "import {writeFile} from 'node:fs/promises'; await writeFile(process.argv.at(-1), '\\uFEFF'+JSON.stringify({argument:process.argv[2]}));");
  const editor = `"${process.execPath}" "${script}" "$(echo not-expanded); $HOME"`;
  const result = await editConfig({}, {tempRoot: root, editor});
  assert.deepEqual(result.config, {argument: '$(echo not-expanded); $HOME'});
  await result.cleanup();
});

test('unserializable or oversized input fails before starting the editor', async () => {
  const circular = {}; circular.self = circular;
  for (const [value, code] of [[undefined, 'CONFIG_SERIALIZE_FAILED'], [circular, 'CONFIG_SERIALIZE_FAILED'],
    [{data: 'x'.repeat(MAX_CONFIG_BYTES)}, 'CONFIG_TOO_LARGE']]) {
    await assert.rejects(editConfig(value, {editor: 'editor', launch: () => assert.fail('must not launch')}), {code});
  }
});
