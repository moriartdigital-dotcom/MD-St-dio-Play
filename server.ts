import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Helper: Detect card brand from card number prefix
function detectCardBrand(num: string): string {
  const clean = num.replace(/\D/g, '');
  if (/^4/.test(clean)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(clean)) return 'master';
  if (/^(4011|4389|4514|4576|5041|5066|5067|6277|6362|6363|650|6516|6550)/.test(clean)) return 'elo';
  if (/^(34|37)/.test(clean)) return 'amex';
  if (/^(3841|60)/.test(clean)) return 'hipercard';
  return 'master';
}

// Handler: Create Mercado Pago Order via /v1/orders (PIX or Credit Card)
async function processMercadoPagoOrder(req: Request, res: Response) {
  try {
    const {
      amount,
      paymentMethodType = 'pix', // 'pix' | 'credit_card' | 'card'
      description,
      payer,
      items,
      card,
      shipment,
      config,
    } = req.body;

    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Valor da transação inválido.' });
    }

    const accessToken =
      process.env.MERCADO_PAGO_ACCESS_TOKEN ||
      config?.mercadoPagoAccessToken ||
      config?.creditCardSecretToken ||
      '';

    // Payer fields validation (Name, Cellphone, Email, CPF/TaxId are mandatory)
    const payerName = (payer?.name || '').trim();
    const cleanCpf = (payer?.cpf || payer?.taxId || '').replace(/\D/g, '');
    const cleanPhone = (payer?.phone || payer?.cellphone || '').replace(/\D/g, '');
    const email = (payer?.email || '').trim();

    if (!payerName) {
      return res.status(400).json({ success: false, error: 'Nome completo é obrigatório.' });
    }
    if (!cleanPhone || cleanPhone.length < 10) {
      return res.status(400).json({ success: false, error: 'Celular com DDD é obrigatório.' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'E-mail válido é obrigatório.' });
    }
    if (!cleanCpf || cleanCpf.length !== 11) {
      return res.status(400).json({ success: false, error: 'CPF (TaxId) de 11 dígitos é obrigatório.' });
    }

    const nameParts = payerName.split(' ');
    const firstName = nameParts[0] || 'Cliente';
    const lastName = nameParts.slice(1).join(' ') || 'VIP';

    const areaCode = cleanPhone.length >= 10 ? cleanPhone.substring(0, 2) : '11';
    const phoneNumber = cleanPhone.length >= 10 ? cleanPhone.substring(2) : cleanPhone;

    const isCard = paymentMethodType === 'credit_card' || paymentMethodType === 'card';
    const totalAmountStr = parsedAmount.toFixed(2);
    const externalRef = `ext_ref_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Default shipment address according to Mercado Pago Orders API requirements
    const shipmentAddress = shipment?.address || {
      zip_code: '11034430',
      street_name: 'Av. Paulista',
      street_number: '100',
      neighborhood: 'Bonfim',
      city: 'SAO PAULO',
      state: 'SP',
      complement: '101',
    };

    // If an Access Token is configured, call official Mercado Pago /v1/payments API
    if (accessToken && accessToken.trim().length > 10 && !accessToken.includes('mock-token')) {
      try {
        let cardTokenId = card?.token;
        let cardBrand = card?.brand;

        // If card payment and card details were provided directly, generate token via Mercado Pago
        if (isCard && !cardTokenId && card?.cardNumber) {
          const rawNum = String(card.cardNumber).replace(/\D/g, '');
          const rawExp = String(card.cardExp || card.expiration || '').trim();
          let expMonth = Number(card.expirationMonth) || 12;
          let expYear = Number(card.expirationYear) || 2028;

          if (rawExp.includes('/')) {
            const [m, y] = rawExp.split('/');
            expMonth = Number(m);
            expYear = Number(y.length === 2 ? `20${y}` : y);
          }

          cardBrand = cardBrand || detectCardBrand(rawNum);

          const tokenRes = await fetch('https://api.mercadopago.com/v1/card_tokens', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken.trim()}`,
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
            console.warn('Card Token error:', tokenData);
            return res.status(400).json({
              success: false,
              error: tokenData.message || tokenData.cause?.[0]?.description || 'Dados do cartão de crédito inválidos.',
              details: tokenData,
            });
          }
        }

        // Build /v1/payments payload
        let paymentPayload: any;

        if (isCard) {
          paymentPayload = {
            transaction_amount: Number(parsedAmount.toFixed(2)),
            token: cardTokenId,
            description: (description || 'MD Stúdio Play - Playbacks Profissionais').slice(0, 100),
            installments: Number(card?.installments) || 1,
            payment_method_id: cardBrand || 'master',
            payer: {
              email: email,
              first_name: firstName,
              last_name: lastName,
              identification: {
                type: 'CPF',
                number: cleanCpf,
              },
            },
            notification_url: `${process.env.APP_URL || ''}/api/mercadopago/webhook`,
          };
        } else {
          // PIX payment
          paymentPayload = {
            transaction_amount: Number(parsedAmount.toFixed(2)),
            description: (description || 'MD Stúdio Play - Playbacks Profissionais').slice(0, 100),
            payment_method_id: 'pix',
            payer: {
              email: email,
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
            notification_url: `${process.env.APP_URL || ''}/api/mercadopago/webhook`,
          };
        }

        const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken.trim()}`,
            'X-Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify(paymentPayload),
        });

        const mpData: any = await mpRes.json();

        if (mpRes.ok && mpData.id) {
          const transactionData = mpData.point_of_interaction?.transaction_data;
          const qrCode = transactionData?.qr_code || '';
          const qrCodeBase64 = transactionData?.qr_code_base64 || '';
          const ticketUrl = transactionData?.ticket_url || '';
          const paymentId = String(mpData.id);
          const status = mpData.status;
          const statusDetail = mpData.status_detail;

          return res.json({
            success: true,
            provider: 'mercadopago_payments_api',
            orderId: paymentId,
            paymentId,
            status,
            statusDetail,
            totalAmount: mpData.transaction_amount,
            qrCode,
            qrCodeBase64,
            ticketUrl,
            expirationDate: mpData.date_of_expiration,
            order: mpData,
          });
        } else {
          console.warn('Mercado Pago /v1/payments error response:', mpData);
          return res.status(mpRes.status || 400).json({
            success: false,
            error:
              mpData.message ||
              mpData.cause?.[0]?.description ||
              'Falha ao processar pagamento no Mercado Pago.',
            mpDetails: mpData,
          });
        }
      } catch (mpErr: any) {
        console.error('Error contacting Mercado Pago /v1/payments API:', mpErr);
        return res.status(502).json({
          success: false,
          error: 'Erro de conexão com o Mercado Pago: ' + (mpErr?.message || 'Servidor indisponível'),
        });
      }
    }

    // Fallback when no valid Access Token configured
    return res.status(400).json({
      success: false,
      requiresToken: true,
      error:
        'Access Token do Mercado Pago não configurado. Adicione seu Access Token em Admin > Vendas/Checkout ou configure MERCADO_PAGO_ACCESS_TOKEN no .env.',
    });
  } catch (err: any) {
    console.error('Unexpected error in Mercado Pago Order:', err);
    return res.status(500).json({ success: false, error: err.message || 'Erro interno no servidor' });
  }
}

// API: Mercado Pago Create Order (/v1/orders for PIX and Credit Card)
app.post('/api/mercadopago/create-order', processMercadoPagoOrder);

// API: Mercado Pago Configuration Status (Safe for UI, no secret exposure)
app.get('/api/mercadopago/status', async (_req: Request, res: Response) => {
  const envToken = process.env.MERCADO_PAGO_ACCESS_TOKEN || '';
  const hasEnvToken = Boolean(envToken && envToken.trim().length > 10 && !envToken.includes('mock-token'));

  if (!hasEnvToken) {
    return res.json({
      configured: false,
      hasEnvToken: false,
      message: 'MERCADO_PAGO_ACCESS_TOKEN não configurado.',
    });
  }

  try {
    const meRes = await fetch('https://api.mercadopago.com/users/me', {
      headers: { Authorization: `Bearer ${envToken.trim()}` },
    });
    if (meRes.ok) {
      const meData: any = await meRes.json();
      return res.json({
        configured: true,
        hasEnvToken: true,
        isLive: true,
        accountNickname: meData.nickname || 'MD Studio',
        siteId: meData.site_id || 'MLB',
        tokenPrefix: envToken.substring(0, 10) + '...',
      });
    }
  } catch {}

  return res.json({
    configured: true,
    hasEnvToken: true,
    isLive: true,
    tokenPrefix: envToken.substring(0, 10) + '...',
  });
});

// API: Mercado Pago Create PIX (routes to the unified /v1/orders engine)
app.post('/api/mercadopago/create-pix', async (req: Request, res: Response) => {
  req.body.paymentMethodType = 'pix';
  return processMercadoPagoOrder(req, res);
});

// API: Mercado Pago Payment Status Check
app.get('/api/mercadopago/payment-status/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const token =
      (req.query.token as string) ||
      process.env.MERCADO_PAGO_ACCESS_TOKEN ||
      '';

    if (!id) {
      return res.status(400).json({ success: false, error: 'ID do pagamento não informado.' });
    }

    if (id.startsWith('demo_')) {
      return res.json({
        success: true,
        status: 'pending',
        id,
      });
    }

    if (!token) {
      return res.json({
        success: true,
        status: 'pending',
        note: 'Sem token para consulta em tempo real',
      });
    }

    // If ID starts with ORD or indicates an order, query /v1/orders
    const isOrderQuery = id.startsWith('ORD') || id.includes('ORD');
    const endpoint = isOrderQuery
      ? `https://api.mercadopago.com/v1/orders/${id}`
      : `https://api.mercadopago.com/v1/payments/${id}`;

    let mpRes = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    // If order query failed or payment not found, try fallback endpoint
    if (!mpRes.ok && !isOrderQuery) {
      mpRes = await fetch(`https://api.mercadopago.com/v1/orders/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }

    if (mpRes.ok) {
      const data: any = await mpRes.json();
      const firstPayment = data.transactions?.payments?.[0];
      const status = firstPayment?.status || data.status;
      const statusDetail = firstPayment?.status_detail || data.status_detail;
      const isApproved =
        status === 'approved' ||
        status === 'processed' ||
        status === 'closed' ||
        firstPayment?.status === 'approved';

      return res.json({
        success: true,
        id: data.id,
        paymentId: firstPayment?.id || data.id,
        status: isApproved ? 'approved' : status,
        statusDetail,
        dateApproved: firstPayment?.date_approved || data.date_approved || data.last_updated_date,
        raw: data,
      });
    }

    return res.json({ success: false, status: 'unknown' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API: Mercado Pago Webhook IPN Receiver
app.post('/api/mercadopago/webhook', async (req: Request, res: Response) => {
  console.log('Mercado Pago Webhook notification received:', req.body);
  res.status(200).send('OK');
});

// API: WhatsApp OTP Dispatcher
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

// Setup Vite or Static File Serving
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  // Ensure image assets are always served reliably regardless of route prefix
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
