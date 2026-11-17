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
	/**
	 * A configured SERVICE -> SERVICE DEPENDS_ON edge means that the source
	 * service consumes the target service. For a code change, impact therefore
	 * propagates in the reverse direction—from the changed dependency to its
	 * consumers—while the graph retains its conventional dependency direction.
	 */
	reverseDependencyEdges?: boolean;
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
			reverseDependencyEdges = false,
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

			const outgoingTypes = reverseDependencyEdges
				? propagationTypes.filter((type) => type !== "DEPENDS_ON")
				: propagationTypes;

			const outgoingEdges = await this.repository.getOutgoingEdges(
				tenantId,
				current.nodeId,
				outgoingTypes,
			);

			const incomingDependencyEdges =
				reverseDependencyEdges && propagationTypes.includes("DEPENDS_ON")
					? await this.repository.getIncomingEdges(tenantId, current.nodeId, [
							"DEPENDS_ON",
						])
					: [];

			const edges = [
				...outgoingEdges.map((edge) => ({
					edge,
					nextNodeId: edge.targetNodeId,
				})),
				...incomingDependencyEdges.map((edge) => ({
					edge,
					nextNodeId: edge.sourceNodeId,
				})),
			];

			for (const { edge, nextNodeId } of edges) {
				if (edge.confidence < minConfidence) {
					continue;
				}

				if (current.nodePath.includes(nextNodeId)) {
					continue;
				}

				const existingPaths = paths[nextNodeId] ?? [];

				if (existingPaths.length >= maxPathsPerNode) {
					truncated = true;
					continue;
				}

				if (
					!visitedNodes.has(nextNodeId) &&
					visitedNodes.size >= maxVisitedNodes
				) {
					truncated = true;
					break;
				}

				visitedNodes.add(nextNodeId);

				const nodePath = [...current.nodePath, nextNodeId];

				const edgePath = [...current.edgePath, edge.id];

				const confidence = Math.min(current.confidence, edge.confidence);

				const resultPath: ImpactPath = {
					nodeIds: nodePath,
					edgeIds: edgePath,
					depth: current.depth + 1,
					confidence,
				};

				if (!paths[nextNodeId]) {
					paths[nextNodeId] = [];
				}

				paths[nextNodeId].push(resultPath);

				queue.push({
					nodeId: nextNodeId,
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
