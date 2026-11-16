export interface ConfluencePageBody {
	storage?: {
		value?: string;
		representation?: string;
	};
}

export interface ConfluencePageVersion {
	number?: number;
	createdAt?: string;
	message?: string;
	authorId?: string;
}

export interface ConfluencePage {
	id: string;
	status: string;
	title: string;
	spaceId: string;
	parentId?: string;
	authorId?: string;
	createdAt?: string;
	version?: ConfluencePageVersion;
	body?: ConfluencePageBody;
	_links?: {
		webui?: string;
	};
}

export interface ConfluencePageSearchResponse {
	results: ConfluencePage[];
	_links?: {
		next?: string;
		base?: string;
	};
}

export interface ConfluenceClient {
	listPages(
		spaceId: string,
		cursor?: string,
		limit?: number,
	): Promise<ConfluencePageSearchResponse>;
}
