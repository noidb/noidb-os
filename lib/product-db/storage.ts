/**
 * Product DB storage adapters.
 * Local File System Access API now; Google Drive can plug in later.
 */

import type { ProductDbFile } from "./files";

export type StorageBackend = "local" | "drive";

export type StorageSaveResult = {
  backend: StorageBackend;
  saved: string[];
};

export interface ProductDbStorage {
  readonly backend: StorageBackend;
  saveFlat(files: ProductDbFile[]): Promise<StorageSaveResult>;
}

/** Writes every file directly under the chosen root folder (no subfolders). */
export class LocalFlatStorage implements ProductDbStorage {
  readonly backend = "local" as const;

  constructor(private root: FileSystemDirectoryHandle) {}

  async saveFlat(files: ProductDbFile[]): Promise<StorageSaveResult> {
    const saved: string[] = [];
    for (const file of files) {
      const handle = await this.root.getFileHandle(file.filename, { create: true });
      const writable = await handle.createWritable();
      await writable.write(file.blob);
      await writable.close();
      saved.push(file.filename);
    }
    return { backend: this.backend, saved };
  }
}

/** Placeholder for future Google Drive API integration. */
export class DriveStorageStub implements ProductDbStorage {
  readonly backend = "drive" as const;

  async saveFlat(_files: ProductDbFile[]): Promise<StorageSaveResult> {
    throw new Error("Google Drive 저장은 아직 준비 중입니다. 로컬 폴더를 사용해주세요.");
  }
}

export function createLocalStorage(root: FileSystemDirectoryHandle): ProductDbStorage {
  return new LocalFlatStorage(root);
}
