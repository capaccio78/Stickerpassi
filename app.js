import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.95.0/+esm";

const config = window.STICKERPASSI_CONFIG;
if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
  throw new Error("Configurazione Supabase mancante");
}

const supabase = createClient(config.supabaseUrl, config.supabasePublishableKey);

const els = {
  productGrid: document.querySelector("#productGrid"),
  shippingHint: document.querySelector("#shippingHint"),
  accountButton: document.querySelector("#accountButton"),
  cartButton: document.querySelector("#cartButton"),
  cartCount: document.querySelector("#cartCount"),
  cartDrawer: document.querySelector("#cartDrawer"),
  closeCartButton: document.querySelector("#closeCartButton"),
  cartItems: document.querySelector("#cartItems"),
  cartSubtotal: document.querySelector("#cartSubtotal"),
  cartShipping: document.querySelector("#cartShipping"),
  cartTotal: document.querySelector("#cartTotal"),
  goCheckoutButton: document.querySelector("#goCheckoutButton"),
  authDialog: document.querySelector("#authDialog"),
  authTitle: document.querySelector("#authTitle"),
  authSubtitle: document.querySelector("#authSubtitle"),
  authEmail: document.querySelector("#authEmail"),
  authPassword: document.querySelector("#authPassword"),
  authMessage: document.querySelector("#authMessage"),
  authSubmit: document.querySelector("#authSubmit"),
  authSwitch: document.querySelector("#authSwitch"),
  checkoutDialog: document.querySelector("#checkoutDialog"),
  checkoutForm: document.querySelector("#checkoutForm"),
  checkoutTotal: document.querySelector("#checkoutTotal"),
  checkoutMessage: document.querySelector("#checkoutMessage"),
  payButton: document.querySelector("#payButton"),
  paymentReturn: document.querySelector("#paymentReturn"),
  ordersSection: document.querySelector("#ordersSection"),
  ordersList: document.querySelector("#ordersList"),
};

const state = {
  products: [],
  settings: { shipping_cents: 0, free_shipping_threshold_cents: null, currency: "EUR" },
  cart: loadCart(),
  session: null,
  authMode: "signin",
  pendingCheckout: false,
};

function loadCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem("stickerpassi_cart") || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCart() {
  localStorage.setItem("stickerpassi_cart", JSON.stringify(state.cart));
}

