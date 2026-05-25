import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { adminClient, storefrontClient, ShopifyError } from '../../src/lib/shopify.js';

describe('adminClient.query', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  test('POSTs to /admin/api/<version>/graphql.json with token header', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })
    );
    await adminClient.query('query { __typename }', { foo: 1 });
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://test.myshopify.com/admin/api/2025-01/graphql.json');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Shopify-Access-Token']).toBe('test-admin-token');
    expect(JSON.parse(init.body)).toEqual({ query: 'query { __typename }', variables: { foo: 1 } });
  });

  test('throws ShopifyError on GraphQL errors', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ errors: [{ message: 'boom' }] }), { status: 200 })
    );
    await expect(adminClient.query('{ x }')).rejects.toThrow(ShopifyError);
  });

  test('throws ShopifyError on non-2xx HTTP status', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('nope', { status: 500 })
    );
    await expect(adminClient.query('{ x }')).rejects.toThrow(ShopifyError);
  });

  test('returns data on success', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { hello: 'world' } }), { status: 200 })
    );
    const result = await adminClient.query<{ hello: string }>('{ hello }');
    expect(result).toEqual({ hello: 'world' });
  });
});

describe('storefrontClient.query', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  test('POSTs to /api/<version>/graphql.json with storefront token header', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })
    );
    await storefrontClient.query('query { __typename }');
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://test.myshopify.com/api/2025-01/graphql.json');
    expect(init.headers['X-Shopify-Storefront-Access-Token']).toBe('test-storefront-token');
  });
});
