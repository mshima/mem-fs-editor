import { describe, beforeEach, it, expect, vi } from 'vitest';
import { type MemFsEditor, MemFsEditorFile, create } from '../src/index.js';
import { create as createMemFs } from 'mem-fs';
import { getFixture } from './fixtures.js';

describe('#write()', () => {
  let memFs: MemFsEditor;

  beforeEach(() => {
    const store = createMemFs<MemFsEditorFile>();
    vi.spyOn(store, 'add');

    memFs = create(store);
  });

  it('write string to a new file', () => {
    const filepath = getFixture('does-not-exist.txt');
    const contents = 'some text';
    memFs.write(filepath, contents);
    expect(memFs.read(filepath)).toBe(contents);
    expect(memFs.store.get(filepath).state).toBe('modified');
  });

  it('write buffer to a new file', () => {
    const filepath = getFixture('does-not-exist.txt');
    const contents = Buffer.from('omg!', 'base64');
    memFs.write(filepath, contents);
    expect(memFs.read(filepath)).toBe(contents.toString());
    expect(memFs.store.get(filepath).state).toBe('modified');
  });

  it('write an existing file', () => {
    const filepath = getFixture('file-a.txt');
    const contents = 'some text';
    memFs.write(filepath, contents);
    expect(memFs.read(filepath)).toBe(contents);
    expect(memFs.store.get(filepath).state).toBe('modified');
  });

  it("doesn't re-add an identical file that already exist in memory", () => {
    const filepath = getFixture('file-a.txt');
    const contents = 'some text';
    memFs.write(filepath, contents);
    expect(memFs.store.add).toHaveBeenCalledTimes(1);
    expect(memFs.read(filepath)).toBe(contents);
    expect(memFs.store.get(filepath).state).toBe('modified');

    memFs.write(filepath, contents);
    expect(memFs.store.add).toHaveBeenCalledTimes(1);
  });
});