function euro(cents) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format((cents || 0) / 100);
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeImage(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

function productById(id) {
  return state.products.find((p) => p.id === id);
}

function subtotal() {
  return state.cart.reduce((sum, line) => {
    const product = productById(line.product_id);
    return sum + (product ? product.price_cents * line.quantity : 0);
  }, 0);
}

function shippingCost(sub = subtotal()) {
  const threshold = state.settings.free_shipping_threshold_cents;
  if (threshold !== null && sub >= threshold) return 0;
  return state.settings.shipping_cents || 0;
}

function renderCatalog() {
  if (!state.products.length) {
    els.productGrid.innerHTML = '<p class="muted">Nessuno sticker disponibile al momento.</p>';
    return;
  }

  els.productGrid.innerHTML = state.products.map((product) => {
    const image = safeImage(product.image_url);
    const art = image
      ? `<img src="${esc(image)}" alt="${esc(product.name)}" loading="lazy">`
      : '<div class="product-placeholder">✦</div>';
    const soldOut = product.stock < 1;
    return `
      <article class="product-card">
        <div class="product-art">${art}</div>
        <div class="product-body">
          <h3>${esc(product.name)}</h3>
          <p>${esc(product.description || "Sticker Stickerpassi")}</p>
          <div class="product-row">
            <span class="price">${euro(product.price_cents)}</span>
            <button class="add-btn" data-add="${product.id}" ${soldOut ? "disabled" : ""}>
              ${soldOut ? "Esaurito" : "Aggiungi"}
            </button>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function normalizeCart() {
  state.cart = state.cart
    .map((line) => {
      const product = productById(line.product_id);
      if (!product || product.stock < 1) return null;
      return {
        product_id: line.product_id,
        quantity: Math.max(1, Math.min(Number(line.quantity) || 1, product.stock, 50)),
      };
    })
    .filter(Boolean);
  saveCart();
}

function renderCart() {
  normalizeCart();
  const count = state.cart.reduce((sum, line) => sum + line.quantity, 0);
  els.cartCount.textContent = String(count);

  if (!state.cart.length) {
    els.cartItems.innerHTML = '<p class="muted">Il carrello è vuoto.</p>';
  } else {
    els.cartItems.innerHTML = state.cart.map((line) => {
      const product = productById(line.product_id);
      return `
        <div class="cart-line">
          <div>
            <strong>${esc(product.name)}</strong>
            <span class="muted">${euro(product.price_cents)} cad.</span>
            <div class="cart-controls">
              <button type="button" data-dec="${product.id}" aria-label="Riduci quantità">−</button>
              <span>${line.quantity}</span>
              <button type="button" data-inc="${product.id}" aria-label="Aumenta quantità">+</button>
              <button type="button" data-remove="${product.id}" aria-label="Rimuovi">×</button>
            </div>
          </div>
          <strong>${euro(product.price_cents * line.quantity)}</strong>
        </div>
      `;
    }).join("");
  }

  const sub = subtotal();
  const ship = state.cart.length ? shippingCost(sub) : 0;
  els.cartSubtotal.textContent = euro(sub);
  els.cartShipping.textContent = state.cart.length ? (ship === 0 ? "Gratis" : euro(ship)) : "—";
  els.cartTotal.textContent = euro(sub + ship);
  els.checkoutTotal.textContent = euro(sub + ship);
  els.goCheckoutButton.disabled = state.cart.length === 0;
}

function openCart() {
  els.cartDrawer.classList.add("open");
  els.cartDrawer.setAttribute("aria-hidden", "false");
}

function closeCart() {
  els.cartDrawer.classList.remove("open");
  els.cartDrawer.setAttribute("aria-hidden", "true");
}

function addToCart(productId) {
  const product = productById(productId);
  if (!product || product.stock < 1) return;
  const existing = state.cart.find((line) => line.product_id === productId);
  if (existing) existing.quantity = Math.min(existing.quantity + 1, product.stock, 50);
  else state.cart.push({ product_id: productId, quantity: 1 });
  saveCart();
  renderCart();
  openCart();
}

function changeQuantity(productId, delta) {
  const product = productById(productId);
  const line = state.cart.find((item) => item.product_id === productId);
  if (!product || !line) return;
  line.quantity = Math.min(product.stock, 50, line.quantity + delta);
  if (line.quantity <= 0) state.cart = state.cart.filter((item) => item.product_id !== productId);
  saveCart();
  renderCart();
}

function removeFromCart(productId) {
  state.cart = state.cart.filter((item) => item.product_id !== productId);
  saveCart();
  renderCart();
}

function setAuthMode(mode) {
  state.authMode = mode;
  const signingUp = mode === "signup";
  els.authTitle.textContent = signingUp ? "Registrati" : "Accedi";
  els.authSubtitle.textContent = signingUp
    ? "Crea un account per acquistare e ritrovare i tuoi ordini."
    : "Accedi per completare l'acquisto e ritrovare i tuoi ordini.";
  els.authSubmit.textContent = signingUp ? "Crea account" : "Accedi";
  els.authSwitch.textContent = signingUp
    ? "Hai già un account? Accedi"
    : "Non hai un account? Registrati";
  els.authPassword.autocomplete = signingUp ? "new-password" : "current-password";
  els.authMessage.textContent = "";
}

function openAuth() {
  setAuthMode("signin");
  els.authDialog.showModal();
}

async function submitAuth() {
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  els.authMessage.textContent = "";
  els.authSubmit.disabled = true;

  try {
    if (state.authMode === "signup") {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) {
        els.authMessage.textContent = "Account creato. Controlla la tua email per confermare l'indirizzo.";
        return;
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }

    els.authDialog.close();
    if (state.pendingCheckout) {
      state.pendingCheckout = false;
      openCheckout();
    }
  } catch (error) {
    els.authMessage.textContent = error?.message || "Accesso non riuscito.";
  } finally {
    els.authSubmit.disabled = false;
  }
}

async function refreshSession() {
  const { data } = await supabase.auth.getSession();
  state.session = data.session;
  els.accountButton.textContent = state.session ? "Esci" : "Accedi";
  els.ordersSection.classList.toggle("hidden", !state.session);
  if (state.session) await loadOrders();
}

async function loadOrders() {
  if (!state.session) return;
  const { data, error } = await supabase
    .from("shop_orders")
    .select("id,total_cents,status,created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    els.ordersList.innerHTML = '<p class="muted">Impossibile caricare gli ordini.</p>';
    return;
  }
  if (!data?.length) {
    els.ordersList.innerHTML = '<p class="muted">Non hai ancora ordini.</p>';
    return;
  }

  const statusLabel = {
    pending_payment: "In attesa di pagamento",
    paid: "Pagato",
    fulfilled: "Spedito",
    canceled: "Annullato",
    refunded: "Rimborsato",
  };

  els.ordersList.innerHTML = data.map((order) => `
    <div class="order-row">
      <div>
        <strong>Ordine #${esc(order.id.slice(0, 8).toUpperCase())}</strong>
        <div class="muted">${new Date(order.created_at).toLocaleDateString("it-IT")} · ${euro(order.total_cents)}</div>
      </div>
      <span class="status">${esc(statusLabel[order.status] || order.status)}</span>
    </div>
  `).join("");
}

function openCheckout() {
  if (!state.cart.length) return;
  closeCart();
  if (!state.session) {
    state.pendingCheckout = true;
    openAuth();
    return;
  }
  els.checkoutMessage.textContent = "";
  renderCart();
  els.checkoutDialog.showModal();
}

async function submitCheckout(event) {
  event.preventDefault();
  if (!state.session || !state.cart.length) return;

  const form = new FormData(els.checkoutForm);
  const shipping = Object.fromEntries(form.entries());
  els.payButton.disabled = true;
  els.checkoutMessage.textContent = "Creazione del pagamento…";

  try {
    const { data, error } = await supabase.functions.invoke("create-checkout", {
      body: {
        items: state.cart.map((line) => ({
          product_id: line.product_id,
          quantity: line.quantity,
        })),
        shipping,
      },
      headers: {
        Authorization: `Bearer ${state.session.access_token}`,
      },
    });

    if (error) throw error;
    if (!data?.redirect_url) {
      if (data?.error === "payment_not_configured") {
        throw new Error("Pagamento Satispay non ancora configurato.");
      }
      throw new Error("Il provider di pagamento non ha restituito un link valido.");
    }

    window.location.assign(data.redirect_url);
  } catch (error) {
    console.error(error);
    els.checkoutMessage.textContent =
      error?.message || "Non è stato possibile avviare il pagamento. Riprova.";
    els.payButton.disabled = false;
  }
}

async function loadCatalog() {
  const [{ data: products, error: productError }, { data: settings, error: settingError }] =
    await Promise.all([
      supabase
        .from("shop_products")
        .select("id,slug,name,description,price_cents,image_url,stock")
        .eq("is_active", true)
        .order("created_at", { ascending: true }),
      supabase
        .from("shop_settings")
        .select("shipping_cents,free_shipping_threshold_cents,currency")
        .eq("id", true)
        .single(),
    ]);

  if (productError) {
    els.productGrid.innerHTML = '<p class="muted">Errore nel caricamento del catalogo.</p>';
    return;
  }

  state.products = products || [];
  if (!settingError && settings) state.settings = settings;

  const threshold = state.settings.free_shipping_threshold_cents;
  els.shippingHint.textContent =
    threshold !== null
      ? `Spedizione ${euro(state.settings.shipping_cents)} · gratis da ${euro(threshold)}`
      : `Spedizione ${euro(state.settings.shipping_cents)}`;

  renderCatalog();
  renderCart();
}

async function handlePaymentReturn() {
  const params = new URLSearchParams(location.search);
  if (params.get("payment") !== "complete") return;
  const orderId = params.get("order");
  if (!orderId) return;

  els.paymentReturn.classList.remove("hidden");
  els.paymentReturn.classList.add("warning");
  els.paymentReturn.textContent = "Stiamo verificando il pagamento…";

  if (!state.session) {
    els.paymentReturn.textContent = "Pagamento completato. Accedi per verificare lo stato dell'ordine.";
    return;
  }

  for (let attempt = 0; attempt < 12; attempt++) {
    const { data } = await supabase
      .from("shop_orders")
      .select("id,status,total_cents")
      .eq("id", orderId)
      .maybeSingle();

    if (data?.status === "paid" || data?.status === "fulfilled") {
      state.cart = [];
      saveCart();
      renderCart();
      els.paymentReturn.classList.remove("warning");
      els.paymentReturn.textContent = `Pagamento confermato. Ordine #${orderId.slice(0, 8).toUpperCase()} ricevuto.`;
      await Promise.all([loadCatalog(), loadOrders()]);
      history.replaceState({}, "", location.pathname);
      return;
    }

    if (data?.status === "canceled") {
      els.paymentReturn.textContent = "Pagamento non completato. Il carrello è ancora disponibile.";
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  els.paymentReturn.textContent =
    "Pagamento ricevuto dal provider, ma la conferma dell'ordine sta impiegando più del previsto. Controlla la sezione ordini tra poco.";
}

els.productGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-add]");
  if (button) addToCart(button.dataset.add);
});

