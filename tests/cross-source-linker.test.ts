import test from "node:test";
import assert from "node:assert/strict";

import { createGraphNode } from "../src/graph/models/graph-node";
import type { GraphNode } from "../src/graph/models/graph-node";
import type { GraphEdge } from "../src/graph/models/graph-edge";
import type { GraphRepository } from "../src/graph/repository/graph-repository";

import { extractJiraIssueKeys } from "../src/integrations/confluence/jira-reference-extractor";
import { CrossSourceLinker } from "../src/integrations/confluence/cross-source-linker";

class FakeRepository implements GraphRepository {
	nodes = new Map<string, GraphNode>();
	edges = new Map<string, GraphEdge>();

	async upsertNode(node: GraphNode): Promise<void> {
		this.nodes.set(node.id, node);
	}

	async upsertEdge(edge: GraphEdge): Promise<void> {
		this.edges.set(edge.id, edge);
	}

	async deleteEdge(tenantId: string, edgeId: string): Promise<boolean> {
		const edge = this.edges.get(edgeId);

		if (!edge || edge.tenantId !== tenantId) {
			return false;
		}

		return this.edges.delete(edgeId);
	}

	async getNode(id: string, tenantId: string): Promise<GraphNode | null> {
		const node = this.nodes.get(id);

		return node?.tenantId === tenantId ? node : null;
	}

	async getOutgoingEdges(
		_nodeId: string,
		_tenantId: string,
	): Promise<GraphEdge[]> {
		return [];
	}

	async getIncomingEdges(
		_nodeId: string,
		_tenantId: string,
	): Promise<GraphEdge[]> {
		return [];
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

function createJiraIssue(
	id: string,
	issueKey: string,
	tenantId = "tenant-1",
): GraphNode {
	return createGraphNode({
		id: `jira:issue:${id}`,
		tenantId,
		type: "ISSUE",
		source: "JIRA",
		externalId: issueKey,
		name: `Issue ${issueKey}`,
		attributes: {
			issueKey,
		},
	});
}

function createDocument(
	id: string,
	content: string,
	tenantId = "tenant-1",
): GraphNode {
	return createGraphNode({
		id: `confluence:page:${id}`,
		tenantId,
		type: "DOCUMENT",
		source: "CONFLUENCE",
		externalId: id,
		name: "Architecture Document",
		description: content,
		attributes: {
			storageBody: content,
		},
	});
}

test("extracts Jira issue keys from plain text", () => {
	const keys = extractJiraIssueKeys(
		"This document covers AUTH-101 and AUTH-102.",
	);

	assert.deepEqual(keys, ["AUTH-101", "AUTH-102"]);
});

test("extracts Jira issue keys from Jira URLs", () => {
	const keys = extractJiraIssueKeys(
		"https://example.atlassian.net/browse/AUTH-103",
	);

	assert.deepEqual(keys, ["AUTH-103"]);
});

test("removes duplicate Jira references", () => {
	const keys = extractJiraIssueKeys(
		"AUTH-101, AUTH-101, https://example.atlassian.net/browse/AUTH-101",
	);

	assert.deepEqual(keys, ["AUTH-101"]);
});

test("normalizes Jira issue keys to uppercase", () => {
	const keys = extractJiraIssueKeys("auth-101 and Auth-102");

	assert.deepEqual(keys, ["AUTH-101", "AUTH-102"]);
});

test("creates DOCUMENTED_BY edges for resolved Jira issues", async () => {
	const repository = new FakeRepository();

	const issue = createJiraIssue("101", "AUTH-101");
	const document = createDocument(
		"500",
		"Authentication design covers AUTH-101.",
	);

	await repository.upsertNode(issue);
	await repository.upsertNode(document);

	const linker = new CrossSourceLinker(repository);

	const result = await linker.linkDocumentToJiraIssues(document);

	assert.equal(result.extractedReferences, 1);
	assert.equal(result.resolvedReferences, 1);
	assert.equal(result.createdEdges, 1);
	assert.deepEqual(result.unresolvedReferences, []);

	const edge = [...repository.edges.values()][0];

	assert.equal(edge.type, "DOCUMENTED_BY");
	assert.equal(edge.sourceNodeId, issue.id);
	assert.equal(edge.targetNodeId, document.id);
	assert.equal(edge.tenantId, "tenant-1");
	assert.equal(edge.provenance.sourceSystem, "CONFLUENCE");
});

test("reports unresolved Jira references without creating nodes", async () => {
	const repository = new FakeRepository();

	const document = createDocument("501", "This document references AUTH-999.");

	await repository.upsertNode(document);

	const linker = new CrossSourceLinker(repository);

	const result = await linker.linkDocumentToJiraIssues(document);

	assert.equal(result.extractedReferences, 1);
	assert.equal(result.resolvedReferences, 0);
	assert.deepEqual(result.unresolvedReferences, ["AUTH-999"]);
	assert.equal(repository.edges.size, 0);
	assert.equal(repository.nodes.size, 1);
});

test("does not create cross-tenant relationships", async () => {
	const repository = new FakeRepository();

	const issue = createJiraIssue("101", "AUTH-101", "tenant-2");

	const document = createDocument("502", "AUTH-101", "tenant-1");

	await repository.upsertNode(issue);
	await repository.upsertNode(document);

	const linker = new CrossSourceLinker(repository);

	const result = await linker.linkDocumentToJiraIssues(document);

	assert.equal(result.resolvedReferences, 0);
	assert.deepEqual(result.unresolvedReferences, ["AUTH-101"]);
	assert.equal(repository.edges.size, 0);
});

test("rejects non-Confluence document nodes", async () => {
	const repository = new FakeRepository();

	const issue = createJiraIssue("101", "AUTH-101");

	const linker = new CrossSourceLinker(repository);

	await assert.rejects(
		() => linker.linkDocumentToJiraIssues(issue),
		/requires a DOCUMENT node/,
	);
});

test("reprocessing a document upserts the same relationship", async () => {
	const repository = new FakeRepository();

	const issue = createJiraIssue("101", "AUTH-101");
	const document = createDocument("503", "AUTH-101");

	await repository.upsertNode(issue);
	await repository.upsertNode(document);

	const linker = new CrossSourceLinker(repository);

	await linker.linkDocumentToJiraIssues(document);
	await linker.linkDocumentToJiraIssues(document);

	assert.equal(repository.edges.size, 1);
});
