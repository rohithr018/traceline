import type { EdgeType } from "../../graph/models/graph-edge";
import type { ImpactAnalysisRequest } from "../models/impact-analysis";

const VALID_EDGE_TYPES: EdgeType[] = [
	"DEPENDS_ON",
	"BLOCKS",
	"IMPLEMENTS",
	"MODIFIES",
	"OWNED_BY",
	"DOCUMENTED_BY",
	"DECIDED_BY",
	"AFFECTED_BY",
	"RELATED_TO",
];

export function validateImpactRequest(input: ImpactAnalysisRequest): void {
	if (!input.tenantId?.trim()) {
		throw new Error("Tenant ID is required.");
	}

	if (!input.sourceNodeId?.trim()) {
		throw new Error("Source node ID is required.");
	}

	if (
		input.maxDepth !== undefined &&
		(!Number.isInteger(input.maxDepth) || input.maxDepth < 0)
	) {
		throw new Error("maxDepth must be a non-negative integer.");
	}

	if (
		input.maxVisitedNodes !== undefined &&
		(!Number.isInteger(input.maxVisitedNodes) || input.maxVisitedNodes < 1)
	) {
		throw new Error("maxVisitedNodes must be a positive integer.");
	}

	if (
		input.maxPathsPerNode !== undefined &&
		(!Number.isInteger(input.maxPathsPerNode) || input.maxPathsPerNode < 1)
	) {
		throw new Error("maxPathsPerNode must be a positive integer.");
	}

	if (
		input.minConfidence !== undefined &&
		(!Number.isFinite(input.minConfidence) ||
			input.minConfidence < 0 ||
			input.minConfidence > 1)
	) {
		throw new Error("minConfidence must be between 0 and 1.");
	}

	if (input.propagationTypes !== undefined) {
		if (!Array.isArray(input.propagationTypes)) {
			throw new Error("propagationTypes must be an array.");
		}

		for (const type of input.propagationTypes) {
			if (!VALID_EDGE_TYPES.includes(type)) {
				throw new Error(`Invalid propagation edge type: ${type}`);
			}
		}
	}
}
