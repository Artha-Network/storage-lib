// src/postgres/metadata.ts
// PostgreSQL metadata/audit repository for @trust-escrow/storage-lib.
//
// PURPOSE
// -------
// Persist a minimal audit trail that maps escrow artifacts (dealId + party)
// to stored content IDs and integrity digests. This lets the app:
//  • trace evidence submissions during disputes
//  • verify tamper-evidence via stored sha256
//  • join to off-chain case management records
//
// DESIGN
// ------
// - Table: evidence_records
//   Columns:
//     id           BIGSERIAL PK            (portable; no pgcrypto/uuid ext needed)
//     deal_id      TEXT NOT NULL
//     party        TEXT NOT NULL CHECK (party IN ('buyer','seller','system'))
//     sha256       TEXT NOT NULL           (lowercase hex, 64 chars)
//     primary_cid  TEXT NOT NULL           (Arweave tx id by default)
//     mirror_cid   TEXT NOT NULL           (IPFS CID by default)
//     content_type TEXT                    (MIME)
//     created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
//   Indexes:
//     evidence_records_deal_idx (deal_id)
//     evidence_records_created_idx (created_at)
//
// USAGE
// -----
// const repo = new EvidenceRepo();
// await repo.migrate(); // idempotent
// await repo.add({ dealId, party, sha256, primaryCid, mirrorCid, contentType });
// const rows = await repo.findByDeal('DEAL-123');
// await repo.close();
//
// CONFIG
// ------
// - DATABASE_URL env must be set when using the repo (see src/config.ts).
//
// NOTES
// -----
// - Keep inserts thin and transactional at the app layer if you need to
//   bundle multiple writes. Here we rely on Pool's implicit transactions.

import { Pool } from 'pg';
import type { EvidenceRecord } from '../types.js';
import { loadConfig, assertPostgresConfigured } from '../config.js';

export class EvidenceRepo {
  private pool: Pool;

  constructor() {
    const cfg = loadConfig();
    assertPostgresConfigured(cfg);
    this.pool = new Pool({ connectionString: cfg.postgres!.url });
  }

  /**
   * Idempotent migration: create the evidence_records table and indexes.
   * Uses BIGSERIAL for portability (no extensions needed).
   */
  async migrate(): Promise<void> {
    const sql = `
      create table if not exists evidence_records (
        id            bigserial primary key,
        deal_id       text not null,
        party         text not null check (party in ('buyer','seller','system')),
        sha256        text not null,
        primary_cid   text not null,
        mirror_cid    text not null,
        content_type  text,
        created_at    timestamptz not null default now()
      );

      create index if not exists evidence_records_deal_idx
        on evidence_records(deal_id);

      create index if not exists evidence_records_created_idx
        on evidence_records(created_at);
    `;
    await this.pool.query(sql);
  }

  /**
   * Insert a single evidence record.
   * Supply at minimum: dealId, party, sha256, primaryCid, mirrorCid.
   */
  async add(rec: EvidenceRecord): Promise<void> {
    const text = `
      insert into evidence_records
        (deal_id, party, sha256, primary_cid, mirror_cid, content_type, created_at)
      values
        ($1,      $2,    $3,     $4,          $5,         $6,           coalesce($7, now()))
    `;
    const values = [
      rec.dealId,
      rec.party,
      rec.sha256,
      rec.primaryCid,
      rec.mirrorCid,
      rec.contentType ?? null,
      rec.createdAt ?? null
    ];
    await this.pool.query(text, values);
  }

  /**
   * Fetch records for a given deal id (most recent first).
   */
  async findByDeal(dealId: string): Promise<Array<{
    id: number;
    deal_id: string;
    party: 'buyer' | 'seller' | 'system';
    sha256: string;
    primary_cid: string;
    mirror_cid: string;
    content_type: string | null;
    created_at: string; // ISO string
  }>> {
    const res = await this.pool.query(
      `select id, deal_id, party, sha256, primary_cid, mirror_cid, content_type, created_at
         from evidence_records
        where deal_id = $1
        order by created_at desc, id desc`,
      [dealId]
    );
    // Convert timestamptz to ISO strings for consistent callers
    return res.rows.map(r => ({
      ...r,
      created_at: new Date(r.created_at).toISOString()
    }));
  }

  /**
   * List the N most recent records (default 50).
   */
  async listRecent(limit = 50): Promise<Array<{
    id: number;
    deal_id: string;
    party: 'buyer' | 'seller' | 'system';
    sha256: string;
    primary_cid: string;
    mirror_cid: string;
    content_type: string | null;
    created_at: string; // ISO string
  }>> {
    const lim = Math.max(1, Math.min(limit, 500)); // sane bounds
    const res = await this.pool.query(
      `select id, deal_id, party, sha256, primary_cid, mirror_cid, content_type, created_at
         from evidence_records
        order by created_at desc, id desc
        limit $1`,
      [lim]
    );
    return res.rows.map(r => ({
      ...r,
      created_at: new Date(r.created_at).toISOString()
    }));
  }

  /**
   * Gracefully close the pool (e.g., on shutdown or in tests).
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
