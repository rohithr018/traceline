import React from "react";
import {
	Button,
	Heading,
	Inline,
	SectionMessage,
	Spinner,
	Stack,
	Text,
} from "@forge/react";

import { formatTimestamp } from "../utils/formatters";

export default function SyncPanel({
	projectKey,
	syncProjectKey,
	syncing,
	loading,
	syncStatus,
	syncResult,
	syncError,
	onSync,
}) {
	const isSyncingCurrentProject = syncing && syncProjectKey === projectKey;
	const isCurrentProject = syncProjectKey === projectKey;
	const visibleSyncResult = isCurrentProject ? syncResult : null;
	const visibleSyncStatus = isCurrentProject ? syncStatus : null;
	const visibleSyncError = isCurrentProject ? syncError : "";

	return (
		<Stack space="space.100">
			<Heading size="medium">Jira synchronization</Heading>

			<Button
				appearance="primary"
				onClick={onSync}
				isDisabled={syncing || loading || !projectKey}
			>
				{syncing
					? isSyncingCurrentProject
						? "Synchronization in progress..."
						: `Sync in progress for ${syncProjectKey ?? "another project"}`
					: "Sync Jira project"}
			</Button>

			{!projectKey && (
				<SectionMessage appearance="warning">
					<Text>A Jira project key is unavailable for this issue.</Text>
				</SectionMessage>
			)}

			{syncing && !isSyncingCurrentProject && (
				<SectionMessage appearance="information">
					<Text>
						A synchronization for {syncProjectKey} is still running. Wait for it to
						finish before starting another project sync.
					</Text>
				</SectionMessage>
			)}

			{visibleSyncStatus === "QUEUED" && (
				<SectionMessage appearance="information">
					<Text>
						Synchronization has been queued and is waiting for a worker.
					</Text>
				</SectionMessage>
			)}

			{visibleSyncStatus === "IN_PROGRESS" && (
				<Inline alignBlock="center" space="space.100">
					<Spinner size="small" />
					<Text>Importing Jira issues and relationships...</Text>
				</Inline>
			)}

			{visibleSyncResult && (
				<SectionMessage appearance="confirmation">
					<Stack space="space.100">
						<Text weight="bold">Project synchronization completed.</Text>

						<Text>
							Last successful sync:{" "}
								{formatTimestamp(visibleSyncResult.lastSuccessfulSyncAt)}
						</Text>

						{visibleSyncResult.result && (
							<>
								{visibleSyncResult.result.fetchedIssues !== undefined && (
									<Text>Issues fetched: {visibleSyncResult.result.fetchedIssues}</Text>
								)}

								{visibleSyncResult.result.persistedNodes !== undefined && (
									<Text>
										Nodes persisted: {visibleSyncResult.result.persistedNodes}
									</Text>
								)}

								{visibleSyncResult.result.placeholderNodes !== undefined && (
									<Text>
										Placeholder nodes: {visibleSyncResult.result.placeholderNodes}
									</Text>
								)}

								{visibleSyncResult.result.persistedEdges !== undefined && (
									<Text>
										Relationships persisted: {visibleSyncResult.result.persistedEdges}
									</Text>
								)}
							</>
						)}
					</Stack>
				</SectionMessage>
			)}

			{visibleSyncError && (
				<SectionMessage appearance="error">
					<Text>{visibleSyncError}</Text>
				</SectionMessage>
			)}
		</Stack>
	);
}
