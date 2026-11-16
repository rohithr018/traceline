import type { GraphNode } from "../../graph/models/graph-node";

export type CriticalityLevel =
	| "UNKNOWN"
	| "LOW"
	| "MEDIUM"
	| "HIGH"
	| "CRITICAL";

export const CRITICALITY_VALUES: readonly CriticalityLevel[] = [
	"UNKNOWN",
	"LOW",
	"MEDIUM",
	"HIGH",
	"CRITICAL",
];

export const CRITICALITY_SCORES: Record<CriticalityLevel, number> = {
	UNKNOWN: 50,
	LOW: 25,
	MEDIUM: 50,
	HIGH: 75,
	CRITICAL: 100,
};

export const CRITICALITY_ATTRIBUTE_KEYS = {
	value: "criticality",
	updatedAt: "criticalityUpdatedAt",
	updatedBy: "criticalityUpdatedBy",
} as const;

export interface UpdateCriticalityRequest {
	nodeId: string;
	criticality: CriticalityLevel;
}

export interface UpdateCriticalityResult {
	success: true;
	nodeId: string;
	criticality: CriticalityLevel;
	updatedAt: number;
}

export interface CriticalityMetadata {
	criticality: CriticalityLevel;
	criticalityUpdatedAt?: number;
	criticalityUpdatedBy?: string;
}

export const CRITICALITY_ELIGIBLE_NODE_TYPES = [
	"PROJECT",
	"ISSUE",
	"SERVICE",
	"REPOSITORY",
	"PULL_REQUEST",
	"RELEASE",
	"INCIDENT",
] as const;

export type CriticalityEligibleNodeType =
	(typeof CRITICALITY_ELIGIBLE_NODE_TYPES)[number];

export function getNodeCriticality(node: GraphNode): CriticalityLevel {
	const value = node.attributes?.[CRITICALITY_ATTRIBUTE_KEYS.value];

	if (
		typeof value === "string" &&
		CRITICALITY_VALUES.includes(value as CriticalityLevel)
	) {
		return value as CriticalityLevel;
	}

	return "UNKNOWN";
}
