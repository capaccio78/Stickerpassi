# Stickerpassi

Mini e-commerce mobile-first per vendere sticker con:

- catalogo e stock su Supabase
- carrello persistente nel browser
- registrazione/login con Supabase Auth
- checkout con indirizzo di spedizione
- pagamento Satispay tramite Edge Function
- callback server-to-server che verifica lo stato del pagamento
- storico ordini protetto da Row Level Security

## Struttura

```
/
├─ index.html
├─ styles.css
├─ app.js
├─ config.js
└─ supabase/
   ├─ migrations/
   │  └─ 001_stickerpassi_shop.sql
   └─ functions/
      ├─ create-checkout/index.ts
      └─ satispay-callback/index.ts
```

## Supabase

Lo schema usa tabelle con prefisso `shop_` per non interferire con le altre tabelle presenti nel progetto.

Il frontend usa soltanto la **publishable key**, che è progettata per essere pubblica nel browser. La `service_role` non viene mai inserita nel repository o nel frontend.

Le policy RLS consentono:
- a tutti di leggere soltanto i prodotti attivi e le impostazioni di spedizione;
- agli utenti autenticati di leggere soltanto i propri ordini;
- nessuna creazione/modifica diretta degli ordini dal browser.

Il totale dell'ordine viene ricalcolato nella Edge Function leggendo i prezzi dal database.

## Credenziali Satispay

Per il pagamento reale servono un account Satispay Business (o sandbox), una coppia RSA e il KeyId.

Configura questi secret **solo lato Supabase**:

```
SATISPAY_KEY_ID=...
SATISPAY_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----...
SATISPAY_API_HOST=authservices.satispay.com
PUBLIC_SITE_URL=https://TUO-SITO.pages.dev
```

Per sandbox:

```
SATISPAY_API_HOST=staging.authservices.satispay.com
```

Non committare mai `SATISPAY_PRIVATE_KEY`.

## Deploy delle Edge Functions

La funzione `create-checkout` richiede un utente Supabase autenticato.

```bash
supabase functions deploy create-checkout
```

La callback viene chiamata da Satispay e quindi non usa JWT Supabase; verifica invece il pagamento interrogando direttamente l'API Satispay con firma RSA.

```bash
supabase functions deploy satispay-callback --no-verify-jwt
```

I secret possono essere configurati dal Dashboard Supabase oppure con la CLI.

## Hosting

Il frontend è statico e può essere pubblicato gratuitamente con Cloudflare Pages collegando questo repository.

Impostazioni consigliate:
- framework preset: None
- build command: vuoto
- output directory: `/`

Dopo il deploy:
1. imposta `PUBLIC_SITE_URL` con il dominio Pages;
2. configura in Supabase Auth il Site URL con lo stesso dominio;
3. aggiungi eventuali redirect URL necessari per dominio custom/preview.

## Prodotti demo

Il database contiene due prodotti demo per provare catalogo e carrello. Prima del lancio sostituiscili nella tabella `shop_products` con nome, prezzo, stock e URL dell'immagine reali.

La spedizione iniziale è impostata a 1,50 € e diventa gratuita da 20,00 €. Modifica la riga in `shop_settings` in base al metodo di spedizione effettivo.

## Sicurezza del pagamento

Il browser invia alla Edge Function soltanto ID prodotto e quantità. Il server:
1. verifica l'utente autenticato;
2. rilegge prodotto, prezzo e stock da Supabase;
3. calcola subtotal, spedizione e totale;
4. crea l'ordine;
5. crea il pagamento Satispay;
6. salva l'ID pagamento.

La callback Satispay non si fida dei parametri ricevuti: recupera nuovamente lo stato del pagamento da Satispay. Solo uno stato `ACCEPTED` porta l'ordine a `paid` e scala lo stock.
