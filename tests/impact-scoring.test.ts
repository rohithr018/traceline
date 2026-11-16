import assert from "node:assert/strict";
import test from "node:test";

import type { GraphEdge } from "../src/graph/models/graph-edge";
import type { ImpactFinding } from "../src/impact/models/impact-analysis";
import { scoreImpactFindings } from "../src/impact/services/impact-scoring";

function makeEdge(id: string, type: GraphEdge["type"]): GraphEdge {
	return {
		id,
		tenantId: "tenant-1",
		sourceNodeId: "source",
		targetNodeId: `target-${id}`,
		type,
		weight: 1,
		confidence: 1,
		provenance: { sourceSystem: "TEST" },
		createdAt: 1,
		updatedAt: 1,
	};
}

function makeFinding(paths: ImpactFinding["paths"]): ImpactFinding {
	return {
		nodeId: "target",
		paths,
		minimumDepth: Math.min(...paths.map((path) => path.depth)),
		strongestPathConfidence: Math.max(...paths.map((path) => path.confidence)),
		score: null,
		severity: null,
	};
}

test("direct high-confidence BLOCKS path receives a critical score", () => {
	const finding = makeFinding([
		{
			nodeIds: ["source", "target"],
			edgeIds: ["edge-1"],
			depth: 1,
			confidence: 1,
		},
	]);

	const result = scoreImpactFindings([finding], [makeEdge("edge-1", "BLOCKS")]);

	assert.equal(result[0].score, 100);
	assert.equal(result[0].severity, "CRITICAL");
});

test("reduces scores for deeper paths", () => {
	const finding = makeFinding([
		{
			nodeIds: ["source", "a", "b"],
			edgeIds: ["edge-1", "edge-2"],
			depth: 2,
			confidence: 1,
		},
	]);

	const result = scoreImpactFindings(
		[finding],
		[makeEdge("edge-1", "BLOCKS"), makeEdge("edge-2", "BLOCKS")],
	);

	assert.equal(result[0].score, 75);
});

test("uses path confidence in the score", () => {
	const finding = makeFinding([
		{
			nodeIds: ["source", "target"],
			edgeIds: ["edge-1"],
			depth: 1,
			confidence: 0.6,
		},
	]);

	const result = scoreImpactFindings([finding], [makeEdge("edge-1", "BLOCKS")]);

	assert.equal(result[0].score, 60);
	assert.equal(result[0].severity, "HIGH");
});

test("uses relationship relevance in the score", () => {
	const finding = makeFinding([
		{
			nodeIds: ["source", "target"],
			edgeIds: ["edge-1"],
			depth: 1,
			confidence: 1,
		},
	]);

	const result = scoreImpactFindings(
		[finding],
		[makeEdge("edge-1", "RELATED_TO")],
	);

	assert.equal(result[0].score, 35);
	assert.equal(result[0].severity, "MEDIUM");
});

test("selects the strongest path instead of summing paths", () => {
	const finding = makeFinding([
		{
			nodeIds: ["source", "a", "target"],
			edgeIds: ["edge-1", "edge-2"],
			depth: 2,
			confidence: 1,
		},
		{
			nodeIds: ["source", "target"],
			edgeIds: ["edge-3"],
			depth: 1,
			confidence: 0.8,
		},
	]);

	const result = scoreImpactFindings(
		[finding],
		[
			makeEdge("edge-1", "BLOCKS"),
			makeEdge("edge-2", "BLOCKS"),
			makeEdge("edge-3", "BLOCKS"),
		],
	);

	assert.equal(result[0].score, 80);
	assert.equal(result[0].severity, "CRITICAL");
});

test("rejects an invalid depth decay", () => {
	assert.throws(
		() => scoreImpactFindings([], [], { depthDecay: 1.5 }),
		/depthDecay must be between 0 and 1/,
	);
});

test("rejects invalid relationship weights", () => {
	assert.throws(
		() =>
			scoreImpactFindings([], [], {
				relationshipWeights: { BLOCKS: 2 },
			}),
		/Relationship weight for BLOCKS must be between 0 and 1/,
	);
});
