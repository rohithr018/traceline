import type { GraphNode } from "../../graph/models/graph-node";

export interface BitbucketSourceMapping {
	repositoryUuid: string;
	pathPrefix: string;
}

export interface BitbucketFileMappingMatch {
	serviceNodeId: string;
	serviceName: string;
	repositoryUuid: string;
	pathPrefix: string;
	filePath: string;
}

const MAPPING_ATTRIBUTE = "bitbucketSourceMappings";

function normalizeRelativePath(value: string, fieldName: string): string {
	let path = value.trim().replace(/\\/g, "/");

	if (!path) {
		throw new Error(`${fieldName} must not be empty.`);
	}

	if (path.startsWith("/") || /^[A-Za-z]:\//.test(path)) {
		throw new Error(`${fieldName} must be a relative path.`);
	}

	while (path.startsWith("./")) {
		path = path.slice(2);
	}

	// A trailing slash is meaningful for configuration readability,
	// but not needed for matching.
	path = path.replace(/\/+$/, "");

	if (!path) {
		throw new Error(`${fieldName} must not be empty.`);
	}

	const segments = path.split("/");

	if (
		segments.some(
			(segment) => segment.length === 0 || segment === "." || segment === "..",
		)
	) {
		throw new Error(`${fieldName} contains an invalid path segment.`);
	}

	return segments.join("/");
}

function parseMapping(value: unknown, index: number): BitbucketSourceMapping {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${MAPPING_ATTRIBUTE}[${index}] must be an object.`);
	}

	const mapping = value as Record<string, unknown>;

	if (
		typeof mapping.repositoryUuid !== "string" ||
		!mapping.repositoryUuid.trim()
	) {
		throw new Error(
			`${MAPPING_ATTRIBUTE}[${index}].repositoryUuid is required.`,
		);
	}

	if (typeof mapping.pathPrefix !== "string" || !mapping.pathPrefix.trim()) {
		throw new Error(`${MAPPING_ATTRIBUTE}[${index}].pathPrefix is required.`);
	}

	return {
		repositoryUuid: mapping.repositoryUuid.trim(),
		pathPrefix: normalizeRelativePath(
			mapping.pathPrefix,
			`${MAPPING_ATTRIBUTE}[${index}].pathPrefix`,
		),
	};
}

export function getBitbucketSourceMappings(
	serviceNode: GraphNode,
): BitbucketSourceMapping[] {
	if (serviceNode.type !== "SERVICE") {
		throw new Error(
			"Bitbucket source mappings are only valid on SERVICE nodes.",
		);
	}

	const rawMappings = serviceNode.attributes[MAPPING_ATTRIBUTE];

	if (rawMappings === undefined) {
		return [];
	}

	if (!Array.isArray(rawMappings)) {
		throw new Error(`${MAPPING_ATTRIBUTE} must be an array.`);
	}

	const mappings = rawMappings.map(parseMapping);
	const seen = new Set<string>();

	for (const mapping of mappings) {
		const key = JSON.stringify([mapping.repositoryUuid, mapping.pathPrefix]);

		if (seen.has(key)) {
			throw new Error(
				`Duplicate Bitbucket source mapping: ${mapping.repositoryUuid}:${mapping.pathPrefix}`,
			);
		}

		seen.add(key);
	}

	return mappings;
}

export function mapBitbucketFileToServices(
	repositoryUuid: string,
	filePath: string,
	serviceNodes: GraphNode[],
): BitbucketFileMappingMatch[] {
	if (!repositoryUuid.trim()) {
		throw new Error("Repository UUID is required.");
	}

	const normalizedFilePath = normalizeRelativePath(
		filePath,
		"Changed file path",
	);

	const matches: BitbucketFileMappingMatch[] = [];

	for (const serviceNode of serviceNodes) {
		if (serviceNode.type !== "SERVICE") {
			continue;
		}

		const matchingMappings = getBitbucketSourceMappings(serviceNode)
			.filter((mapping) => {
				if (mapping.repositoryUuid !== repositoryUuid) {
					return false;
				}

				return (
					normalizedFilePath === mapping.pathPrefix ||
					normalizedFilePath.startsWith(`${mapping.pathPrefix}/`)
				);
			})
			.sort((a, b) => b.pathPrefix.length - a.pathPrefix.length);

		// Keep the most specific mapping for this service and file.
		const mapping = matchingMappings[0];

		if (!mapping) {
			continue;
		}

		matches.push({
			serviceNodeId: serviceNode.id,
			serviceName: serviceNode.name,
			repositoryUuid: mapping.repositoryUuid,
			pathPrefix: mapping.pathPrefix,
			filePath: normalizedFilePath,
		});
	}

	return matches.sort((a, b) => a.serviceNodeId.localeCompare(b.serviceNodeId));
}
