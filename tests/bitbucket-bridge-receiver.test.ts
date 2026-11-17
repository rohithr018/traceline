import assert from "node:assert/strict";
import test from "node:test";

import { createGraphNode } from "../src/graph/models/graph-node";
import { InMemoryGraphRepository } from "../src/graph/repository/in-memory-graph-repository";
import type { GraphNode } from "../src/graph/models/graph-node";

import {
	createBitbucketBridgeReceiver,
	type BitbucketBridgeReceiverDependencies,
} from "../src/integrations/bitbucket/bitbucket-bridge-receiver";
import { signBridgeRequest } from "../src/integrations/bitbucket/bitbucket-bridge-crypto";
import type {
	BitbucketBridgeEventStore,
	BitbucketWorkspaceLink,
} from "../src/integrations/bitbucket/bitbucket-bridge-store";

const WORKSPACE_UUID = "{8ba415db-861f-4575-b92b-8d057b404599}";
const TENANT_ID = "tenant-1";
const SECRET = "test-bridge-secret-with-at-least-32-bytes";
const NOW = Date.parse("2026-11-17T10:00:00.000Z");

class FakeBridgeStore implements BitbucketBridgeEventStore {
	private readonly events = new Map<string, "PROCESSING" | "FAILED" | "COMPLETED">();
	private workspaceStatus: "PENDING" | "ACTIVE" = "ACTIVE";

	get claimCount(): number {
		return [...this.events.values()].filter((status) => status === "PROCESSING")
			.length;
	}

	async getWorkspaceLink(
		workspaceUuid: string,
	): Promise<BitbucketWorkspaceLink | null> {
		if (workspaceUuid !== WORKSPACE_UUID || this.workspaceStatus !== "ACTIVE") {
			return null;
		}

		return {
			workspaceUuid: WORKSPACE_UUID,
			tenantId: TENANT_ID,
			secret: SECRET,
			status: "ACTIVE",
		};
	}

	async getWorkspaceActivationLink(
		workspaceUuid: string,
	): Promise<BitbucketWorkspaceLink | null> {
		if (workspaceUuid !== WORKSPACE_UUID) {
			return null;
		}

		return {
			workspaceUuid: WORKSPACE_UUID,
			tenantId: TENANT_ID,
			secret: SECRET,
			status: this.workspaceStatus,
		};
	}

	async activateWorkspace(workspaceUuid: string): Promise<boolean> {
		if (workspaceUuid !== WORKSPACE_UUID || this.workspaceStatus !== "PENDING") {
			return false;
		}

		this.workspaceStatus = "ACTIVE";
		return true;
	}

	makeWorkspacePending(): void {
		this.workspaceStatus = "PENDING";
	}

	async claimEvent(input: {
		workspaceUuid: string;
		eventId: string;
	}): Promise<boolean> {
		const key = `${input.workspaceUuid}:${input.eventId}`;
		const status = this.events.get(key);

		if (status === "PROCESSING" || status === "COMPLETED") {
			return false;
		}

		this.events.set(key, "PROCESSING");
		return true;
	}

	async completeEvent(input: {
		workspaceUuid: string;
		eventId: string;
	}): Promise<boolean> {
		const key = `${input.workspaceUuid}:${input.eventId}`;

		if (this.events.get(key) !== "PROCESSING") {
			return false;
		}

		this.events.set(key, "COMPLETED");
		return true;
	}

	async failEvent(input: {
		workspaceUuid: string;
		eventId: string;
		error: string;
	}): Promise<boolean> {
		const key = `${input.workspaceUuid}:${input.eventId}`;

		if (this.events.get(key) !== "PROCESSING") {
			return false;
		}

		this.events.set(key, "FAILED");
		return true;
	}
}

class FailOnceGraphRepository extends InMemoryGraphRepository {
	private shouldFail = false;

	failNextNodeUpsert(): void {
		this.shouldFail = true;
	}

	async upsertNode(node: GraphNode): Promise<void> {
		if (this.shouldFail) {
			this.shouldFail = false;
			throw new Error("Simulated graph persistence failure");
		}

		await super.upsertNode(node);
	}
}

