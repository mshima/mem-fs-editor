'use strict';

const filesystem = require('fs');
const os = require('os');
const path = require('path');
const memFs = require('mem-fs');
const sinon = require('sinon');
const editor = require('..');
const { STATE, STATE_MODIFIED, STATE_DELETED } = require('../lib/state');

const rmSync = filesystem.rmSync || filesystem.rmdirSync;

// Permission mode are handled differently by windows.
// chmod is particularly useful for executable bit at posix platforms but is not useful at windows platform.
// More information can be found at Node source https://github.com/nodejs/node/blob/8cf33850bea691d8c53b2d4175c959c8549aa76c/deps/uv/src/win/fs.c#L1743-L1761
const posixIt = process.platform === 'win32' ? it.skip : it;

describe('#commitFileAsync()', () => {
  const outputRoot = path.join(os.tmpdir(), 'mem-fs-editor-test' + Math.random());
  const outputDir = path.join(outputRoot, 'output');
  const filename = path.join(outputDir, 'file.txt');
  const filenameNew = path.join(outputDir, 'file-new.txt');
  let newFile;

  let store;
  let fs;

  beforeEach(() => {
    store = memFs.create();
    sinon.spy(store, 'add');

    fs = editor.create(store);
    fs.write(filename, 'foo');

    newFile = {
      path: filenameNew,
      contents: Buffer.from('bar'),
      [STATE]: STATE_MODIFIED,
    };

    expect(store.add.callCount).toEqual(1);
  });

  afterEach(() => {
    if (filesystem.existsSync(outputRoot)) {
      rmSync(outputRoot, { recursive: true });
    }
  });

  it('writes a modified file to disk', async () => {
    await fs.commitFileAsync(store.get(filename));
    expect(filesystem.readFileSync(filename).toString()).toEqual('foo');
  });

  it('adds non existing file to store', async () => {
    await fs.commitFileAsync(newFile);
    expect(store.add.callCount).toEqual(2);
  });

  it('writes non existing file to disk', async () => {
    await fs.commitFileAsync(newFile);
    expect(filesystem.existsSync(filenameNew)).toBe(true);
  });

  it("doesn't commit an unmodified file", async () => {
    await fs.commitFileAsync({
      ...newFile,
      [STATE]: undefined,
    });
    expect(filesystem.existsSync(filenameNew)).toBe(false);
  });

  it('throws if the file is a directory', async () => {
    filesystem.mkdirSync(filenameNew, { recursive: true });
    await expect(fs.commitFileAsync(newFile)).rejects.toThrow();
  });

  it('throws if the directory is a file', async () => {
    filesystem.mkdirSync(outputRoot, { recursive: true });
    filesystem.writeFileSync(path.dirname(filenameNew), 'foo');
    await expect(fs.commitFileAsync(newFile)).rejects.toThrow();
  });

  it('deletes a file', async () => {
    filesystem.mkdirSync(path.dirname(filenameNew), { recursive: true });
    filesystem.writeFileSync(filenameNew, 'foo');
    await fs.commitFileAsync({
      ...newFile,
      [STATE]: STATE_DELETED,
    });
    expect(filesystem.existsSync(filenameNew)).toBe(false);
  });

  posixIt('set file permission', async () => {
    await fs.commitFileAsync({
      ...newFile,
      stat: { mode: 0o600 },
    });
    // eslint-disable-next-line no-bitwise
    expect(filesystem.statSync(filenameNew).mode & 0o777).toEqual(0o600);
  });

  posixIt("doesn't change unmodified file permission", async () => {
    await fs.commitFileAsync({
      ...newFile,
      stat: { mode: 0o600 },
    });

    await fs.commitFileAsync({
      ...newFile,
      stat: { mode: 0o600 },
    });

    // eslint-disable-next-line no-bitwise
    expect(filesystem.statSync(filenameNew).mode & 0o777).toEqual(0o600);
  });

  posixIt('update file permission', async () => {
    await fs.commitFileAsync({
      ...newFile,
      stat: { mode: 0o600 },
    });

    await fs.commitFileAsync({
      ...newFile,
      stat: { mode: 0o660 },
    });

    // eslint-disable-next-line no-bitwise
    expect(filesystem.statSync(filenameNew).mode & 0o777).toEqual(0o660);
  });

  it("doesn't readd same file to store", async () => {
    await fs.commitFileAsync(store.get(filename));
    expect(store.add.callCount).toEqual(1);
  });
});
