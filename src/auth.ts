/**
 * Authentication. WordPress has application passwords built in; cookie
 * authentication works in the browser with a `wp_rest` nonce; plugins add
 * bearer tokens (JWT, OAuth). Anything else can be done with a function.
 */

export type Auth =
	/** An application password, sent with HTTP Basic authentication. */
	| { username: string; password: string }
	/** A bearer token, from a JWT or OAuth plugin. */
	| { token: string }
	/** The logged-in user's cookies plus a `wp_rest` nonce, for code running in wp-admin or a theme. */
	| { nonce: string }
	/** Sets whatever headers the site needs. */
	| ((request: { method: string; url: string; headers: Headers }) => void | Promise<void>);

/** Base64 of UTF-8 text, without Node's `Buffer`, so it runs anywhere `fetch` does. */
function base64(text: string): string {
	let binary = '';
	for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/** Adds `auth` to an outgoing request. */
export async function authorize(
	auth: Auth | undefined,
	request: { method: string; url: string; headers: Headers },
	init: RequestInit,
): Promise<void> {
	if (!auth) return;
	if (typeof auth === 'function') {
		await auth(request);
	} else if ('username' in auth) {
		request.headers.set('authorization', `Basic ${base64(`${auth.username}:${auth.password}`)}`);
	} else if ('token' in auth) {
		request.headers.set('authorization', `Bearer ${auth.token}`);
	} else {
		request.headers.set('x-wp-nonce', auth.nonce);
		init.credentials = 'include';
	}
}

export interface AuthorizationRequest {
	/** Shown to the user on the approval screen. */
	appName: string;
	/** A UUID identifying your app across sites. */
	appId?: string;
	/** Where WordPress sends the user, with the new password, after they approve. Must be HTTPS outside local development. */
	successUrl?: string;
	/** Where WordPress sends the user if they decline. Defaults to `successUrl` with `success=false`. */
	rejectUrl?: string;
}

/**
 * The page where a user approves an application password for your app.
 * `endpoint` is the site's `authorize-application.php`, which
 * `client.authorizationEndpoint()` reads from the site.
 */
export function authorizationUrl(endpoint: string, request: AuthorizationRequest): string {
	const url = new URL(endpoint);
	url.searchParams.set('app_name', request.appName);
	if (request.appId) url.searchParams.set('app_id', request.appId);
	if (request.successUrl) url.searchParams.set('success_url', request.successUrl);
	if (request.rejectUrl) url.searchParams.set('reject_url', request.rejectUrl);
	return url.toString();
}

export type AuthorizationResult =
	| { approved: true; siteUrl: string; username: string; password: string }
	| { approved: false };

/** Reads the URL WordPress redirected back to after the user approved or declined. */
export function parseAuthorization(callbackUrl: string | URL): AuthorizationResult {
	const params = new URL(callbackUrl).searchParams;
	const username = params.get('user_login');
	const password = params.get('password');
	if (params.get('success') === 'false' || !username || !password) return { approved: false };
	return { approved: true, siteUrl: params.get('site_url') ?? '', username, password };
}
