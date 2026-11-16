import { createGraphNode } from "../src/graph/models/graph-node";
import { createGraphEdge } from "../src/graph/models/graph-edge";

import { InMemoryGraphRepository } from "../src/graph/repository/in-memory-graph-repository";

const TENANT = "demo-tenant";

export async function buildSampleGraph() {
	const repository = new InMemoryGraphRepository();

	const nodes = [
		createGraphNode({
			id: "payment-service",
			tenantId: TENANT,
			type: "SERVICE",
			source: "USER",
			name: "Payment Service",
			attributes: { language: "Go" },
		}),

		createGraphNode({
			id: "checkout-service",
			tenantId: TENANT,
			type: "SERVICE",
			source: "USER",
			name: "Checkout Service",
			attributes: { language: "Node.js" },
		}),

		createGraphNode({
			id: "billing-service",
			tenantId: TENANT,
			type: "SERVICE",
			source: "USER",
			name: "Billing Service",
			attributes: { language: "Java" },
		}),

		createGraphNode({
			id: "order-service",
			tenantId: TENANT,
			type: "SERVICE",
			source: "USER",
			name: "Order Service",
			attributes: { language: "Go" },
		}),

		createGraphNode({
			id: "analytics-service",
			tenantId: TENANT,
			type: "SERVICE",
			source: "USER",
			name: "Analytics Service",
			attributes: {},
		}),

		createGraphNode({
			id: "payment-incident-01",
			tenantId: TENANT,
			type: "INCIDENT",
			source: "USER",
			name: "Previous Payment Timeout",
			attributes: { severity: "HIGH" },
		}),
	];

	for (const node of nodes) {
		await repository.upsertNode(node);
	}

	const edges = [
		createGraphEdge({
			id: "edge-01",
			tenantId: TENANT,
			sourceNodeId: "payment-service",
			targetNodeId: "checkout-service",
			type: "DEPENDS_ON",
			weight: 0.9,
			confidence: 1,
			provenance: {
				sourceSystem: "USER",
				evidenceText: "Checkout consumes payment service.",
			},
		}),

		createGraphEdge({
			id: "edge-02",
			tenantId: TENANT,
			sourceNodeId: "payment-service",
			targetNodeId: "billing-service",
			type: "DEPENDS_ON",
			weight: 0.9,
			confidence: 1,
			provenance: {
				sourceSystem: "USER",
				evidenceText: "Billing consumes payment service.",
			},
		}),

		createGraphEdge({
			id: "edge-03",
			tenantId: TENANT,
			sourceNodeId: "checkout-service",
			targetNodeId: "order-service",
			type: "DEPENDS_ON",
			weight: 0.8,
			confidence: 0.95,
			provenance: {
				sourceSystem: "USER",
			},
		}),

		createGraphEdge({
			id: "edge-04",
			tenantId: TENANT,
			sourceNodeId: "billing-service",
			targetNodeId: "order-service",
			type: "DEPENDS_ON",
			weight: 0.8,
			confidence: 0.95,
			provenance: {
				sourceSystem: "USER",
			},
		}),

		createGraphEdge({
			id: "edge-05",
			tenantId: TENANT,
			sourceNodeId: "order-service",
			targetNodeId: "analytics-service",
			type: "RELATED_TO",
			weight: 0.4,
			confidence: 0.9,
			provenance: {
				sourceSystem: "USER",
			},
		}),

		createGraphEdge({
			id: "edge-06",
			tenantId: TENANT,
			sourceNodeId: "payment-service",
			targetNodeId: "payment-incident-01",
			type: "AFFECTED_BY",
			weight: 0.9,
			confidence: 1,
			provenance: {
				sourceSystem: "USER",
				evidenceText: "Previous payment timeout incident.",
			},
		}),
	];

	for (const edge of edges) {
		await repository.upsertEdge(edge);
	}

	return {
		tenantId: TENANT,
		repository,
	};
}
