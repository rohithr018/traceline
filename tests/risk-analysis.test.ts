import test from "node:test";
import assert from "node:assert/strict";

import type { GraphNode } from "../src/graph/models/graph-node";
import type { GraphEdge } from "../src/graph/models/graph-edge";
import type { ImpactAnalysisResult } from "../src/impact/models/impact-analysis";

import { RiskAnalysisService } from "../src/risk/services/risk-analysis-service";
import {
	getRiskLevel,
	scoreRiskFindings,
} from "../src/risk/services/risk-scoring";

const tenantId = "tenant-1";

function makeNode(id: string, criticality?: string): GraphNode {
	return {
		id,
		tenantId,
		type: "SERVICE",
		source: "USER",
		name: id,
		attributes: criticality ? { criticality } : {},
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
		tenantId,
		sourceNodeId,
		targetNodeId,
		type: "DEPENDS_ON",
		weight: 1,
		confidence: 1,
		provenance: { sourceSystem: "TEST" },
		createdAt: 1,
		updatedAt: 1,
	};
}

function makeAnalysis(
	findings: ImpactAnalysisResult["findings"],
): ImpactAnalysisResult {
	return {
		sourceNodeId: "source",
		analyzedAt: 1,
		findings,
		visitedNodeCount: findings.length + 1,
		truncated: false,
	};
}

test("risk levels use the configured thresholds", () => {
	assert.equal(getRiskLevel(0), "LOW");
	assert.equal(getRiskLevel(34.99), "LOW");
	assert.equal(getRiskLevel(35), "MEDIUM");
	assert.equal(getRiskLevel(59.99), "MEDIUM");
	assert.equal(getRiskLevel(60), "HIGH");
	assert.equal(getRiskLevel(80), "CRITICAL");
	assert.equal(getRiskLevel(100), "CRITICAL");
});

test("criticality metadata maps to the configured score", () => {
	const node = makeNode("service-1", "HIGH");

	const risks = scoreRiskFindings(
		[
			{
				nodeId: node.id,
				paths: [],
				minimumDepth: 1,
				strongestPathConfidence: 1,
				score: null,
				severity: null,
			},
		],
		[node],
		[],
	);

	assert.equal(risks[0].criticality, "HIGH");
	assert.equal(risks[0].factors.componentCriticality, 75);
});

test("unknown criticality uses a numeric fallback of 50", () => {
	const node = makeNode("service-1");

	const risks = scoreRiskFindings(
		[
			{
				nodeId: node.id,
				paths: [],
				minimumDepth: 1,
				strongestPathConfidence: 1,
				score: null,
				severity: null,
			},
		],
		[node],
		[],
	);

	assert.equal(risks[0].criticality, "UNKNOWN");
	assert.equal(risks[0].factors.componentCriticality, 50);
});

test("duplicate incoming edges do not inflate dependency centrality", () => {
	const node = makeNode("service-1");
	const dependency = makeNode("dependency-1");

	const edges = [
		makeEdge("edge-1", dependency.id, node.id),
		makeEdge("edge-2", dependency.id, node.id),
	];

	const risks = scoreRiskFindings(
		[
			{
				nodeId: node.id,
				paths: [],
				minimumDepth: 1,
				strongestPathConfidence: 1,
				score: null,
				severity: null,
			},
		],
		[node, dependency],
		edges,
	);

	assert.equal(risks[0].factors.dependencyCentrality, 10);
});

test("risk contributors expose weighted factor contributions", () => {
	const node = makeNode("service-1", "CRITICAL");

	const risks = scoreRiskFindings(
		[
			{
				nodeId: node.id,
				paths: [],
				minimumDepth: 1,
				strongestPathConfidence: 1,
				score: null,
				severity: null,
			},
		],
		[node],
		[],
	);

	assert.equal(risks[0].contributors.length, 5);

	const totalContribution = risks[0].contributors.reduce(
		(sum: number, item) => sum + item.contribution,
		0,
	);

	assert.equal(totalContribution, risks[0].score);
});

test("risk analysis calculates average, maximum and aggregate risk", async () => {
	const affected = [
		makeNode("affected-1", "CRITICAL"),
		makeNode("affected-2", "HIGH"),
		makeNode("affected-3", "LOW"),
	];

	const dependencies = Array.from({ length: 10 }, (_, index) =>
		makeNode(`dependency-${index}`),
	);

	const edges: GraphEdge[] = [];

	for (let i = 0; i < 10; i++) {
		edges.push(makeEdge(`edge-1-${i}`, dependencies[i].id, affected[0].id));
	}

	for (let i = 0; i < 5; i++) {
		edges.push(makeEdge(`edge-2-${i}`, dependencies[i].id, affected[1].id));
	}

	const impactAnalysis = makeAnalysis([
		{
			nodeId: "affected-1",
			paths: [],
			minimumDepth: 1,
			strongestPathConfidence: 1,
			score: null,
			severity: null,
		},
		{
			nodeId: "affected-2",
			paths: [],
			minimumDepth: 2,
			strongestPathConfidence: 0.8,
			score: null,
			severity: null,
		},
		{
			nodeId: "affected-3",
			paths: [],
			minimumDepth: 5,
			strongestPathConfidence: 0.5,
			score: null,
			severity: null,
		},
	]);

	const service = new RiskAnalysisService();

	const result = await service.analyze({
		tenantId,
		impactAnalysis,
		nodes: [...affected, ...dependencies],
		edges,
	});

	assert.equal(result.affectedNodeCount, 3);
	assert.equal(result.nodeRisks[0].nodeId, "affected-1");
	assert.equal(result.nodeRisks[0].score, 82.5);
	assert.equal(result.nodeRisks[1].score, 57.25);
	assert.equal(result.nodeRisks[2].score, 25.75);

	assert.equal(result.averageRisk, 55.17);
	assert.equal(result.maximumRisk, 82.5);
	assert.equal(result.overallScore, 66.1);
	assert.equal(result.overallLevel, "HIGH");
});

test("risk analysis rejects graph data from another tenant", async () => {
	const service = new RiskAnalysisService();

	await assert.rejects(
		() =>
			service.analyze({
				tenantId,
				impactAnalysis: makeAnalysis([]),
				nodes: [
					{
						...makeNode("foreign-node"),
						tenantId: "another-tenant",
					},
				],
				edges: [],
			}),
		/different tenant/,
	);
});
