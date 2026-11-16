import React from "react";
import { Inline, Stack, Text } from "@forge/react";
import { formatNumber, formatPercent, getFactorLabel } from "../utils/formatters";

export default function RiskFactorRow({ contributor }) {
	return (
		<Stack space="space.050">
			<Inline alignBlock="center" spread="space-between">
				<Text weight="bold">{getFactorLabel(contributor.factor)}</Text>

				<Text weight="bold">
					{formatNumber(contributor.contribution)} pts
				</Text>
			</Inline>

			<Text>{contributor.explanation}</Text>

			<Inline alignBlock="center" spread="space-between">
				<Text>Value: {formatNumber(contributor.value, 0)}/100</Text>

				<Text>Weight: {formatPercent(contributor.weight)}</Text>
			</Inline>
		</Stack>
	);
}