function buildPayload(eventId = "event-1") {
	return {
		schemaVersion: 1,
		eventId,
		workspaceId: WORKSPACE_UUID,
		repository: {
			uuid: "{repo-1}",
			slug: "traceline-bitbucket",
			fullName: "rohith018r/traceline-bitbucket",
			name: "traceline-bitbucket",
			isPrivate: true,
			url: "https://bitbucket.org/rohith018r/traceline-bitbucket",
		},
		pullRequest: {
			id: 42,
			title: "PAY-1 Update payment flow",
			description: "Implements PAY-1",
			state: "OPEN",
			url: "https://bitbucket.org/rohith018r/traceline-bitbucket/pull-requests/42",
			createdOn: "2026-11-17T09:00:00.000Z",
			updatedOn: "2026-11-17T09:30:00.000Z",
			sourceBranch: "feature/pay-1",
			destinationBranch: "main",
			author: "TraceLine Developer",
		},
		commits: [
			{
				hash: "abcdef123456",
				message: "PAY-1 update payment flow",
				date: "2026-11-17T09:15:00.000Z",
			},
		],
		changedFiles: [
			{
				status: "modified",
				newPath: "src/payment/charge.ts",
				linesAdded: 12,
				linesRemoved: 2,
			},
		],
	};
}

function buildRequest(payload: ReturnType<typeof buildPayload>, timestamp?: string) {
	const rawBody = JSON.stringify(payload);
	const signedTimestamp = timestamp ?? String(Math.floor(NOW / 1000));

	return {
		method: "POST",
		body: rawBody,
		headers: {
			"X-TraceLine-Timestamp": [signedTimestamp],
			"X-TraceLine-Event-Id": [payload.eventId],
			"X-TraceLine-Signature": [
				signBridgeRequest(SECRET, signedTimestamp, payload.eventId, rawBody),
			],
		},
	};
}

function buildActivationRequest(timestamp?: string) {
	const payload = {
		schemaVersion: 1,
		kind: "ACTIVATE",
		eventId: "activation-event-1",
		workspaceId: WORKSPACE_UUID,
	};
	const rawBody = JSON.stringify(payload);
	const signedTimestamp = timestamp ?? String(Math.floor(NOW / 1000));

	return {
		method: "POST",
		body: rawBody,
		headers: {
			"X-TraceLine-Timestamp": [signedTimestamp],
			"X-TraceLine-Event-Id": [payload.eventId],
			"X-TraceLine-Signature": [
				signBridgeRequest(SECRET, signedTimestamp, payload.eventId, rawBody),
			],
		},
	};
}

async function seedImpactTargets(repository: InMemoryGraphRepository) {
	await repository.upsertNode(
		createGraphNode({
			id: "service:payment",
			tenantId: TENANT_ID,
			type: "SERVICE",
			source: "USER",
			name: "payment-service",
			attributes: {
				bitbucketSourceMappings: [
					{
						repositoryUuid: "{repo-1}",
						pathPrefix: "src/payment/",
					},
				],
			},
		}),
	);

	await repository.upsertNode(
		createGraphNode({
			id: "jira:issue:pay-1",
			tenantId: TENANT_ID,
			type: "ISSUE",
			source: "JIRA",
			externalId: "PAY-1",
			name: "Payment work",
			attributes: {
				issueKey: "PAY-1",
			},
		}),
	);
}

function dependencies(
	repository: InMemoryGraphRepository,
	bridgeStore = new FakeBridgeStore(),
): BitbucketBridgeReceiverDependencies {
	return {
		repository,
		bridgeStore,
		now: () => NOW,
	};
}

function receiveWithDependencies(
	request: ReturnType<typeof buildRequest>,
	bridgeReceiverDependencies: BitbucketBridgeReceiverDependencies,
) {
	return createBitbucketBridgeReceiver(bridgeReceiverDependencies)(request);
}

test("authenticates a bridge event and persists its complete PR graph links", async () => {
	const repository = new InMemoryGraphRepository();
	const bridgeStore = new FakeBridgeStore();
	await seedImpactTargets(repository);
	const payload = buildPayload();
	Object.assign(payload, { tenantId: "untrusted-payload-tenant" });

	const result = await receiveWithDependencies(
		buildRequest(payload),
		dependencies(repository, bridgeStore),
	);

	assert.equal(result.statusCode, 200);

	const nodes = await repository.listNodes(TENANT_ID);
	const edges = await repository.listEdges(TENANT_ID);
	const pullRequest = nodes.find((node) => node.type === "PULL_REQUEST");

	assert.equal(nodes.length, 4);
	assert.equal(pullRequest?.tenantId, TENANT_ID);
	assert.equal(pullRequest?.attributes.workspaceId, WORKSPACE_UUID);
	assert.equal(pullRequest?.attributes.changedFileCount, 1);
	assert.equal(
		nodes.find((node) => node.type === "REPOSITORY")?.attributes.isPrivate,
		true,
	);
	assert.deepEqual(
		edges.map((edge) => edge.type).sort(),
		["IMPLEMENTS", "MODIFIES", "RELATED_TO"],
	);
});

