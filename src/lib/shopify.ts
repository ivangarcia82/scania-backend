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

export interface ShopifyCustomerCreate {
  email: string;
  password: string;
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
        password: input.password,
        firstName: input.firstName,
        lastName: input.lastName,
      },
    }
  );
  if (data.customerCreate.userErrors.length > 0 || !data.customerCreate.customer) {
    throw new ShopifyError(
      `customerCreate userErrors: ${JSON.stringify(data.customerCreate.userErrors)}`
    );
  }
  return data.customerCreate.customer.id;
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

export async function adminCustomerUpdatePassword(customerId: string, password: string): Promise<void> {
  const data = await adminClient.query<{
    customerUpdate: { userErrors: Array<{ message: string }> };
  }>(
    `mutation CustomerUpdate($input: CustomerInput!) {
       customerUpdate(input: $input) {
         customer { id }
         userErrors { message field }
       }
     }`,
    { input: { id: customerId, password } }
  );
  if (data.customerUpdate.userErrors.length > 0) {
    throw new ShopifyError(
      `customerUpdate userErrors: ${JSON.stringify(data.customerUpdate.userErrors)}`
    );
  }
}

export interface StorefrontAccessToken {
  accessToken: string;
  expiresAt: string;
}

export async function storefrontCustomerAccessTokenCreate(
  email: string,
  password: string
): Promise<StorefrontAccessToken> {
  const data = await storefrontClient.query<{
    customerAccessTokenCreate: {
      customerAccessToken: { accessToken: string; expiresAt: string } | null;
      customerUserErrors: Array<{ message: string; code?: string; field?: string[] }>;
    };
  }>(
    `mutation TokenCreate($input: CustomerAccessTokenCreateInput!) {
       customerAccessTokenCreate(input: $input) {
         customerAccessToken { accessToken expiresAt }
         customerUserErrors { code message field }
       }
     }`,
    { input: { email, password } }
  );
  if (!data.customerAccessTokenCreate.customerAccessToken) {
    throw new ShopifyError(
      `customerAccessTokenCreate failed: ${JSON.stringify(data.customerAccessTokenCreate.customerUserErrors)}`
    );
  }
  return data.customerAccessTokenCreate.customerAccessToken;
}
