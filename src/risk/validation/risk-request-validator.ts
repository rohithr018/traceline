import type { GraphNode } from "../../graph/models/graph-node";
import type { GraphEdge } from "../../graph/models/graph-edge";
import type { ImpactAnalysisResult } from "../../impact/models/impact-analysis";

export interface RiskValidationInput {
	tenantId: string;
	impactAnalysis: ImpactAnalysisResult;
	nodes: GraphNode[];
	edges: GraphEdge[];
}

export function validateRiskInput(input: RiskValidationInput): void {
	if (!input.tenantId.trim()) {
		throw new Error("Risk analysis requires a tenant ID.");
	}

	if (!input.impactAnalysis.sourceNodeId.trim()) {
		throw new Error("Risk analysis requires a source node ID.");
	}

	const nodeIds = new Set<string>();

	for (const node of input.nodes) {
		if (node.tenantId !== input.tenantId) {
			throw new Error(`Node ${node.id} belongs to a different tenant.`);
		}

		if (nodeIds.has(node.id)) {
			throw new Error(`Duplicate graph node: ${node.id}`);
		}

		nodeIds.add(node.id);
	}

	for (const edge of input.edges) {
		if (edge.tenantId !== input.tenantId) {
			throw new Error(`Edge ${edge.id} belongs to a different tenant.`);
		}

		if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
			throw new Error(
				`Edge ${edge.id} references a node outside the supplied graph.`,
			);
		}
	}

	for (const finding of input.impactAnalysis.findings) {
		if (!nodeIds.has(finding.nodeId)) {
			throw new Error(
				`Finding ${finding.nodeId} has no corresponding graph node.`,
			);
		}

		if (!Number.isFinite(finding.minimumDepth) || finding.minimumDepth < 1) {
			throw new Error(
				`Finding ${finding.nodeId} has an invalid minimum depth.`,
			);
		}

		if (
			!Number.isFinite(finding.strongestPathConfidence) ||
			finding.strongestPathConfidence < 0 ||
			finding.strongestPathConfidence > 1
		) {
			throw new Error(`Finding ${finding.nodeId} has invalid path confidence.`);
		}
	}
}
