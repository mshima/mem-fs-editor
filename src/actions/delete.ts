import path from 'path';
import { globSync } from 'tinyglobby';
import multimatch from 'multimatch';
import normalize from 'normalize-path';

import type { MemFsEditor, MemFsEditorFile } from '../index.js';
import type { Store } from 'mem-fs';
import { isFileStateDeleted, setDeletedFileState } from '../state.js';
import { globify } from '../util.js';

function deleteFile(path: string, store: Store<MemFsEditorFile>) {
  const file = store.get(path);
  setDeletedFileState(file);
  file.contents = null;
  store.add(file);
}

export default function deleteAction(
  this: MemFsEditor,
  paths: string | string[],
  options: { globOptions?: Omit<Parameters<typeof globSync>[0], 'patterns'> } = {},
) {
  if (!Array.isArray(paths)) {
    paths = [paths];
  }

  const onStoreFiles: Set<string> = new Set();
  const notFound: Set<string> = new Set();
  for (const filePath of paths) {
    if (!this.store.existsInMemory(filePath)) {
      notFound.add(filePath);
    } else if (this.store.get(filePath).contents !== null) {
      onStoreFiles.add(filePath);
    } else if (!isFileStateDeleted(this.store.get(filePath))) {
      notFound.add(filePath);
    }
  }

  paths = globify([...notFound]);

  const globOptions = options.globOptions || {};
  const files = globSync(paths, { ...globOptions, absolute: true, onlyFiles: true }).map((p) => path.resolve(p));
  files.forEach((file) => {
    deleteFile(file, this.store);
  });

  this.store.each((file) => {
    if (multimatch([normalize(file.path)], paths).length !== 0) {
      deleteFile(file.path, this.store);
    }
  });

  onStoreFiles.forEach((filePath) => {
    deleteFile(filePath, this.store);
  });
}
