/** A `fetch` that records requests and answers from `handler`, for unit tests. */
export function fakeFetch(handler: (request: Request, attempt: number) => Response | Promise<Response>) {
	const requests: Request[] = [];
	const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init);
		requests.push(request);
		return handler(request, requests.length);
	};
	return { fetch: fetch as typeof globalThis.fetch, requests };
}

export function json(body: unknown, init: ResponseInit & { headers?: Record<string, string> } = {}): Response {
	return new Response(JSON.stringify(body), {
		...init,
		headers: { 'content-type': 'application/json; charset=UTF-8', ...init.headers },
	});
}
