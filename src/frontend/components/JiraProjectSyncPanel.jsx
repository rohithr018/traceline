import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@forge/bridge";
import {
	Button,
	Heading,
	Inline,
	SectionMessage,
	Spinner,
	Stack,
	Text,
	Textfield,
} from "@forge/react";

import { formatTimestamp } from "../utils/formatters";

export default function JiraProjectSyncPanel({ onReadinessChange, initialReadiness = null }) {
	const [projectKey, setProjectKey] = useState(initialReadiness?.projectKey ?? "");
	const [readiness, setReadiness] = useState(initialReadiness);
	const [status, setStatus] = useState(initialReadiness?.syncStatus ?? null);
	const [syncing, setSyncing] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const startedAt = useRef(null);
	const projectKeyRef = useRef(projectKey);
	projectKeyRef.current = projectKey;

	function reportReadiness(value) {
		onReadinessChange?.(value);
	}

	function updateProjectKey(value) {
		const nextKey = value.toUpperCase();
		setProjectKey(nextKey);
		setReadiness(null);
		setStatus(null);
		setError("");
		reportReadiness(nextKey ? { projectKey: nextKey, accessible: false, syncStatus: "UNCHECKED", indexedIssueCount: null } : null);
	}

	async function fetchReadiness(key) {
		const response = await invoke("setup.checkJiraProject", { projectKey: key });
		if (!response?.ok) {
			throw new Error(response?.error?.message ?? "Could not check Jira project readiness.");
		}
		return response.data;
	}

	async function refreshStatus() {
		const normalizedKey = projectKey.trim().toUpperCase();
		if (!normalizedKey) {
			setError("Enter a Jira project key first.");
			return;
		}
		setBusy(true);
		setError("");
		try {
			const result = await fetchReadiness(normalizedKey);
			setReadiness(result);
			setStatus(result.syncStatus);
			setSyncing(["QUEUED", "IN_PROGRESS"].includes(result.syncStatus));
			startedAt.current = Date.now();
			reportReadiness(result);
		} catch (err) {
			setReadiness(null);
			setError(err instanceof Error ? err.message : "Could not check Jira project readiness.");
			reportReadiness({ projectKey: normalizedKey, accessible: false, syncStatus: "UNKNOWN", indexedIssueCount: null, error: err instanceof Error ? err.message : "Could not check Jira project readiness." });
		} finally {
			setBusy(false);
		}
	}

	async function startSync() {
		const normalizedKey = projectKey.trim().toUpperCase();
		if (!normalizedKey) {
			setError("Enter a Jira project key first.");
			return;
		}
		setBusy(true);
		setError("");
		try {
			const response = await invoke("jira.syncProject", { projectKey: normalizedKey });
			if (!response?.ok) {
				throw new Error(response?.error?.message ?? "Could not start Jira synchronization.");
			}
			setStatus(response.data.status);
			setSyncing(["QUEUED", "IN_PROGRESS"].includes(response.data.status));
			startedAt.current = Date.now();
			if (!response.data.status || response.data.status === "SUCCEEDED") {
				await refreshStatus();
			} else {
				reportReadiness({
					...(readiness?.projectKey === normalizedKey ? readiness : {}),
					projectKey: normalizedKey,
					accessible: true,
					syncStatus: response.data.status,
				});
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : "Could not start Jira synchronization.";
			setError(message);
			reportReadiness({ projectKey: normalizedKey, accessible: false, syncStatus: "UNKNOWN", indexedIssueCount: null, error: message });
		} finally {
			setBusy(false);
		}
	}

	useEffect(() => {
		if (!syncing || !projectKey) return undefined;
		let cancelled = false;
		let timeoutId;

		async function poll() {
			if (startedAt.current && Date.now() - startedAt.current > 10 * 60 * 1000) {
				setSyncing(false);
				setError("Synchronization is taking longer than expected. Check the status again before retrying.");
				return;
			}
			try {
				const response = await invoke("jira.getSyncStatus", {
					projectKey: projectKeyRef.current.trim().toUpperCase(),
				});
				if (cancelled) return;
				if (!response?.ok) {
					throw new Error(response?.error?.message ?? "Could not retrieve sync status.");
				}
				const checkpoint = response.data;
				const nextStatus = checkpoint?.status ?? "NOT_STARTED";
				setStatus(nextStatus);
				if (["QUEUED", "IN_PROGRESS"].includes(nextStatus)) {
					timeoutId = setTimeout(poll, 2500);
					return;
				}
				setSyncing(false);
				if (nextStatus === "SUCCEEDED") {
					const result = await fetchReadiness(projectKeyRef.current.trim().toUpperCase());
					if (cancelled) return;
					setReadiness(result);
					reportReadiness(result);
				} else {
					const updated = {
						...(readiness ?? {}),
						projectKey: projectKeyRef.current.trim().toUpperCase(),
						accessible: true,
						indexedIssueCount: readiness?.indexedIssueCount ?? null,
						syncStatus: nextStatus,
						lastSuccessfulSyncAt:
							checkpoint?.lastSuccessfulSyncAt ?? readiness?.lastSuccessfulSyncAt ?? null,
						lastSyncError:
							nextStatus === "FAILED" ? checkpoint?.lastError ?? "Jira synchronization failed." : null,
					};
					setReadiness(updated);
					reportReadiness(updated);
				}
			} catch (err) {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : "Could not retrieve sync status.");
				setSyncing(false);
			}
		}

		timeoutId = setTimeout(poll, 1000);
		return () => {
			cancelled = true;
			if (timeoutId) clearTimeout(timeoutId);
		};
	}, [syncing, projectKey]);

	return (
		<Stack space="space.150">
			<Stack space="space.050">
				<Heading size="medium">Jira project synchronization</Heading>
				<Text color="color.text.subtle">Check project access and indexed issue count, then sync a project you can access.</Text>
			</Stack>
			<Inline alignBlock="center" space="space.100" shouldWrap>
				<Stack grow="fill" space="space.050">
					<Text weight="semibold">Project key</Text>
					<Textfield
						name="jira-project-key"
						placeholder="PAY"
						value={projectKey}
						isDisabled={busy || syncing}
						onChange={(event) => updateProjectKey(event?.target?.value ?? "")}
					/>
				</Stack>
				<Button appearance="primary" onClick={startSync} isDisabled={busy || syncing || !projectKey.trim()}>
					{busy ? "Starting..." : syncing ? "Sync in progress..." : "Sync project"}
				</Button>
				<Button appearance="subtle" onClick={refreshStatus} isDisabled={busy || syncing || !projectKey.trim()}>
					Check access and status
				</Button>
			</Inline>

			{syncing && <Inline alignBlock="center" space="space.100"><Spinner size="small" /><Text>{status === "QUEUED" ? "Sync queued..." : "Importing issues and relationships..."}</Text></Inline>}

			{readiness && (
				<SectionMessage appearance={readiness.syncStatus === "SUCCEEDED" && readiness.indexedIssueCount > 0 ? "confirmation" : "information"}>
					<Stack space="space.050">
						<Text weight="bold">{readiness.projectKey} · Jira project access verified</Text>
						<Text>{readiness.indexedIssueCount} actual Jira issue(s) indexed in TraceLine.</Text>
						<Text>Latest sync: {readiness.syncStatus}</Text>
						{readiness.lastSuccessfulSyncAt && <Text>Last successful sync: {formatTimestamp(readiness.lastSuccessfulSyncAt)}</Text>}
						{readiness.lastSyncError && <Text>Latest sync error: {readiness.lastSyncError}</Text>}
						{readiness.syncStatus === "SUCCEEDED" && readiness.indexedIssueCount === 0 && <Text>The sync completed, but no non-placeholder Jira issues are indexed for this project.</Text>}
						{readiness.syncStatus !== "SUCCEEDED" && <Text>Run Sync project to ingest issues and relationships for this project.</Text>}
					</Stack>
				</SectionMessage>
			)}

			{status === "NOT_STARTED" && !readiness && (
				<SectionMessage appearance="information"><Text>No sync checkpoint was found. Check project access or run the first sync.</Text></SectionMessage>
			)}

			{error && <SectionMessage appearance="error"><Stack space="space.100"><Text>{error}</Text><Button appearance="subtle" onClick={refreshStatus} isDisabled={busy || syncing || !projectKey.trim()}>Retry access and status check</Button></Stack></SectionMessage>}
		</Stack>
	);
}
