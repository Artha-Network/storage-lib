// src/config.ts
// Environment-driven configuration for @trust-escrow/storage-lib

/**
 * Shape of the configuration consumed by stores and the metadata repo.
 */
export interface StorageConfig {
  arweave?: {
    /** Upload/gateway endpoint (e.g., Bundlr or an Arweave gateway that accepts uploads) */
    endpoint: string;
    /** Optional auth key/token if your uploader requires it */
    apiKey?: string;
  };
  ipfs?: {
    /** IPFS API base URL (the store will call /api/v0 endpoints as needed) */
    endpoint: string;
    /** Pinning/auth token, often in the form "Bearer <token>" */
    token?: string;
  };
  postgres?: {
    /** Postgres connection string, e.g. postgresql://user:pass@host:5432/dbname */
    url: string;
  };
  publicGateway?: {
    /** Public gateway base for IPFS reads/HEAD (must end with /) */
    ipfs?: string;
    /** Public gateway base for Arweave reads/HEAD (must end with /) */
    arweave?: string;
  };
}

/**
 * Load configuration from process.env with sensible defaults.
 * NOTE: Do not import 'dotenv' here; let the host app load envs however it prefers.
 */
export const loadConfig = (): StorageConfig => {
  return {
    arweave: {
      endpoint: env('ARWEAVE_ENDPOINT', 'https://arweave.net'),
      apiKey: envOpt('ARWEAVE_API_KEY'),
    },
    ipfs: {
      endpoint: env('IPFS_ENDPOINT', 'https://ipfs.infura.io:5001'),
      token: envOpt('IPFS_TOKEN'),
    },
    postgres: envOpt('DATABASE_URL')
      ? { url: env('DATABASE_URL') }
      : undefined,
    publicGateway: {
      ipfs: env('IPFS_PUBLIC_GATEWAY', 'https://ipfs.io/ipfs/'),
      arweave: env('ARWEAVE_PUBLIC_GATEWAY', 'https://arweave.net/'),
    },
  };
};

/**
 * Assert that required pieces exist when features are enabled.
 * Example: call this if you constructed StorageLib with Postgres enabled.
 */
export function assertPostgresConfigured(cfg: StorageConfig): void {
  if (!cfg.postgres?.url) {
    throw new Error(
      'DATABASE_URL is required when PostgreSQL registry is enabled. ' +
        'Set it in your environment or disable Postgres for this instance.'
    );
  }
}

// ---------------------
// Internal helpers
// ---------------------

/** Required env var with optional default. Throws if missing and no default is provided. */
function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${name}`);
}

/** Optional env var; returns string or undefined. */
function envOpt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}
