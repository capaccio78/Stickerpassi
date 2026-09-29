import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

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

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const paymentId = url.searchParams.get("payment_id");
  if (!paymentId) return new Response("missing payment_id", { status: 400 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const keyId = Deno.env.get("SATISPAY_KEY_ID") ?? "";
  const privateKey = Deno.env.get("SATISPAY_PRIVATE_KEY") ?? "";
  const host = Deno.env.get("SATISPAY_API_HOST") ?? "authservices.satispay.com";

  if (!keyId || !privateKey) return new Response("payment provider not configured", { status: 503 });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const path = `/g_business/v1/payments/${encodeURIComponent(paymentId)}`;
  const signed = await signRequest("GET", path, host, "", keyId, privateKey);

  const response = await fetch(`https://${host}${path}`, {
    method: "GET",
    headers: {
      Host: host,
      Date: signed.date,
      Digest: signed.digest,
      Authorization: signed.authorization,
      "x-satispay-devicetype": "ECOMMERCE_PLUGIN",
      "x-satispay-apph": "Stickerpassi",
      "x-satispay-appn": "Stickerpassi Callback",
      "x-satispay-appv": "1.0.0",
    },
  });

  if (!response.ok) return new Response("provider verification failed", { status: 502 });

  const payment = await response.json();
  const orderId = String(payment.external_code ?? "");

  if (orderId) {
    await admin
      .from("shop_orders")
      .update({ payment_id: paymentId, updated_at: new Date().toISOString() })
      .eq("id", orderId)
      .is("payment_id", null);
  }

  if (payment.status === "ACCEPTED") {
    const { error } = await admin.rpc("shop_finalize_paid_order", { p_payment_id: paymentId });
    if (error) {
      console.error("finalize order failed", error);
      return new Response("finalization failed", { status: 500 });
    }
  } else if (payment.status === "CANCELED") {
    await admin
      .from("shop_orders")
      .update({ status: "canceled", updated_at: new Date().toISOString() })
      .eq("payment_id", paymentId)
      .eq("status", "pending_payment");
  }

  return new Response("ok", { status: 200 });
});
