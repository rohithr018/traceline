import type { GraphNode } from "../../graph/models/graph-node";
import type { GraphRepository } from "../../graph/repository/graph-repository";
import {
	CRITICALITY_ATTRIBUTE_KEYS,
	type UpdateCriticalityRequest,
	type UpdateCriticalityResult,
} from "../models/criticality";
import {
	CriticalityValidationError,
	validateCriticalityTarget,
	validateCriticalityUpdateRequest,
} from "../validation/criticality-validator";

export class CriticalityNodeNotFoundError extends Error {
	constructor(nodeId: string) {
		super(`Graph node not found: ${nodeId}`);
		this.name = "CriticalityNodeNotFoundError";
	}
}

export interface CriticalityServiceInput {
	tenantId: string;
	updatedBy: string;
	request: unknown;
}

export class CriticalityService {
	constructor(
		private readonly repository: GraphRepository,
		private readonly clock: () => number = Date.now,
	) {}

	async updateCriticality(
		input: CriticalityServiceInput,
	): Promise<UpdateCriticalityResult> {
		if (
			typeof input.tenantId !== "string" ||
			input.tenantId.trim().length === 0
		) {
			throw new CriticalityValidationError("A valid tenantId is required.");
		}

		if (
			typeof input.updatedBy !== "string" ||
			input.updatedBy.trim().length === 0
		) {
			throw new CriticalityValidationError(
				"A valid updater account ID is required.",
			);
		}

		const request: UpdateCriticalityRequest = validateCriticalityUpdateRequest(
			input.request,
		);

		const node: GraphNode | null = await this.repository.getNode(
			input.tenantId,
			request.nodeId,
		);

		if (!node) {
			throw new CriticalityNodeNotFoundError(request.nodeId);
		}

		validateCriticalityTarget(node, input.tenantId);

		const updatedAt = this.clock();

		const updatedNode: GraphNode = {
			...node,
			attributes: {
				...node.attributes,
				[CRITICALITY_ATTRIBUTE_KEYS.value]: request.criticality,
				[CRITICALITY_ATTRIBUTE_KEYS.updatedAt]: updatedAt,
				[CRITICALITY_ATTRIBUTE_KEYS.updatedBy]: input.updatedBy,
			},
			updatedAt,
		};

		await this.repository.upsertNode(updatedNode);

		return {
			success: true,
			nodeId: updatedNode.id,
			criticality: request.criticality,
			updatedAt,
		};
	}
}