els.cartItems.addEventListener("click", (event) => {
  const inc = event.target.closest("[data-inc]");
  const dec = event.target.closest("[data-dec]");
  const remove = event.target.closest("[data-remove]");
  if (inc) changeQuantity(inc.dataset.inc, 1);
  if (dec) changeQuantity(dec.dataset.dec, -1);
  if (remove) removeFromCart(remove.dataset.remove);
});

els.cartButton.addEventListener("click", openCart);
els.closeCartButton.addEventListener("click", closeCart);
els.cartDrawer.addEventListener("click", (event) => {
  if (event.target === els.cartDrawer) closeCart();
});
els.goCheckoutButton.addEventListener("click", openCheckout);
els.authSubmit.addEventListener("click", submitAuth);
els.authSwitch.addEventListener("click", () =>
  setAuthMode(state.authMode === "signin" ? "signup" : "signin")
);
els.checkoutForm.addEventListener("submit", submitCheckout);

els.accountButton.addEventListener("click", async () => {
  if (state.session) await supabase.auth.signOut();
  else openAuth();
});

supabase.auth.onAuthStateChange(async (_event, session) => {
  state.session = session;
  els.accountButton.textContent = session ? "Esci" : "Accedi";
  els.ordersSection.classList.toggle("hidden", !session);
  if (session) await loadOrders();
  else els.ordersList.innerHTML = "";
});

await loadCatalog();
await refreshSession();
await handlePaymentReturn();
