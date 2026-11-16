import test from "node:test";
import assert from "node:assert/strict";

import type { GraphNode } from "../src/graph/models/graph-node";
import type { GraphRepository } from "../src/graph/repository/graph-repository";
import {
	CriticalityNodeNotFoundError,
	CriticalityService,
} from "../src/risk/services/criticality-service";
import { CriticalityValidationError } from "../src/risk/validation/criticality-validator";

function createNode(
	attributes: Record<string, unknown> = {},
	type = "ISSUE",
): GraphNode {
	return {
		id: "jira:issue:10005",
		tenantId: "tenant-1",
		type,
		source: "JIRA",
		externalId: "10005",
		name: "Implement User Registration",
		attributes,
		createdAt: 1000,
		updatedAt: 1000,
		lastSyncedAt: 1000,
	} as GraphNode;
}

function createRepository(node: GraphNode | null) {
	let savedNode: GraphNode | null = null;

	const repository = {
		getNode: async (_tenantId: string, _nodeId: string) => node,
		upsertNode: async (updated: GraphNode) => {
			savedNode = updated;
		},
	} as unknown as GraphRepository;

	return {
		repository,
		getSavedNode: () => savedNode,
	};
}

test("updates criticality and returns the result", async () => {
	const node = createNode();
	const { repository, getSavedNode } = createRepository(node);
	const service = new CriticalityService(repository, () => 5000);

	const result = await service.updateCriticality({
		tenantId: "tenant-1",
		updatedBy: "account-123",
		request: {
			nodeId: node.id,
			criticality: "HIGH",
		},
	});

	assert.deepEqual(result, {
		success: true,
		nodeId: node.id,
		criticality: "HIGH",
		updatedAt: 5000,
	});

	assert.equal(getSavedNode()?.attributes.criticality, "HIGH");
});

test("preserves existing node attributes", async () => {
	const node = createNode({
		criticality: "LOW",
		labels: ["backend", "authentication"],
		projectKey: "SCRUM",
		customMetadata: {
			owner: "platform-team",
		},
	});

	const { repository, getSavedNode } = createRepository(node);
	const service = new CriticalityService(repository, () => 6000);

	await service.updateCriticality({
		tenantId: "tenant-1",
		updatedBy: "account-123",
		request: {
			nodeId: node.id,
			criticality: "CRITICAL",
		},
	});

	const saved = getSavedNode();

	assert.deepEqual(saved?.attributes.labels, ["backend", "authentication"]);
	assert.equal(saved?.attributes.projectKey, "SCRUM");
	assert.deepEqual(saved?.attributes.customMetadata, {
		owner: "platform-team",
	});
	assert.equal(saved?.attributes.criticality, "CRITICAL");
});

test("stores updater and update timestamp", async () => {
	const node = createNode();
	const { repository, getSavedNode } = createRepository(node);
	const service = new CriticalityService(repository, () => 7000);

	await service.updateCriticality({
		tenantId: "tenant-1",
		updatedBy: "account-456",
		request: {
			nodeId: node.id,
			criticality: "MEDIUM",
		},
	});

	const saved = getSavedNode();

	assert.equal(saved?.attributes.criticalityUpdatedAt, 7000);
	assert.equal(saved?.attributes.criticalityUpdatedBy, "account-456");
	assert.equal(saved?.updatedAt, 7000);
});

test("allows resetting criticality to UNKNOWN", async () => {
	const node = createNode({ criticality: "CRITICAL" });
	const { repository, getSavedNode } = createRepository(node);
	const service = new CriticalityService(repository, () => 8000);

	await service.updateCriticality({
		tenantId: "tenant-1",
		updatedBy: "account-123",
		request: {
			nodeId: node.id,
			criticality: "UNKNOWN",
		},
	});

	assert.equal(getSavedNode()?.attributes.criticality, "UNKNOWN");
});

test("rejects a missing graph node", async () => {
	const { repository } = createRepository(null);
	const service = new CriticalityService(repository);

	await assert.rejects(
		() =>
			service.updateCriticality({
				tenantId: "tenant-1",
				updatedBy: "account-123",
				request: {
					nodeId: "jira:issue:99999",
					criticality: "HIGH",
				},
			}),
		CriticalityNodeNotFoundError,
	);
});

test("rejects a node belonging to another tenant", async () => {
	const node = {
		...createNode(),
		tenantId: "tenant-2",
	};

	const { repository } = createRepository(node);
	const service = new CriticalityService(repository);

	await assert.rejects(
		() =>
			service.updateCriticality({
				tenantId: "tenant-1",
				updatedBy: "account-123",
				request: {
					nodeId: node.id,
					criticality: "HIGH",
				},
			}),
		CriticalityValidationError,
	);
});

test("rejects unsupported node types", async () => {
	const node = createNode({}, "DOCUMENT");
	const { repository } = createRepository(node);
	const service = new CriticalityService(repository);

	await assert.rejects(
		() =>
			service.updateCriticality({
				tenantId: "tenant-1",
				updatedBy: "account-123",
				request: {
					nodeId: node.id,
					criticality: "HIGH",
				},
			}),
		CriticalityValidationError,
	);
});

test("rejects an empty updater account ID", async () => {
	const node = createNode();
	const { repository } = createRepository(node);
	const service = new CriticalityService(repository);

	await assert.rejects(
		() =>
			service.updateCriticality({
				tenantId: "tenant-1",
				updatedBy: " ",
				request: {
					nodeId: node.id,
					criticality: "HIGH",
				},
			}),
		CriticalityValidationError,
	);
});
