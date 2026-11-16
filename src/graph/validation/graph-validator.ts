import type { GraphNode } from "../models/graph-node";
import type { GraphEdge } from "../models/graph-edge";

import { GraphValidationError } from "../errors/graph-errors";

export function validateNode(node: GraphNode): void {
	if (!node.id.trim()) {
		throw new GraphValidationError("Node ID cannot be empty.");
	}

	if (!node.tenantId.trim()) {
		throw new GraphValidationError("Tenant ID cannot be empty.");
	}

	if (!node.name.trim()) {
		throw new GraphValidationError("Node name cannot be empty.");
	}

	if (!node.type || !node.source) {
		throw new GraphValidationError("Node type and source are required.");
	}

	if (
		!Number.isFinite(node.createdAt) ||
		!Number.isFinite(node.updatedAt) ||
		!Number.isFinite(node.lastSyncedAt)
	) {
		throw new GraphValidationError("Node timestamps must be valid numbers.");
	}
}

export function validateEdge(edge: GraphEdge): void {
	if (!edge.id.trim()) {
		throw new GraphValidationError("Edge ID cannot be empty.");
	}

	if (!edge.tenantId.trim()) {
		throw new GraphValidationError("Tenant ID cannot be empty.");
	}

	if (!edge.sourceNodeId.trim() || !edge.targetNodeId.trim()) {
		throw new GraphValidationError("Edge endpoints are required.");
	}

	if (edge.sourceNodeId === edge.targetNodeId) {
		throw new GraphValidationError("Self-referencing edges are not allowed.");
	}

	if (!Number.isFinite(edge.weight) || edge.weight < 0 || edge.weight > 1) {
		throw new GraphValidationError("Edge weight must be between 0 and 1.");
	}

	if (
		!Number.isFinite(edge.confidence) ||
		edge.confidence < 0 ||
		edge.confidence > 1
	) {
		throw new GraphValidationError("Edge confidence must be between 0 and 1.");
	}

	if (!edge.type) {
		throw new GraphValidationError("Edge type is required.");
	}
}
