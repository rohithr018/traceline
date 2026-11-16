import type { EdgeType } from "../models/graph-edge";
import type { GraphRepository } from "../repository/graph-repository";

import { GraphNodeNotFoundError } from "../errors/graph-errors";

export interface ImpactInput {
	tenantId: string;
	sourceNodeId: string;

	maxDepth?: number;
	maxVisitedNodes?: number;
	maxPathsPerNode?: number;

	minConfidence?: number;
	propagationTypes?: EdgeType[];
}

export interface ImpactPath {
	nodeIds: string[];
	edgeIds: string[];
	depth: number;
	confidence: number;
}

export interface ImpactResult {
	sourceNodeId: string;

	affectedNodeIds: string[];

	paths: Record<string, ImpactPath[]>;

	visitedNodeCount: number;
	truncated: boolean;
}

interface QueueEntry {
	nodeId: string;
	nodePath: string[];
	edgePath: string[];
	confidence: number;
	depth: number;
}

const DEFAULT_PROPAGATION_TYPES: EdgeType[] = [
	"DEPENDS_ON",
	"BLOCKS",
	"MODIFIES",
];

export class ImpactTraversal {
	constructor(private readonly repository: GraphRepository) {}

	async analyze(input: ImpactInput): Promise<ImpactResult> {
		const {
			tenantId,
			sourceNodeId,
			maxDepth = 5,
			maxVisitedNodes = 1000,
			maxPathsPerNode = 3,
			minConfidence = 0.5,
			propagationTypes = DEFAULT_PROPAGATION_TYPES,
		} = input;

		if (!Number.isInteger(maxDepth) || maxDepth < 0) {
			throw new Error("maxDepth must be a non-negative integer.");
		}

		if (!Number.isInteger(maxVisitedNodes) || maxVisitedNodes < 1) {
			throw new Error("maxVisitedNodes must be a positive integer.");
		}

		if (!Number.isInteger(maxPathsPerNode) || maxPathsPerNode < 1) {
			throw new Error("maxPathsPerNode must be a positive integer.");
		}

		if (
			!Number.isFinite(minConfidence) ||
			minConfidence < 0 ||
			minConfidence > 1
		) {
			throw new Error("minConfidence must be between 0 and 1.");
		}

		const source = await this.repository.getNode(tenantId, sourceNodeId);

		if (!source) {
			throw new GraphNodeNotFoundError(sourceNodeId);
		}

		const queue: QueueEntry[] = [
			{
				nodeId: sourceNodeId,
				nodePath: [sourceNodeId],
				edgePath: [],
				confidence: 1,
				depth: 0,
			},
		];

		const paths: Record<string, ImpactPath[]> = {};

		const visitedNodes = new Set<string>([sourceNodeId]);

		let truncated = false;
		let head = 0;

		while (head < queue.length) {
			const current = queue[head++];

			if (current.depth >= maxDepth) {
				continue;
			}

			const edges = await this.repository.getOutgoingEdges(
				tenantId,
				current.nodeId,
				propagationTypes,
			);

			for (const edge of edges) {
				if (edge.confidence < minConfidence) {
					continue;
				}

				if (current.nodePath.includes(edge.targetNodeId)) {
					continue;
				}

				const existingPaths = paths[edge.targetNodeId] ?? [];

				if (existingPaths.length >= maxPathsPerNode) {
					truncated = true;
					continue;
				}

				if (
					!visitedNodes.has(edge.targetNodeId) &&
					visitedNodes.size >= maxVisitedNodes
				) {
					truncated = true;
					break;
				}

				visitedNodes.add(edge.targetNodeId);

				const nodePath = [...current.nodePath, edge.targetNodeId];

				const edgePath = [...current.edgePath, edge.id];

				const confidence = Math.min(current.confidence, edge.confidence);

				const resultPath: ImpactPath = {
					nodeIds: nodePath,
					edgeIds: edgePath,
					depth: current.depth + 1,
					confidence,
				};

				if (!paths[edge.targetNodeId]) {
					paths[edge.targetNodeId] = [];
				}

				paths[edge.targetNodeId].push(resultPath);

				queue.push({
					nodeId: edge.targetNodeId,
					nodePath,
					edgePath,
					confidence,
					depth: current.depth + 1,
				});
			}

			if (truncated) {
				break;
			}
		}

		return {
			sourceNodeId,
			affectedNodeIds: Object.keys(paths).sort(),
			paths,
			visitedNodeCount: visitedNodes.size,
			truncated,
		};
	}
}
