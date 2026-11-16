import { sql, type UpdateQueryResponse } from "@forge/sql";

import type {
	SyncCheckpoint,
	SyncCheckpointStore,
	SyncSource,
	SyncStatus,
} from "./sync-checkpoint";

interface SyncCheckpointRow {
	tenantId: string;
	source: string;
	scopeId: string;
	status: string;
	lastSuccessfulSyncAt: number | string | null;
	startedAt: number | string;
	completedAt: number | string | null;
	lastError: string | null;
	updatedAt: number | string;
	jobId: string | null;
	resultJson: string | null;
}

export class SqlSyncCheckpointStore implements SyncCheckpointStore {
	async get(
		tenantId: string,
		source: SyncSource,
		scopeId: string,
	): Promise<SyncCheckpoint | null> {
		const result = await sql
			.prepare<SyncCheckpointRow>(
				`SELECT
					tenant_id AS tenantId,
					source,
					scope_id AS scopeId,
					status,
					last_successful_sync_at AS lastSuccessfulSyncAt,
					started_at AS startedAt,
					completed_at AS completedAt,
					last_error AS lastError,
					updated_at AS updatedAt,
					job_id AS jobId,
					result_json AS resultJson
				FROM sync_checkpoints
				WHERE tenant_id = ?
					AND source = ?
					AND scope_id = ?`,
			)
			.bindParams(tenantId, source, scopeId)
			.execute();

		if (result.rows.length === 0) {
			return null;
		}

		const row = result.rows[0];

		let parsedResult: Record<string, unknown> | null = null;

		if (row.resultJson) {
			try {
				const parsed: unknown = JSON.parse(row.resultJson);

				if (
					parsed !== null &&
					typeof parsed === "object" &&
					!Array.isArray(parsed)
				) {
					parsedResult = parsed as Record<string, unknown>;
				}
			} catch {
				parsedResult = null;
			}
		}

		return {
			tenantId: row.tenantId,
			source: row.source as SyncSource,
			scopeId: row.scopeId,
			status: row.status as SyncStatus,
			lastSuccessfulSyncAt:
				row.lastSuccessfulSyncAt === null
					? null
					: Number(row.lastSuccessfulSyncAt),
			startedAt: Number(row.startedAt),
			completedAt: row.completedAt === null ? null : Number(row.completedAt),
			lastError: row.lastError,
			updatedAt: Number(row.updatedAt),
			jobId: row.jobId,
			result: parsedResult,
		};
	}

	async save(checkpoint: SyncCheckpoint): Promise<void> {
		await sql
			.prepare(
				`INSERT INTO sync_checkpoints (
					tenant_id,
					source,
					scope_id,
					status,
					last_successful_sync_at,
					started_at,
					completed_at,
					last_error,
					updated_at,
					job_id,
					result_json
				)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON DUPLICATE KEY UPDATE
					status = VALUES(status),
					last_successful_sync_at = VALUES(last_successful_sync_at),
					started_at = VALUES(started_at),
					completed_at = VALUES(completed_at),
					last_error = VALUES(last_error),
					updated_at = VALUES(updated_at),
					job_id = VALUES(job_id),
					result_json = VALUES(result_json)`,
			)
			.bindParams(
				checkpoint.tenantId,
				checkpoint.source,
				checkpoint.scopeId,
				checkpoint.status,
				checkpoint.lastSuccessfulSyncAt,
				checkpoint.startedAt,
				checkpoint.completedAt,
				checkpoint.lastError,
				checkpoint.updatedAt,
				checkpoint.jobId ?? null,
				checkpoint.result ? JSON.stringify(checkpoint.result) : null,
			)
			.execute();
	}

	/**
	 * Atomically transitions QUEUED -> IN_PROGRESS.
	 *
	 * A failed job may be reclaimed only by the same job ID.
	 * Concurrent duplicate deliveries cannot both claim the job.
	 */
	async claim(
		tenantId: string,
		source: SyncSource,
		scopeId: string,
		jobId: string,
		startedAt: number,
	): Promise<boolean> {
		const result = await sql
			.prepare<UpdateQueryResponse>(
				`UPDATE sync_checkpoints
				SET
					status = 'IN_PROGRESS',
					started_at = ?,
					completed_at = NULL,
					last_error = NULL,
					updated_at = ?,
					job_id = ?,
					result_json = NULL
				WHERE tenant_id = ?
					AND source = ?
					AND scope_id = ?
					AND (
						status = 'QUEUED'
						OR (
							status = 'FAILED'
							AND job_id = ?
						)
					)`,
			)
			.bindParams(startedAt, startedAt, jobId, tenantId, source, scopeId, jobId)
			.execute();

		return result.rows.affectedRows === 1;
	}

	/**
	 * Updates the checkpoint only if the job still owns it.
	 *
	 * This prevents stale consumers from overwriting a newer job's result.
	 */
	async saveIfOwned(
		checkpoint: SyncCheckpoint,
		jobId: string,
	): Promise<boolean> {
		const result = await sql
			.prepare<UpdateQueryResponse>(
				`UPDATE sync_checkpoints
				SET
					status = ?,
					last_successful_sync_at = ?,
					started_at = ?,
					completed_at = ?,
					last_error = ?,
					updated_at = ?,
					result_json = ?
				WHERE tenant_id = ?
					AND source = ?
					AND scope_id = ?
					AND status = 'IN_PROGRESS'
					AND job_id = ?`,
			)
			.bindParams(
				checkpoint.status,
				checkpoint.lastSuccessfulSyncAt,
				checkpoint.startedAt,
				checkpoint.completedAt,
				checkpoint.lastError,
				checkpoint.updatedAt,
				checkpoint.result ? JSON.stringify(checkpoint.result) : null,
				checkpoint.tenantId,
				checkpoint.source,
				checkpoint.scopeId,
				jobId,
			)
			.execute();

		return result.rows.affectedRows === 1;
	}
}
