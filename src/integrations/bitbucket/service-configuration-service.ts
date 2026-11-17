import { createGraphEdge } from "../../graph/models/graph-edge";
import { createGraphNode, type GraphNode } from "../../graph/models/graph-node";
import type { GraphRepository } from "../../graph/repository/graph-repository";
import {
	CRITICALITY_ATTRIBUTE_KEYS,
	CRITICALITY_VALUES,
	type CriticalityLevel,
} from "../../risk/models/criticality";
import {
	getBitbucketSourceMappings,
	type BitbucketSourceMapping,
} from "./bitbucket-source-mapping";

const SERVICE_ID_PATTERN = /^service:[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_MAPPINGS = 50;
const MAX_DEPENDENCIES = 50;

export interface SaveServiceConfigurationInput {
	tenantId: string;
	updatedBy: string;
	serviceId: string;
	name: string;
	mappings: unknown;
	dependsOnServiceIds?: unknown;
	criticality: unknown;
}

export interface ServiceConfigurationResult {
	service: GraphNode;
	mappings: BitbucketSourceMapping[];
	dependsOnServiceIds: string[];
	staleDependenciesRemoved: number;
}

function validateServiceId(value: string): string {
	const serviceId = value.trim();

	if (!SERVICE_ID_PATTERN.test(serviceId)) {
		throw new Error(
			"Service ID must use the format service:lowercase-name.",
		);
	}

	return serviceId;
}

function validateName(value: string): string {
	const name = value.trim();

	if (!name || name.length > 500) {
		throw new Error("Service name must contain between 1 and 500 characters.");
	}

	return name;
}

function validateCriticality(value: unknown): CriticalityLevel {
	if (
		typeof value !== "string" ||
		!CRITICALITY_VALUES.includes(value as CriticalityLevel)
	) {
		throw new Error("Service criticality is invalid.");
	}

	return value as CriticalityLevel;
}

function validateDependencyIds(value: unknown, serviceId: string): string[] {
	if (value === undefined) {
		return [];
	}

	if (!Array.isArray(value) || value.length > MAX_DEPENDENCIES) {
		throw new Error(
			`dependsOnServiceIds must contain no more than ${MAX_DEPENDENCIES} service IDs.`,
		);
	}

	const dependencies = value.map((dependency) => {
		if (typeof dependency !== "string") {
			throw new Error("Each dependency must be a service ID.");
		}

		return validateServiceId(dependency);
	});

	if (dependencies.includes(serviceId)) {
		throw new Error("A service cannot depend on itself.");
	}

	if (new Set(dependencies).size !== dependencies.length) {
		throw new Error("Service dependencies must not contain duplicates.");
	}

	return dependencies.sort();
}

function getRepositoryUuid(node: GraphNode): string | null {
	if (node.type !== "REPOSITORY" || node.source !== "BITBUCKET") {
		return null;
	}

	const value = node.attributes.repositoryUuid ?? node.externalId;

	return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Persists the deliberately small amount of service configuration needed by
 * TraceLine: source paths, criticality, and direct service dependencies.
 */
export class ServiceConfigurationService {
	constructor(private readonly repository: GraphRepository) {}

	async save(
		input: SaveServiceConfigurationInput,
	): Promise<ServiceConfigurationResult> {
		if (!input.tenantId.trim()) {
			throw new Error("Tenant ID is required.");
		}

		if (!input.updatedBy.trim()) {
			throw new Error("An authenticated administrator is required.");
		}

		const tenantId = input.tenantId.trim();
		const serviceId = validateServiceId(input.serviceId);
		const name = validateName(input.name);
		const criticality = validateCriticality(input.criticality);
		const dependsOnServiceIds = validateDependencyIds(
			input.dependsOnServiceIds,
			serviceId,
		);

		if (!Array.isArray(input.mappings) || input.mappings.length === 0) {
			throw new Error("At least one Bitbucket source mapping is required.");
		}

		if (input.mappings.length > MAX_MAPPINGS) {
			throw new Error(
				`A service can have no more than ${MAX_MAPPINGS} source mappings.`,
			);
		}

		const [nodes, existing] = await Promise.all([
			this.repository.listNodes(tenantId),
			this.repository.getNode(tenantId, serviceId),
		]);

		if (
			existing &&
			(existing.type !== "SERVICE" || existing.source !== "USER")
		) {
			throw new Error("The requested service ID is already used by another node.");
		}

		const now = Date.now();
		const candidate = createGraphNode({
			id: serviceId,
			tenantId,
			type: "SERVICE",
			source: "USER",
			name,
			attributes: {
				bitbucketSourceMappings: input.mappings,
			},
		});

		// Reuse the production mapping parser so configuration and ingestion use
		// exactly the same directory-boundary and duplicate-mapping rules.
		const mappings = getBitbucketSourceMappings(candidate);
		const connectedRepositoryUuids = new Set(
			nodes
				.map(getRepositoryUuid)
				.filter((uuid): uuid is string => uuid !== null),
		);

		for (const mapping of mappings) {
			if (!connectedRepositoryUuids.has(mapping.repositoryUuid)) {
				throw new Error(
					`Repository ${mapping.repositoryUuid} has not been received from the paired Bitbucket workspace.`,
				);
			}
		}

		const serviceNodeIds = new Set(
			nodes
				.filter((node) => node.type === "SERVICE" && node.source === "USER")
				.map((node) => node.id),
		);
		serviceNodeIds.add(serviceId);

		for (const dependencyId of dependsOnServiceIds) {
			if (!serviceNodeIds.has(dependencyId)) {
				throw new Error(`Configured dependency ${dependencyId} does not exist.`);
			}
		}

		const service: GraphNode = {
			...(existing ?? candidate),
			name,
			attributes: {
				...(existing?.attributes ?? {}),
				bitbucketSourceMappings: mappings,
				[CRITICALITY_ATTRIBUTE_KEYS.value]: criticality,
				[CRITICALITY_ATTRIBUTE_KEYS.updatedAt]: now,
				[CRITICALITY_ATTRIBUTE_KEYS.updatedBy]: input.updatedBy.trim(),
			},
			updatedAt: now,
			lastSyncedAt: now,
		};

		await this.repository.upsertNode(service);

		const desiredDependencies = new Map(
			dependsOnServiceIds.map((dependencyId) => {
				const edge = createGraphEdge({
					id: `user:service-dependency:${serviceId}:${dependencyId}`,
					tenantId,
					sourceNodeId: serviceId,
					targetNodeId: dependencyId,
					type: "DEPENDS_ON",
					weight: 1,
					confidence: 1,
					provenance: {
						sourceSystem: "USER",
						evidenceText: `${name} depends on ${dependencyId}.`,
					},
				});

				return [edge.id, edge] as const;
			}),
		);

		const existingDependencies = await this.repository.getOutgoingEdges(
			tenantId,
			serviceId,
			["DEPENDS_ON"],
		);

		for (const edge of desiredDependencies.values()) {
			await this.repository.upsertEdge(edge);
		}

		let staleDependenciesRemoved = 0;

		for (const edge of existingDependencies) {
			if (!desiredDependencies.has(edge.id)) {
				await this.repository.deleteEdge(tenantId, edge.id);
				staleDependenciesRemoved++;
			}
		}

		return {
			service,
			mappings,
			dependsOnServiceIds,
			staleDependenciesRemoved,
		};
	}
}
