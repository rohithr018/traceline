import type { GraphNode } from "./models/graph-node";
import type { GraphEdge, EdgeType } from "./models/graph-edge";

import type { GraphRepository } from "./repository/graph-repository";

import { GraphNodeNotFoundError } from "./errors/graph-errors";

export class GraphService {
	constructor(private readonly repository: GraphRepository) {}

	async addNode(node: GraphNode): Promise<void> {
		await this.repository.upsertNode(node);
	}

	async addEdge(edge: GraphEdge): Promise<void> {
		await this.repository.upsertEdge(edge);
	}

	async getNode(tenantId: string, nodeId: string): Promise<GraphNode> {
		const node = await this.repository.getNode(tenantId, nodeId);

		if (!node) {
			throw new GraphNodeNotFoundError(nodeId);
		}

		return node;
	}

	async getOutgoingEdges(
		tenantId: string,
		nodeId: string,
		types?: EdgeType[],
	): Promise<GraphEdge[]> {
		await this.getNode(tenantId, nodeId);

		return this.repository.getOutgoingEdges(tenantId, nodeId, types);
	}

	async getIncomingEdges(
		tenantId: string,
		nodeId: string,
		types?: EdgeType[],
	): Promise<GraphEdge[]> {
		await this.getNode(tenantId, nodeId);

		return this.repository.getIncomingEdges(tenantId, nodeId, types);
	}

	async getGraph(tenantId: string) {
		const [nodes, edges] = await Promise.all([
			this.repository.listNodes(tenantId),
			this.repository.listEdges(tenantId),
		]);

		return { nodes, edges };
	}
}
