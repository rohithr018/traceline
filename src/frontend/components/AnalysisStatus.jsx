import React from "react";
import {
	Button,
	Inline,
	SectionMessage,
	Spinner,
	Stack,
	Text,
} from "@forge/react";

export default function AnalysisStatus({
	loading,
	hasAnalyzed,
	error,
	onRetry,
}) {
	if (loading) {
		return (
			<SectionMessage appearance="information">
				<Inline alignBlock="center" space="space.100">
					<Spinner size="small" />
					<Text>
						{hasAnalyzed
							? "Refreshing impact analysis..."
							: "Analyzing dependencies and calculating risk..."}
					</Text>
				</Inline>
			</SectionMessage>
		);
	}

	if (error) {
		return (
			<SectionMessage appearance="error">
				<Stack space="space.100">
					<Text weight="semibold">
						{hasAnalyzed
							? "Could not refresh the analysis"
							: "Impact analysis failed"}
					</Text>
					<Text>{error}</Text>
					<Inline>
						<Button appearance="primary" onClick={onRetry}>
							Retry analysis
						</Button>
					</Inline>
					{hasAnalyzed && (
						<Text>Your previous successful results are still available.</Text>
					)}
				</Stack>
			</SectionMessage>
		);
	}

	return null;
}
