import { cliState } from "../state/state";
import { Vault } from "./vault";

const CREDENTIAL_TYPES = {
  PASSWORD: "password",
  KEYFILE: "keyfile",
};

const isValidType = (type) => Object.values(CREDENTIAL_TYPES).includes(type);

/**
 * Retrieves credential for hostname from Zustand secrets cache.
 * Returns null if hostname or type is not found.
 * Not LIVE Vault, for LIVE Vault, loadSecretsFromVault().
 *
 * @param {string} hostname - Target host (e.g., "192.168.1.10").
 * @param {'password'|'keyfile'} type - Credential type to retrieve.
 * @returns {string|Object|null} Stored credential (null if absent)
 * @throws {Error} If `type` is invalid
 */
export const retrieveStoredCredential = (hostname, type) => {
  if (!isValidType(type)) {
    throw new Error(`Invalid credential type: ${type}`);
  }

  const secretsCache = cliState.getState().secretsCache || {};
  const hostCreds = secretsCache[hostname];

  if (!hostCreds) return null;

  if (type === CREDENTIAL_TYPES.PASSWORD) {
    return hostCreds.password || null;
  } else if (type === CREDENTIAL_TYPES.KEYFILE) {
    console.log("Providing keyfile from cache");
    return hostCreds.keyfile || null;
  }

  return null;
};

/**
 * Stores a credential for hostname in Zustand secrets.
 * Session-only storage (lost on page reload)
 * Persisted to vault (saveCredentialToVault)
 * Merges into existing store rather than replacing it
 * one credential type does not evict the other.
 *
 * @param {string} hostname          - Target host.
 * @param {'password'|'keyfile'} type - Credential type to store.
 * @param {string|Object} value      - Credential value to cache.
 * @throws {Error} If `type` is invalid
 */
export const storeCredentialInSession = (hostname, type, value) => {
  if (!isValidType(type)) {
    throw new Error(`Invalid credential type: ${type}`);
  }

  const currentCache = cliState.getState().secretsCache || {};
  const hostData = currentCache[hostname] || {};

  // Spread existing host data so target type is overwritten.
  const updatedHostData = {
    ...hostData,
    [type]: value,
  };

  cliState.getState().cacheSecrets({
    ...currentCache,
    [hostname]: updatedHostData,
  });
};

/**
 * Persists a credential to the encrypted Dexie vault (IndexedDB).
 * If record for hostname + type exists, updated in place;
 * Default: new record is inserted.
 *
 * After writing, reloads the full vault into the Zustand cache so the
 * in-memory state reflects the latest persisted data.
 *
 * Guards:
 *   - Throws if vault database is null (vault is locked) or credLocked is true and db is non-null (state mismatch)
 *
 * @param {string} hostname          - Target host.
 * @param {'password'|'keyfile'} type - Credential type.
 * @param {string|{name: string, contents: string}} value - Credential value.
 *   For 'keyfile', expects object with `name` and `contents` fields.
 * @param {string} [ref=''] - Optional reference label (e.g., key filename).
 * @throws {Error} Vault locked or credential type is invalid.
 */
