import test from "node:test";
import assert from "node:assert/strict";

import type { GraphNode } from "../src/graph/models/graph-node";
import type { GraphEdge, EdgeType } from "../src/graph/models/graph-edge";
import type { GraphRepository } from "../src/graph/repository/graph-repository";

import { BitbucketChangeLinker } from "../src/integrations/bitbucket/bitbucket-change-linker";

class MemoryGraphRepository implements GraphRepository {
	private readonly nodes = new Map<string, GraphNode>();
	private readonly edges = new Map<string, GraphEdge>();

	constructor(nodes: GraphNode[] = []) {
		for (const node of nodes) {
			this.nodes.set(node.id, node);
		}
	}

	async upsertNode(node: GraphNode): Promise<void> {
		this.nodes.set(node.id, node);
	}

	async upsertEdge(edge: GraphEdge): Promise<void> {
		if (!this.nodes.has(edge.sourceNodeId)) {
			throw new Error("Source node not found.");
		}

		if (!this.nodes.has(edge.targetNodeId)) {
			throw new Error("Target node not found.");
		}

		this.edges.set(edge.id, edge);
	}

	async deleteEdge(tenantId: string, edgeId: string): Promise<boolean> {
		const edge = this.edges.get(edgeId);

		if (!edge || edge.tenantId !== tenantId) {
			return false;
		}

		return this.edges.delete(edgeId);
	}

	async getNode(tenantId: string, nodeId: string): Promise<GraphNode | null> {
		const node = this.nodes.get(nodeId);

		return node?.tenantId === tenantId ? node : null;
	}

	async getOutgoingEdges(
		tenantId: string,
		nodeId: string,
		types?: EdgeType[],
	): Promise<GraphEdge[]> {
		return [...this.edges.values()].filter(
			(edge) =>
				edge.tenantId === tenantId &&
				edge.sourceNodeId === nodeId &&
				(!types || types.includes(edge.type)),
		);
	}

	async getIncomingEdges(
		tenantId: string,
		nodeId: string,
		types?: EdgeType[],
	): Promise<GraphEdge[]> {
		return [...this.edges.values()].filter(
			(edge) =>
				edge.tenantId === tenantId &&
				edge.targetNodeId === nodeId &&
				(!types || types.includes(edge.type)),
		);
	}

	async listNodes(tenantId: string): Promise<GraphNode[]> {
		return [...this.nodes.values()].filter(
			(node) => node.tenantId === tenantId,
		);
	}

	async listEdges(tenantId: string): Promise<GraphEdge[]> {
		return [...this.edges.values()].filter(
			(edge) => edge.tenantId === tenantId,
		);
	}
}

function createNode(
	input: Partial<GraphNode> &
		Pick<GraphNode, "id" | "type" | "source" | "name">,
): GraphNode {
	return {
		id: input.id,
		tenantId: input.tenantId ?? "tenant-1",
		type: input.type,
		source: input.source,
		name: input.name,
		externalId: input.externalId,
		url: input.url,
		description: input.description,
		attributes: input.attributes ?? {},
		createdAt: 1,
		updatedAt: 1,
		lastSyncedAt: 1,
	};
}

function createPullRequest(
	id: string,
	changedFiles: unknown[],
	repositoryUuid = "{repo-1}",
): GraphNode {
	return createNode({
		id,
		type: "PULL_REQUEST",
		source: "BITBUCKET",
		name: "Add payment changes",
		url: "https://bitbucket.org/example/repo/pull-requests/1",
		attributes: {
			repositoryUuid,
			changedFiles,
		},
	});
}

function createService(
	id: string,
	name: string,
	pathPrefix: string,
	repositoryUuid = "{repo-1}",
	tenantId = "tenant-1",
): GraphNode {
	return createNode({
		id,
		tenantId,
		type: "SERVICE",
		source: "USER",
		name,
		attributes: {
			bitbucketSourceMappings: [
				{
					repositoryUuid,
					pathPrefix,
				},
			],
		},
	});
}

test("creates a MODIFIES edge for a matching changed file", async () => {
	const pullRequest = createPullRequest("pr-1", [
		{
			path: "src/payment/transaction.ts",
			oldPath: "src/payment/transaction.ts",
			newPath: "src/payment/transaction.ts",
		},
	]);

	const service = createService("service-1", "Payment", "src/payment/");

	const repository = new MemoryGraphRepository([pullRequest, service]);

	const linker = new BitbucketChangeLinker(repository);

	const result = await linker.linkPullRequestsToServices("tenant-1");
	const edges = await repository.listEdges("tenant-1");

	assert.equal(result.scannedPullRequests, 1);
	assert.equal(result.changedFiles, 1);
	assert.equal(result.matchedFiles, 1);
	assert.equal(result.persistedEdges, 1);

	assert.equal(edges.length, 1);
	assert.equal(edges[0].sourceNodeId, "pr-1");
	assert.equal(edges[0].targetNodeId, "service-1");
	assert.equal(edges[0].type, "MODIFIES");
	assert.equal(edges[0].confidence, 0.95);
	assert.match(
		edges[0].provenance.evidenceText ?? "",
		/src\/payment\/transaction\.ts/,
	);
});

