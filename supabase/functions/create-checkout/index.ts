import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function pemToArrayBuffer(pem: string) {
  const normalized = pem.replace(/\\n/g, "\n");
  const body = normalized
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function sha256Base64(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

async function signRequest(
  method: string,
  path: string,
  host: string,
  body: string,
  keyId: string,
  privateKeyPem: string,
) {
  const date = new Date().toUTCString();
  const digest = `SHA-256=${await sha256Base64(body)}`;
  const message = `(request-target): ${method.toLowerCase()} ${path}\nhost: ${host}\ndate: ${date}\ndigest: ${digest}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(message),
  );
  const signature = bytesToBase64(new Uint8Array(signatureBuffer));

  return {
    date,
    digest,
    authorization:
      `Signature keyId="${keyId}", algorithm="rsa-sha256", headers="(request-target) host date digest", signature="${signature}"`,
  };
}

type CartItem = { product_id: string; quantity: number };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const satispayKeyId = Deno.env.get("SATISPAY_KEY_ID") ?? "";
  const satispayPrivateKey = Deno.env.get("SATISPAY_PRIVATE_KEY") ?? "";
  const satispayHost = Deno.env.get("SATISPAY_API_HOST") ?? "authservices.satispay.com";
  const publicSiteUrl = (Deno.env.get("PUBLIC_SITE_URL") ?? "").replace(/\/$/, "");

  if (!satispayKeyId || !satispayPrivateKey || !publicSiteUrl) {
    return json({ error: "payment_not_configured" }, 503);
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "authentication_required" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData.user;
  if (userError || !user?.id || !user.email) {
    return json({ error: "invalid_session" }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const items: CartItem[] = Array.isArray(body.items) ? body.items : [];
  if (items.length < 1 || items.length > 30) return json({ error: "invalid_cart" }, 400);

  const cleanItems = items.map((item) => ({
    product_id: String(item.product_id ?? ""),
    quantity: Number(item.quantity),
  }));

  if (cleanItems.some((item) =>
    !/^[0-9a-f-]{36}$/i.test(item.product_id) ||
    !Number.isInteger(item.quantity) ||
    item.quantity < 1 ||
    item.quantity > 50
  )) {
    return json({ error: "invalid_cart_item" }, 400);
  }

  const shipping = body.shipping ?? {};
  const fullName = String(shipping.full_name ?? "").trim();
  const addressLine1 = String(shipping.address_line1 ?? "").trim();
  const addressLine2 = String(shipping.address_line2 ?? "").trim() || null;
  const postalCode = String(shipping.postal_code ?? "").trim();
  const city = String(shipping.city ?? "").trim();
  const province = String(shipping.province ?? "").trim() || null;
  const country = String(shipping.country ?? "IT").trim().toUpperCase();

  if (!fullName || !addressLine1 || !postalCode || !city || country.length !== 2) {
    return json({ error: "invalid_shipping_address" }, 400);
  }

  const productIds = [...new Set(cleanItems.map((item) => item.product_id))];
  const { data: products, error: productsError } = await admin
    .from("shop_products")
    .select("id,name,price_cents,stock,is_active")
    .in("id", productIds)
    .eq("is_active", true);

  if (productsError) return json({ error: "catalog_error" }, 500);
  if (!products || products.length !== productIds.length) {
    return json({ error: "product_unavailable" }, 409);
  }

  const productMap = new Map(products.map((product) => [product.id, product]));
  let subtotal = 0;
  const orderItems = [];

  for (const item of cleanItems) {
    const product = productMap.get(item.product_id);
    if (!product || product.stock < item.quantity) {
      return json({ error: "insufficient_stock", product_id: item.product_id }, 409);
    }

    const lineTotal = product.price_cents * item.quantity;
    subtotal += lineTotal;
    orderItems.push({
      product_id: product.id,
      product_name: product.name,
      unit_price_cents: product.price_cents,
      quantity: item.quantity,
      line_total_cents: lineTotal,
    });
  }

  const { data: settings, error: settingsError } = await admin
    .from("shop_settings")
    .select("shipping_cents,free_shipping_threshold_cents,currency")
    .eq("id", true)
    .single();

  if (settingsError || !settings) return json({ error: "settings_error" }, 500);

  const shippingCents =
    settings.free_shipping_threshold_cents !== null &&
    subtotal >= settings.free_shipping_threshold_cents
      ? 0
      : settings.shipping_cents;
  const total = subtotal + shippingCents;

  const { data: order, error: orderError } = await admin
    .from("shop_orders")
    .insert({
      user_id: user.id,
      email: user.email,
      full_name: fullName,
      address_line1: addressLine1,
      address_line2: addressLine2,
      postal_code: postalCode,
      city,
      province,
      country,
      subtotal_cents: subtotal,
      shipping_cents: shippingCents,
      total_cents: total,
      currency: settings.currency,
      status: "pending_payment",
      payment_provider: "satispay",
    })
    .select("id")
    .single();

  if (orderError || !order) return json({ error: "order_creation_failed" }, 500);

  const { error: itemInsertError } = await admin.from("shop_order_items").insert(
    orderItems.map((item) => ({ ...item, order_id: order.id })),
  );
  if (itemInsertError) {
    await admin.from("shop_orders").delete().eq("id", order.id);
    return json({ error: "order_items_failed" }, 500);
  }

  const path = "/g_business/v1/payments";
  const callbackUrl = `${supabaseUrl}/functions/v1/satispay-callback?payment_id={uuid}`;
  const returnUrl = `${publicSiteUrl}/?payment=complete&order=${encodeURIComponent(order.id)}`;
  const paymentBody = JSON.stringify({
    flow: "MATCH_CODE",
    amount_unit: total,
    currency: settings.currency,
    external_code: order.id,
    callback_url: callbackUrl,
    redirect_url: returnUrl,
    metadata: { order_id: order.id, user_id: user.id },
  });

  const signed = await signRequest(
    "POST",
    path,
    satispayHost,
    paymentBody,
    satispayKeyId,
    satispayPrivateKey,
  );

  const response = await fetch(`https://${satispayHost}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: satispayHost,
      Date: signed.date,
      Digest: signed.digest,
      Authorization: signed.authorization,
      "Idempotency-Key": order.id,
      "x-satispay-devicetype": "ECOMMERCE_PLUGIN",
      "x-satispay-apph": "Stickerpassi",
      "x-satispay-appn": "Stickerpassi Checkout",
      "x-satispay-appv": "1.0.0",
    },
    body: paymentBody,
  });

  const payment = await response.json().catch(() => ({}));
  if (!response.ok || !payment?.id || !payment?.redirect_url) {
    await admin
      .from("shop_orders")
      .update({ status: "canceled", updated_at: new Date().toISOString() })
      .eq("id", order.id);

    return json({ error: "payment_creation_failed", provider_status: response.status }, 502);
  }

  const { error: updateError } = await admin
    .from("shop_orders")
    .update({ payment_id: payment.id, updated_at: new Date().toISOString() })
    .eq("id", order.id);

  if (updateError) return json({ error: "order_payment_link_failed" }, 500);

  return json({
    order_id: order.id,
    redirect_url: payment.redirect_url,
    total_cents: total,
    currency: settings.currency,
  });
});