export const saveCredentialToVault = async (
  hostname,
  type,
  value,
  ref = "",
) => {
  if (!isValidType(type)) {
    throw new Error(`Invalid credential type: ${type}`);
  }

  const vaultDb = Vault.getDb();
  if (!vaultDb) {
    console.error("Vault database is null - vault is locked");
    throw new Error(
      "Vault is locked. Please unlock the vault first to save credentials.",
    );
  }

  const isLocked = cliState.getState().credLocked;
  console.log("Save credential check:", {
    vaultDb: !!vaultDb,
    isLocked,
    hostname,
    type,
  });

  if (isLocked) {
    console.error("credLocked is true but vault db exists - state mismatch!");
    throw new Error(
      "Vault is locked. Please unlock the vault first to save credentials.",
    );
  }

  const credType = type === "password" ? "PASSWORD" : "KEY";

  try {
    const existingSecrets = await vaultDb.secrets.toArray();
    const existingSecret = existingSecrets.find(
      (s) => s.content.hostname === hostname && s.content.type === credType,
    );

    if (existingSecret) {
      console.log(`Updating existing ${credType} for ${hostname}`);
      await vaultDb.secrets.update(existingSecret.id, {
        content: {
          hostname,
          type: credType,
          ref: ref || (type === CREDENTIAL_TYPES.KEYFILE ? value?.name : ""), // safe access
          credential:
            type === CREDENTIAL_TYPES.KEYFILE ? value?.contents : value, // safe access
        },
        date: new Date().toISOString(),
      });
    } else {
      console.log(`Adding new ${credType} for ${hostname}`);
      await Vault.saveSecret({
        hostname,
        type: credType,
        // Use provided ref (fall back to the keyfile's filename)
        ref: ref || (type === CREDENTIAL_TYPES.KEYFILE ? value?.name : ""),
        credential: type === CREDENTIAL_TYPES.KEYFILE ? value?.contents : value, // safe access
      });
    }

    // Reload vault into Zustand cache
    await loadSecretsFromVault(vaultDb);
    console.log("Credential saved and cache reloaded successfully");
  } catch (error) {
    console.error("Failed to save credential to vault:", error);
    throw error;
  }
};

/**
 * Removes credential from the Zustand in-memory cache.
 * Does NOT delete from the encrypted vault
 *
 * Behavior:
 *   - If `type` omitted, entire hostname entry is removed.
 *   - If `type` provided, only that credential type is cleared (hostname entry, other credential types remain intact)
 *
 * @param {string} hostname              - Target host.
 * @param {'password'|'keyfile'} [type]  - Credential to clear,
 * @throws {Error} If `type` invalid
 */
export const clearStoredCredentials = (hostname, type) => {
  const currentCache = { ...(cliState.getState().secretsCache || {}) };

  if (!hostname || !currentCache[hostname]) return;

  if (!type) {
    // No type specified (remove hostname entry)
    delete currentCache[hostname];
  } else {
    if (!isValidType(type)) {
      throw new Error(`Invalid credential type: ${type}`);
    }

    // Clear specific type instead of deleting the key
    // Keeps hostname entry and other credential types stored under it.
    currentCache[hostname] = {
      ...currentCache[hostname],
      [type]: null,
    };
  }

  cliState.getState().cacheSecrets(currentCache);
};

/**
 * Reads all secrets from open vault database and rebuilds Zustand secrets mappings.
 * Called after any vault writes to keep in-memory secrets the same with persisted data.
 *
 * Sets `credLocked` to false in Zustand state
 *
 * Cache structure
 * {
 *   [hostname]: {
 *     password?: string,
 *     keyfile?: { name: string, contents: string },
 *     username: string
 *   }
 * }
 *
 * @param {Dexie} vaultDb - Open Dexie instance.
 * @returns {Promise<Object>} New secrets cache mappings.
 */
export const loadSecretsFromVault = async (vaultDb) => {
  const secrets = await vaultDb.secrets.toArray();

  const secretsCache = {};

  secrets.forEach((secret) => {
    const hostname = secret.content.hostname;

    if (!secretsCache[hostname]) {
      secretsCache[hostname] = {};
    }

    if (secret.content.type === "PASSWORD") {
      secretsCache[hostname].password = secret.content.credential;
      secretsCache[hostname].username = secret.content.username || "root";
    } else if (secret.content.type === "KEY") {
      secretsCache[hostname].keyfile = {
        name: secret.content.ref,
        contents: secret.content.credential,
      };
      secretsCache[hostname].username = secret.content.username || "root";
    }
  });

  console.log("Loaded secrets from vault");

  // Push new cache into Zustand and mark vault as unlocked.
  cliState.getState().cacheSecrets(secretsCache);
  cliState.getState().setCredLocked(false);

  return secretsCache;
};
