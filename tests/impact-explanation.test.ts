import assert from "node:assert/strict";
import test from "node:test";

import type { GraphEdge } from "../src/graph/models/graph-edge";
import type { GraphNode } from "../src/graph/models/graph-node";
import type { ImpactFinding } from "../src/impact/models/impact-analysis";
import { explainImpactFindings } from "../src/impact/services/impact-explanation";

function makeNode(id: string, name: string): GraphNode {
	return {
		id,
		tenantId: "tenant-1",
		type: "ISSUE",
		source: "JIRA",
		externalId: id,
		name,
		url: `https://example.atlassian.net/browse/${id}`,
		attributes: {},
		createdAt: 1,
		updatedAt: 1,
		lastSyncedAt: 1,
	};
}

function makeEdge(
	id: string,
	sourceNodeId: string,
	targetNodeId: string,
): GraphEdge {
	return {
		id,
		tenantId: "tenant-1",
		sourceNodeId,
		targetNodeId,
		type: "BLOCKS",
		weight: 1,
		confidence: 0.9,
		provenance: {
			sourceSystem: "JIRA",
			externalReference: "link-123",
			evidenceText: "Blocks relationship from Jira",
		},
		createdAt: 1,
		updatedAt: 1,
	};
}

function makeFinding(): ImpactFinding {
	return {
		nodeId: "PROJ-2",
		paths: [
			{
				nodeIds: ["PROJ-1", "PROJ-2"],
				edgeIds: ["edge-1"],
				depth: 1,
				confidence: 0.9,
			},
		],
		minimumDepth: 1,
		strongestPathConfidence: 0.9,
		score: 90,
		severity: "CRITICAL",
	};
}

test("creates a readable explanation for an affected node", () => {
	const result = explainImpactFindings(
		[makeFinding()],
		[
			makeNode("PROJ-1", "Authentication Service"),
			makeNode("PROJ-2", "Payment Service"),
		],
		[makeEdge("edge-1", "PROJ-1", "PROJ-2")],
	);

	assert.match(
		result[0].explanation!,
		/Authentication Service --BLOCKS--> Payment Service/,
	);
});

test("preserves relationship provenance and evidence text", () => {
	const result = explainImpactFindings(
		[makeFinding()],
		[
			makeNode("PROJ-1", "Authentication Service"),
			makeNode("PROJ-2", "Payment Service"),
		],
		[makeEdge("edge-1", "PROJ-1", "PROJ-2")],
	);

	const relationship = result[0].evidence![0].relationships[0];

	assert.equal(relationship.sourceSystem, "JIRA");
	assert.equal(relationship.externalReference, "link-123");
	assert.equal(relationship.evidenceText, "Blocks relationship from Jira");
});

test("includes node URLs in evidence", () => {
	const result = explainImpactFindings(
		[makeFinding()],
		[
			makeNode("PROJ-1", "Authentication Service"),
			makeNode("PROJ-2", "Payment Service"),
		],
		[makeEdge("edge-1", "PROJ-1", "PROJ-2")],
	);

	assert.equal(
		result[0].evidence![0].nodes[1].url,
		"https://example.atlassian.net/browse/PROJ-2",
	);
});

test("preserves all alternative paths", () => {
	const finding: ImpactFinding = {
		...makeFinding(),
		paths: [
			...makeFinding().paths,
			{
				nodeIds: ["PROJ-1", "PROJ-3", "PROJ-2"],
				edgeIds: ["edge-2", "edge-3"],
				depth: 2,
				confidence: 0.8,
			},
		],
	};

	const result = explainImpactFindings(
		[finding],
		[
			makeNode("PROJ-1", "Authentication Service"),
			makeNode("PROJ-2", "Payment Service"),
			makeNode("PROJ-3", "API Gateway"),
		],
		[
			makeEdge("edge-1", "PROJ-1", "PROJ-2"),
			makeEdge("edge-2", "PROJ-1", "PROJ-3"),
			makeEdge("edge-3", "PROJ-3", "PROJ-2"),
		],
	);

	assert.equal(result[0].evidence!.length, 2);
	assert.equal(result[0].evidence![1].relationships.length, 2);
});

test("handles missing graph nodes and edges gracefully", () => {
	const result = explainImpactFindings(
		[makeFinding()],
		[makeNode("PROJ-1", "Authentication Service")],
		[],
	);

	const evidence = result[0].evidence![0];

	assert.equal(evidence.nodes[1].name, "PROJ-2");
	assert.equal(evidence.nodes[1].type, null);
	assert.equal(evidence.relationships[0].type, null);
	assert.match(result[0].explanation!, /UNKNOWN_RELATIONSHIP/);
});

test("explains findings with no paths", () => {
	const finding: ImpactFinding = {
		...makeFinding(),
		paths: [],
		minimumDepth: 0,
		strongestPathConfidence: 0,
	};

	const result = explainImpactFindings([finding], [], []);

	assert.equal(result[0].evidence!.length, 0);
	assert.match(result[0].explanation!, /no supporting path/i);
});

test("preserves existing score and severity", () => {
	const result = explainImpactFindings(
		[makeFinding()],
		[
			makeNode("PROJ-1", "Authentication Service"),
			makeNode("PROJ-2", "Payment Service"),
		],
		[makeEdge("edge-1", "PROJ-1", "PROJ-2")],
	);

	assert.equal(result[0].score, 90);
	assert.equal(result[0].severity, "CRITICAL");
});

test("explains reverse dependency propagation as impact on a consumer", () => {
	const finding: ImpactFinding = {
		...makeFinding(),
		paths: [
			{
				nodeIds: ["PROJ-1", "PROJ-2"],
				edgeIds: ["dependency-edge"],
				depth: 1,
				confidence: 1,
			},
		],
	};

	const dependencyEdge = {
		...makeEdge("dependency-edge", "PROJ-2", "PROJ-1"),
		type: "DEPENDS_ON" as const,
	};

	const result = explainImpactFindings(
		[finding],
		[
			makeNode("PROJ-1", "Payment Service"),
			makeNode("PROJ-2", "Checkout Service"),
		],
		[dependencyEdge],
	);

	assert.equal(result[0].evidence![0].relationships[0].propagatedToDependent, true);
	assert.match(
		result[0].explanation!,
		/Payment Service --IMPACTS_DEPENDENT--> Checkout Service/,
	);
});
