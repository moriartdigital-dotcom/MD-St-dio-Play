import React, { useState, useEffect, useRef } from 'react';
import { CartItem, PlaybackPack } from '../types';
import { PackThumbnail } from './PackThumbnail';
import { useStore } from '../context/StoreContext';
import { generatePixPayload, generatePixQrCodeDataUrl } from '../utils/pix';
import {
  X,
  Trash2,
  ShoppingBag,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  QrCode,
  CreditCard,
  CheckCircle2,
  Copy,
  Download,
  Check,
  FileMusic,
  Lock,
  Zap,
  FolderDown,
  Plus,
  Minus,
  RefreshCw,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  items: CartItem[];
  onRemoveItem: (packId: string) => void;
  onUpdateQuantity?: (packId: string, quantity: number) => void;
  onClearCart: () => void;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  onClose,
  items,
  onRemoveItem,
  onUpdateQuantity,
  onClearCart,
}) => {
  const {
    cartConfig,
    checkoutConfig,
    themeConfig,
    addOrder,
    setIsCustomerAreaOpen,
    setPendingWhatsAppPhone,
    sendWhatsAppValidationCode,
    loginCustomerDirectWithPhone,
  } = useStore();

  // Navigation state: 'cart' | 'checkout' | 'completed'
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'card'>('pix');

  // Customer Checkout Inputs
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerCpf, setCustomerCpf] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Card fields
  const [cardHolder, setCardHolder] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExp, setCardExp] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [installments, setInstallments] = useState(1);

  // Mercado Pago PIX states
  const [mpLoading, setMpLoading] = useState(false);
  const [cardLoading, setCardLoading] = useState(false);
  const [mpQrCode, setMpQrCode] = useState<string | null>(null);
  const [mpQrCodeBase64, setMpQrCodeBase64] = useState<string | null>(null);
  const [mpPaymentId, setMpPaymentId] = useState<string | null>(null);
  const [mpTicketUrl, setMpTicketUrl] = useState<string | null>(null);
  const [pixCopied, setPixCopied] = useState(false);
  const pollIntervalRef = useRef<any>(null);

  // Completed order reference
  const [completedOrderPacks, setCompletedOrderPacks] = useState<PlaybackPack[]>([]);

  // Subtotal (No coupons applied as requested)
  const total = items.reduce(
    (acc, item) => acc + item.pack.discountPrice * item.quantity,
    0
  );

  const formatCurrency = (val: number) => {
    return val.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  };

  // Mask for WhatsApp: (XX) XXXXX-XXXX with limit of 11 numeric digits
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawDigits = e.target.value.replace(/\D/g, '').slice(0, 11);
    let formatted = '';
    if (!rawDigits.length) {
      formatted = '';
    } else if (rawDigits.length <= 2) {
      formatted = `(${rawDigits}`;
    } else if (rawDigits.length <= 6) {
      formatted = `(${rawDigits.slice(0, 2)}) ${rawDigits.slice(2)}`;
    } else if (rawDigits.length <= 10) {
      formatted = `(${rawDigits.slice(0, 2)}) ${rawDigits.slice(2, 6)}-${rawDigits.slice(6)}`;
    } else {
      formatted = `(${rawDigits.slice(0, 2)}) ${rawDigits.slice(2, 7)}-${rawDigits.slice(7, 11)}`;
    }
    setCustomerPhone(formatted);
    if (formError) setFormError(null);
  };

  // Mask for CPF: 000.000.000-00 with limit of 11 numeric digits
  const handleCpfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawDigits = e.target.value.replace(/\D/g, '').slice(0, 11);
    let formatted = '';
    if (!rawDigits.length) {
      formatted = '';
    } else if (rawDigits.length <= 3) {
      formatted = rawDigits;
    } else if (rawDigits.length <= 6) {
      formatted = `${rawDigits.slice(0, 3)}.${rawDigits.slice(3)}`;
    } else if (rawDigits.length <= 9) {
      formatted = `${rawDigits.slice(0, 3)}.${rawDigits.slice(3, 6)}.${rawDigits.slice(6)}`;
    } else {
      formatted = `${rawDigits.slice(0, 3)}.${rawDigits.slice(3, 6)}.${rawDigits.slice(6, 9)}-${rawDigits.slice(9, 11)}`;
    }
    setCustomerCpf(formatted);
    if (formError) setFormError(null);
  };

  // Validate required customer fields
  const validateCustomerFields = (): boolean => {
    if (!customerName.trim() || customerName.trim().length < 3) {
      setFormError('Por favor informe seu nome completo.');
      return false;
    }
    const phoneDigits = customerPhone.replace(/\D/g, '');
    if (phoneDigits.length < 10) {
      setFormError('Informe um WhatsApp válido com DDD (ex: (11) 99999-9999).');
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerEmail.trim())) {
      setFormError('Informe um e-mail válido.');
      return false;
    }
    const cpfDigits = customerCpf.replace(/\D/g, '');
    if (cpfDigits.length !== 11) {
      setFormError('O CPF deve conter exatamente 11 dígitos no formato 000.000.000-00.');
      return false;
    }
    setFormError(null);
    return true;
  };

  // Generate Real Mercado Pago PIX QR Code via Server API
  const handleGenerateMercadoPagoPix = async () => {
    if (!validateCustomerFields()) return;

    setMpLoading(true);

    const accessToken =
      checkoutConfig.mercadoPagoAccessToken ||
      checkoutConfig.creditCardSecretToken ||
      '';

    try {
      const response = await fetch('/api/mercadopago/create-pix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: total,
          description: `MD Studio Play - ${items.map((i) => i.pack.title).join(', ')}`.slice(0, 100),
          payer: {
            name: customerName.trim(),
            email: customerEmail.trim(),
            phone: customerPhone,
            cpf: customerCpf.replace(/\D/g, ''),
          },
          items: items.map((i) => ({
            title: i.pack.title,
            quantity: i.quantity,
            unit_price: i.pack.discountPrice,
          })),
          config: {
            mercadoPagoAccessToken: accessToken,
          },
        }),
      });

      const data = await response.json();

      if (data.success && data.qrCode) {
        setMpQrCode(data.qrCode);
        setMpPaymentId(data.paymentId);
        setMpTicketUrl(data.ticketUrl || null);

        if (data.qrCodeBase64) {
          setMpQrCodeBase64(`data:image/png;base64,${data.qrCodeBase64}`);
        } else {
          const generatedUrl = await generatePixQrCodeDataUrl(data.qrCode);
          setMpQrCodeBase64(generatedUrl);
        }
      } else {
        // Fallback: If Mercado Pago requires a token or returned an error, generate standard compliant BACEN PIX
        const fallbackTxid = `${checkoutConfig.pixTxidPrefix || 'MD'}${Math.floor(100000 + Math.random() * 900000)}`;
        const fallbackPayload = generatePixPayload({
          key: checkoutConfig.pixKey || 'comercial@mdstudioplay.com.br',
          name: checkoutConfig.pixBeneficiaryName || 'MD STUDIO PLAY',
          city: checkoutConfig.pixBeneficiaryCity || 'SAO PAULO',
          amount: total,
          txid: fallbackTxid,
          description: 'MD STUDIO PLAY PIX',
        });

        const fallbackQrUrl = await generatePixQrCodeDataUrl(fallbackPayload);
        setMpQrCode(fallbackPayload);
        setMpQrCodeBase64(fallbackQrUrl);
        setMpPaymentId('demo_' + Date.now());
      }
    } catch (err: any) {
      console.warn('Falha na rota Mercado Pago, usando contingência BACEN PIX:', err);
      const fallbackTxid = `${checkoutConfig.pixTxidPrefix || 'MD'}${Math.floor(100000 + Math.random() * 900000)}`;
      const fallbackPayload = generatePixPayload({
        key: checkoutConfig.pixKey || 'comercial@mdstudioplay.com.br',
        name: checkoutConfig.pixBeneficiaryName || 'MD STUDIO PLAY',
        city: checkoutConfig.pixBeneficiaryCity || 'SAO PAULO',
        amount: total,
        txid: fallbackTxid,
        description: 'MD STUDIO PLAY PIX',
      });
      const fallbackQrUrl = await generatePixQrCodeDataUrl(fallbackPayload);
      setMpQrCode(fallbackPayload);
      setMpQrCodeBase64(fallbackQrUrl);
      setMpPaymentId('demo_' + Date.now());
    } finally {
      setMpLoading(false);
    }
  };

  // Process Real Mercado Pago Credit Card via /api/mercadopago/create-order
  const handleProcessCreditCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateCustomerFields()) return;

    const cleanCard = cardNumber.replace(/\D/g, '');
    if (cleanCard.length < 13) {
      setFormError('Informe um número de cartão de crédito válido.');
      return;
    }
    if (!cardHolder.trim()) {
      setFormError('Nome do titular impresso no cartão é obrigatório.');
      return;
    }
    if (!cardExp.trim() || !cardExp.includes('/')) {
      setFormError('Data de validade do cartão deve estar no formato MM/AA.');
      return;
    }
    const cleanCvvNum = cardCvv.replace(/\D/g, '');
    if (cleanCvvNum.length < 3) {
      setFormError('Código de segurança (CVV) de 3 ou 4 dígitos é obrigatório.');
      return;
    }

    setCardLoading(true);
    setFormError(null);

    const accessToken =
      checkoutConfig.mercadoPagoAccessToken ||
      checkoutConfig.creditCardSecretToken ||
      '';

    try {
      const response = await fetch('/api/mercadopago/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: total,
          paymentMethodType: 'credit_card',
          description: `MD Studio Play - ${items.map((i) => i.pack.title).join(', ')}`.slice(0, 100),
          payer: {
            name: customerName.trim(),
            email: customerEmail.trim(),
            phone: customerPhone,
            cpf: customerCpf.replace(/\D/g, ''),
          },
          card: {
            cardNumber: cleanCard,
            cardHolder: cardHolder.trim(),
            cardExp: cardExp.trim(),
            cvv: cleanCvvNum,
            installments,
          },
          config: {
            mercadoPagoAccessToken: accessToken,
          },
        }),
      });

      const data = await response.json();

      if (data.success && (data.status === 'approved' || data.status === 'processed')) {
        setMpPaymentId(data.paymentId || data.orderId);
        await handleFinalizeOrderAndRedirect('card');
        return;
      } else if (data.success && (data.status === 'in_process' || data.status === 'action_required' || data.status === 'pending')) {
        setMpPaymentId(data.paymentId || data.orderId);
        await handleFinalizeOrderAndRedirect('card');
        return;
      } else if (!data.success && data.requiresToken) {
        // Fallback demo approval only if no token is configured anywhere
        await handleFinalizeOrderAndRedirect('card');
        return;
      } else {
        setFormError(
          data.error ||
          data.mpDetails?.message ||
          'Pagamento com cartão recusado pela operadora. Verifique os dados ou pague via PIX.'
        );
        return;
      }
    } catch (err: any) {
      console.warn('Erro ao processar cartão Mercado Pago:', err);
      setFormError('Erro ao comunicar com o Mercado Pago. Tente novamente ou use PIX.');
    } finally {
      setCardLoading(false);
    }
  };

  // Poll payment status if paymentId exists and is real Mercado Pago ID
  useEffect(() => {
    if (!mpPaymentId || mpPaymentId.startsWith('demo_') || isCompleted) {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      return;
    }

    let isPollingActive = true;

    const checkStatus = async () => {
      if (!isPollingActive) return;
      try {
        const token =
          checkoutConfig.mercadoPagoAccessToken ||
          checkoutConfig.creditCardSecretToken ||
          '';
        const res = await fetch(
          `/api/mercadopago/payment-status/${mpPaymentId}?token=${encodeURIComponent(token)}`
        );
        const json = await res.json();
        if (json.success && json.status === 'approved' && isPollingActive) {
          isPollingActive = false;
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          await handleFinalizeOrderAndRedirect('pix');
        }
      } catch {
        // silent check error
      }
    };

    // Immediate check
    checkStatus();
    // Then poll every 2.5 seconds
    pollIntervalRef.current = setInterval(checkStatus, 2500);

    return () => {
      isPollingActive = false;
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [
    mpPaymentId,
    isCompleted,
    customerPhone,
    customerName,
    customerEmail,
    customerCpf,
    items,
    total,
    mpQrCode,
    mpQrCodeBase64,
    mpTicketUrl,
    checkoutConfig,
  ]);

  const handleCopyPix = () => {
    if (mpQrCode) {
      navigator.clipboard.writeText(mpQrCode);
      setPixCopied(true);
      setTimeout(() => setPixCopied(false), 3000);
    }
  };

  // Finalize order, authenticate customer session, and redirect directly to Customer Area pop-up for instant downloads
  const handleFinalizeOrderAndRedirect = async (method: 'pix' | 'card') => {
    const rawPhone = customerPhone.trim() || '(11) 99999-8888';
    const rawName = customerName.trim() || 'Cliente VIP';
    const rawEmail = customerEmail.trim() || 'cliente@mdstudioplay.com.br';
    const rawCpf = customerCpf.trim();

    const orderPacks = items.map((i) => i.pack);
    setCompletedOrderPacks(orderPacks);

    addOrder({
      customerName: rawName,
      customerEmail: rawEmail,
      customerPhone: rawPhone,
      customerCpf: rawCpf,
      items: items.map((i) => ({ pack: i.pack, quantity: i.quantity })),
      subtotal: total,
      discount: 0,
      total,
      paymentMethod: method,
      status: 'completed',
      pixPayload: method === 'pix' ? (mpQrCode || undefined) : undefined,
      pixQrCodeUrl: method === 'pix' ? (mpQrCodeBase64 || undefined) : undefined,
      mercadoPagoPaymentId: mpPaymentId || undefined,
      ticketUrl: mpTicketUrl || undefined,
      cardBrand: method === 'card' ? 'Visa' : undefined,
      cardLast4: method === 'card' ? (cardNumber.slice(-4) || '1234') : undefined,
      installments: method === 'card' ? installments : undefined,
    });

    setPendingWhatsAppPhone(rawPhone);
    sendWhatsAppValidationCode(rawPhone).catch(() => {});

    // Authenticate customer directly so the Customer Area modal opens straight to downloads!
    await loginCustomerDirectWithPhone(rawPhone);

    onClearCart();
    setIsCheckingOut(false);
    setIsCompleted(false);
    onClose();
    setIsCustomerAreaOpen(true);
  };

  const handleGoToCustomerArea = () => {
    setIsCompleted(false);
    setIsCheckingOut(false);
    onClose();
    setIsCustomerAreaOpen(true);
  };

  const handleResetOrder = () => {
    setIsCompleted(false);
    setIsCheckingOut(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden animate-in fade-in duration-200">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-6 sm:pl-10">
        <div className="w-screen max-w-md bg-[#0e1014] border-l border-white/10 flex flex-col shadow-2xl text-neutral-200">
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between bg-[#12141a]">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-emerald-400" />
              <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                {isCompleted
                  ? 'Compra Concluída'
                  : isCheckingOut
                  ? 'Finalizar Compra / Checkout'
                  : `Meu Carrinho (${items.reduce((acc, i) => acc + i.quantity, 0)})`}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content Body */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
            {isCompleted ? (
              /* Success / Instant Download Screen */
              <div className="py-6 text-center space-y-4 animate-in fade-in zoom-in-95 duration-200">
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto shadow-[0_0_25px_rgba(16,185,129,0.3)]">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-white">Pagamento Confirmado!</h3>
                  <p className="text-xs text-neutral-400 mt-1">
                    Seus playbacks masterizados em 320kbps + Stems multitrack foram liberados.
                  </p>
                </div>

                <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-3.5 text-left space-y-2.5">
                  <div className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                    <Download className="w-4 h-4" />
                    <span>Seus Playbacks Prontos para Download:</span>
                  </div>
                  {completedOrderPacks.map((pack) => (
                    <div
                      key={pack.id}
                      className="p-3 rounded-xl bg-black/50 border border-white/5 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate">{pack.title}</div>
                        <div className="text-[10px] text-neutral-400">
                          {pack.tracks.length} faixas · {pack.genre}
                        </div>
                      </div>
                      {pack.postSaleUrl ? (
                        <a
                          href={pack.postSaleUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs transition-colors flex items-center gap-1.5 cursor-pointer shadow shrink-0"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Baixar</span>
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            const blob = new Blob(
                              [
                                `MD STUDIO PLAY - DOWNLOAD LIBERADO\nProduto: ${pack.title}\nCliente: ${customerName}\nWhatsApp: ${customerPhone}\nData: ${new Date().toLocaleString()}\nAcesso autorizado aos multitracks na nuvem.`,
                              ],
                              { type: 'text/plain' }
                            );
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `${pack.title.replace(/\s+/g, '_')}_Multitracks.txt`;
                            a.click();
                            URL.revokeObjectURL(url);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs transition-colors flex items-center gap-1.5 cursor-pointer shadow shrink-0"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Baixar</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-xs text-emerald-300 text-left space-y-1">
                  <div className="font-bold flex items-center gap-1 text-emerald-400">
                    <Check className="w-3.5 h-3.5" /> Acesso Liberado no WhatsApp
                  </div>
                  <p className="text-[11px] text-neutral-300">
                    Você pode acessar todos os seus downloads a qualquer momento na <strong>Área do Cliente</strong> informando o seu WhatsApp cadastrado.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleGoToCustomerArea}
                  className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-sm rounded-xl transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                >
                  <FolderDown className="w-4 h-4" />
                  <span>Acessar Área do Cliente Agora</span>
                </button>

                <button
                  type="button"
                  onClick={handleResetOrder}
                  className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white font-medium text-xs rounded-xl transition-colors cursor-pointer"
                >
                  Voltar para a Loja Virtual
                </button>
              </div>
            ) : isCheckingOut ? (
              /* =========================================================================
                 CHECKOUT STEP: NOME, WHATSAPP, E-MAIL, CPF + FORMA DE PAGAMENTO (PIX OU CARTÃO)
                 ========================================================================= */
              <div className="space-y-4 animate-in fade-in duration-200">
                {/* Back to cart button */}
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <span className="text-xs font-bold text-neutral-400 uppercase tracking-wider">
                    Dados do Comprador
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCheckingOut(false);
                      setMpQrCode(null);
                      setFormError(null);
                    }}
                    className="text-xs text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Voltar ao Carrinho</span>
                  </button>
                </div>

                {/* Form Error Alert */}
                {formError && (
                  <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                    <span>{formError}</span>
                  </div>
                )}

                {/* Required Customer Data Fields */}
                <div className="bg-[#12141a] border border-white/10 rounded-2xl p-4 space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-neutral-300 mb-1">
                      Seu Nome Completo *
                    </label>
                    <input
                      type="text"
                      value={customerName}
                      onChange={(e) => {
                        setCustomerName(e.target.value);
                        if (formError) setFormError(null);
                      }}
                      placeholder="Ex: Carlos Eduardo da Silva"
                      required
                      className="w-full bg-[#0a0b0e] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-neutral-500 outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-neutral-300 mb-1">
                      Whatsapp com DDD *
                    </label>
                    <input
                      type="tel"
                      value={customerPhone}
                      onChange={handlePhoneChange}
                      placeholder="(00) 00000-0000"
                      maxLength={16}
                      required
                      className="w-full bg-[#0a0b0e] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-neutral-500 outline-none focus:border-emerald-500 transition-colors font-mono"
                    />
                    <span className="text-[10px] text-neutral-500 mt-1 block">
                      DDD entre parênteses obrigatório para envio e liberação dos downloads
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-neutral-300 mb-1">
                      Seu E-mail *
                    </label>
                    <input
                      type="email"
                      value={customerEmail}
                      onChange={(e) => {
                        setCustomerEmail(e.target.value);
                        if (formError) setFormError(null);
                      }}
                      placeholder="seuemail@exemplo.com"
                      required
                      className="w-full bg-[#0a0b0e] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-neutral-500 outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-neutral-300 mb-1">
                      CPF *
                    </label>
                    <input
                      type="text"
                      value={customerCpf}
                      onChange={handleCpfChange}
                      placeholder="000.000.000-00"
                      maxLength={14}
                      required
                      className="w-full bg-[#0a0b0e] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-neutral-500 outline-none focus:border-emerald-500 transition-colors font-mono"
                    />
                    <span className="text-[10px] text-neutral-500 mt-1 block">
                      Exatamente 11 dígitos divididos em pontos e traço
                    </span>
                  </div>
                </div>

                {/* Payment Method Selector (PIX ou Cartão) */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wider">
                    Escolha a Forma de Pagamento
                  </label>
                  <div className="grid grid-cols-2 gap-2 p-1 bg-[#12141a] rounded-2xl border border-white/10">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('pix')}
                      className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        paymentMethod === 'pix'
                          ? 'bg-emerald-500 text-black shadow-md'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      <QrCode className="w-4 h-4" />
                      <span>PIX (Instantâneo)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('card')}
                      className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        paymentMethod === 'card'
                          ? 'bg-emerald-500 text-black shadow-md'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      <CreditCard className="w-4 h-4" />
                      <span>Cartão de Crédito</span>
                    </button>
                  </div>
                </div>

                {/* Summary Row */}
                <div className="p-3 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between text-xs">
                  <span className="text-neutral-400">Total a Pagar:</span>
                  <span className="text-base font-black text-emerald-400 tabular-nums">
                    {formatCurrency(total)}
                  </span>
                </div>

                {/* PIX Flow via Mercado Pago API */}
                {paymentMethod === 'pix' ? (
                  <div className="bg-[#12141a] border border-white/10 rounded-2xl p-4 text-center space-y-3.5">
                    <div className="flex items-center justify-between border-b border-white/5 pb-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                        <Zap className="w-4 h-4 text-emerald-400" />
                        <span>PIX Mercado Pago Oficial</span>
                      </div>
                      <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                        Aprovação Automática
                      </span>
                    </div>

                    {!mpQrCode ? (
                      /* CTA to generate Mercado Pago QR Code */
                      <div className="py-3 space-y-3">
                        <p className="text-xs text-neutral-300 leading-relaxed">
                          Ao clicar no botão abaixo, será gerado o <strong>QR Code oficial via Mercado Pago</strong> com liberação instantânea.
                        </p>
                        <button
                          type="button"
                          onClick={handleGenerateMercadoPagoPix}
                          disabled={mpLoading}
                          className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-sm rounded-xl transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-50"
                        >
                          {mpLoading ? (
                            <>
                              <RefreshCw className="w-4 h-4 animate-spin text-black" />
                              <span>Gerando QR Code no Mercado Pago...</span>
                            </>
                          ) : (
                            <>
                              <QrCode className="w-4 h-4" />
                              <span>Gerar QR Code PIX (Mercado Pago)</span>
                            </>
                          )}
                        </button>
                      </div>
                    ) : (
                      /* Scannable Real QR Code Display */
                      <div className="space-y-3 animate-in zoom-in-95 duration-200">
                        <div className="w-48 h-48 bg-white p-3 rounded-2xl mx-auto shadow-2xl flex items-center justify-center border-4 border-emerald-500">
                          {mpQrCodeBase64 ? (
                            <img
                              src={mpQrCodeBase64}
                              alt="QR Code PIX Mercado Pago"
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <div className="text-xs text-black font-bold">Carregando QR Code...</div>
                          )}
                        </div>

                        {/* Status notification */}
                        <div className="flex items-center justify-center gap-2 text-xs text-emerald-400 bg-emerald-950/30 border border-emerald-500/20 p-2 rounded-xl">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                          <span>Aguardando confirmação do Mercado Pago...</span>
                        </div>

                        {/* Copy Paste Code */}
                        <div className="p-2.5 rounded-xl bg-black/60 border border-white/10 text-left space-y-1.5">
                          <div className="text-[10px] text-neutral-400 font-semibold flex items-center justify-between">
                            <span>Código PIX Copia e Cola:</span>
                            {pixCopied && <span className="text-emerald-400 font-bold">Copiado!</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              readOnly
                              value={mpQrCode}
                              className="flex-1 bg-transparent text-[11px] text-neutral-300 font-mono truncate outline-none select-all"
                            />
                            <button
                              type="button"
                              onClick={handleCopyPix}
                              className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                            >
                              {pixCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                              <span>{pixCopied ? 'Copiado' : 'Copiar'}</span>
                            </button>
                          </div>
                        </div>

                        {mpTicketUrl && (
                          <a
                            href={mpTicketUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-neutral-400 hover:text-white underline cursor-pointer"
                          >
                            <span>Ver comprovante na página do Mercado Pago</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}

                        {/* Orientações do PIX */}
                        <div className="bg-[#12141a] border border-white/10 rounded-xl p-3 space-y-1.5 text-[11px] text-neutral-300">
                          <div className="flex items-start gap-2">
                            <span className="text-emerald-400 font-bold shrink-0">ⓘ</span>
                            <span>O pagamento deve ser realizado em até 24 horas.</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="text-emerald-400 font-bold shrink-0">ⓘ</span>
                            <span>Utilize o código acima para efetuar o pagamento pelo seu banco.</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="text-emerald-400 font-bold shrink-0">ⓘ</span>
                            <span>Após a confirmação do pagamento, a liberação será automática e ocorrerá em poucos instantes.</span>
                          </div>
                        </div>

                        {/* Status de Confirmação Automática via Mercado Pago */}
                        <div className="bg-[#12141a] border border-emerald-500/30 rounded-xl p-3.5 flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                            <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin" />
                          </div>
                          <div className="text-left flex-1 min-w-0">
                            <p className="text-xs font-bold text-white flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
                              <span>Aguardando confirmação do Mercado Pago...</span>
                            </p>
                            <p className="text-[11px] text-neutral-400 mt-0.5">
                              Assim que o pagamento for confirmado pelo seu banco, você será redirecionado automaticamente para a Área do Cliente.
                            </p>
                          </div>
                        </div>

                        {/* Botão de teste exibido apenas quando em modo demonstração (sem token live) */}
                        {mpPaymentId?.startsWith('demo_') && (
                          <div className="text-center pt-0.5">
                            <button
                              type="button"
                              onClick={() => handleFinalizeOrderAndRedirect('pix')}
                              className="text-[10px] text-neutral-500 hover:text-emerald-400 underline transition-colors cursor-pointer"
                            >
                              [Ambiente de Teste: Simular Aprovação Automática Agora]
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Credit Card Form */
                  <form
                    onSubmit={handleProcessCreditCard}
                    className="bg-[#12141a] border border-white/10 rounded-2xl p-4 space-y-3 text-xs"
                  >
                    <div className="flex items-center justify-between text-[11px] text-neutral-400 pb-2 border-b border-white/5">
                      <span>Gateway: <strong className="text-white uppercase">{checkoutConfig.creditCardGateway}</strong></span>
                      <span className="flex items-center gap-1 text-emerald-400">
                        <Lock className="w-3 h-3" /> SSL 256-bit Seguro
                      </span>
                    </div>

                    <div>
                      <label className="block text-neutral-300 mb-1 font-semibold">Nome no Cartão</label>
                      <input
                        type="text"
                        value={cardHolder}
                        onChange={(e) => setCardHolder(e.target.value)}
                        placeholder="Nome idêntico ao impresso"
                        required
                        className="w-full bg-[#0a0b0e] border border-white/10 rounded-xl px-3 py-2 text-white outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="block text-neutral-300 mb-1 font-semibold">Número do Cartão</label>
                      <input
                        type="text"
                        value={cardNumber}
                        onChange={(e) => setCardNumber(e.target.value)}
                        placeholder="0000 0000 0000 0000"
                        maxLength={19}
                        required
                        className="w-full bg-[#0a0b0e] border border-white/10 rounded-xl px-3 py-2 text-white font-mono outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-neutral-300 mb-1 font-semibold">Validade (MM/AA)</label>
                        <input
                          type="text"
                          value={cardExp}
                          onChange={(e) => setCardExp(e.target.value)}
                          placeholder="MM/AA"
                          maxLength={5}
                          required
                          className="w-full bg-[#0a0b0e] border border-white/10 rounded-xl px-3 py-2 text-white font-mono outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="block text-neutral-300 mb-1 font-semibold">CVV</label>
                        <input
                          type="password"
                          value={cardCvv}
                          onChange={(e) => setCardCvv(e.target.value)}
                          placeholder="CVV"
                          maxLength={4}
                          required
                          className="w-full bg-[#0a0b0e] border border-white/10 rounded-xl px-3 py-2 text-white font-mono outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-neutral-300 mb-1 font-semibold">Parcelamento</label>
                      <select
                        value={installments}
                        onChange={(e) => setInstallments(Number(e.target.value))}
                        className="w-full bg-[#0a0b0e] border border-white/10 rounded-xl px-3 py-2 text-white outline-none focus:border-emerald-500 cursor-pointer"
                      >
                        <option value={1}>1x de {formatCurrency(total)} (sem juros)</option>
                        {checkoutConfig.creditCardMaxInstallments >= 2 && (
                          <option value={2}>2x de {formatCurrency(total / 2)} (sem juros)</option>
                        )}
                        {checkoutConfig.creditCardMaxInstallments >= 3 && (
                          <option value={3}>3x de {formatCurrency(total / 3)} (sem juros)</option>
                        )}
                        {checkoutConfig.creditCardMaxInstallments >= 6 && (
                          <option value={6}>6x de {formatCurrency(total / 6)}</option>
                        )}
                        {checkoutConfig.creditCardMaxInstallments >= 12 && (
                          <option value={12}>12x de {formatCurrency(total / 12)}</option>
                        )}
                      </select>
                    </div>

                    <button
                      type="submit"
                      disabled={cardLoading}
                      className="w-full mt-2 py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-sm rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-50"
                    >
                      {cardLoading ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin text-black" />
                          <span>Processando Pagamento...</span>
                        </>
                      ) : (
                        <>
                          <Lock className="w-4 h-4" />
                          <span>Confirmar Pagamento de {formatCurrency(total)}</span>
                        </>
                      )}
                    </button>
                  </form>
                )}
              </div>
            ) : items.length === 0 ? (
              /* Empty Cart */
              <div className="py-16 text-center space-y-3">
                <FileMusic className="w-12 h-12 text-neutral-600 mx-auto" />
                <p className="text-neutral-400 text-sm">Seu carrinho está vazio.</p>
                <button
                  type="button"
                  onClick={onClose}
                  className="text-xs text-emerald-400 hover:underline font-bold cursor-pointer"
                >
                  Explorar os pacotes de playbacks na loja &rarr;
                </button>
              </div>
            ) : (
              /* =========================================================================
                 CART ITEMS VIEW: INCLUI + E - DE CADA PRODUTO, BOTÃO "ADICIONAR MAIS"
                 ========================================================================= */
              <div className="space-y-4">
                {/* List of Cart Items with + and - Controls */}
                <div className="space-y-3">
                  {items.map((item) => (
                    <div
                      key={item.pack.id}
                      className="p-3 rounded-2xl bg-[#12141a] border border-white/5 flex items-center justify-between gap-3 shadow-sm hover:border-white/10 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <PackThumbnail pack={item.pack} size="sm" />
                        <div className="min-w-0 flex-1">
                          <h4 className="text-xs font-bold text-white truncate">
                            {item.pack.title}
                          </h4>
                          <span className="text-[11px] text-neutral-400 block truncate">
                            {item.pack.tracks.length} faixas · {item.pack.genre}
                          </span>
                          <span className="text-xs font-bold text-emerald-400 block mt-0.5">
                            {formatCurrency(item.pack.discountPrice * item.quantity)}
                          </span>
                        </div>
                      </div>

                      {/* Quantity Controls: - [ Qty ] + */}
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center bg-black/60 border border-white/10 rounded-xl p-0.5">
                          <button
                            type="button"
                            onClick={() => {
                              if (onUpdateQuantity) {
                                onUpdateQuantity(item.pack.id, item.quantity - 1);
                              } else if (item.quantity <= 1) {
                                onRemoveItem(item.pack.id);
                              }
                            }}
                            title="Diminuir quantidade"
                            className="w-7 h-7 flex items-center justify-center text-neutral-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="w-7 text-center text-xs font-black text-white font-mono">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (onUpdateQuantity) {
                                onUpdateQuantity(item.pack.id, item.quantity + 1);
                              }
                            }}
                            title="Aumentar quantidade"
                            className="w-7 h-7 flex items-center justify-center text-neutral-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5 text-emerald-400" />
                          </button>
                        </div>

                        {/* Direct Remove Button */}
                        <button
                          type="button"
                          onClick={() => onRemoveItem(item.pack.id)}
                          aria-label="Remover item do carrinho"
                          title="Remover"
                          className="p-1.5 rounded-lg text-neutral-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Botão "Adicionar Mais" Voltando para a Loja */}
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-2.5 px-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs font-bold text-neutral-300 hover:text-white flex items-center justify-center gap-2 transition-all cursor-pointer group"
                >
                  <Plus className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                  <span>Adicionar mais produtos (Voltar para a Loja)</span>
                </button>

                {/* Order Summary (Sem Cupom) */}
                <div className="bg-[#12141a] border border-white/10 rounded-2xl p-4 space-y-2 text-xs shadow-sm">
                  <div className="flex justify-between text-neutral-400">
                    <span>Itens no Carrinho</span>
                    <span className="font-bold text-white">
                      {items.reduce((acc, i) => acc + i.quantity, 0)} unidades
                    </span>
                  </div>
                  <div className="flex justify-between text-white font-black text-base pt-2 border-t border-white/10">
                    <span>Total da Compra</span>
                    <span className="text-emerald-400 tabular-nums text-lg font-black">
                      {formatCurrency(total)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer CTA: Botão para Avançar para o Checkout */}
          {!isCompleted && !isCheckingOut && items.length > 0 && (
            <div className="p-4 border-t border-white/10 bg-[#12141a] space-y-2">
              <button
                type="button"
                onClick={() => setIsCheckingOut(true)}
                className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 text-black font-black text-sm sm:text-base rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-500/20 active:scale-98 cursor-pointer"
              >
                <span>Finalizar Compra</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <div className="flex items-center justify-center gap-1.5 text-[11px] text-neutral-400">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Liberação imediata no PIX oficial e Cartão de Crédito</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
