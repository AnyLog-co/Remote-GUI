/**
 * Plugin ↔ main app (host) bridge — single file to copy or publish as a package.
 *
 * The host must set this before the remote runs:
 *   globalThis.__ANYLOG_PLUGIN_HOST_CONTEXT__ = { services, utils, components, ... }
 * Paths mirror the host's src layout (e.g. services.api → host folder `services` + file `api`).
 *
 * ---------------------------------------------------------------------------
 * Usage (any module in the plugin — no React required)
 * ---------------------------------------------------------------------------
 *   import host from "host";
 *   host.services.api.sendCommand({ ... });
 *   const DataTable = host.components.DataTable;
 *   host.utils.tableExport.toCsv?.(...);
 *
 * Host functions, components, and "hooks" (if the host exports them as functions)
 * are all reachable the same way — they live on the injected object tree.
 *
 * ---------------------------------------------------------------------------
 * Advanced: resolve by string path
 * ---------------------------------------------------------------------------
 *   import { getFromHost, getHostContext } from "host";
 *   getFromHost("services.api").sendCommand(...);
 *   getHostContext() // full root object
 */

const GLOBAL_KEY = "__ANYLOG_PLUGIN_HOST_CONTEXT__";

/**
 * @returns {Record<string, unknown>} Root object injected by the host.
 */
export function getHostContext() {
  const ctx = globalThis?.[GLOBAL_KEY];
  if (!ctx) {
    throw new Error(
      "[pluginHost] Missing host injection. Open this plugin from the main app (not standalone) so the host can set __ANYLOG_PLUGIN_HOST_CONTEXT__.",
    );
  }
  return ctx;
}

const walk = (obj, keys) =>
  keys.reduce(
    (acc, key) => (acc == null || key === "" ? acc : acc[key]),
    obj,
  );

/**
 * @param {string} dottedPath e.g. "services.api" or "components.DataTable"
 */
function resolveDotted(ctx, dottedPath) {
  const keys = dottedPath.split(".").filter(Boolean);
  return walk(ctx, keys);
}

/**
 * Read one leaf or namespace from the host by path.
 * @param {string} path e.g. "services/api" or "components.security.LoginForm"
 */
export function getFromHost(path) {
  const dotted = String(path).replaceAll("/", ".");
  const value = resolveDotted(getHostContext(), dotted);
  if (value === undefined) {
    throw new Error(`[pluginHost] Nothing registered at "${path}".`);
  }
  return value;
}

/**
 * Objects that support further property access (namespace / nested folders on host).
 * Functions, components, and primitives are returned as-is.
 */
function shouldProxyDeepValue(value) {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const tag = Object.prototype.toString.call(value);
  if (tag === "[object Object]") return true;
  if (tag === "[object Module]") return true;
  return false;
}

/**
 * `host` is a lazy view of `getHostContext()` so you can write host.services.api.sendCommand.
 */
function createHostProxy(segmentPath) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;
        if (prop === "then") return undefined;
        const next = segmentPath ? `${segmentPath}/${prop}` : prop;
        const dotted = next.replaceAll("/", ".");
        const value = resolveDotted(getHostContext(), dotted);

        if (value === undefined) {
          throw new Error(
            `[pluginHost] Nothing registered at "${next.replaceAll("/", ".")}".`,
          );
        }
        if (shouldProxyDeepValue(value)) {
          return createHostProxy(next);
        }
        return value;
      },
    },
  );
}

const host = createHostProxy();
export { host };
export default host;
