# Integrating with the Shopify Theme

The backend is deployed at `https://<your-backend>.up.railway.app`. The theme runs on `https://scania.generandoideas.com` and/or `https://scania-mexico.myshopify.com`. All requests must be `credentials: 'include'` so the session cookie is sent and stored.

Save the API base in a settings file or as a `<script>` constant injected from `theme.liquid`:

```liquid
{% comment %} layout/theme.liquid {% endcomment %}
<script>
  window.SCANIA_AUTH_API = "https://<your-backend>.up.railway.app/api/v1";
</script>
```

## Register form

```liquid
{% comment %} sections/register-form.liquid {% endcomment %}
<form id="register-form">
  <input name="email" type="email" required />
  <input name="password" type="password" minlength="8" required />
  <input name="firstName" />
  <input name="lastName" />
  <button type="submit">Crear cuenta</button>
  <p class="error" hidden></p>
</form>

<script>
  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const errorEl = form.querySelector('.error');
    errorEl.hidden = true;

    const res = await fetch(`${window.SCANIA_AUTH_API}/auth/register`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const { error } = await res.json();
      errorEl.textContent = error.message;
      errorEl.hidden = false;
      return;
    }

    const { customerAccessToken, expiresAt } = await res.json();
    if (customerAccessToken) {
      localStorage.setItem('shopifyCustomerAccessToken', customerAccessToken);
      localStorage.setItem('shopifyCustomerAccessTokenExpiresAt', expiresAt);
    }
    window.location.href = '/account';
  });
</script>
```

## Login form

Same shape as register, posting to `/auth/login` with `{ email, password }`. On success store the `customerAccessToken` the same way.

## Logout

```js
await fetch(`${window.SCANIA_AUTH_API}/auth/logout`, { method: 'POST', credentials: 'include' });
localStorage.removeItem('shopifyCustomerAccessToken');
localStorage.removeItem('shopifyCustomerAccessTokenExpiresAt');
window.location.href = '/';
```

## Forgot password

```js
await fetch(`${window.SCANIA_AUTH_API}/auth/forgot-password`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email }),
});
// always show "Si el email existe, recibirás un correo" — no enumeration
```

## Reset password page

Reads the `?token=...` query string from the URL `/account/reset?token=...` and POSTs to `/auth/reset-password`:

```js
const params = new URLSearchParams(window.location.search);
const token = params.get('token');
await fetch(`${window.SCANIA_AUTH_API}/auth/reset-password`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token, password: newPassword }),
});
```

## Checking session on page load

```js
async function whoAmI() {
  const res = await fetch(`${window.SCANIA_AUTH_API}/auth/me`, { credentials: 'include' });
  if (!res.ok) return null;
  return (await res.json()).user;
}
```

## Using the `customerAccessToken` with Shopify Storefront

Send it as `buyerIdentity` in your cart-creation mutation, or read orders directly from the Storefront API.

```js
const token = localStorage.getItem('shopifyCustomerAccessToken');
const res = await fetch('https://scania-mexico.myshopify.com/api/2025-01/graphql.json', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Shopify-Storefront-Access-Token': '<public storefront token>',
  },
  body: JSON.stringify({
    query: `query { customer(customerAccessToken: "${token}") { orders(first: 10) { edges { node { id name totalPriceV2 { amount currencyCode } } } } } }`,
  }),
});
```
