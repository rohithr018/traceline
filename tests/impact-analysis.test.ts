import test from "node:test";
import assert from "node:assert/strict";

import { createImpactAnalysisResult } from "../src/impact/models/impact-analysis";

import { validateImpactRequest } from "../src/impact/validation/impact-request-validator";

import type { ImpactResult } from "../src/graph/algorithms/impact-traversal";

test("validates a valid impact analysis request", () => {
	assert.doesNotThrow(() => {
		validateImpactRequest({
			tenantId: "tenant-1",
			sourceNodeId: "jira:issue:101",
			maxDepth: 5,
			maxVisitedNodes: 1000,
			maxPathsPerNode: 3,
			minConfidence: 0.5,
			propagationTypes: ["BLOCKS", "DEPENDS_ON"],
		});
	});
});

test("rejects an empty tenant ID", () => {
	assert.throws(
		() =>
			validateImpactRequest({
				tenantId: " ",
				sourceNodeId: "jira:issue:101",
			}),
		/Tenant ID is required/,
	);
});

test("rejects an empty source node ID", () => {
	assert.throws(
		() =>
			validateImpactRequest({
				tenantId: "tenant-1",
				sourceNodeId: "",
			}),
		/Source node ID is required/,
	);
});

test("rejects invalid confidence thresholds", () => {
	assert.throws(
		() =>
			validateImpactRequest({
				tenantId: "tenant-1",
				sourceNodeId: "jira:issue:101",
				minConfidence: 1.5,
			}),
		/minConfidence must be between 0 and 1/,
	);
});

test("rejects invalid propagation edge types", () => {
	assert.throws(
		() =>
			validateImpactRequest({
				tenantId: "tenant-1",
				sourceNodeId: "jira:issue:101",
				propagationTypes: ["INVALID" as never],
			}),
		/Invalid propagation edge type/,
	);
});

test("converts traversal paths into ordered impact findings", () => {
	const traversal: ImpactResult = {
		sourceNodeId: "jira:issue:101",
		affectedNodeIds: ["jira:issue:103", "jira:issue:102"],
		paths: {
			"jira:issue:103": [
				{
					nodeIds: ["jira:issue:101", "jira:issue:102", "jira:issue:103"],
					edgeIds: ["edge-1", "edge-2"],
					depth: 2,
					confidence: 0.7,
				},
			],
			"jira:issue:102": [
				{
					nodeIds: ["jira:issue:101", "jira:issue:102"],
					edgeIds: ["edge-1"],
					depth: 1,
					confidence: 0.9,
				},
				{
					nodeIds: ["jira:issue:101", "jira:issue:104", "jira:issue:102"],
					edgeIds: ["edge-3", "edge-4"],
					depth: 2,
					confidence: 0.8,
				},
			],
		},
		visitedNodeCount: 4,
		truncated: false,
	};

	const result = createImpactAnalysisResult(traversal, 1760000000000);

	assert.equal(result.sourceNodeId, "jira:issue:101");
	assert.equal(result.analyzedAt, 1760000000000);
	assert.equal(result.findings.length, 2);

	assert.equal(result.findings[0].nodeId, "jira:issue:102");

	assert.equal(result.findings[0].minimumDepth, 1);
	assert.equal(result.findings[0].strongestPathConfidence, 0.9);

	assert.equal(result.findings[1].nodeId, "jira:issue:103");

	assert.equal(result.findings[1].minimumDepth, 2);
});

test("leaves scoring fields unset before scoring phase", () => {
	const traversal: ImpactResult = {
		sourceNodeId: "jira:issue:101",
		affectedNodeIds: ["jira:issue:102"],
		paths: {
			"jira:issue:102": [
				{
					nodeIds: ["jira:issue:101", "jira:issue:102"],
					edgeIds: ["edge-1"],
					depth: 1,
					confidence: 0.9,
				},
			],
		},
		visitedNodeCount: 2,
		truncated: false,
	};

	const result = createImpactAnalysisResult(traversal);

	assert.equal(result.findings[0].score, null);
	assert.equal(result.findings[0].severity, null);
});
