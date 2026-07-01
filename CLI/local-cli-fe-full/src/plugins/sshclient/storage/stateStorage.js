import { cliState } from '../state/state';
import { Vault } from './vault';
import {
  CRED_TYPE_PASSWORD,
  CRED_TYPE_KEYFILE,
  CREDENTIAL_TYPES,
  VAULT_TYPE_PASSWORD,
  VAULT_TYPE_KEY,
  CACHE_KEY_AUTH,
  CACHE_KEY_KEYFILE,
  cacheKeyForCredentialType,
} from './credentialConstants';

export {
  CRED_TYPE_PASSWORD,
  CRED_TYPE_KEYFILE,
} from './credentialConstants';

export const retrieveStoredCredential = (hostname, type) => {
  if (!CREDENTIAL_TYPES.includes(type)) {
    throw new Error(`Invalid credential type: ${type}`);
  }

  const secretsCache = cliState.getState().secretsCache || {};
  const hostCreds = secretsCache[hostname];

  if (!hostCreds) return null;

  const cacheKey = cacheKeyForCredentialType(type);
  if (type === CRED_TYPE_PASSWORD) {
    return hostCreds[cacheKey] || null;
  }
  if (type === CRED_TYPE_KEYFILE) {
    console.log(`providing data from ${hostCreds[CACHE_KEY_KEYFILE]?.name}`);
    return hostCreds[CACHE_KEY_KEYFILE] || null;
  }

  return null;
};

export const storeCredentialInSession = (hostname, type, value) => {
  if (!CREDENTIAL_TYPES.includes(type)) {
    throw new Error(`Invalid credential type: ${type}`);
  }

  const currentCache = cliState.getState().secretsCache || {};
  const hostData = currentCache[hostname] || {};
  const cacheKey = cacheKeyForCredentialType(type);

  const updatedHostData = {
    ...hostData,
    [cacheKey]: value,
  };

  cliState.getState().cacheSecrets({
    ...currentCache,
    [hostname]: updatedHostData,
  });
};

export const saveCredentialToVault = async (
  hostname,
  type,
  value,
  ref = '',
) => {
  if (!CREDENTIAL_TYPES.includes(type)) {
    throw new Error(`Invalid credential type: ${type}`);
  }

  const vaultDb = Vault.getDb();
  if (!vaultDb) {
    console.error('Vault database is null - vault is locked');
    throw new Error(
      'Vault is locked. Please unlock the vault first to save credentials.',
    );
  }

  const isLocked = cliState.getState().credLocked;
  console.log('Save credential check:', {
    vaultDb: !!vaultDb,
    isLocked,
    hostname,
    type,
  });

  if (isLocked) {
    console.error('credLocked is true but vault db exists - state mismatch!');
    throw new Error(
      'Vault is locked. Please unlock the vault first to save credentials.',
    );
  }

  const credType = type === CRED_TYPE_PASSWORD ? VAULT_TYPE_PASSWORD : VAULT_TYPE_KEY;

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
          ref: ref || (type === CRED_TYPE_KEYFILE ? value.name : ''),
          credential: type === CRED_TYPE_KEYFILE ? value.contents : value,
        },
        date: new Date().toISOString(),
      });
    } else {
      console.log(`Adding new ${credType} for ${hostname}`);
      await Vault.saveSecret({
        hostname,
        type: credType,
        ref: ref || (type === CRED_TYPE_KEYFILE ? value.name : ''),
        credential: type === CRED_TYPE_KEYFILE ? value.contents : value,
      });
    }

    await loadSecretsFromVault(vaultDb);
    console.log('Credential saved and cache reloaded successfully');
  } catch (error) {
    console.error('Failed to save credential to vault:', error);
    throw error;
  }
};

export const clearStoredCredentials = (hostname, type) => {
  const currentCache = { ...(cliState.getState().secretsCache || {}) };

  if (!hostname || !currentCache[hostname]) return;

  if (!type) {
    delete currentCache[hostname];
  } else {
    if (!CREDENTIAL_TYPES.includes(type)) {
      throw new Error(`Invalid credential type: ${type}`);
    }
    const cacheKey = cacheKeyForCredentialType(type);
    currentCache[hostname] = {
      ...currentCache[hostname],
      [cacheKey]: null,
    };
  }

  cliState.getState().cacheSecrets(currentCache);
};

export const loadSecretsFromVault = async (vaultDb) => {
  const secrets = await vaultDb.secrets.toArray();

  const secretsCache = {};

  secrets.forEach((secret) => {
    const hostname = secret.content.hostname;

    if (!secretsCache[hostname]) {
      secretsCache[hostname] = {};
    }

    if (secret.content.type === VAULT_TYPE_PASSWORD) {
      secretsCache[hostname][CACHE_KEY_AUTH] = secret.content.credential;
      secretsCache[hostname].username = secret.content.username || 'root';
    } else if (secret.content.type === VAULT_TYPE_KEY) {
      secretsCache[hostname][CACHE_KEY_KEYFILE] = {
        name: secret.content.ref,
        contents: secret.content.credential,
      };
      secretsCache[hostname].username = secret.content.username || 'root';
    }
  });

  console.log('Loaded secrets from vault:', Object.keys(secretsCache));

  cliState.getState().cacheSecrets(secretsCache);
  cliState.getState().setCredLocked(false);

  return secretsCache;
};
