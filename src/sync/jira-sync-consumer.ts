import type { AsyncEvent } from "@forge/events";

import { SqlGraphRepository } from "../graph/repository/sql-graph-repository";
import { JiraIngestionService } from "../integrations/jira/jira-ingestion-service";
import { SqlSyncCheckpointStore } from "./sql-sync-checkpoint-store";

interface JiraSyncEventBody extends Record<string, unknown> {
	tenantId: string;
	projectKey: string;
}

const repository = new SqlGraphRepository();
const ingestionService = new JiraIngestionService(repository);
const checkpointStore = new SqlSyncCheckpointStore();

function isValidEventBody(body: unknown): body is JiraSyncEventBody {
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		return false;
	}

	const value = body as Record<string, unknown>;

	return (
		typeof value.tenantId === "string" &&
		value.tenantId.length > 0 &&
		typeof value.projectKey === "string" &&
		/^[A-Z][A-Z0-9_]{0,254}$/.test(value.projectKey)
	);
}

export async function handler(
	event: AsyncEvent<JiraSyncEventBody>,
): Promise<void> {
	if (!isValidEventBody(event.body)) {
		throw new Error("Invalid Jira synchronization event.");
	}

	const { tenantId, projectKey } = event.body;
	const jobId = event.jobId;

	if (!jobId) {
		throw new Error("Jira synchronization event has no job ID.");
	}

	const existing = await checkpointStore.get(tenantId, "JIRA", projectKey);

	const previousSuccessfulSyncAt = existing?.lastSuccessfulSyncAt ?? null;

	const startedAt = Date.now();

	// Only one delivery can claim a queued job.
	// A failed job can be reclaimed by its own retry.
	const claimed = await checkpointStore.claim(
		tenantId,
		"JIRA",
		projectKey,
		jobId,
		startedAt,
	);

	if (!claimed) {
		console.warn("Ignoring duplicate or stale Jira sync event:", {
			jobId,
			projectKey,
		});

		return;
	}

	try {
		const result = await ingestionService.ingestProject({
			tenantId,
			projectKey,
			maxIssues: 1000,
		});

		const completedAt = Date.now();

		const saved = await checkpointStore.saveIfOwned(
			{
				tenantId,
				source: "JIRA",
				scopeId: projectKey,
				status: "SUCCEEDED",
				lastSuccessfulSyncAt: completedAt,
				startedAt,
				completedAt,
				lastError: null,
				updatedAt: completedAt,
				jobId,
				result: result as unknown as Record<string, unknown>,
			},
			jobId,
		);

		if (!saved) {
			throw new Error(
				"Jira synchronization completed, but checkpoint ownership was lost.",
			);
		}

		console.info("TraceLine Jira synchronization completed:", {
			jobId,
			...result,
		});
	} catch (error) {
		const completedAt = Date.now();

		const message =
			error instanceof Error
				? error.message
				: "Unknown Jira synchronization error.";

		try {
			const saved = await checkpointStore.saveIfOwned(
				{
					tenantId,
					source: "JIRA",
					scopeId: projectKey,
					status: "FAILED",
					lastSuccessfulSyncAt: previousSuccessfulSyncAt,
					startedAt,
					completedAt,
					lastError: message,
					updatedAt: completedAt,
					jobId,
					result: null,
				},
				jobId,
			);

			if (!saved) {
				console.error(
					"Could not record Jira sync failure because job ownership was lost:",
					{
						jobId,
						projectKey,
					},
				);
			}
		} catch (checkpointError) {
			console.error(
				"Failed to persist Jira synchronization failure:",
				checkpointError,
			);
		}

		console.error("TraceLine Jira synchronization failed:", {
			jobId,
			projectKey,
			error,
		});

		// Allow Forge's async event retry mechanism to handle the failure.
		throw error;
	}
}
