import type { GraphRepository } from "../../graph/repository/graph-repository";
import { ForgeConfluenceClient } from "./forge-confluence-client";
import { mapConfluencePageToGraphNode } from "./confluence-mapper";
import type { ConfluenceClient, ConfluencePage } from "./confluence-types";

export interface ConfluenceIngestionInput {
	tenantId: string;
	spaceId: string;
	maxPages?: number;
}

export interface ConfluenceIngestionResult {
	spaceId: string;
	fetchedPages: number;
	persistedNodes: number;
}

function extractNextCursor(nextUrl?: string): string | undefined {
	if (!nextUrl) {
		return undefined;
	}

	try {
		const parsedUrl = new URL(nextUrl, "https://confluence-pagination.invalid");

		return parsedUrl.searchParams.get("cursor") ?? undefined;
	} catch {
		throw new Error("Confluence returned an invalid pagination URL");
	}
}

export class ConfluenceIngestionService {
	constructor(
		private readonly repository: GraphRepository,
		private readonly client: ConfluenceClient = new ForgeConfluenceClient(),
	) {}

	async ingestSpace(
		input: ConfluenceIngestionInput,
	): Promise<ConfluenceIngestionResult> {
		const { tenantId, spaceId } = input;
		const maxPages = input.maxPages ?? 1000;

		if (!tenantId.trim()) {
			throw new Error("Tenant ID is required");
		}

		if (!/^\d+$/.test(spaceId)) {
			throw new Error("Invalid Confluence space ID");
		}

		if (!Number.isInteger(maxPages) || maxPages <= 0) {
			throw new Error("maxPages must be a positive integer");
		}

		const fetchedPages: ConfluencePage[] = [];
		const seenCursors = new Set<string>();

		let cursor: string | undefined;
		let baseUrl: string | undefined;

		while (fetchedPages.length < maxPages) {
			const page = await this.client.listPages(
				spaceId,
				cursor,
				Math.min(100, maxPages - fetchedPages.length),
			);

			if (!baseUrl && page._links?.base) {
				baseUrl = page._links.base;
			}

			fetchedPages.push(
				...page.results.slice(0, maxPages - fetchedPages.length),
			);

			const nextCursor = extractNextCursor(page._links?.next);

			if (!nextCursor) {
				break;
			}

			if (seenCursors.has(nextCursor)) {
				throw new Error("Confluence pagination returned a repeated cursor");
			}

			seenCursors.add(nextCursor);
			cursor = nextCursor;
		}

		for (const page of fetchedPages) {
			const node = mapConfluencePageToGraphNode(page, tenantId, baseUrl);

			await this.repository.upsertNode(node);
		}

		return {
			spaceId,
			fetchedPages: fetchedPages.length,
			persistedNodes: fetchedPages.length,
		};
	}
}
