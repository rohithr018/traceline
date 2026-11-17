import type { GraphNode } from "../models/graph-node";
import type { GraphEdge, EdgeType } from "../models/graph-edge";

export interface GraphRepository {
	upsertNode(node: GraphNode): Promise<void>;

	upsertEdge(edge: GraphEdge): Promise<void>;

	/**
	 * Remove one stable graph relationship within a tenant.
	 *
	 * Ingestion code uses this to reconcile relationships whose source data has
	 * changed (for example, files or Jira keys removed from a pull request).
	 */
	deleteEdge(tenantId: string, edgeId: string): Promise<boolean>;

	getNode(tenantId: string, nodeId: string): Promise<GraphNode | null>;

	getOutgoingEdges(
		tenantId: string,
		nodeId: string,
		types?: EdgeType[],
	): Promise<GraphEdge[]>;

	getIncomingEdges(
		tenantId: string,
		nodeId: string,
		types?: EdgeType[],
	): Promise<GraphEdge[]>;

	listNodes(tenantId: string): Promise<GraphNode[]>;

	listEdges(tenantId: string): Promise<GraphEdge[]>;
}
