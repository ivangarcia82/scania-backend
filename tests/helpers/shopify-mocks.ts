import { vi } from 'vitest';

export function mockShopifyFetchSuccess(
  responses: Array<{ matches?: (url: string) => boolean; data: unknown }>
) {
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    const match = responses.find((r) => (r.matches ? r.matches(u) : true));
    if (!match) {
      return new Response(JSON.stringify({ errors: [{ message: 'no mock for ' + u }] }), { status: 500 });
    }
    return new Response(JSON.stringify({ data: match.data }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function mockShopifyFetchFailure(opts: {
  status?: number;
  userErrors?: Array<{ message: string }>;
  graphqlErrors?: Array<{ message: string }>;
}) {
  const fetchMock = vi.fn(async () => {
    if (opts.graphqlErrors) {
      return new Response(JSON.stringify({ errors: opts.graphqlErrors }), { status: 200 });
    }
    if (opts.userErrors) {
      return new Response(
        JSON.stringify({
          data: {
            customerCreate: { customer: null, userErrors: opts.userErrors },
            customerUpdate: { customer: null, userErrors: opts.userErrors },
            customerAccessTokenCreate: { customerAccessToken: null, customerUserErrors: opts.userErrors },
          },
        }),
        { status: 200 }
      );
    }
    return new Response('error', { status: opts.status ?? 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export const ADMIN_CUSTOMER_CREATE_OK = {
  customerCreate: {
    customer: { id: 'gid://shopify/Customer/9999' },
    userErrors: [],
  },
};

export const ADMIN_CUSTOMER_UPDATE_OK = {
  customerUpdate: {
    customer: { id: 'gid://shopify/Customer/9999' },
    userErrors: [],
  },
};

export const ADMIN_CUSTOMER_DELETE_OK = {
  customerDelete: {
    deletedCustomerId: 'gid://shopify/Customer/9999',
    userErrors: [],
  },
};

export const STOREFRONT_TOKEN_OK = {
  customerAccessTokenCreate: {
    customerAccessToken: {
      accessToken: 'storefront-token-xyz',
      expiresAt: '2026-12-31T23:59:59Z',
    },
    customerUserErrors: [],
  },
};
