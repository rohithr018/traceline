import type { EdgeType } from "../../graph/models/graph-edge";
import type { ImpactAnalysisRequest } from "../models/impact-analysis";
import { validateImpactRequest } from "../validation/impact-request-validator";

export interface ImpactApiPayload {
	sourceNodeId?: unknown;
	maxDepth?: unknown;
	maxVisitedNodes?: unknown;
	maxPathsPerNode?: unknown;
	minConfidence?: unknown;
	propagationTypes?: unknown;
}

export function buildImpactAnalysisRequest(
	payload: unknown,
	tenantId: string,
): ImpactAnalysisRequest {
	if (!tenantId || typeof tenantId !== "string") {
		throw new Error("A valid installation context is required.");
	}

	if (
		payload === null ||
		typeof payload !== "object" ||
		Array.isArray(payload)
	) {
		throw new Error("Request payload must be an object.");
	}

	const input = payload as ImpactApiPayload;

	if (
		typeof input.sourceNodeId !== "string" ||
		input.sourceNodeId.trim().length === 0
	) {
		throw new Error("sourceNodeId is required.");
	}

	if (input.sourceNodeId.length > 255) {
		throw new Error("sourceNodeId is too long.");
	}

	const request: ImpactAnalysisRequest = {
		tenantId,
		sourceNodeId: input.sourceNodeId.trim(),
	};

	if (input.maxDepth !== undefined) {
		if (typeof input.maxDepth !== "number" || input.maxDepth > 8) {
			throw new Error("maxDepth must be a number no greater than 8.");
		}
		request.maxDepth = input.maxDepth;
	}

	if (input.maxVisitedNodes !== undefined) {
		if (
			typeof input.maxVisitedNodes !== "number" ||
			input.maxVisitedNodes > 500
		) {
			throw new Error("maxVisitedNodes must be a number no greater than 500.");
		}
		request.maxVisitedNodes = input.maxVisitedNodes;
	}

	if (input.maxPathsPerNode !== undefined) {
		if (
			typeof input.maxPathsPerNode !== "number" ||
			input.maxPathsPerNode > 5
		) {
			throw new Error("maxPathsPerNode must be a number no greater than 5.");
		}
		request.maxPathsPerNode = input.maxPathsPerNode;
	}

	if (input.minConfidence !== undefined) {
		if (typeof input.minConfidence !== "number") {
			throw new Error("minConfidence must be a number.");
		}
		request.minConfidence = input.minConfidence;
	}

	if (input.propagationTypes !== undefined) {
		if (
			!Array.isArray(input.propagationTypes) ||
			!input.propagationTypes.every(
				(type): type is EdgeType => typeof type === "string",
			)
		) {
			throw new Error("propagationTypes must be an array of edge types.");
		}

		request.propagationTypes = input.propagationTypes;
	}

	validateImpactRequest(request);

	return request;
}