test("reports files without a matching service mapping", async () => {
	const pullRequest = createPullRequest("pr-1", [
		{
			path: "src/unknown/file.ts",
		},
	]);

	const service = createService("service-1", "Payment", "src/payment/");

	const repository = new MemoryGraphRepository([pullRequest, service]);

	const linker = new BitbucketChangeLinker(repository);

	const result = await linker.linkPullRequestsToServices("tenant-1");

	assert.equal(result.changedFiles, 1);
	assert.equal(result.matchedFiles, 0);
	assert.equal(result.persistedEdges, 0);
	assert.deepEqual(result.unmatchedFiles, [
		{
			pullRequestNodeId: "pr-1",
			filePath: "src/unknown/file.ts",
		},
	]);
});

test("aggregates multiple changed files into one PR-service edge", async () => {
	const pullRequest = createPullRequest("pr-1", [
		{ path: "src/payment/a.ts" },
		{ path: "src/payment/b.ts" },
	]);

	const service = createService("service-1", "Payment", "src/payment/");

	const repository = new MemoryGraphRepository([pullRequest, service]);

	const linker = new BitbucketChangeLinker(repository);

	const result = await linker.linkPullRequestsToServices("tenant-1");
	const edges = await repository.listEdges("tenant-1");

	assert.equal(result.matchedFiles, 2);
	assert.equal(result.persistedEdges, 1);
	assert.equal(edges.length, 1);

	assert.match(edges[0].provenance.evidenceText ?? "", /a\.ts/);
	assert.match(edges[0].provenance.evidenceText ?? "", /b\.ts/);
});

test("maps both old and new paths for renamed files", async () => {
	const pullRequest = createPullRequest("pr-1", [
		{
			oldPath: "src/legacy/payment.ts",
			newPath: "src/payment/payment.ts",
			path: "src/payment/payment.ts",
		},
	]);

	const oldService = createService("service-old", "Legacy", "src/legacy/");

	const newService = createService("service-new", "Payment", "src/payment/");

	const repository = new MemoryGraphRepository([
		pullRequest,
		oldService,
		newService,
	]);

	const linker = new BitbucketChangeLinker(repository);

	const result = await linker.linkPullRequestsToServices("tenant-1");
	const edges = await repository.listEdges("tenant-1");

	assert.equal(result.changedFiles, 2);
	assert.equal(result.matchedFiles, 2);
	assert.equal(result.persistedEdges, 2);

	assert.deepEqual(edges.map((edge) => edge.targetNodeId).sort(), [
		"service-new",
		"service-old",
	]);
});

test("does not create edges for services in another tenant", async () => {
	const pullRequest = createPullRequest("pr-1", [
		{ path: "src/payment/file.ts" },
	]);

	const otherTenantService = createService(
		"service-other",
		"Other tenant payment",
		"src/payment/",
		"{repo-1}",
		"tenant-2",
	);

	const repository = new MemoryGraphRepository([
		pullRequest,
		otherTenantService,
	]);

	const linker = new BitbucketChangeLinker(repository);

	const result = await linker.linkPullRequestsToServices("tenant-1");

	assert.equal(result.persistedEdges, 0);
	assert.equal(result.unmatchedFiles.length, 1);
	assert.deepEqual(await repository.listEdges("tenant-1"), []);
});

test("repeated linking is idempotent", async () => {
	const pullRequest = createPullRequest("pr-1", [
		{ path: "src/payment/file.ts" },
	]);

	const service = createService("service-1", "Payment", "src/payment/");

	const repository = new MemoryGraphRepository([pullRequest, service]);

	const linker = new BitbucketChangeLinker(repository);

	await linker.linkPullRequestsToServices("tenant-1");
	await linker.linkPullRequestsToServices("tenant-1");

	const edges = await repository.listEdges("tenant-1");

	assert.equal(edges.length, 1);
});

test("reconciles a service relationship removed by a later pull request update", async () => {
	const pullRequest = createPullRequest("pr-1", [
		{
			path: "src/payment/transaction.ts",
			newPath: "src/payment/transaction.ts",
		},
	]);

	const payment = createService("service-payment", "Payment", "src/payment/");
	const notifications = createService(
		"service-notifications",
		"Notifications",
		"src/notifications/",
	);
	const repository = new MemoryGraphRepository([pullRequest, payment, notifications]);
	const linker = new BitbucketChangeLinker(repository);

	await linker.linkPullRequestsToServices("tenant-1", "pr-1");

	await repository.upsertNode({
		...pullRequest,
		attributes: {
			...pullRequest.attributes,
			changedFiles: [
				{
					path: "src/notifications/send.ts",
					newPath: "src/notifications/send.ts",
				},
			],
		},
	});

	const result = await linker.linkPullRequestsToServices("tenant-1", "pr-1");
	const edges = await repository.listEdges("tenant-1");

	assert.equal(result.staleEdgesRemoved, 1);
	assert.equal(edges.length, 1);
	assert.equal(edges[0].targetNodeId, "service-notifications");
});

test("rejects an empty tenant ID", async () => {
	const linker = new BitbucketChangeLinker(new MemoryGraphRepository());

	await assert.rejects(
		() => linker.linkPullRequestsToServices(" "),
		/Tenant ID is required/,
	);
});
