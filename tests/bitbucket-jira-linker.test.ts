import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createGraphNode } from "../src/graph/models/graph-node";
import type { GraphNode } from "../src/graph/models/graph-node";

import type { GraphEdge, EdgeType } from "../src/graph/models/graph-edge";

import type { GraphRepository } from "../src/graph/repository/graph-repository";

import { extractJiraKeys } from "../src/integrations/bitbucket/jira-key-extractor";
import { BitbucketJiraLinker } from "../src/integrations/bitbucket/bitbucket-jira-linker";

class MemoryGraphRepository implements GraphRepository {
	private nodes = new Map<string, GraphNode>();
	private edges = new Map<string, GraphEdge>();

	private key(tenantId: string, id: string): string {
		return `${tenantId}:${id}`;
	}

	async upsertNode(node: GraphNode): Promise<void> {
		this.nodes.set(this.key(node.tenantId, node.id), node);
	}

	async upsertEdge(edge: GraphEdge): Promise<void> {
		const source = await this.getNode(edge.tenantId, edge.sourceNodeId);
		const target = await this.getNode(edge.tenantId, edge.targetNodeId);

		if (!source || !target) {
			throw new Error("Edge endpoint not found");
		}

		this.edges.set(this.key(edge.tenantId, edge.id), edge);
	}

	async deleteEdge(tenantId: string, edgeId: string): Promise<boolean> {
		return this.edges.delete(this.key(tenantId, edgeId));
	}

	async getNode(tenantId: string, nodeId: string): Promise<GraphNode | null> {
		return this.nodes.get(this.key(tenantId, nodeId)) ?? null;
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

function makeJiraIssue(
	tenantId: string,
	key: string,
	placeholder = false,
): GraphNode {
	return createGraphNode({
		id: `jira:issue:${key}`,
		tenantId,
		type: "ISSUE",
		source: "JIRA",
		externalId: key,
		name: key,
		attributes: {
			issueKey: key,
			placeholder,
		},
	});
}

function makePullRequest(
	tenantId: string,
	id: number,
	title: string,
	description: string,
	commitMessages: string[],
): GraphNode {
	return createGraphNode({
		id: `bitbucket:pullrequest:repo-1:${id}`,
		tenantId,
		type: "PULL_REQUEST",
		source: "BITBUCKET",
		externalId: String(id),
		name: title,
		description,
		attributes: {
			commits: commitMessages.map((message) => ({ message })),
		},
	});
}

describe("extractJiraKeys", () => {
	it("extracts Jira keys and normalizes them", () => {
		const keys = extractJiraKeys("implements abc-123 and PLATFORM-42");

		assert.deepEqual(keys, ["ABC-123", "PLATFORM-42"]);
	});

	it("deduplicates keys", () => {
		const keys = extractJiraKeys("ABC-123 fixes ABC-123; commit: abc-123");

		assert.deepEqual(keys, ["ABC-123"]);
	});

	it("ignores Jira-like strings embedded in larger identifiers", () => {
		const keys = extractJiraKeys("ABC-1234suffix and ABC-123");

		assert.deepEqual(keys, ["ABC-123"]);
	});

	it("returns an empty array for empty input", () => {
		assert.deepEqual(extractJiraKeys(""), []);
		assert.deepEqual(extractJiraKeys(null), []);
		assert.deepEqual(extractJiraKeys(undefined), []);
	});
});

describe("BitbucketJiraLinker", () => {
	it("links resolved Jira issues and reports unresolved references", async () => {
		const repository = new MemoryGraphRepository();
		const tenantId = "tenant-1";

		await repository.upsertNode(makeJiraIssue(tenantId, "ABC-123"));

		await repository.upsertNode(makeJiraIssue(tenantId, "DEF-456", true));

		// This issue belongs to another tenant and must not be resolved.
		await repository.upsertNode(makeJiraIssue("tenant-2", "DEF-456"));

		await repository.upsertNode(
			makePullRequest(
				tenantId,
				10,
				"Implement ABC-123",
				"Also references DEF-456",
				["fix ABC-123"],
			),
		);

		const linker = new BitbucketJiraLinker(repository);
		const result = await linker.linkPullRequestsToJira(tenantId);

		assert.equal(result.scannedPullRequests, 1);
		assert.equal(result.extractedReferences, 2);
		assert.equal(result.resolvedReferences, 1);
		assert.equal(result.persistedEdges, 1);

		assert.deepEqual(result.unresolvedReferences, [
			{
				pullRequestId: "bitbucket:pullrequest:repo-1:10",
				jiraKey: "DEF-456",
			},
		]);

		const edges = await repository.listEdges(tenantId);

		assert.equal(edges.length, 1);
		assert.equal(edges[0].type, "IMPLEMENTS");
		assert.equal(edges[0].sourceNodeId, "bitbucket:pullrequest:repo-1:10");
		assert.equal(edges[0].targetNodeId, "jira:issue:ABC-123");
	});

	it("does not create duplicate edges on repeated linking", async () => {
		const repository = new MemoryGraphRepository();
		const tenantId = "tenant-1";

		await repository.upsertNode(makeJiraIssue(tenantId, "ABC-123"));

		await repository.upsertNode(
			makePullRequest(tenantId, 20, "ABC-123", "", []),
		);

		const linker = new BitbucketJiraLinker(repository);

		await linker.linkPullRequestsToJira(tenantId);
		await linker.linkPullRequestsToJira(tenantId);

		const edges = await repository.listEdges(tenantId);

		assert.equal(edges.length, 1);
	});

	it("reconciles a Jira relationship removed by a later pull request update", async () => {
		const repository = new MemoryGraphRepository();
		const tenantId = "tenant-1";

		await repository.upsertNode(makeJiraIssue(tenantId, "ABC-123"));
		await repository.upsertNode(makeJiraIssue(tenantId, "DEF-456"));
		await repository.upsertNode(
			makePullRequest(tenantId, 30, "ABC-123", "", []),
		);

		const linker = new BitbucketJiraLinker(repository);
		await linker.linkPullRequestsToJira(
			tenantId,
			"bitbucket:pullrequest:repo-1:30",
		);

		await repository.upsertNode(
			makePullRequest(tenantId, 30, "DEF-456", "", []),
		);

		const result = await linker.linkPullRequestsToJira(
			tenantId,
			"bitbucket:pullrequest:repo-1:30",
		);
		const edges = await repository.listEdges(tenantId);

		assert.equal(result.staleEdgesRemoved, 1);
		assert.equal(edges.length, 1);
		assert.equal(edges[0].targetNodeId, "jira:issue:DEF-456");
	});

	it("rejects an empty tenant ID", async () => {
		const linker = new BitbucketJiraLinker(new MemoryGraphRepository());

		await assert.rejects(
			() => linker.linkPullRequestsToJira(" "),
			/Tenant ID is required/,
		);
	});
});
