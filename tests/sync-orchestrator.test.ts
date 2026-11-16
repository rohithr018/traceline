import test from "node:test";
import assert from "node:assert/strict";

import { SyncOrchestrator } from "../src/sync/sync-orchestrator";
import type {
	SyncCheckpoint,
	SyncCheckpointStore,
	SyncSource,
} from "../src/sync/sync-checkpoint";

class FakeCheckpointStore implements SyncCheckpointStore {
	records = new Map<string, SyncCheckpoint>();

	private key(tenantId: string, source: SyncSource, scopeId: string): string {
		return `${tenantId}:${source}:${scopeId}`;
	}

	async get(
		tenantId: string,
		source: SyncSource,
		scopeId: string,
	): Promise<SyncCheckpoint | null> {
		return this.records.get(this.key(tenantId, source, scopeId)) ?? null;
	}

	async save(checkpoint: SyncCheckpoint): Promise<void> {
		this.records.set(
			this.key(checkpoint.tenantId, checkpoint.source, checkpoint.scopeId),
			checkpoint,
		);
	}
	async claim(
		tenantId: string,
		source: SyncSource,
		scopeId: string,
		jobId: string,
		startedAt: number,
	): Promise<boolean> {
		const checkpoint = await this.get(tenantId, source, scopeId);

		if (!checkpoint) {
			return false;
		}

		if (
			checkpoint.status !== "QUEUED" &&
			!(checkpoint.status === "FAILED" && checkpoint.jobId === jobId)
		) {
			return false;
		}

		await this.save({
			...checkpoint,
			status: "IN_PROGRESS",
			startedAt,
			completedAt: null,
			lastError: null,
			updatedAt: startedAt,
			jobId,
			result: null,
		});

		return true;
	}

	async saveIfOwned(
		checkpoint: SyncCheckpoint,
		jobId: string,
	): Promise<boolean> {
		const existing = await this.get(
			checkpoint.tenantId,
			checkpoint.source,
			checkpoint.scopeId,
		);

		if (
			!existing ||
			existing.status !== "IN_PROGRESS" ||
			existing.jobId !== jobId
		) {
			return false;
		}

		await this.save(checkpoint);
		return true;
	}
}

function createOrchestrator(options?: {
	jiraFails?: boolean;
	confluenceFails?: boolean;
	linkerFails?: boolean;
}) {
	const checkpoints = new FakeCheckpointStore();

	const jira = {
		async ingestProject() {
			if (options?.jiraFails) {
				throw new Error("Jira API unavailable");
			}

			return {
				projectKey: "AUTH",
				fetchedIssues: 10,
				persistedNodes: 10,
				placeholderNodes: 2,
				persistedEdges: 5,
			};
		},
	};

	const confluence = {
		async ingestSpace() {
			if (options?.confluenceFails) {
				throw new Error("Confluence API unavailable");
			}

			return {
				spaceId: "10001",
				fetchedPages: 5,
				persistedNodes: 5,
			};
		},
	};

	const linker = {
		async linkAllDocuments() {
			if (options?.linkerFails) {
				throw new Error("Cross-source linking failed");
			}

			return [];
		},
	};

	return {
		orchestrator: new SyncOrchestrator(jira, confluence, linker, checkpoints),
		checkpoints,
	};
}

test("runs all synchronization stages successfully", async () => {
	const { orchestrator, checkpoints } = createOrchestrator();

	const result = await orchestrator.run({
		tenantId: "tenant-1",
		projectKey: "AUTH",
		spaceId: "10001",
	});

	assert.equal(result.status, "SUCCEEDED");
	assert.equal(result.steps.jira.status, "SUCCEEDED");
	assert.equal(result.steps.confluence.status, "SUCCEEDED");
	assert.equal(result.steps.crossSource.status, "SUCCEEDED");

	assert.equal(checkpoints.records.size, 3);
});

test("preserves Jira success when Confluence fails", async () => {
	const { orchestrator, checkpoints } = createOrchestrator({
		confluenceFails: true,
	});

	const result = await orchestrator.run({
		tenantId: "tenant-1",
		projectKey: "AUTH",
		spaceId: "10001",
	});

	assert.equal(result.status, "PARTIAL_FAILURE");
	assert.equal(result.steps.jira.status, "SUCCEEDED");
	assert.equal(result.steps.confluence.status, "FAILED");
	assert.equal(result.steps.crossSource.status, "SUCCEEDED");

	const jiraCheckpoint = await checkpoints.get("tenant-1", "JIRA", "AUTH");

	const confluenceCheckpoint = await checkpoints.get(
		"tenant-1",
		"CONFLUENCE",
		"10001",
	);

	assert.equal(jiraCheckpoint?.status, "SUCCEEDED");
	assert.equal(confluenceCheckpoint?.status, "FAILED");
	assert.ok(jiraCheckpoint?.lastSuccessfulSyncAt);
	assert.equal(confluenceCheckpoint?.lastSuccessfulSyncAt, null);
});

test("records Jira failure and continues other stages", async () => {
	const { orchestrator } = createOrchestrator({
		jiraFails: true,
	});

	const result = await orchestrator.run({
		tenantId: "tenant-1",
		projectKey: "AUTH",
		spaceId: "10001",
	});

	assert.equal(result.status, "PARTIAL_FAILURE");
	assert.equal(result.steps.jira.status, "FAILED");
	assert.equal(result.steps.confluence.status, "SUCCEEDED");
	assert.equal(result.steps.crossSource.status, "SUCCEEDED");
	assert.equal(result.steps.jira.error, "Jira API unavailable");
});

test("records cross-source linking failures", async () => {
	const { orchestrator, checkpoints } = createOrchestrator({
		linkerFails: true,
	});

	const result = await orchestrator.run({
		tenantId: "tenant-1",
		projectKey: "AUTH",
		spaceId: "10001",
	});

	assert.equal(result.status, "PARTIAL_FAILURE");
	assert.equal(result.steps.jira.status, "SUCCEEDED");
	assert.equal(result.steps.confluence.status, "SUCCEEDED");
	assert.equal(result.steps.crossSource.status, "FAILED");

	const checkpoint = await checkpoints.get(
		"tenant-1",
		"CROSS_SOURCE",
		"AUTH:10001",
	);

	assert.equal(checkpoint?.status, "FAILED");
	assert.equal(checkpoint?.lastError, "Cross-source linking failed");
});

test("preserves the previous successful timestamp after a failed run", async () => {
	const { orchestrator, checkpoints } = createOrchestrator();

	await orchestrator.run({
		tenantId: "tenant-1",
		projectKey: "AUTH",
		spaceId: "10001",
	});

	const previous = await checkpoints.get("tenant-1", "JIRA", "AUTH");

	assert.ok(previous?.lastSuccessfulSyncAt);

	const failing = createOrchestrator({
		jiraFails: true,
	});

	await failing.checkpoints.save(previous!);

	await failing.orchestrator.run({
		tenantId: "tenant-1",
		projectKey: "AUTH",
		spaceId: "10001",
	});

	const updated = await failing.checkpoints.get("tenant-1", "JIRA", "AUTH");

	assert.equal(updated?.lastSuccessfulSyncAt, previous?.lastSuccessfulSyncAt);

	assert.equal(updated?.status, "FAILED");
});
