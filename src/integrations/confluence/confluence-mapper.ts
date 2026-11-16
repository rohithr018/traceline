import { createGraphNode } from "../../graph/models/graph-node";
import type { GraphNode } from "../../graph/models/graph-node";
import type { ConfluencePage } from "./confluence-types";

function decodeHtmlEntities(value: string): string {
	const entities: Record<string, string> = {
		"&amp;": "&",
		"&lt;": "<",
		"&gt;": ">",
		"&quot;": '"',
		"&apos;": "'",
		"&nbsp;": " ",
	};

	return value.replace(
		/&amp;|&lt;|&gt;|&quot;|&apos;|&nbsp;/g,
		(entity) => entities[entity] ?? entity,
	);
}

export function extractPageText(storageValue?: string): string {
	if (!storageValue) {
		return "";
	}

	const withoutHiddenContent = storageValue
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");

	const withLineBreaks = withoutHiddenContent.replace(
		/<\/?(?:p|div|h[1-6]|li|tr|br|blockquote|pre)[^>]*>/gi,
		"\n",
	);

	const withoutTags = withLineBreaks.replace(/<[^>]*>/g, " ");

	return decodeHtmlEntities(withoutTags)
		.replace(/[ \t]+/g, " ")
		.replace(/\n\s+/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function parseTimestamp(value?: string): number {
	if (!value) {
		return Date.now();
	}

	const timestamp = Date.parse(value);

	return Number.isNaN(timestamp) ? Date.now() : timestamp;
}

function resolvePageUrl(
	pageUrl?: string,
	baseUrl?: string,
): string | undefined {
	if (!pageUrl) {
		return undefined;
	}

	try {
		if (pageUrl.startsWith("https://") || pageUrl.startsWith("http://")) {
			return new URL(pageUrl).toString();
		}

		if (baseUrl) {
			return new URL(pageUrl, baseUrl).toString();
		}
	} catch {
		return undefined;
	}

	return undefined;
}

export function mapConfluencePageToGraphNode(
	page: ConfluencePage,
	tenantId: string,
	baseUrl?: string,
): GraphNode {
	const createdAt = parseTimestamp(page.createdAt);
	const updatedAt = parseTimestamp(page.version?.createdAt);

	const node = createGraphNode({
		id: `confluence:page:${page.id}`,
		tenantId,
		type: "DOCUMENT",
		source: "CONFLUENCE",
		externalId: page.id,
		name: page.title,
		description: extractPageText(page.body?.storage?.value),
		url: resolvePageUrl(page._links?.webui, baseUrl),
		attributes: {
			confluencePageId: page.id,
			spaceId: page.spaceId,
			parentId: page.parentId,
			status: page.status,
			authorId: page.authorId,
			version: page.version?.number,
			bodyRepresentation: page.body?.storage?.representation ?? "storage",
			storageBody: page.body?.storage?.value ?? "",
		},
	});

	return {
		...node,
		createdAt,
		updatedAt,
		lastSyncedAt: Date.now(),
	};
}
