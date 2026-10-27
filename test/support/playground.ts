/**
 * Starts a throwaway WordPress with WordPress Playground (PHP compiled to
 * WebAssembly, running in Node), so tests run against real WordPress without
 * Docker or a database server.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

export interface Playground {
	url: string;
	stop(): Promise<void>;
}

export interface PlaygroundOptions {
	/** Blueprint path, relative to the project root. */
	blueprint: string;
	/** A host directory to expose inside WordPress at `wp-content/sdk-test`. */
	mount?: string;
	/** The port to listen on. Defaults to a free one. */
	port?: number;
	/** How long to wait for WordPress to answer, in milliseconds. */
	timeout?: number;
}

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.unref();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address ? address.port : 0;
			server.close(() => resolve(port));
		});
	});
}

function exited(child: ChildProcess): Promise<void> {
	return new Promise((resolve) => {
		if (child.exitCode !== null) resolve();
		else child.once('exit', () => resolve());
	});
}

export async function startPlayground(options: PlaygroundOptions): Promise<Playground> {
	const port = options.port ?? (await freePort());
	const url = `http://127.0.0.1:${port}`;
	const args = ['server', `--port=${port}`, `--blueprint=${options.blueprint}`, '--verbosity=quiet'];
	if (options.mount) args.push(`--mount=${options.mount}:/wordpress/wp-content/sdk-test`);

	const child = spawn(`${root}node_modules/.bin/wp-playground-cli`, args, {
		cwd: root,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let output = '';
	child.stdout?.on('data', (chunk) => {
		output += chunk;
	});
	child.stderr?.on('data', (chunk) => {
		output += chunk;
	});

	const stop = async () => {
		if (child.exitCode !== null) return;
		child.kill('SIGTERM');
		const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
		await exited(child);
		clearTimeout(timer);
	};

	const deadline = Date.now() + (options.timeout ?? 180_000);
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error(`WordPress Playground exited early:\n${output}`);
		try {
			const response = await fetch(`${url}/wp-json/`, { signal: AbortSignal.timeout(3000) });
			if (response.ok) return { url, stop };
		} catch {
			// Not listening yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	await stop();
	throw new Error(`WordPress Playground didn't start within ${options.timeout ?? 180_000} ms:\n${output}`);
}
