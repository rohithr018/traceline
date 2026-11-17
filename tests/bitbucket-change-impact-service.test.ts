import test from "node:test";
import assert from "node:assert/strict";

import type { GraphNode } from "../src/graph/models/graph-node";
import type { GraphEdge, EdgeType } from "../src/graph/models/graph-edge";
import type { GraphRepository } from "../src/graph/repository/graph-repository";
import type { ImpactAnalysisRequest } from "../src/impact/models/impact-analysis";

import { BitbucketChangeImpactService } from "../src/integrations/bitbucket/bitbucket-change-impact-service";

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

function createNode(input: {
	id: string;
	type: GraphNode["type"];
	source: GraphNode["source"];
	name: string;
	tenantId?: string;
	url?: string;
	attributes?: Record<string, unknown>;
}): GraphNode {
	return {
		id: input.id,
		tenantId: input.tenantId ?? "tenant-1",
		type: input.type,
		source: input.source,
		name: input.name,
		...(input.url ? { url: input.url } : {}),
		attributes: input.attributes ?? {},
		createdAt: 1,
		updatedAt: 1,
		lastSyncedAt: 1,
	};
}

function createPullRequest(
	id = "pr-1",
	tenantId = "tenant-1",
	changedFiles: unknown[] = [
		{
			path: "src/payment/transaction.ts",
			oldPath: "src/payment/transaction.ts",
			newPath: "src/payment/transaction.ts",
		},
	],
): GraphNode {
	return createNode({
		id,
		tenantId,
		type: "PULL_REQUEST",
		source: "BITBUCKET",
		name: "Update payment transaction",
		url: "https://bitbucket.org/example/repo/pull-requests/1",
		attributes: {
			repositoryUuid: "{repo-1}",
			changedFiles,
		},
	});
}

function createService(
	id = "service-payment",
	tenantId = "tenant-1",
): GraphNode {
	return createNode({
		id,
		tenantId,
		type: "SERVICE",
		source: "USER",
		name: "Payment Service",
		attributes: {
			bitbucketSourceMappings: [
				{
					repositoryUuid: "{repo-1}",
					pathPrefix: "src/payment/",
				},
			],
		},
	});
}

function createRunner() {
	const requests: ImpactAnalysisRequest[] = [];

	return {
		requests,
		runner: {
			async analyze(request: ImpactAnalysisRequest) {
				requests.push(request);

				return {
					sourceNodeId: request.sourceNodeId,
					findings: [],
				};
			},
		},
	};
}

test("links changed files before invoking impact analysis", async () => {
	const pullRequest = createPullRequest();
	const service = createService();

	const repository = new MemoryGraphRepository([pullRequest, service]);

	const fake = createRunner();

	const impactService = new BitbucketChangeImpactService(
		repository,
		fake.runner,
	);

	const result = await impactService.analyzePullRequest({
		tenantId: "tenant-1",
		pullRequestNodeId: "pr-1",
	});

	const edges = await repository.listEdges("tenant-1");

	assert.equal(result.pullRequest.id, "pr-1");
	assert.equal(result.mapping.changedFiles, 1);
	assert.equal(result.mapping.matchedFiles, 1);
	assert.equal(result.mapping.persistedEdges, 1);

	assert.equal(edges.length, 1);
	assert.equal(edges[0].sourceNodeId, "pr-1");
	assert.equal(edges[0].targetNodeId, "service-payment");
	assert.equal(edges[0].type, "MODIFIES");

	assert.equal(fake.requests.length, 1);
	assert.equal(fake.requests[0].sourceNodeId, "pr-1");
	assert.equal(fake.requests[0].tenantId, "tenant-1");
});

test("passes traversal limits to the existing analysis runner", async () => {
	const repository = new MemoryGraphRepository([
		createPullRequest(),
		createService(),
	]);

	const fake = createRunner();

	const impactService = new BitbucketChangeImpactService(
		repository,
		fake.runner,
	);

	await impactService.analyzePullRequest({
		tenantId: "tenant-1",
		pullRequestNodeId: "pr-1",
		maxDepth: 4,
		maxVisitedNodes: 100,
		maxPathsPerNode: 3,
		minConfidence: 0.5,
		propagationTypes: ["MODIFIES", "DEPENDS_ON", "IMPLEMENTS"],
		reverseDependencyEdges: true,
	});

	assert.deepEqual(fake.requests[0], {
		tenantId: "tenant-1",
		sourceNodeId: "pr-1",
		maxDepth: 4,
		maxVisitedNodes: 100,
		maxPathsPerNode: 3,
		minConfidence: 0.5,
		propagationTypes: ["MODIFIES", "DEPENDS_ON", "IMPLEMENTS"],
		reverseDependencyEdges: true,
	});
});

test("links Jira references as part of pull request analysis", async () => {
	const pullRequest = createPullRequest();
	pullRequest.name = "ABC-123: Update payment transaction";
	const issue = createNode({
		id: "jira:issue:123",
		type: "ISSUE",
		source: "JIRA",
		name: "ABC-123",
		attributes: { issueKey: "ABC-123" },
	});
	const repository = new MemoryGraphRepository([
		pullRequest,
		createService(),
		issue,
	]);
	const impactService = new BitbucketChangeImpactService(
		repository,
		createRunner().runner,
	);

	const result = await impactService.analyzePullRequest({
		tenantId: "tenant-1",
		pullRequestNodeId: "pr-1",
	});

	assert.equal(result.mapping.linkedJiraReferences, 1);
	assert.equal(result.mapping.unresolvedJiraReferences, 0);
	assert.equal(
		(await repository.getOutgoingEdges("tenant-1", "pr-1", ["IMPLEMENTS"]))
			.length,
		1,
	);
});

