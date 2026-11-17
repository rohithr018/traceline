import { createGraphEdge } from "../../graph/models/graph-edge";

import type { GraphNode } from "../../graph/models/graph-node";
import type { GraphRepository } from "../../graph/repository/graph-repository";

import { mapBitbucketFileToServices } from "./bitbucket-source-mapping";

interface ChangedFileMetadata {
	path?: string | null;
	oldPath?: string | null;
	newPath?: string | null;
}

export interface UnmatchedChangedFile {
	pullRequestNodeId: string;
	filePath: string;
}

export interface BitbucketChangeLinkResult {
	scannedPullRequests: number;
	changedFiles: number;
	matchedFiles: number;
	unmatchedFiles: UnmatchedChangedFile[];
	matchedServices: number;
	persistedEdges: number;
	staleEdgesRemoved: number;
}

function getRepositoryUuid(node: GraphNode): string | undefined {
	const value = node.attributes.repositoryUuid;

	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getChangedFilePaths(node: GraphNode): string[] {
	const rawFiles = node.attributes.changedFiles;

	if (!Array.isArray(rawFiles)) {
		return [];
	}

	const paths = new Set<string>();

	for (const rawFile of rawFiles) {
		if (
			rawFile === null ||
			typeof rawFile !== "object" ||
			Array.isArray(rawFile)
		) {
			continue;
		}

		const file = rawFile as ChangedFileMetadata;

		// Include both sides of a rename so that ownership can be
		// discovered for the old and new locations.
		for (const value of [file.oldPath, file.newPath, file.path]) {
			if (typeof value === "string" && value.trim()) {
				paths.add(value.trim());
			}
		}
	}

	return [...paths].sort();
}

export class BitbucketChangeLinker {
	constructor(private readonly repository: GraphRepository) {}

	async linkPullRequestsToServices(
		tenantId: string,
		pullRequestNodeId?: string,
	): Promise<BitbucketChangeLinkResult> {
		if (!tenantId.trim()) {
			throw new Error("Tenant ID is required.");
		}

		const nodes = await this.repository.listNodes(tenantId);

		const pullRequests = nodes.filter(
			(node) =>
				node.type === "PULL_REQUEST" &&
				node.source === "BITBUCKET" &&
				(!pullRequestNodeId || node.id === pullRequestNodeId),
		);

		const services = nodes.filter((node) => node.type === "SERVICE");

		const unmatchedFiles: UnmatchedChangedFile[] = [];

		let changedFiles = 0;
		let matchedFiles = 0;
		let persistedEdges = 0;
		let staleEdgesRemoved = 0;

		for (const pullRequest of pullRequests) {
			const repositoryUuid = getRepositoryUuid(pullRequest);

			if (!repositoryUuid) {
				continue;
			}

			const filePaths = getChangedFilePaths(pullRequest);

			changedFiles += filePaths.length;

			const serviceFiles = new Map<string, Set<string>>();

			for (const filePath of filePaths) {
				const matches = mapBitbucketFileToServices(
					repositoryUuid,
					filePath,
					services,
				);

				if (matches.length === 0) {
					unmatchedFiles.push({
						pullRequestNodeId: pullRequest.id,
						filePath,
					});

					continue;
				}

				matchedFiles++;

				for (const match of matches) {
					if (!serviceFiles.has(match.serviceNodeId)) {
						serviceFiles.set(match.serviceNodeId, new Set<string>());
					}

					serviceFiles.get(match.serviceNodeId)!.add(match.filePath);
				}
			}

			const desiredEdges = new Map<
				string,
				ReturnType<typeof createGraphEdge>
			>();

			for (const [serviceNodeId, paths] of serviceFiles) {
				const matchedPaths = [...paths].sort();

				const edge = createGraphEdge({
					id: `bitbucket:pr-service:${pullRequest.id}:${serviceNodeId}`,
					tenantId,
					sourceNodeId: pullRequest.id,
					targetNodeId: serviceNodeId,
					type: "MODIFIES",
					weight: 1,
					confidence: 0.95,
					provenance: {
						sourceSystem: "BITBUCKET",
						...(pullRequest.url ? { externalReference: pullRequest.url } : {}),
						evidenceText:
							`Pull request "${pullRequest.name}" modifies ` +
							`service "${
								nodes.find((node) => node.id === serviceNodeId)?.name ??
								serviceNodeId
							}" through changed files: ` +
							matchedPaths.join(", "),
					},
				});

				desiredEdges.set(edge.id, edge);
			}

			// Reconcile only after every mapping for this pull request has been
			// validated. This avoids erasing the last known-good relationships
			// when malformed mapping configuration is encountered.
			const existingEdges = await this.repository.getOutgoingEdges(
				tenantId,
				pullRequest.id,
				["MODIFIES"],
			);

			for (const edge of desiredEdges.values()) {
				await this.repository.upsertEdge(edge);
			}

			for (const existingEdge of existingEdges) {
				if (!desiredEdges.has(existingEdge.id)) {
					await this.repository.deleteEdge(tenantId, existingEdge.id);
					staleEdgesRemoved++;
				}
			}

			persistedEdges += desiredEdges.size;
		}

		return {
			scannedPullRequests: pullRequests.length,
			changedFiles,
			matchedFiles,
			unmatchedFiles,
			matchedServices: persistedEdges,
			persistedEdges,
			staleEdgesRemoved,
		};
	}
}
