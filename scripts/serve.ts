/**
 * `pnpm wp`: runs the test site on http://127.0.0.1:9400 until interrupted,
 * for trying the SDK by hand or running the integration tests against it.
 */

import { writeFile } from 'node:fs/promises';
import { startTestSite } from '../test/support/site.js';

const site = await startTestSite({ port: 9400 });
await writeFile('.wp-credentials.json', `${JSON.stringify({ admin: site.admin, author: site.author }, null, '\t')}\n`);
console.log(`WordPress is running at ${site.url}. Press Ctrl+C to stop it.

Log in at ${site.url}/wp-admin with one of these:
  admin   password      (an administrator)
  author  author-pass   (an author)

.wp-credentials.json has both users' application passwords. Those are for API requests only;
the login page doesn't accept them. To run the integration tests against this site:
  WORDPRESS_URL=${site.url} WORDPRESS_CREDENTIALS=.wp-credentials.json pnpm test:integration`);

const stop = async () => {
	await site.stop();
	process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
