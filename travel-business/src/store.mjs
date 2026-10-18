import { VisitorStore } from './VisitorStore.mjs';
import { SandboxConfig } from './dto/SandboxConfig.mjs';
import { Catalog } from './dto/Catalog.mjs';

export { InputError } from './InputError.mjs';

/** @param {string} path @param {SandboxConfig} config @param {Catalog} catalog @param {()=>number} now @param {boolean} create @returns {VisitorStore} */
export function createStore(path, config, catalog, now, create) {
  if (arguments.length !== 5 || !(config instanceof SandboxConfig) || !(catalog instanceof Catalog) || typeof now !== 'function' || typeof create !== 'boolean') { throw new TypeError('Explicit store arguments are required.'); }
  return new VisitorStore(path, config, catalog, now, create);
}
