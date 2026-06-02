import { env } from '../config/env.js';

export class ShopifyError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'ShopifyError';
  }
}

type GraphQLResponse<T> = { data?: T; errors?: Array<{ message: string }> };

interface GraphQLClient {
  query<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

function makeClient(url: string, headers: Record<string, string>): GraphQLClient {
  return {
    async query<T = unknown>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ query, variables }),
        });
      } catch (e) {
        throw new ShopifyError(`Network error calling Shopify: ${(e as Error).message}`, e);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new ShopifyError(`Shopify HTTP ${res.status}: ${body.slice(0, 500)}`);
      }
      const json = (await res.json()) as GraphQLResponse<T>;
      if (json.errors && json.errors.length > 0) {
        throw new ShopifyError(`Shopify GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`);
      }
      if (!json.data) {
        throw new ShopifyError('Shopify returned no data');
      }
      return json.data;
    },
  };
}

export const adminClient: GraphQLClient = makeClient(
  `https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
  { 'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_ACCESS_TOKEN }
);

export const storefrontClient: GraphQLClient = makeClient(
  `https://${env.SHOPIFY_STORE_DOMAIN}/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
  { 'X-Shopify-Storefront-Access-Token': env.SHOPIFY_STOREFRONT_ACCESS_TOKEN }
);

// High-level helpers used by routes. These wrap the raw clients and translate
// Shopify-specific userErrors into ShopifyError so handlers see one error type.
//
// Auth is owned by Postgres + own session cookies. Shopify holds only the
// customer record (email, name) for orders/marketing. Shopify's Admin API
// removed `password` from CustomerInput in 2024+ as part of the Customer
// Accounts migration, so we never sync passwords to Shopify.

export interface ShopifyCustomerCreate {
  email: string;
  firstName?: string;
  lastName?: string;
}

export async function adminCustomerCreate(input: ShopifyCustomerCreate): Promise<string> {
  const data = await adminClient.query<{
    customerCreate: {
      customer: { id: string } | null;
      userErrors: Array<{ message: string; field?: string[] }>;
    };
  }>(
    `mutation CustomerCreate($input: CustomerInput!) {
       customerCreate(input: $input) {
         customer { id }
         userErrors { message field }
       }
     }`,
    {
      input: {
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
      },
    }
  );

  if (data.customerCreate.customer) {
    return data.customerCreate.customer.id;
  }

  // If the email is already a customer in Shopify (e.g. seeded by another
  // integration), reuse the existing record instead of failing. The Postgres
  // user becomes the auth-of-truth and just points at that gid.
  if (isEmailTakenError(data.customerCreate.userErrors)) {
    const existing = await adminCustomerFindByEmail(input.email);
    if (existing) return existing;
  }

  throw new ShopifyError(
    `customerCreate userErrors: ${JSON.stringify(data.customerCreate.userErrors)}`
  );
}

function isEmailTakenError(
  userErrors: Array<{ message: string; field?: string[] }>
): boolean {
  return userErrors.some((e) => {
    const msg = (e.message || '').toLowerCase();
    const field = (e.field || []).map((f) => f.toLowerCase());
    return field.includes('email') && (msg.includes('taken') || msg.includes('already'));
  });
}

export async function adminCustomerFindByEmail(email: string): Promise<string | null> {
  const data = await adminClient.query<{
    customers: { edges: Array<{ node: { id: string; email: string | null } }> };
  }>(
    `query FindByEmail($q: String!) {
       customers(first: 5, query: $q) {
         edges { node { id email } }
       }
     }`,
    { q: `email:${email}` }
  );
  const target = email.trim().toLowerCase();
  const match = data.customers.edges.find(
    (edge) => (edge.node.email || '').trim().toLowerCase() === target
  );
  return match ? match.node.id : null;
}

export async function adminCustomerDelete(customerId: string): Promise<void> {
  await adminClient.query(
    `mutation CustomerDelete($input: CustomerDeleteInput!) {
       customerDelete(input: $input) {
         deletedCustomerId
         userErrors { message }
       }
     }`,
    { input: { id: customerId } }
  );
  // best-effort: do not throw on userErrors — caller is already in a failure path
}
