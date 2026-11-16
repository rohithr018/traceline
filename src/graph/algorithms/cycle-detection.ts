import type { GraphRepository } from "../repository/graph-repository";
import type { EdgeType } from "../models/graph-edge";

export interface CycleDetectionResult {
	hasCycle: boolean;
	processedNodeCount: number;
	blockedNodeIds: string[];
}

export class CycleDetector {
	constructor(private readonly repository: GraphRepository) {}

	async detect(
		tenantId: string,
		types?: EdgeType[],
	): Promise<CycleDetectionResult> {
		const nodes = await this.repository.listNodes(tenantId);

		const nodeIds = nodes.map((node) => node.id);

		const indegree = new Map<string, number>();

		const adjacency = new Map<string, string[]>();

		for (const nodeId of nodeIds) {
			indegree.set(nodeId, 0);
			adjacency.set(nodeId, []);
		}

		const edges = await this.repository.listEdges(tenantId);

		for (const edge of edges) {
			if (types && !types.includes(edge.type)) {
				continue;
			}

			adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId);

			indegree.set(
				edge.targetNodeId,
				(indegree.get(edge.targetNodeId) ?? 0) + 1,
			);
		}

		const queue: string[] = [];

		for (const [nodeId, degree] of indegree) {
			if (degree === 0) {
				queue.push(nodeId);
			}
		}

		let head = 0;
		let processedNodeCount = 0;

		while (head < queue.length) {
			const current = queue[head++];

			processedNodeCount++;

			for (const neighbor of adjacency.get(current) ?? []) {
				const nextDegree = (indegree.get(neighbor) ?? 0) - 1;

				indegree.set(neighbor, nextDegree);

				if (nextDegree === 0) {
					queue.push(neighbor);
				}
			}
		}

		const blockedNodeIds = nodeIds
			.filter((id) => (indegree.get(id) ?? 0) > 0)
			.sort();

		return {
			hasCycle: processedNodeCount !== nodes.length,
			processedNodeCount,
			blockedNodeIds,
		};
	}
}