test("keeps its dependencies when Forge passes invocation context as argument two", async () => {
	const repository = new InMemoryGraphRepository();
	const bridgeStore = new FakeBridgeStore();
	await seedImpactTargets(repository);

	const receiver = createBitbucketBridgeReceiver(
		dependencies(repository, bridgeStore),
	);
	const invokeAsForge = receiver as (
		request: ReturnType<typeof buildRequest>,
		context: { installationId: string },
	) => Promise<{ statusCode: number }>;
	const result = await invokeAsForge(
		buildRequest(buildPayload("event-forge-context")),
		{ installationId: "forge-installation-context" },
	);

	assert.equal(result.statusCode, 200);
	assert.equal(
		(await repository.listNodes(TENANT_ID)).some(
			(node) => node.type === "PULL_REQUEST",
		),
		true,
	);
});

test("rejects invalid authentication and invalid payloads before claiming an event", async () => {
	const repository = new InMemoryGraphRepository();
	const bridgeStore = new FakeBridgeStore();
	const request = buildRequest(buildPayload());

	request.headers["X-TraceLine-Signature"] = ["not-a-signature"];

	const invalidSignature = await receiveWithDependencies(
		request,
		dependencies(repository, bridgeStore),
	);

	assert.equal(invalidSignature.statusCode, 401);
	assert.equal(bridgeStore.claimCount, 0);

	const invalidPayload = buildPayload("event-invalid-payload");
	delete (invalidPayload.repository as { name?: string }).name;

	const invalidBody = await receiveWithDependencies(
		buildRequest(invalidPayload),
		dependencies(repository, bridgeStore),
	);

	assert.equal(invalidBody.statusCode, 400);
	assert.equal(bridgeStore.claimCount, 0);
});

test("rejects expired and unpaired workspace requests", async () => {
	const repository = new InMemoryGraphRepository();
	const bridgeStore = new FakeBridgeStore();

	const expired = await receiveWithDependencies(
		buildRequest(buildPayload("event-expired"), String(Math.floor(NOW / 1000) - 301)),
		dependencies(repository, bridgeStore),
	);

	assert.equal(expired.statusCode, 401);

	const unpairedPayload = buildPayload("event-unpaired");
	unpairedPayload.workspaceId = "{11111111-1111-4111-8111-111111111111}";

	const unpaired = await receiveWithDependencies(
		buildRequest(unpairedPayload),
		dependencies(repository, bridgeStore),
	);

	assert.equal(unpaired.statusCode, 401);
});

test("requires companion activation before a pending workspace can write PR data", async () => {
	const repository = new InMemoryGraphRepository();
	const bridgeStore = new FakeBridgeStore();
	bridgeStore.makeWorkspacePending();
	await seedImpactTargets(repository);
	const receiverDependencies = dependencies(repository, bridgeStore);

	const beforeActivation = await receiveWithDependencies(
		buildRequest(buildPayload("event-pending")),
		receiverDependencies,
	);
	assert.equal(beforeActivation.statusCode, 401);

	const activation = await receiveWithDependencies(
		buildActivationRequest(),
		receiverDependencies,
	);
	assert.equal(activation.statusCode, 200);

	const accepted = await receiveWithDependencies(
		buildRequest(buildPayload("event-pending")),
		receiverDependencies,
	);
	assert.equal(accepted.statusCode, 200);
	assert.equal((await repository.listNodes(TENANT_ID)).some((node) => node.type === "PULL_REQUEST"), true);
});

test("deduplicates repeated delivery and retries a previously failed event", async () => {
	const repository = new InMemoryGraphRepository();
	const bridgeStore = new FakeBridgeStore();
	await seedImpactTargets(repository);

	const request = buildRequest(buildPayload("event-duplicate"));

	const first = await receiveWithDependencies(
		request,
		dependencies(repository, bridgeStore),
	);
	const duplicate = await receiveWithDependencies(
		request,
		dependencies(repository, bridgeStore),
	);

	assert.equal(first.statusCode, 200);
	assert.equal(duplicate.statusCode, 200);
	assert.equal((await repository.listEdges(TENANT_ID)).length, 3);

	const failingRepository = new FailOnceGraphRepository();
	const retryStore = new FakeBridgeStore();
	await seedImpactTargets(failingRepository);
	failingRepository.failNextNodeUpsert();
	const retryRequest = buildRequest(buildPayload("event-retry"));

	const failed = await receiveWithDependencies(
		retryRequest,
		dependencies(failingRepository, retryStore),
	);
	const retried = await receiveWithDependencies(
		retryRequest,
		dependencies(failingRepository, retryStore),
	);

	assert.equal(failed.statusCode, 500);
	assert.equal(retried.statusCode, 200);
	assert.equal((await failingRepository.listEdges(TENANT_ID)).length, 3);
});
