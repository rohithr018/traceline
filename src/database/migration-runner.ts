import { runMigrations } from "./migrations";

const RETRY_TIMEOUT_MS = 60_000;
const RETRY_INTERVAL_MS = 2_000;

export async function runMigration(): Promise<void> {
	const deadline = Date.now() + RETRY_TIMEOUT_MS;

	let lastError: unknown;

	while (Date.now() < deadline) {
		try {
			await runMigrations();
			return;
		} catch (error) {
			lastError = error;

			console.warn("TraceLine migration failed. Retrying.", error);

			await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
		}
	}

	throw lastError ?? new Error("Migration failed.");
}
