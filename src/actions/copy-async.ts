import assert from 'assert';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import createDebug from 'debug';
import type { Data, Options } from 'ejs';
import { globby, isDynamicPattern, type Options as GlobbyOptions } from 'globby';
import multimatch from 'multimatch';
import normalize from 'normalize-path';
import File from 'vinyl';

import type { MemFsEditor } from '../index.js';
import { AppendOptions } from './append.js';
import { CopySingleOptions } from './copy.js';
import { resolveFromPaths, render, getCommonPath, ResolvedFrom, globify, resolveGlobOptions } from '../util.js';

const debug = createDebug('mem-fs-editor:copy-async');

async function applyProcessingFileFunc(
  this: MemFsEditor,
  processFile: CopySingleAsyncOptions['processFile'],
  filename: string,
) {
  const output = await Promise.resolve(processFile!.call(this, filename));
  return Buffer.isBuffer(output) ? output : Buffer.from(output);
}

function renderFilepath(filepath, context, tplSettings) {
  if (!context) {
    return filepath;
  }

  return render(filepath, context, tplSettings);
}

async function getOneFile(filepath: string) {
  const resolved = path.resolve(filepath);
  try {
    if ((await fsPromises.stat(resolved)).isFile()) {
      return resolved;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {}

  return undefined;
}

export type CopyAsyncOptions = CopySingleAsyncOptions & {
  globOptions?: GlobbyOptions;
  processDestinationPath?: (string) => string;
  ignoreNoMatch?: boolean;
};

export async function copyAsync(
  this: MemFsEditor,
  from: string | string[],
  to: string,
  options: CopyAsyncOptions = {},
  context?: Data,
  tplSettings?: Options,
) {
  to = path.resolve(to);
  if (typeof from === 'string') {
    // If `from` is a string and an existing file just go ahead and copy it.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this.store.existsInMemory?.(from) && this.exists(from)) {
      this._copySingle(from, renderFilepath(to, context, tplSettings), options);
      return;
    }

    const oneFile = await getOneFile(from);
    if (oneFile) {
      return this._copySingleAsync(oneFile, renderFilepath(to, context, tplSettings), options);
    }
  }

  const fromBasePath = getCommonPath(from);
  const resolvedFromPaths = resolveFromPaths({ from, fromBasePath });
  const hasDynamicPattern = resolvedFromPaths.some((f) => isDynamicPattern(normalize(f.from)));
  const { preferFiles } = resolveGlobOptions({
    noGlob: false,
    hasDynamicPattern,
    hasGlobOptions: Boolean(options.globOptions),
  });

  const storeFiles: string[] = [];
  const globResolved: ResolvedFrom[] = [];

  for (const resolvedFromPath of resolvedFromPaths) {
    const { resolvedFrom } = resolvedFromPath;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this.store.existsInMemory?.(resolvedFrom)) {
      storeFiles.push(resolvedFrom);
    } else {
      globResolved.push(resolvedFromPath);
    }
  }

  let diskFiles: string[] = [];
  if (globResolved.length > 0) {
    const patterns = globResolved.map((file) => globify(file.from)).flat();
    diskFiles = await globby(patterns, { ...options.globOptions, absolute: true, onlyFiles: true });
    this.store.each((file) => {
      const normalizedFilepath = normalize(file.path);
      // The store may have a glob path and when we try to copy it will fail because not real file
      if (
        !diskFiles.includes(normalizedFilepath) &&
        !isDynamicPattern(normalizedFilepath) &&
        multimatch([normalizedFilepath], patterns).length !== 0
      ) {
        storeFiles.push(file.path);
      }
    });
  }

  // Sanity checks: Makes sure we copy at least one file.
  assert(
    options.ignoreNoMatch || diskFiles.length > 0 || storeFiles.length > 0,
    'Trying to copy from a source that does not exist: ' + String(from),
  );

  // If `from` is an array, or if it contains any dynamic patterns, or if it doesn't exist, `to` must be a directory.
  const treatToAsDir = Array.isArray(from) || !preferFiles || globResolved.length > 0;
  let generateDestination: (string) => string = () => to;
  if (treatToAsDir) {
    assert(
      !this.exists(to) || fs.statSync(to).isDirectory(),
      'When copying multiple files, provide a directory as destination',
    );

    const processDestinationPath = options.processDestinationPath || ((path) => path);
    generateDestination = (filepath) => {
      const toFile = path.relative(fromBasePath, filepath);
      return processDestinationPath(path.join(to, toFile));
    };
  }

  await Promise.all([
    ...diskFiles.map((file) =>
      this._copySingleAsync(file, renderFilepath(generateDestination(file), context, tplSettings), options),
    ),
    ...storeFiles.map((file) => {
      this._copySingle(file, renderFilepath(generateDestination(file), context, tplSettings), options);
      return Promise.resolve();
    }),
  ]);
}

export type CopySingleAsyncOptions = AppendOptions &
  CopySingleOptions & {
    append?: boolean;
    processFile?: (this: MemFsEditor, filepath: string) => string | Promise<string | Buffer>;
  };

export async function _copySingleAsync(
  this: MemFsEditor,
  from: string,
  to: string,
  options: CopySingleAsyncOptions = {},
) {
  if (!options.processFile) {
    this._copySingle(from, to, options);
    return;
  }

  from = path.resolve(from);

  debug('Copying %s to %s with %o', from, to, options);

  const contents = await applyProcessingFileFunc.call(this, options.processFile, from);

  if (options.append) {
    // Safety check against legacy API
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!this.store.existsInMemory) {
      throw new Error('Current mem-fs is not compatible with append');
    }

    if (this.store.existsInMemory(to)) {
      this.append(to, contents, { create: true, ...options });
      return;
    }
  }

  this._write(
    new File({
      contents,
      stat: await fsPromises.stat(from),
      path: to,
      history: [from],
    }),
  );
}
