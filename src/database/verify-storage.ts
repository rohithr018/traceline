import { randomUUID } from "node:crypto";
import { sql } from "@forge/sql";

import { SqlGraphRepository } from "../graph/repository/sql-graph-repository";
import { createGraphNode } from "../graph/models/graph-node";
import { createGraphEdge } from "../graph/models/graph-edge";
import { ImpactTraversal } from "../graph/algorithms/impact-traversal";

const repository = new SqlGraphRepository();

export async function verifyStorage() {
	const runId = randomUUID();
	const tenantId = `traceline-verification-${runId}`;

	const sourceId = `storage-test-source-${runId}`;
	const targetId = `storage-test-target-${runId}`;
	const edgeId = `storage-test-edge-${runId}`;

	try {
		const source = createGraphNode({
			id: sourceId,
			tenantId,
			type: "SERVICE",
			source: "USER",
			name: "Storage Test Source",
			attributes: { testRun: runId },
		});

		const target = createGraphNode({
			id: targetId,
			tenantId,
			type: "SERVICE",
			source: "USER",
			name: "Storage Test Target",
			attributes: { testRun: runId },
		});

		// 1. Insert nodes.
		await repository.upsertNode(source);
		await repository.upsertNode(target);

		// 2. Insert dependency edge.
		const edge = createGraphEdge({
			id: edgeId,
			tenantId,
			sourceNodeId: sourceId,
			targetNodeId: targetId,
			type: "DEPENDS_ON",
			weight: 1,
			confidence: 1,
			provenance: {
				sourceSystem: "USER",
				evidenceText: "TraceLine SQL persistence verification",
			},
		});

		await repository.upsertEdge(edge);

		// 3. Read nodes back from SQL.
		const storedSource = await repository.getNode(tenantId, sourceId);
		const storedTarget = await repository.getNode(tenantId, targetId);

		if (!storedSource || !storedTarget) {
			throw new Error("SQL node persistence verification failed.");
		}

		if (storedSource.name !== "Storage Test Source") {
			throw new Error("Stored source node data does not match.");
		}

		// 4. Read the edge back from SQL.
		const storedEdges = await repository.getOutgoingEdges(tenantId, sourceId, [
			"DEPENDS_ON",
		]);

		if (!storedEdges.some((storedEdge) => storedEdge.id === edgeId)) {
			throw new Error("SQL edge persistence verification failed.");
		}

		// 5. Verify graph traversal using SQL-backed data.
		const traversal = new ImpactTraversal(repository);

		const impact = await traversal.analyze({
			tenantId,
			sourceNodeId: sourceId,
		});

		if (!impact.affectedNodeIds.includes(targetId)) {
			throw new Error("SQL-backed graph traversal verification failed.");
		}

		return {
			success: true,
			checks: {
				nodeInsertAndRead: true,
				edgeInsertAndRead: true,
				impactTraversal: true,
				cleanup: "pending",
			},
			affectedNodeCount: impact.affectedNodeIds.length,
		};
	} finally {
		// Remove only records belonging to this unique test tenant.
		await sql
			.prepare("DELETE FROM graph_edges WHERE tenant_id = ?")
			.bindParams(tenantId)
			.execute();

		await sql
			.prepare("DELETE FROM graph_nodes WHERE tenant_id = ?")
			.bindParams(tenantId)
			.execute();
	}
}
