"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { createMediaStore, importFiles, type MediaBlobStore } from "@cutaway/media-engine";
import { useEditorStore } from "@/state/editorStore";

/**
 * Import orchestration for the UI layer.
 *
 * The blob store is created lazily and held in a ref rather than at module
 * scope: `createMediaStore` touches `indexedDB`, which does not exist during
 * server rendering.
 */

export interface ImportError {
  fileName: string;
  message: string;
}

export interface MediaImportApi {
  importFromFiles: (files: FileList | File[]) => Promise<void>;
  isImporting: boolean;
  /** Names of files currently being processed, for progress display. */
  pending: string[];
  errors: ImportError[];
  dismissErrors: () => void;
  store: () => MediaBlobStore;
  /**
   * Removes an asset from the project. Its bytes stay in the store: the edit is
   * undoable, so deleting them here would break undo.
   */
  removeAsset: (assetId: string) => Promise<void>;
}

export function useMediaImport(): MediaImportApi {
  const storeRef = useRef<MediaBlobStore | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [errors, setErrors] = useState<ImportError[]>([]);

  const addMediaAssets = useEditorStore((state) => state.addMediaAssets);
  const upsertMediaAsset = useEditorStore((state) => state.upsertMediaAsset);
  const removeMediaAsset = useEditorStore((state) => state.removeMediaAsset);

  const getStore = useCallback((): MediaBlobStore => {
    storeRef.current ??= createMediaStore();
    return storeRef.current;
  }, []);

  const importFromFiles = useCallback(
    async (input: FileList | File[]) => {
      const files = Array.from(input);
      if (files.length === 0) return;

      setPending((current) => [...current, ...files.map((file) => file.name)]);
      setErrors([]);

      try {
        const result = await importFiles(files, {
          store: getStore(),
          // Thumbnails and waveforms land after the asset is already in the
          // library, so the grid fills in progressively instead of blocking.
          onAssetUpdated: upsertMediaAsset,
        });

        if (result.assets.length > 0) addMediaAssets(result.assets);
        if (result.errors.length > 0) setErrors(result.errors);
      } finally {
        const names = new Set(files.map((file) => file.name));
        setPending((current) => current.filter((name) => !names.has(name)));
      }
    },
    [getStore, addMediaAssets, upsertMediaAsset],
  );

  const removeAsset = useCallback(
    async (assetId: string) => {
      // Bytes are deliberately **not** deleted here. Removing an asset is an
      // undoable document edit (`commit(..., "Remove media")`) and the document
      // is only autosaved 800 ms later, so deleting the blobs now would leave an
      // undo — or a crash inside that window — pointing at media that is gone.
      // The orphaned bytes are handled by a future safe sweep; see
      // docs/DEVELOPMENT.md, "Deferred media cleanup".
      removeMediaAsset(assetId);
    },
    [removeMediaAsset],
  );

  return useMemo(
    () => ({
      importFromFiles,
      isImporting: pending.length > 0,
      pending,
      errors,
      dismissErrors: () => setErrors([]),
      store: getStore,
      removeAsset,
    }),
    [importFromFiles, pending, errors, getStore, removeAsset],
  );
}
