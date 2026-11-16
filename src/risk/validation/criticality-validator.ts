import type { GraphNode } from "../../graph/models/graph-node";
import {
	CRITICALITY_ELIGIBLE_NODE_TYPES,
	CRITICALITY_VALUES,
	type CriticalityLevel,
	type UpdateCriticalityRequest,
} from "../models/criticality";

export class CriticalityValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CriticalityValidationError";
	}
}

export function validateCriticalityUpdateRequest(
	input: unknown,
): UpdateCriticalityRequest {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		throw new CriticalityValidationError("Request must be an object.");
	}

	const request = input as Record<string, unknown>;

	if (
		typeof request.nodeId !== "string" ||
		request.nodeId.trim().length === 0
	) {
		throw new CriticalityValidationError("A valid nodeId is required.");
	}

	if (
		typeof request.criticality !== "string" ||
		!CRITICALITY_VALUES.includes(request.criticality as CriticalityLevel)
	) {
		throw new CriticalityValidationError("Invalid criticality value.");
	}

	return {
		nodeId: request.nodeId.trim(),
		criticality: request.criticality as CriticalityLevel,
	};
}

export function validateCriticalityTarget(
	node: GraphNode,
	tenantId: string,
): void {
	if (!tenantId || tenantId.trim().length === 0) {
		throw new CriticalityValidationError("A valid tenantId is required.");
	}

	if (node.tenantId !== tenantId) {
		throw new CriticalityValidationError(
			"Node does not belong to the requesting tenant.",
		);
	}

	if (
		!CRITICALITY_ELIGIBLE_NODE_TYPES.includes(
			node.type as (typeof CRITICALITY_ELIGIBLE_NODE_TYPES)[number],
		)
	) {
		throw new CriticalityValidationError(
			`Criticality cannot be updated for node type: ${node.type}.`,
		);
	}
}
