import test from "node:test";
import assert from "node:assert/strict";

import {
	extractPageText,
	mapConfluencePageToGraphNode,
} from "../src/integrations/confluence/confluence-mapper";

import type { ConfluencePage } from "../src/integrations/confluence/confluence-types";

test("extracts readable text from Confluence storage content", () => {
	const text = extractPageText(
		"<h1>Architecture</h1><p>TraceLine &amp; Jira</p>",
	);

	assert.match(text, /Architecture/);
	assert.match(text, /TraceLine & Jira/);
});

test("removes script and style content", () => {
	const text = extractPageText(
		"<p>Visible</p><script>alert('x')</script><style>.x{}</style>",
	);

	assert.match(text, /Visible/);
	assert.doesNotMatch(text, /alert/);
	assert.doesNotMatch(text, /\.x/);
});

test("maps a Confluence page to a DOCUMENT graph node", () => {
	const page: ConfluencePage = {
		id: "12345",
		status: "current",
		title: "System Architecture",
		spaceId: "10001",
		parentId: "12300",
		authorId: "user-1",
		createdAt: "2026-01-01T10:00:00.000Z",
		version: {
			number: 3,
			createdAt: "2026-02-01T10:00:00.000Z",
		},
		body: {
			storage: {
				value: "<p>TraceLine architecture</p>",
				representation: "storage",
			},
		},
		_links: {
			webui: "/spaces/ENG/pages/12345/System+Architecture",
		},
	};

	const node = mapConfluencePageToGraphNode(
		page,
		"tenant-1",
		"https://example.atlassian.net/wiki",
	);

	assert.equal(node.id, "confluence:page:12345");
	assert.equal(node.tenantId, "tenant-1");
	assert.equal(node.type, "DOCUMENT");
	assert.equal(node.source, "CONFLUENCE");
	assert.equal(node.externalId, "12345");
	assert.equal(node.name, "System Architecture");
	assert.equal(node.description, "TraceLine architecture");
	assert.equal(node.attributes.spaceId, "10001");
	assert.equal(node.attributes.version, 3);
	assert.equal(
		node.url,
		"https://example.atlassian.net/spaces/ENG/pages/12345/System+Architecture",
	);
});

test("handles pages without a body", () => {
	const page: ConfluencePage = {
		id: "12346",
		status: "current",
		title: "Empty Page",
		spaceId: "10001",
	};

	const node = mapConfluencePageToGraphNode(page, "tenant-1");

	assert.equal(node.description, "");
	assert.equal(node.attributes.storageBody, "");
});
