export type SyncSource = "JIRA" | "CONFLUENCE" | "CROSS_SOURCE";

export type SyncStatus = "QUEUED" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED";

export interface SyncCheckpoint {
	tenantId: string;
	source: SyncSource;
	scopeId: string;
	status: SyncStatus;
	lastSuccessfulSyncAt: number | null;
	startedAt: number;
	completedAt: number | null;
	lastError: string | null;
	updatedAt: number;
	jobId?: string | null;
	result?: Record<string, unknown> | null;
}

export interface SyncCheckpointStore {
	get(
		tenantId: string,
		source: SyncSource,
		scopeId: string,
	): Promise<SyncCheckpoint | null>;

	save(checkpoint: SyncCheckpoint): Promise<void>;

	/**
	 * Atomically claims a queued job.
	 *
	 * A failed job can be reclaimed only by the same Forge job ID,
	 * allowing retries without allowing another job to take ownership.
	 */
	claim(
		tenantId: string,
		source: SyncSource,
		scopeId: string,
		jobId: string,
		startedAt: number,
	): Promise<boolean>;

	/**
	 * Updates a checkpoint only if the supplied job still owns it.
	 */
	saveIfOwned(checkpoint: SyncCheckpoint, jobId: string): Promise<boolean>;
}
