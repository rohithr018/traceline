import api, { route } from "@forge/api";
import type {
	ConfluenceClient,
	ConfluencePageSearchResponse,
} from "./confluence-types";

export class ForgeConfluenceClient implements ConfluenceClient {
	async listPages(
		spaceId: string,
		cursor?: string,
		limit = 100,
	): Promise<ConfluencePageSearchResponse> {
		const requestPath = cursor
			? route`/wiki/api/v2/spaces/${spaceId}/pages?limit=${limit}&body-format=storage&cursor=${cursor}`
			: route`/wiki/api/v2/spaces/${spaceId}/pages?limit=${limit}&body-format=storage`;

		const response = await api.asApp().requestConfluence(requestPath, {
			headers: {
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			const errorBody = await response.text();

			throw new Error(
				`Confluence page retrieval failed (${response.status}): ${errorBody}`,
			);
		}

		return (await response.json()) as ConfluencePageSearchResponse;
	}
}
