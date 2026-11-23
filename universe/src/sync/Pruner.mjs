import { SyncSettings } from './SyncSettings.mjs';

const manifestsPrefix = '_universe/v2/manifests/';
const blobsPrefix = '_universe/v2/blobs/';
const manifestKey = /^_universe\/v2\/manifests\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.json$/;
const blobKey = /^_universe\/v2\/blobs\/([0-9a-f]{64})$/;

export const Pruner = Object.freeze({
  /**
   * @param {import('./CloudStore.mjs').CloudStore} cloud
   * @param {?string} head
   * @param {number} now
   * @param {{signal?: AbortSignal}} options
   * @returns {Promise<{manifests: number, blobs: number}>}
   * @throws {Error}
   */
  async prune(cloud, head, now, { signal } = {}) {
    if (head === null) {
      throw new Error('The cloud holds no current save.');
    }
    const keptIds = new Set();
    const keptHashes = new Set();
    let id = head;
    while (id !== null && !keptIds.has(id) && keptIds.size < SyncSettings.KeepSaves) {
      const manifest = await cloud.manifestHashes(id, { signal });
      keptIds.add(id);
      for (const hash of manifest.hashes) {
        keptHashes.add(hash);
      }
      id = manifest.parent;
    }
    const manifests = await cloud.listObjects(manifestsPrefix, { signal });
    const blobs = await cloud.listObjects(blobsPrefix, { signal });
    const doomedManifests = manifests.filter(({ key, lastModified }) => {
      const name = manifestKey.exec(key);
      return name !== null && !keptIds.has(name[1]) && now - lastModified >= SyncSettings.BlobMinAgeMs;
    }).map(({ key }) => key);
    const doomedBlobs = blobs.filter(({ key, lastModified }) => {
      const name = blobKey.exec(key);
      return name !== null && !keptHashes.has(name[1]) && now - lastModified >= SyncSettings.BlobMinAgeMs;
    }).map(({ key }) => key);
    const doomed = [...doomedManifests, ...doomedBlobs];
    let next = 0;
    let failure = null;
    /**
     * @returns {Promise<void>}
     */
    const worker = async () => {
      while (next < doomed.length && failure === null && !signal?.aborted) {
        const key = doomed[next];
        next += 1;
        try {
          await cloud.deleteObject(key, { signal });
        } catch (error) {
          failure ??= error;
        }
      }
    };
    await Promise.all(Array.from({ length: SyncSettings.Concurrency }, worker));
    signal?.throwIfAborted();
    if (failure !== null) {
      throw failure;
    }
    return { manifests: doomedManifests.length, blobs: doomedBlobs.length };
  },
});
