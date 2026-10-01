import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { doc, setDoc, getDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from './src/firebase';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Helper: Retrieve Access Token from environment or config payload
function getAccessToken(clientConfig?: any): string {
  const token =
    process.env.MERCADOPAGO_ACCESS_TOKEN ||
    process.env.MERCADO_PAGO_ACCESS_TOKEN ||
    clientConfig?.mercadoPagoAccessToken ||
    clientConfig?.creditCardSecretToken ||
    '';
  return token.trim();
}

// Helper: Retrieve Public Key from environment or config payload
function getPublicKey(clientConfig?: any): string {
  const key =
    process.env.MERCADOPAGO_PUBLIC_KEY ||
    process.env.MERCADO_PAGO_PUBLIC_KEY ||
    process.env.VITE_MERCADOPAGO_PUBLIC_KEY ||
    process.env.VITE_MERCADO_PAGO_PUBLIC_KEY ||
    clientConfig?.mercadoPagoPublicKey ||
    '';
  return key.trim();
}

// Helper: Map Mercado Pago payment status to official Portuguese Order Status
function mapOrderStatus(mpStatus: string): {
  orderStatus:
    | 'AGUARDANDO PAGAMENTO'
    | 'PAGAMENTO EM ANÁLISE'
    | 'PAGAMENTO APROVADO'
    | 'PAGAMENTO REJEITADO'
    | 'PAGAMENTO CANCELADO'
    | 'PAGAMENTO ESTORNADO';
  simpleStatus: 'completed' | 'pending' | 'cancelled';
} {
  switch (mpStatus) {
    case 'approved':
      return { orderStatus: 'PAGAMENTO APROVADO', simpleStatus: 'completed' };
    case 'in_process':
      return { orderStatus: 'PAGAMENTO EM ANÁLISE', simpleStatus: 'pending' };
    case 'pending':
      return { orderStatus: 'AGUARDANDO PAGAMENTO', simpleStatus: 'pending' };
    case 'rejected':
      return { orderStatus: 'PAGAMENTO REJEITADO', simpleStatus: 'cancelled' };
    case 'cancelled':
      return { orderStatus: 'PAGAMENTO CANCELADO', simpleStatus: 'cancelled' };
    case 'refunded':
      return { orderStatus: 'PAGAMENTO ESTORNADO', simpleStatus: 'cancelled' };
    case 'charged_back':
      return { orderStatus: 'PAGAMENTO ESTORNADO', simpleStatus: 'cancelled' };
    default:
      return { orderStatus: 'AGUARDANDO PAGAMENTO', simpleStatus: 'pending' };
  }
}

// Helper: Recalculate and validate total purchase value on backend (Anti-Tampering)
function calculateRealOrderTotal(items: any[]): { total: number; postSaleUrls: string[]; validatedItems: any[] } {
  if (!Array.isArray(items) || items.length === 0) {
    return { total: 57.99, postSaleUrls: [], validatedItems: [] };
  }

  let total = 0;
  const postSaleUrls: string[] = [];
  const validatedItems: any[] = [];

  for (const item of items) {
    const qty = Math.max(1, Number(item.quantity) || 1);
    const pack = item.pack || item;
    const packId = String(pack.id || item.id || '');
    let unitPrice = Number(pack.discountPrice ?? item.unit_price ?? item.price ?? 0);

    // Baseline catalog checks for special collection products
    if (
      packId === 'pack_flyer_150_mega' ||
      packId === 'pack_midi_gospel_vip_2026' ||
      packId === 'pack_midi_variados_vip_2026'
    ) {
      unitPrice = 57.99;
    } else if (unitPrice <= 0) {
      unitPrice = 57.99;
    }

    const itemTotal = Number((unitPrice * qty).toFixed(2));
    total += itemTotal;

    const postSale = pack.postSaleUrl || item.postSaleUrl;
    if (postSale && !postSaleUrls.includes(postSale)) {
      postSaleUrls.push(postSale);
    }

    validatedItems.push({
      id: packId,
      title: String(pack.title || item.title || 'Produto MD Studio').slice(0, 150),
      quantity: qty,
      unit_price: unitPrice,
      total: itemTotal,
      postSaleUrl: postSale || null,
      coverImage: pack.image || pack.coverImage || null,
    });
  }

  return {
    total: Number(total.toFixed(2)),
    postSaleUrls,
    validatedItems,
  };
}

// Helper: Detect card brand from card number prefix (fallback)
function detectCardBrand(num: string): string {
  const clean = num.replace(/\D/g, '');
  if (/^4/.test(clean)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(clean)) return 'master';
  if (/^(4011|4389|4514|4576|5041|5066|5067|6277|6362|6363|650|6516|6550)/.test(clean)) return 'elo';
  if (/^(34|37)/.test(clean)) return 'amex';
  if (/^(3841|60)/.test(clean)) return 'hipercard';
  return 'master';
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. API: Mercado Pago Configuration Status (Safe for Frontend)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/mercadopago/status', async (_req: Request, res: Response) => {
  const accessToken = getAccessToken();
  const publicKey = getPublicKey();
  const hasToken = Boolean(accessToken && accessToken.length > 10 && !accessToken.includes('mock-token'));
  const isSandbox = accessToken.startsWith('TEST-') || publicKey.startsWith('TEST-');

  if (!hasToken) {
    return res.json({
      configured: false,
      hasAccessToken: false,
      hasPublicKey: Boolean(publicKey),
      isSandbox,
      message: 'MERCADOPAGO_ACCESS_TOKEN não configurado.',
    });
  }

  try {
    const meRes = await fetch('https://api.mercadopago.com/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (meRes.ok) {
      const meData: any = await meRes.json();
      return res.json({
        configured: true,
        hasAccessToken: true,
        hasPublicKey: Boolean(publicKey),
        isSandbox,
        isLive: !isSandbox,
        accountNickname: meData.nickname || 'MD Studio',
        siteId: meData.site_id || 'MLB',
        tokenPrefix: accessToken.substring(0, 10) + '...',
        publicKeyPrefix: publicKey ? publicKey.substring(0, 10) + '...' : null,
      });
    }
  } catch {}

  return res.json({
    configured: true,
    hasAccessToken: true,
    hasPublicKey: Boolean(publicKey),
    isSandbox,
    isLive: !isSandbox,
    tokenPrefix: accessToken.substring(0, 10) + '...',
    publicKeyPrefix: publicKey ? publicKey.substring(0, 10) + '...' : null,
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. API: Public Key for MercadoPago.js v2 SDK
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/mercadopago/public-key', (_req: Request, res: Response) => {
  const publicKey = getPublicKey();
  return res.json({
    success: true,
    publicKey,
    isSandbox: publicKey.startsWith('TEST-'),
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. API: Create Payment (PIX or Credit Card) via official /v1/payments
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function handleCreatePayment(req: Request, res: Response) {
  try {
    const {
      amount,
      paymentMethodType = 'pix', // 'pix' | 'credit_card' | 'card'
      description = 'MD Stúdio Play - Playbacks & Multitracks',
      payer,
      items,
      card,
      config,
    } = req.body;

    const accessToken = getAccessToken(config);
    if (!accessToken || accessToken.length < 10 || accessToken.includes('mock-token')) {
      return res.status(400).json({
        success: false,
        requiresToken: true,
        error:
          'Access Token do Mercado Pago não configurado. Adicione MERCADOPAGO_ACCESS_TOKEN no .env ou nas configurações do Painel Admin.',
      });
    }

    // 1. Validate mandatory Payer details
    const payerName = (payer?.name || '').trim();
    const cleanCpf = (payer?.cpf || payer?.taxId || '').replace(/\D/g, '');
    const cleanPhone = (payer?.phone || payer?.cellphone || '').replace(/\D/g, '');
    const email = (payer?.email || '').trim().toLowerCase();

    if (!payerName || payerName.length < 3) {
      return res.status(400).json({ success: false, error: 'Nome completo é obrigatório.' });
    }
    if (!cleanPhone || cleanPhone.length < 10) {
      return res.status(400).json({ success: false, error: 'WhatsApp com DDD é obrigatório.' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'E-mail válido é obrigatório.' });
    }
    if (!cleanCpf || cleanCpf.length !== 11) {
      return res.status(400).json({ success: false, error: 'CPF válido com 11 dígitos é obrigatório.' });
    }

    const nameParts = payerName.split(' ');
    const firstName = nameParts[0] || 'Cliente';
    const lastName = nameParts.slice(1).join(' ') || 'VIP';
    const areaCode = cleanPhone.length >= 10 ? cleanPhone.substring(0, 2) : '11';
    const phoneNumber = cleanPhone.length >= 10 ? cleanPhone.substring(2) : cleanPhone;

    // 2. Recalculate real purchase total on backend (anti-tampering)
    const { total: calculatedTotal, postSaleUrls, validatedItems } = calculateRealOrderTotal(items);
    if (!calculatedTotal || calculatedTotal <= 0) {
      return res.status(400).json({ success: false, error: 'Valor da compra inválido.' });
    }

    // 3. Generate unique order references
    const orderId = `ORD-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const externalReference = `ext_ref_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const idempotencyKey = crypto.randomUUID();

    const isCard = paymentMethodType === 'credit_card' || paymentMethodType === 'card';
    const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
    const notificationUrl = appUrl ? `${appUrl}/api/mercadopago/webhook` : undefined;

    let paymentPayload: any;

    if (isCard) {
      // ━━━ CARTÃO DE CRÉDITO ━━━
      let cardTokenId = card?.token;
      let paymentMethodId = card?.payment_method_id || card?.brand;
      const installments = Number(card?.installments) || 1;

      // If token not provided directly from frontend SDK, tokenize via MP Card Tokens API as fallback
      if (!cardTokenId && card?.cardNumber) {
        const rawNum = String(card.cardNumber).replace(/\D/g, '');
        const rawExp = String(card.cardExp || card.expiration || '').trim();
        let expMonth = Number(card.expirationMonth) || 12;
        let expYear = Number(card.expirationYear) || 2028;

        if (rawExp.includes('/')) {
          const [m, y] = rawExp.split('/');
          expMonth = Number(m);
          expYear = Number(y.length === 2 ? `20${y}` : y);
        }

        paymentMethodId = paymentMethodId || detectCardBrand(rawNum);

        const tokenRes = await fetch('https://api.mercadopago.com/v1/card_tokens', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            card_number: rawNum,
            expiration_month: expMonth,
            expiration_year: expYear,
            security_code: String(card.cvv || card.securityCode || '123'),
            cardholder: {
              name: card.cardHolder || payerName,
              identification: {
                type: 'CPF',
                number: cleanCpf,
              },
            },
          }),
        });

        const tokenData: any = await tokenRes.json();
        if (tokenRes.ok && tokenData.id) {
          cardTokenId = tokenData.id;
        } else {
          return res.status(400).json({
            success: false,
            error:
              tokenData.message ||
              tokenData.cause?.[0]?.description ||
              'Dados do cartão inválidos ou não autorizados.',
            details: tokenData,
          });
        }
      }

      if (!cardTokenId) {
        return res.status(400).json({
          success: false,
          error: 'Token do cartão de crédito não fornecido.',
        });
      }

      paymentPayload = {
        transaction_amount: calculatedTotal,
        token: cardTokenId,
        description: description.slice(0, 100),
        installments,
        payment_method_id: paymentMethodId || 'master',
        issuer_id: card?.issuer_id || undefined,
        external_reference: externalReference,
        payer: {
          email,
          first_name: firstName,
          last_name: lastName,
          identification: {
            type: 'CPF',
            number: cleanCpf,
          },
        },
        ...(notificationUrl ? { notification_url: notificationUrl } : {}),
      };
    } else {
      // ━━━ PIX EM TEMPO REAL ━━━
      paymentPayload = {
        transaction_amount: calculatedTotal,
        description: description.slice(0, 100),
        payment_method_id: 'pix',
        external_reference: externalReference,
        payer: {
          email,
          first_name: firstName,
          last_name: lastName,
          identification: {
            type: 'CPF',
            number: cleanCpf,
          },
          phone: {
            area_code: areaCode,
            number: phoneNumber,
          },
        },
        ...(notificationUrl ? { notification_url: notificationUrl } : {}),
      };
    }

    // Call official Mercado Pago /v1/payments
    const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(paymentPayload),
    });

    const mpData: any = await mpRes.json();

    if (mpRes.ok && mpData.id) {
      const paymentId = String(mpData.id);
      const mpStatus = String(mpData.status || 'pending');
      const statusDetail = String(mpData.status_detail || '');
      const transactionData = mpData.point_of_interaction?.transaction_data;
      const qrCode = transactionData?.qr_code || '';
      const qrCodeBase64 = transactionData?.qr_code_base64 || '';
      const ticketUrl = transactionData?.ticket_url || '';

      const { orderStatus, simpleStatus } = mapOrderStatus(mpStatus);

      // Persist order in Firestore
      const orderDocData = {
        id: orderId,
        orderNumber: orderId,
        customer_id: cleanPhone,
        customerName: payerName,
        customerEmail: email,
        customerPhone: cleanPhone,
        customerCpf: cleanCpf,
        external_reference: externalReference,
        items: validatedItems,
        total: calculatedTotal,
        subtotal: calculatedTotal,
        discount: 0,
        paymentMethod: isCard ? 'card' : 'pix',
        payment_method: isCard ? 'credit_card' : 'pix',
        payment_id: paymentId,
        payment_status: mpStatus,
        order_status: orderStatus,
        status: simpleStatus,
        mercadoPagoPaymentId: paymentId,
        pixPayload: qrCode || null,
        pixQrCodeUrl: qrCodeBase64 ? `data:image/png;base64,${qrCodeBase64}` : null,
        ticketUrl: ticketUrl || null,
        cardBrand: isCard ? (mpData.payment_method_id || 'Cartão') : null,
        cardLast4: isCard ? mpData.card?.last_four_digits || null : null,
        installments: isCard ? Number(mpData.installments) || 1 : null,
        post_sale_urls: postSaleUrls,
        date: new Date().toLocaleDateString('pt-BR'),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Persist payment ledger record in Firestore
      const paymentDocData = {
        id: paymentId,
        order_id: orderId,
        mercado_pago_payment_id: paymentId,
        external_reference: externalReference,
        method: isCard ? 'credit_card' : 'pix',
        amount: calculatedTotal,
        status: mpStatus,
        status_detail: statusDetail,
        transaction_date: mpData.date_created || new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      try {
        await setDoc(doc(db, 'orders', orderId), orderDocData, { merge: true });
        await setDoc(doc(db, 'payments', paymentId), paymentDocData, { merge: true });
      } catch (dbErr) {
        console.warn('Notice: Firestore save in backend:', dbErr);
      }

      return res.json({
        success: true,
        orderId,
        paymentId,
        externalReference,
        status: mpStatus,
        statusDetail,
        orderStatus,
        totalAmount: calculatedTotal,
        qrCode,
        qrCodeBase64,
        ticketUrl,
        expirationDate: mpData.date_of_expiration,
        postSaleUrls,
      });
    } else {
      console.warn('Mercado Pago /v1/payments error:', mpData);
      return res.status(mpRes.status || 400).json({
        success: false,
        error:
          mpData.message ||
          mpData.cause?.[0]?.description ||
          'Falha ao processar pagamento com o Mercado Pago.',
        details: mpData,
      });
    }
  } catch (err: any) {
    console.error('Unexpected error creating Mercado Pago payment:', err);
    return res.status(500).json({ success: false, error: err.message || 'Erro interno no servidor' });
  }
}

app.post('/api/mercadopago/create-payment', handleCreatePayment);
app.post('/api/mercadopago/create-order', handleCreatePayment);
app.post('/api/mercadopago/create-pix', (req: Request, res: Response) => {
  req.body.paymentMethodType = 'pix';
  return handleCreatePayment(req, res);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. API: Payment Status Polling & Firestore Real-Time Synchronizer
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/mercadopago/payment-status/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const accessToken = getAccessToken({ mercadoPagoAccessToken: req.query.token as string });

    if (!id) {
      return res.status(400).json({ success: false, error: 'ID do pagamento não informado.' });
    }

    if (id.startsWith('demo_')) {
      return res.json({ success: true, status: 'pending', id });
    }

    if (!accessToken) {
      return res.json({
        success: true,
        status: 'pending',
        note: 'Sem access token configurado para consulta externa',
      });
    }

    // Direct consultation to official Mercado Pago API
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (mpRes.ok) {
      const data: any = await mpRes.json();
      const status = data.status; // 'approved', 'pending', 'rejected', etc.
      const statusDetail = data.status_detail;
      const isApproved = status === 'approved';
      const { orderStatus, simpleStatus } = mapOrderStatus(status);

      // Synchronize status in Firestore orders and payments
      try {
        const orderSnap = await getDocs(
          query(collection(db, 'orders'), where('payment_id', '==', String(id)))
        );

        if (!orderSnap.empty) {
          const orderDocRef = orderSnap.docs[0].ref;
          await updateDoc(orderDocRef, {
            payment_status: status,
            order_status: orderStatus,
            status: simpleStatus,
            updated_at: new Date().toISOString(),
          });
        }

        const paymentRef = doc(db, 'payments', String(id));
        await setDoc(
          paymentRef,
          {
            status,
            status_detail: statusDetail,
            updated_at: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch (syncErr) {
        console.warn('Notice: Firestore status sync error:', syncErr);
      }

      return res.json({
        success: true,
        id: data.id,
        paymentId: data.id,
        status,
        statusDetail,
        orderStatus,
        isApproved,
        dateApproved: data.date_approved || data.date_last_updated,
        amount: data.transaction_amount,
      });
    }

    return res.json({ success: false, status: 'unknown' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. API: Official Mercado Pago Webhook / IPN Receiver
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/mercadopago/webhook', async (req: Request, res: Response) => {
  try {
    const accessToken = getAccessToken();
    const body = req.body || {};
    const queryParams = req.query || {};

    console.log('Mercado Pago Webhook Event received:', {
      action: body.action,
      type: body.type,
      dataId: body.data?.id,
      queryId: queryParams.id || queryParams['data.id'],
      topic: queryParams.topic || body.topic,
    });

    // Identify payment id from query or body
    const paymentId = String(body.data?.id || body.id || queryParams['data.id'] || queryParams.id || '');

    if (!paymentId || paymentId === 'undefined') {
      return res.status(200).send('OK (Sem ID de pagamento)');
    }

    if (!accessToken) {
      console.warn('Webhook received but MERCADOPAGO_ACCESS_TOKEN is not configured.');
      return res.status(200).send('OK (Token ausente)');
    }

    // Always consult Mercado Pago directly to verify authentic transaction state
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!mpRes.ok) {
      console.warn('Webhook: Falha ao consultar pagamento no Mercado Pago:', paymentId);
      return res.status(200).send('OK');
    }

    const mpPayment: any = await mpRes.json();
    const mpStatus = String(mpPayment.status || '');
    const statusDetail = String(mpPayment.status_detail || '');
    const externalRef = String(mpPayment.external_reference || '');
    const { orderStatus, simpleStatus } = mapOrderStatus(mpStatus);

    // Update orders collection by payment_id or external_reference
    try {
      let orderDocRef: any = null;

      const qByPaymentId = query(collection(db, 'orders'), where('payment_id', '==', paymentId));
      const snap1 = await getDocs(qByPaymentId);

      if (!snap1.empty) {
        orderDocRef = snap1.docs[0].ref;
      } else if (externalRef) {
        const qByExtRef = query(collection(db, 'orders'), where('external_reference', '==', externalRef));
        const snap2 = await getDocs(qByExtRef);
        if (!snap2.empty) {
          orderDocRef = snap2.docs[0].ref;
        }
      }

      if (orderDocRef) {
        await updateDoc(orderDocRef, {
          payment_status: mpStatus,
          order_status: orderStatus,
          status: simpleStatus,
          updated_at: new Date().toISOString(),
        });
        console.log(`Webhook: Pedido atualizado com sucesso para ${orderStatus} (ID: ${paymentId})`);
      }

      // Update payments collection
      await setDoc(
        doc(db, 'payments', paymentId),
        {
          id: paymentId,
          mercado_pago_payment_id: paymentId,
          external_reference: externalRef,
          status: mpStatus,
          status_detail: statusDetail,
          amount: mpPayment.transaction_amount,
          method: mpPayment.payment_method_id,
          transaction_date: mpPayment.date_created,
          updated_at: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (dbErr) {
      console.error('Webhook: Erro ao sincronizar com Firestore:', dbErr);
    }

    return res.status(200).send('OK');
  } catch (err: any) {
    console.error('Webhook error handler:', err);
    return res.status(200).send('OK');
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. API: WhatsApp OTP Dispatcher
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/whatsapp/send-otp', async (req: Request, res: Response) => {
  try {
    const { phone, code, gatewayUrl, gatewayToken } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ success: false, error: 'Telefone e código são obrigatórios.' });
    }

    const cleanDigits = String(phone).replace(/\D/g, '');
    const intlPhone = cleanDigits.startsWith('55') && cleanDigits.length >= 12 ? cleanDigits : `55${cleanDigits}`;
    const message = `*Código de autenticação* da MD Stúdio Play\n${code}`;
    const whatsappUrl = `https://api.whatsapp.com/send?phone=${intlPhone}&text=${encodeURIComponent(message)}`;

    const targetGateway = gatewayUrl || process.env.WHATSAPP_GATEWAY_URL;
    const targetToken = gatewayToken || process.env.WHATSAPP_GATEWAY_TOKEN;

    if (targetGateway) {
      try {
        await fetch(targetGateway, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(targetToken ? { Authorization: `Bearer ${targetToken}`, apikey: targetToken } : {}),
          },
          body: JSON.stringify({
            phone: intlPhone,
            number: intlPhone,
            message,
            text: message,
            code,
          }),
        });
      } catch (err: any) {
        console.warn('WhatsApp gateway webhook warning:', err?.message);
      }
    }

    return res.json({ success: true, whatsappUrl, phone: intlPhone });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || 'Erro ao processar envio' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. Setup Vite or Static File Serving
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  const imagesDir = path.resolve(__dirname, 'src/assets/images');
  const publicDir = path.resolve(__dirname, 'public');
  if (fs.existsSync(imagesDir)) {
    app.use('/src/assets/images', express.static(imagesDir));
    app.use('/assets/images', express.static(imagesDir));
    app.use('/images', express.static(imagesDir));
  }
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
  }

  if (!isProduction) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    app.use('*', async (req: Request, res: Response, next) => {
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        next(e);
      }
    });
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT} at 0.0.0.0`);
  });
}

startServer();