test("returns unmatched files without inventing service relationships", async () => {
	const pullRequest = createPullRequest("pr-1", "tenant-1", [
		{ path: "src/unknown/file.ts" },
	]);

	const repository = new MemoryGraphRepository([pullRequest, createService()]);

	const fake = createRunner();

	const impactService = new BitbucketChangeImpactService(
		repository,
		fake.runner,
	);

	const result = await impactService.analyzePullRequest({
		tenantId: "tenant-1",
		pullRequestNodeId: "pr-1",
	});

	assert.equal(result.mapping.matchedFiles, 0);
	assert.equal(result.mapping.persistedEdges, 0);

	assert.deepEqual(result.mapping.unmatchedFiles, [
		{
			pullRequestNodeId: "pr-1",
			filePath: "src/unknown/file.ts",
		},
	]);

	assert.deepEqual(await repository.listEdges("tenant-1"), []);

	// Analysis can still run; it simply has no mapped service
	// from which to propagate impact.
	assert.equal(fake.requests.length, 1);
});

test("does not process another pull request in the same tenant", async () => {
	const repository = new MemoryGraphRepository([
		createPullRequest("pr-1"),
		createPullRequest("pr-2", "tenant-1", [{ path: "src/payment/another.ts" }]),
		createService(),
	]);

	const fake = createRunner();

	const impactService = new BitbucketChangeImpactService(
		repository,
		fake.runner,
	);

	await impactService.analyzePullRequest({
		tenantId: "tenant-1",
		pullRequestNodeId: "pr-1",
	});

	const edges = await repository.listEdges("tenant-1");

	assert.equal(edges.length, 1);
	assert.equal(edges[0].sourceNodeId, "pr-1");
	assert.equal(fake.requests.length, 1);
	assert.equal(fake.requests[0].sourceNodeId, "pr-1");
});

test("does not access a pull request belonging to another tenant", async () => {
	const repository = new MemoryGraphRepository([
		createPullRequest("pr-other", "tenant-2"),
		createService("service-payment", "tenant-2"),
	]);

	const fake = createRunner();

	const impactService = new BitbucketChangeImpactService(
		repository,
		fake.runner,
	);

	await assert.rejects(
		() =>
			impactService.analyzePullRequest({
				tenantId: "tenant-1",
				pullRequestNodeId: "pr-other",
			}),
		/Pull request was not found/,
	);

	assert.equal(fake.requests.length, 0);
});

test("rejects a Jira issue as the source of Bitbucket change analysis", async () => {
	const issue = createNode({
		id: "jira:issue:100",
		type: "ISSUE",
		source: "JIRA",
		name: "ABC-100",
	});

	const repository = new MemoryGraphRepository([issue]);
	const fake = createRunner();

	const impactService = new BitbucketChangeImpactService(
		repository,
		fake.runner,
	);

	await assert.rejects(
		() =>
			impactService.analyzePullRequest({
				tenantId: "tenant-1",
				pullRequestNodeId: "jira:issue:100",
			}),
		/requires a Bitbucket pull request/,
	);

	assert.equal(fake.requests.length, 0);
});

test("rejects a missing pull request", async () => {
	const repository = new MemoryGraphRepository();
	const fake = createRunner();

	const impactService = new BitbucketChangeImpactService(
		repository,
		fake.runner,
	);

	await assert.rejects(
		() =>
			impactService.analyzePullRequest({
				tenantId: "tenant-1",
				pullRequestNodeId: "missing-pr",
			}),
		/Pull request was not found/,
	);

	assert.equal(fake.requests.length, 0);
});

test("rejects an empty tenant ID", async () => {
	const impactService = new BitbucketChangeImpactService(
		new MemoryGraphRepository(),
		createRunner().runner,
	);

	await assert.rejects(
		() =>
			impactService.analyzePullRequest({
				tenantId: " ",
				pullRequestNodeId: "pr-1",
			}),
		/Tenant ID is required/,
	);
});

test("rejects an empty pull request ID", async () => {
	const impactService = new BitbucketChangeImpactService(
		new MemoryGraphRepository(),
		createRunner().runner,
	);

	await assert.rejects(
		() =>
			impactService.analyzePullRequest({
				tenantId: "tenant-1",
				pullRequestNodeId: " ",
			}),
		/Pull request node ID is required/,
	);
});

test("does not invoke analysis if source mapping metadata is malformed", async () => {
	const pullRequest = createPullRequest();

	const malformedService = createNode({
		id: "service-invalid",
		type: "SERVICE",
		source: "USER",
		name: "Invalid Service",
		attributes: {
			bitbucketSourceMappings: "not-an-array",
		},
	});

	const repository = new MemoryGraphRepository([pullRequest, malformedService]);

	const fake = createRunner();

	const impactService = new BitbucketChangeImpactService(
		repository,
		fake.runner,
	);

	await assert.rejects(
		() =>
			impactService.analyzePullRequest({
				tenantId: "tenant-1",
				pullRequestNodeId: "pr-1",
			}),
		/must be an array/,
	);

	assert.equal(fake.requests.length, 0);
});
