/**
 * The WordPress the integration tests run against: stock WordPress plus a
 * `book` post type with a `genre` taxonomy and registered meta, an author
 * account, application passwords for both users, and 23 published posts.
 */

import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPlayground } from './playground.js';

export interface Credentials {
	username: string;
	password: string;
}

export interface TestSite {
	url: string;
	admin: Credentials;
	author: Credentials;
	stop(): Promise<void>;
}

const plugin = fileURLToPath(new URL('../wp/sdk-test-plugin.php', import.meta.url));

/**
 * WordPress can answer before the blueprint's last step has run. That step
 * writes the credentials last, so their arrival means seeding is done.
 */
async function waitForFile(path: string, timeout = 60_000): Promise<string> {
	const deadline = Date.now() + timeout;
	for (;;) {
		try {
			return await readFile(path, 'utf8');
		} catch (error) {
			if (Date.now() > deadline) throw error;
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}
}

export async function startTestSite(options: { port?: number } = {}): Promise<TestSite> {
	// The blueprint copies the plugin from, and writes credentials to, this folder.
	const dir = await mkdtemp(join(tmpdir(), 'wordpress-rest-sdk-'));
	await copyFile(plugin, join(dir, 'sdk-test-plugin.php'));
	const server = await startPlayground({ blueprint: 'test/blueprint.json', mount: dir, port: options.port });
	try {
		const credentials = JSON.parse(await waitForFile(join(dir, 'credentials.json'))) as {
			admin: Credentials;
			author: Credentials;
		};
		return {
			url: server.url,
			...credentials,
			async stop() {
				await server.stop();
				await rm(dir, { recursive: true, force: true });
			},
		};
	} catch (error) {
		await server.stop();
		throw error;
	}
}
