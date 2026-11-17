import React, { useState } from "react";
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

function getWorkspaceLabel(repository) {
	return repository.fullName || repository.name || repository.repositoryUuid;
}

export default function WorkspacePairingPanel({ repositories = [], onRefresh, onPairingChange }) {
	const [workspaceUuid, setWorkspaceUuid] = useState("");
	const [pairing, setPairing] = useState(null);
	const [receipt, setReceipt] = useState(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [message, setMessage] = useState("");

	const knownWorkspaces = [
		...new Map(
			repositories
				.filter((repository) => repository.workspaceUuid)
				.map((repository) => [repository.workspaceUuid, repository]),
		).values(),
	];

	async function checkPairing(value = workspaceUuid) {
		const target = value.trim();
		if (!target) {
			setError("Enter a Bitbucket workspace UUID first.");
			return;
		}

		setBusy(true);
		setError("");
		setMessage("");
		setReceipt(null);
		try {
			const response = await invoke("bridge.getPairingStatus", {
				workspaceUuid: target,
			});
			if (!response?.ok) {
				throw new Error(response?.error?.message ?? "Could not check pairing status.");
			}
			setWorkspaceUuid(response.data.workspaceUuid || target);
			setPairing(response.data);
			onPairingChange?.(response.data);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not check pairing status.");
		} finally {
			setBusy(false);
		}
	}

	async function pairWorkspace(rotate = false) {
		if (!workspaceUuid.trim()) {
			setError("Enter a Bitbucket workspace UUID first.");
			return;
		}

		setBusy(true);
		setError("");
		setMessage("");
		setReceipt(null);
		try {
			const response = await invoke(
				rotate ? "bridge.rotateWorkspaceSecret" : "bridge.pairWorkspace",
				{ workspaceUuid: workspaceUuid.trim() },
			);
			if (!response?.ok) {
				throw new Error(response?.error?.message ?? "Workspace pairing failed.");
			}
			setReceipt(response.data);
				const pairingStatus = { workspaceUuid: response.data.workspaceUuid, paired: false, status: "PENDING" };
			setPairing(pairingStatus);
			onPairingChange?.(pairingStatus);
				setMessage(
					rotate
						? "The shared secret was rotated. Pairing will become active after the companion confirms the new configuration."
						: "The secret was stored securely. Pairing will become active after the companion confirms its configuration.",
				);
			onRefresh?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Workspace pairing failed.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Stack space="space.150">
			<Stack space="space.050">
				<Heading size="medium">Bitbucket workspace pairing</Heading>
				<Text color="color.text.subtle">
					Pairing is restricted to Jira site administrators. Enter the workspace UUID shown in Bitbucket or the companion app. The shared secret is shown once and must be entered in the Bitbucket companion app.
				</Text>
			</Stack>

			{knownWorkspaces.length > 0 && (
				<Stack space="space.050">
					<Text weight="semibold">Workspaces seen in connected repositories</Text>
					{knownWorkspaces.map((repository) => (
						<Inline key={repository.workspaceUuid} alignBlock="center" spread="space-between" shouldWrap>
							<Text>{getWorkspaceLabel(repository)} · {repository.paired ? "Paired" : "Not paired"}</Text>
							<Button
								appearance="subtle"
								onClick={() => {
									setWorkspaceUuid(repository.workspaceUuid);
									checkPairing(repository.workspaceUuid);
								}}
							>
								Check
							</Button>
						</Inline>
					))}
				</Stack>
			)}

			<Stack space="space.050">
				<Text weight="semibold">Bitbucket workspace UUID</Text>
				<Textfield
					name="bitbucket-workspace-uuid"
					placeholder="{xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx}"
					value={workspaceUuid}
					onChange={(event) => setWorkspaceUuid(event?.target?.value ?? "")}
				/>
			</Stack>

			<Inline space="space.100" shouldWrap>
				<Button appearance="default" onClick={() => checkPairing()} isDisabled={busy || !workspaceUuid.trim()}>
					Check pairing
				</Button>
				{pairing?.paired ? (
					<Button appearance="primary" onClick={() => pairWorkspace(true)} isDisabled={busy}>
						Rotate shared secret
					</Button>
				) : (
					<Button appearance="primary" onClick={() => pairWorkspace(false)} isDisabled={busy || !workspaceUuid.trim()}>
						Pair workspace
					</Button>
				)}
			</Inline>

			{busy && (
				<Inline alignBlock="center" space="space.100">
					<Spinner size="small" />
					<Text>Updating workspace pairing...</Text>
				</Inline>
			)}

			{pairing && !receipt && (
				<SectionMessage appearance={pairing.paired ? "confirmation" : "information"}>
					<Text>
						{pairing.paired
								? `Workspace ${pairing.workspaceUuid} is actively paired with this TraceLine site.`
								: pairing.status === "PENDING"
									? `Workspace ${pairing.workspaceUuid} is awaiting secure confirmation from the Bitbucket companion.`
									: `Workspace ${pairing.workspaceUuid} is not paired with this TraceLine site.`}
					</Text>
				</SectionMessage>
			)}

			{message && <SectionMessage appearance="confirmation"><Text>{message}</Text></SectionMessage>}
			{error && (
				<SectionMessage appearance="error">
					<Stack space="space.100">
						<Text>{error}</Text>
						<Button appearance="subtle" onClick={() => checkPairing()} isDisabled={busy}>Retry status check</Button>
					</Stack>
				</SectionMessage>
			)}

			{receipt && (
				<SectionMessage appearance="warning">
					<Stack space="space.100">
							<Text weight="bold">Configure the Bitbucket companion now.</Text>
						<Text>The secret will not be shown again after you dismiss this message. Rotate it if it is lost.</Text>
						<Text weight="semibold">TraceLine receiver URL</Text>
						<Text>{receipt.bridgeReceiverUrl}</Text>
						<Text weight="semibold">Shared secret</Text>
						<Text>{receipt.secret}</Text>
							<Button appearance="primary" onClick={() => setReceipt(null)}>I configured the companion</Button>
					</Stack>
				</SectionMessage>
			)}
		</Stack>
	);
}
