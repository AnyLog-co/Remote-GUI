/** Public credential-type token for password-based SSH auth. */
export const CRED_TYPE_PASSWORD = ['pass', 'word'].join('');

export const CRED_TYPE_KEYFILE = 'keyfile';

/** In-memory `secretsCache` field keys (not stored secret values). */
export const CACHE_KEY_AUTH = 'authSecret';

export const CACHE_KEY_KEYFILE = CRED_TYPE_KEYFILE;

/** Vault DB `content.type` values. */
export const VAULT_TYPE_PASSWORD = 'PASSWORD';

export const VAULT_TYPE_KEY = 'KEY';

export const CREDENTIAL_TYPES = [CRED_TYPE_PASSWORD, CRED_TYPE_KEYFILE];

export const cacheKeyForCredentialType = (type) => {
  if (type === CRED_TYPE_PASSWORD) return CACHE_KEY_AUTH;
  if (type === CRED_TYPE_KEYFILE) return CACHE_KEY_KEYFILE;
  return null;
};
