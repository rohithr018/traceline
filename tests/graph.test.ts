import test from "node:test";
import assert from "node:assert/strict";

import { buildSampleGraph } from "../fixtures/sample-graph";

import { ImpactTraversal } from "../src/graph/algorithms/impact-traversal";
import { CycleDetector } from "../src/graph/algorithms/cycle-detection";

import { createGraphNode } from "../src/graph/models/graph-node";
import { createGraphEdge } from "../src/graph/models/graph-edge";

import { GraphNodeNotFoundError } from "../src/graph/errors/graph-errors";

test("graph stores and retrieves nodes", async () => {
	const { repository, tenantId } = await buildSampleGraph();

	const node = await repository.getNode(tenantId, "payment-service");

	assert.ok(node);
	assert.equal(node.name, "Payment Service");
	assert.equal(node.type, "SERVICE");
});

test("graph returns outgoing relationships", async () => {
	const { repository, tenantId } = await buildSampleGraph();

	const edges = await repository.getOutgoingEdges(tenantId, "payment-service");

	assert.equal(edges.length, 3);
});

test("BFS discovers direct and transitive impact", async () => {
	const { repository, tenantId } = await buildSampleGraph();

	const traversal = new ImpactTraversal(repository);

	const result = await traversal.analyze({
		tenantId,
		sourceNodeId: "payment-service",
		maxDepth: 5,
	});

	assert.deepEqual(result.affectedNodeIds, [
		"billing-service",
		"checkout-service",
		"order-service",
	]);
});

test("BFS preserves alternative dependency paths", async () => {
	const { repository, tenantId } = await buildSampleGraph();

	const traversal = new ImpactTraversal(repository);

	const result = await traversal.analyze({
		tenantId,
		sourceNodeId: "payment-service",
	});

	assert.equal(result.paths["order-service"].length, 2);
});

test("non-propagation relationships are excluded", async () => {
	const { repository, tenantId } = await buildSampleGraph();

	const traversal = new ImpactTraversal(repository);

	const result = await traversal.analyze({
		tenantId,
		sourceNodeId: "payment-service",
	});

	assert.ok(!result.affectedNodeIds.includes("analytics-service"));

	assert.ok(!result.affectedNodeIds.includes("payment-incident-01"));
});

test("confidence threshold excludes weak relationships", async () => {
	const { repository, tenantId } = await buildSampleGraph();

	const traversal = new ImpactTraversal(repository);

	const result = await traversal.analyze({
		tenantId,
		sourceNodeId: "payment-service",
		minConfidence: 0.98,
	});

	assert.ok(!result.affectedNodeIds.includes("order-service"));
});

test("traversal respects maximum depth", async () => {
	const { repository, tenantId } = await buildSampleGraph();

	const traversal = new ImpactTraversal(repository);

	const result = await traversal.analyze({
		tenantId,
		sourceNodeId: "payment-service",
		maxDepth: 1,
	});

	assert.deepEqual(result.affectedNodeIds, [
		"billing-service",
		"checkout-service",
	]);
});

test("PR impact traversal reaches consumers through reverse dependency edges", async () => {
	const { repository, tenantId } = await buildSampleGraph();

	// The configuration convention is consumer -> dependency. A change to the
	// dependency must therefore propagate to its consumer in reverse.
	await repository.upsertEdge(
		createGraphEdge({
			id: "configured-checkout-depends-on-payment",
			tenantId,
			sourceNodeId: "checkout-service",
			targetNodeId: "payment-service",
			type: "DEPENDS_ON",
			weight: 1,
			confidence: 1,
			provenance: { sourceSystem: "USER" },
		}),
	);

	const traversal = new ImpactTraversal(repository);
	const result = await traversal.analyze({
		tenantId,
		sourceNodeId: "payment-service",
		propagationTypes: ["DEPENDS_ON"],
		reverseDependencyEdges: true,
	});

	assert.ok(result.affectedNodeIds.includes("checkout-service"));
	assert.equal(
		result.paths["checkout-service"].some((path) =>
			path.edgeIds.includes("configured-checkout-depends-on-payment"),
		),
		true,
	);
});

test("missing source node throws an error", async () => {
	const { repository, tenantId } = await buildSampleGraph();

	const traversal = new ImpactTraversal(repository);

	await assert.rejects(
		() =>
			traversal.analyze({
				tenantId,
				sourceNodeId: "missing-service",
			}),
		GraphNodeNotFoundError,
	);
});

test("cycle detection identifies a cyclic graph", async () => {
	const { repository, tenantId } = await buildSampleGraph();

	const nodes = ["service-a", "service-b", "service-c"];

	for (const id of nodes) {
		await repository.upsertNode(
			createGraphNode({
				id,
				tenantId,
				type: "SERVICE",
				source: "USER",
				name: id,
				attributes: {},
			}),
		);
	}

	const pairs = [
		["service-a", "service-b"],
		["service-b", "service-c"],
		["service-c", "service-a"],
	];

	let index = 0;

	for (const [sourceNodeId, targetNodeId] of pairs) {
		await repository.upsertEdge(
			createGraphEdge({
				id: `cycle-${index++}`,
				tenantId,
				sourceNodeId,
				targetNodeId,
				type: "DEPENDS_ON",
				weight: 1,
				confidence: 1,
				provenance: {
					sourceSystem: "USER",
				},
			}),
		);
	}

	const detector = new CycleDetector(repository);

	const result = await detector.detect(tenantId, ["DEPENDS_ON"]);

	assert.equal(result.hasCycle, true);

	assert.ok(result.blockedNodeIds.length >= 3);
});

test("tenant isolation prevents cross-tenant graph reads", async () => {
	const { repository } = await buildSampleGraph();

	const node = await repository.getNode("another-tenant", "payment-service");

	assert.equal(node, null);
});

test("repository rejects edges with missing endpoints", async () => {
	const { repository, tenantId } = await buildSampleGraph();

	await assert.rejects(
		() =>
			repository.upsertEdge(
				createGraphEdge({
					id: "invalid-edge",
					tenantId,
					sourceNodeId: "payment-service",
					targetNodeId: "missing-node",
					type: "DEPENDS_ON",
					weight: 1,
					confidence: 1,
					provenance: {
						sourceSystem: "USER",
					},
				}),
			),
		GraphNodeNotFoundError,
	);
});
