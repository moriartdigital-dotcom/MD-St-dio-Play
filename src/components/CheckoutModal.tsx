import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../context/StoreContext';
import { PlaybackPack, CartItem } from '../types';
import { isValidCPF } from '../utils/cpfValidator';
import QRCode from 'qrcode';
import {
  X,
  ShieldCheck,
  CreditCard,
  QrCode,
  Copy,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  Download,
  Lock,
  ArrowRight,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  ChevronRight,
  Info,
} from 'lucide-react';

declare global {
  interface Window {
    MercadoPago?: any;
  }
}

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: CartItem[];
  onClearCart: () => void;
  initialView?: 'checkout' | 'success' | 'pending' | 'error';
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  onClose,
  items,
  onClearCart,
  initialView = 'checkout',
}) => {
  const {
    checkoutConfig,
    themeConfig,
    addOrder,
    setIsCustomerAreaOpen,
    loginCustomerDirectWithPhone,
    sendWhatsAppValidationCode,
    setPendingWhatsAppPhone,
  } = useStore();

  // Primary view state: 'checkout' | 'pix_display' | 'success' | 'pending' | 'error'
  const [viewState, setViewState] = useState<'checkout' | 'pix_display' | 'success' | 'pending' | 'error'>(
    initialView === 'success'
      ? 'success'
      : initialView === 'pending'
      ? 'pending'
      : initialView === 'error'
      ? 'error'
      : 'checkout'
  );

  // Payment Method: 'pix' | 'credit_card'
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'credit_card'>('credit_card');

  // Customer Fields
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerCpf, setCustomerCpf] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Processing & Verification States
  const [buttonState, setButtonState] = useState<'idle' | 'processing' | 'waiting_confirmation' | 'approved'>('idle');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  // PIX State
  const [pixQrCode, setPixQrCode] = useState<string | null>(null);
  const [pixQrCodeBase64, setPixQrCodeBase64] = useState<string | null>(null);
  const [pixPaymentId, setPixPaymentId] = useState<string | null>(null);
  const [pixTicketUrl, setPixTicketUrl] = useState<string | null>(null);
  const [pixCopied, setPixCopied] = useState(false);
  const [pixCountdown, setPixCountdown] = useState(600); // 10 minutes

  // Completed Order Metadata
  const [completedOrder, setCompletedOrder] = useState<{
    orderId: string;
    total: number;
    paymentMethod: string;
    date: string;
    items: any[];
    postSaleUrls: string[];
    ticketUrl?: string;
  } | null>(null);

  const pollIntervalRef = useRef<any>(null);
  const timerIntervalRef = useRef<any>(null);

  // Check URL parameters when returning from Mercado Pago Checkout Pro
  useEffect(() => {
    if (!isOpen) return;

    const urlParams = new URLSearchParams(window.location.search);
    const paymentId = urlParams.get('payment_id') || urlParams.get('collection_id');
    const extRef = urlParams.get('external_reference');
    const statusParam = urlParams.get('status') || urlParams.get('collection_status');
    const path = window.location.pathname.toLowerCase();

    const isSuccessRoute = path.includes('/pagamento/sucesso') || statusParam === 'approved';
    const isPendingRoute = path.includes('/pagamento/pendente') || statusParam === 'pending';
    const isErrorRoute = path.includes('/pagamento/erro') || statusParam === 'rejected' || statusParam === 'failure';
    const isCancelRoute = path.includes('/pagamento/cancelado') || statusParam === 'null';

    if (isSuccessRoute) {
      setViewState('success');
      verifyPaymentOnBackend(paymentId, extRef);
    } else if (isPendingRoute) {
      setViewState('pending');
      if (paymentId || extRef) {
        verifyPaymentOnBackend(paymentId, extRef);
      }
    } else if (isErrorRoute) {
      setViewState('error');
    } else if (isCancelRoute) {
      setViewState('checkout');
      setFormError('Pagamento cancelado no Mercado Pago. Você pode tentar novamente quando desejar.');
    }
  }, [isOpen]);

  const verifyPaymentOnBackend = async (paymentId: string | null, externalReference: string | null) => {
    setIsVerifying(true);
    try {
      const res = await fetch('/api/mercadopago/verify-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId, externalReference }),
      });
      const data = await res.json();

      if (data.verified && data.order) {
        setCompletedOrder({
          orderId: data.order.id || data.externalReference || externalReference || '#ORD-CONFIRMADO',
          total: data.amount || data.order.total || totalAmount,
          paymentMethod: 'Cartão de Crédito (Mercado Pago)',
          date: new Date().toLocaleDateString('pt-BR'),
          items: data.order.items || items.map((i) => i.pack),
          postSaleUrls: data.order.post_sale_urls || [],
        });

        // Register in local StoreContext
        addOrder({
          ...data.order,
          status: 'completed',
          payment_status: 'approved',
          order_status: 'PAGAMENTO APROVADO',
        });

        if (data.order.customerPhone) {
          setPendingWhatsAppPhone(data.order.customerPhone);
          loginCustomerDirectWithPhone(data.order.customerPhone).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('Notice verifying order:', err);
    } finally {
      setIsVerifying(false);
    }
  };

  // Calculate Cart Total (unit prices)
  const totalAmount = items.reduce((acc, item) => {
    const pack = item.pack;
    const price = Number(pack.discountPrice ?? 57.99);
    return acc + price * (item.quantity || 1);
  }, 0);

  const formatBRL = (val: number) => {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  // Phone masking: (XX) XXXXX-XXXX
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 11);
    let f = '';
    if (!raw.length) f = '';
    else if (raw.length <= 2) f = `(${raw}`;
    else if (raw.length <= 6) f = `(${raw.slice(0, 2)}) ${raw.slice(2)}`;
    else if (raw.length <= 10) f = `(${raw.slice(0, 2)}) ${raw.slice(2, 6)}-${raw.slice(6)}`;
    else f = `(${raw.slice(0, 2)}) ${raw.slice(2, 7)}-${raw.slice(7, 11)}`;
    setCustomerPhone(f);
    if (formError) setFormError(null);
  };

  // CPF masking: 000.000.000-00
  const handleCpfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 11);
    let f = '';
    if (!raw.length) f = '';
    else if (raw.length <= 3) f = raw;
    else if (raw.length <= 6) f = `${raw.slice(0, 3)}.${raw.slice(3)}`;
    else if (raw.length <= 9) f = `${raw.slice(0, 3)}.${raw.slice(3, 6)}.${raw.slice(6)}`;
    else f = `${raw.slice(0, 3)}.${raw.slice(3, 6)}.${raw.slice(6, 9)}-${raw.slice(9, 11)}`;
    setCustomerCpf(f);
    if (formError) setFormError(null);
  };

  // Validate customer inputs
  const validateCustomer = (): boolean => {
    if (!customerName.trim() || customerName.trim().length < 3) {
      setFormError('Informe seu nome completo.');
      return false;
    }
    const cleanPhone = customerPhone.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      setFormError('Informe um WhatsApp válido com DDD (ex: (11) 99999-9999).');
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerEmail.trim())) {
      setFormError('Informe um e-mail válido para receber os links de acesso.');
      return false;
    }
    const cleanCpf = customerCpf.replace(/\D/g, '');
    if (!cleanCpf || !isValidCPF(cleanCpf)) {
      setFormError('Por favor, informe um CPF válido e existente.');
      return false;
    }
    setFormError(null);
    return true;
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 1. Process PIX Payment (Real-Time Generation & Polling)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const handleGeneratePix = async () => {
    if (!validateCustomer()) return;

    setIsProcessing(true);
    setButtonState('processing');
    setFormError(null);

    try {
      const response = await fetch('/api/mercadopago/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: totalAmount,
          paymentMethodType: 'pix',
          description: `MD Stúdio Play - ${items.map((i) => i.pack.title).join(', ')}`.slice(0, 100),
          payer: {
            name: customerName.trim(),
            email: customerEmail.trim(),
            phone: customerPhone,
            cpf: customerCpf.replace(/\D/g, ''),
          },
          items: items.map((i) => ({
            id: i.pack.id,
            title: i.pack.title,
            quantity: i.quantity,
            unit_price: i.pack.discountPrice || 57.99,
            postSaleUrl: i.pack.postSaleUrl,
          })),
        }),
      });

      const data = await response.json();

      if (data.success && data.paymentId) {
        setPixPaymentId(data.paymentId);
        setPixQrCode(data.qrCode);
        setPixTicketUrl(data.ticketUrl || null);

        if (data.qrCodeBase64) {
          setPixQrCodeBase64(`data:image/png;base64,${data.qrCodeBase64}`);
        } else if (data.qrCode) {
          const qrUrl = await QRCode.toDataURL(data.qrCode, { width: 320, margin: 1 });
          setPixQrCodeBase64(qrUrl);
        }

        setCompletedOrder({
          orderId: data.orderId,
          total: data.totalAmount || totalAmount,
          paymentMethod: 'PIX',
          date: new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          items: items.map((i) => i.pack),
          postSaleUrls: data.postSaleUrls || items.map((i) => i.pack.postSaleUrl).filter(Boolean),
          ticketUrl: data.ticketUrl,
        });

        setViewState('pix_display');
        setPixCountdown(600);
      } else {
        setFormError(data.error || 'Falha ao gerar PIX com o Mercado Pago.');
        setViewState('error');
      }
    } catch (err: any) {
      console.error('Erro na chamada PIX:', err);
      setFormError('Erro ao comunicar com o servidor de pagamento. Tente novamente.');
      setViewState('error');
    } finally {
      setIsProcessing(false);
      setButtonState('idle');
    }
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2. Checkout Pro Mercado Pago (Ambiente Seguro Oficial)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const handleCheckoutPro = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!validateCustomer()) return;

    setIsProcessing(true);
    setButtonState('processing');
    setFormError(null);

    try {
      const cleanCpf = customerCpf.replace(/\D/g, '');

      const response = await fetch('/api/mercadopago/create-checkout-pro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payer: {
            name: customerName.trim(),
            email: customerEmail.trim(),
            phone: customerPhone,
            cpf: cleanCpf,
          },
          items: items.map((i) => ({
            id: i.pack.id,
            title: i.pack.title,
            quantity: i.quantity || 1,
            unit_price: Number(i.pack.discountPrice ?? 57.99),
            postSaleUrl: i.pack.postSaleUrl,
            coverImage: i.pack.image,
          })),
        }),
      });

      const data = await response.json();

      if (data.success && data.checkout_url) {
        // Save pending order locally in context
        addOrder({
          customerName: customerName.trim(),
          customerEmail: customerEmail.trim(),
          customerPhone: customerPhone,
          customerCpf: customerCpf,
          items: items.map((i) => ({ pack: i.pack, quantity: i.quantity })),
          subtotal: totalAmount,
          discount: 0,
          total: totalAmount,
          paymentMethod: 'card',
          status: 'pending',
          external_reference: data.orderId,
        });

        // Set customer WhatsApp session
        setPendingWhatsAppPhone(customerPhone);
        loginCustomerDirectWithPhone(customerPhone).catch(() => {});

        // Clear cart
        onClearCart();

        // Redirect directly to official Mercado Pago Checkout Pro
        window.location.href = data.checkout_url;
      } else {
        setFormError(data.error || 'Não foi possível iniciar o pagamento. Tente novamente.');
        setIsProcessing(false);
        setButtonState('idle');
      }
    } catch (err: any) {
      console.error('Erro ao iniciar Checkout Pro:', err);
      setFormError('Não foi possível iniciar o pagamento. Tente novamente.');
      setIsProcessing(false);
      setButtonState('idle');
    }
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 3. PIX Real-Time Polling Engine & Countdown
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  useEffect(() => {
    if (viewState !== 'pix_display' || !pixPaymentId) {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      return;
    }

    // Countdown Timer
    timerIntervalRef.current = setInterval(() => {
      setPixCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timerIntervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Polling Mercado Pago Payment Status every 2.5s
    let isPolling = true;

    const pollStatus = async () => {
      if (!isPolling) return;
      try {
        const res = await fetch(`/api/mercadopago/payment-status/${pixPaymentId}`);
        const data = await res.json();

        if (data.success && data.status === 'approved' && isPolling) {
          isPolling = false;
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);

          // Add to local store orders
          addOrder({
            customerName: customerName.trim(),
            customerEmail: customerEmail.trim(),
            customerPhone: customerPhone,
            customerCpf: customerCpf,
            items: items.map((i) => ({ pack: i.pack, quantity: i.quantity })),
            subtotal: totalAmount,
            discount: 0,
            total: totalAmount,
            paymentMethod: 'pix',
            status: 'completed',
            pixPayload: pixQrCode || undefined,
            pixQrCodeUrl: pixQrCodeBase64 || undefined,
            mercadoPagoPaymentId: pixPaymentId,
            ticketUrl: pixTicketUrl || undefined,
          });

          // Authenticate customer WhatsApp session
          setPendingWhatsAppPhone(customerPhone);
          loginCustomerDirectWithPhone(customerPhone).catch(() => {});
          onClearCart();

          // Move to Success Screen
          setViewState('success');
        } else if (data.success && data.status === 'rejected') {
          isPolling = false;
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setViewState('error');
        }
      } catch (err) {
        // silent check error
      }
    };

    pollIntervalRef.current = setInterval(pollStatus, 2500);

    return () => {
      isPolling = false;
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [viewState, pixPaymentId, customerName, customerEmail, customerPhone, customerCpf, items, totalAmount]);

  const handleCopyPix = () => {
    if (pixQrCode) {
      navigator.clipboard.writeText(pixQrCode);
      setPixCopied(true);
      setTimeout(() => setPixCopied(false), 3000);
    }
  };

  const formatCountdown = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-[#0f1115] border border-white/10 rounded-3xl shadow-2xl shadow-black relative overflow-hidden flex flex-col my-auto max-h-[92vh]">
        {/* Header Bar */}
        <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between bg-[#14161c]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-white flex items-center gap-2">
                <span>Checkout Seguro</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Mercado Pago Oficial
                </span>
              </h2>
              <p className="text-[11px] text-neutral-400">Ambiente criptografado com liberação imediata</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Area */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1">
          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              VIEW 1: FORMULÁRIO DE CHECKOUT E MEIOS DE PAGAMENTO
             ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {viewState === 'checkout' && (
            <div className="space-y-6">
              {/* Order Summary Box */}
              <div className="bg-[#14161c] border border-white/[0.08] rounded-2xl p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-white/[0.08] pb-2.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-neutral-300">
                    <ShoppingBag className="w-4 h-4 text-yellow-400" />
                    <span>Resumo da Compra ({items.length} produto{items.length > 1 ? 's' : ''})</span>
                  </div>
                  <span className="text-xs font-extrabold text-white">Valor Unitário</span>
                </div>

                <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                  {items.map((it) => (
                    <div key={it.pack.id} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2.5 min-w-0 pr-2">
                        <img
                          src={it.pack.image}
                          alt={it.pack.title}
                          className="w-9 h-9 rounded-lg object-cover border border-white/10 shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="text-white font-bold truncate">{it.pack.title}</p>
                          <p className="text-[10px] text-neutral-400">Qtd: {it.quantity}</p>
                        </div>
                      </div>
                      <span className="font-mono font-bold text-neutral-200 shrink-0">
                        {formatBRL(it.pack.discountPrice || 57.99)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="border-t border-white/[0.08] pt-2.5 flex items-center justify-between">
                  <span className="text-xs font-bold text-neutral-400">Total a Pagar:</span>
                  <span className="text-xl sm:text-2xl font-black text-yellow-400 font-mono">
                    {formatBRL(totalAmount)}
                  </span>
                </div>
              </div>

              {/* Form Error Notice */}
              {formError && (
                <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2.5 animate-in slide-in-from-top-1">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Identification Form */}
              <div className="bg-[#14161c] border border-white/[0.08] rounded-2xl p-4 sm:p-5 space-y-3.5">
                <h3 className="text-xs font-bold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Seus Dados para Entrega e Liberação</span>
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-neutral-400 mb-1">
                      Nome Completo *
                    </label>
                    <input
                      type="text"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Ex: João da Silva"
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white outline-none focus:border-yellow-400 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-neutral-400 mb-1">
                      WhatsApp com DDD (Receber Links) *
                    </label>
                    <input
                      type="tel"
                      value={customerPhone}
                      onChange={handlePhoneChange}
                      placeholder="(11) 99999-9999"
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white outline-none focus:border-yellow-400 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-neutral-400 mb-1">
                      E-mail de Entrega *
                    </label>
                    <input
                      type="email"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      placeholder="seuemail@exemplo.com"
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white outline-none focus:border-yellow-400 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-neutral-400 mb-1">
                      CPF (Exigido pelo Banco) *
                    </label>
                    <input
                      type="text"
                      value={customerCpf}
                      onChange={handleCpfChange}
                      placeholder="000.000.000-00"
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white outline-none focus:border-yellow-400 transition-colors font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Payment Method Selector Tabs */}
              <div className="space-y-3">
                <label className="block text-xs font-bold text-neutral-300 uppercase tracking-wider">
                  Escolha o Método de Pagamento:
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentMethod('pix');
                      setFormError(null);
                    }}
                    className={`p-3.5 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      paymentMethod === 'pix'
                        ? 'bg-emerald-500/15 border-emerald-500 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.25)]'
                        : 'bg-[#14161c] border-white/10 text-neutral-400 hover:text-white hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <QrCode className="w-5 h-5" />
                      <span className="text-sm font-black">PIX</span>
                    </div>
                    <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                      ⚡ Liberação Imediata
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPaymentMethod('credit_card');
                      setFormError(null);
                    }}
                    className={`p-3.5 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      paymentMethod === 'credit_card'
                        ? 'bg-blue-500/15 border-blue-500 text-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.25)]'
                        : 'bg-[#14161c] border-white/10 text-neutral-400 hover:text-white hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-5 h-5" />
                      <span className="text-sm font-black">Cartão de Crédito</span>
                    </div>
                    <span className="text-[10px] font-semibold text-neutral-400">
                      Parcele em até 12x
                    </span>
                  </button>
                </div>
              </div>

              {/* PIX Details & Action Button */}
              {paymentMethod === 'pix' && (
                <div className="space-y-4 pt-1">
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-neutral-300 flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>
                      O QR Code PIX será gerado diretamente pelo <strong>Mercado Pago</strong> com confirmação automática em tempo real. Não é necessário enviar comprovante!
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleGeneratePix}
                    disabled={isProcessing}
                    className="w-full py-4 rounded-2xl bg-[#1ec75f] hover:bg-[#18b554] text-white font-black text-base uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_0_30px_rgba(30,199,95,0.4)] transition-all cursor-pointer active:scale-98 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isProcessing ? (
                      <>
                        <RefreshCw className="w-5 h-5 animate-spin" />
                        <span>Gerando QR Code PIX...</span>
                      </>
                    ) : (
                      <>
                        <QrCode className="w-5 h-5" />
                        <span>Gerar PIX — {formatBRL(totalAmount)}</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Credit Card — Official Mercado Pago Checkout Pro (Ambiente Seguro Externo) */}
              {paymentMethod === 'credit_card' && (
                <div className="space-y-4 pt-1">
                  <div className="p-5 sm:p-6 rounded-2xl bg-[#14161c] border border-blue-500/30 text-center space-y-4 shadow-xl">
                    <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center mx-auto text-blue-400 shadow-[0_0_25px_rgba(59,130,246,0.2)]">
                      <ShieldCheck className="w-8 h-8" />
                    </div>

                    <div>
                      <h4 className="text-base sm:text-lg font-black text-white">
                        Pagamento seguro pelo Mercado Pago
                      </h4>
                      <p className="text-xs text-neutral-300 mt-1 max-w-sm mx-auto leading-relaxed">
                        Você será redirecionado para o ambiente seguro do <strong>Mercado Pago</strong> para realizar o pagamento com seu cartão de crédito com total proteção.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-left bg-black/40 p-3 rounded-xl border border-white/5 text-[11px] text-neutral-300">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                        <span>Parcele em até 12x</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                        <span>100% Criptografado</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                        <span>Todas as Bandeiras</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                        <span>Liberação Imediata</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleCheckoutPro()}
                      disabled={isProcessing}
                      className="w-full py-4 rounded-2xl bg-[#009ee3] hover:bg-[#008ac7] text-white font-black text-sm sm:text-base uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_0_30px_rgba(0,158,227,0.4)] transition-all cursor-pointer active:scale-98 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isProcessing ? (
                        <>
                          <RefreshCw className="w-5 h-5 animate-spin" />
                          <span>CRIANDO PAGAMENTO...</span>
                        </>
                      ) : (
                        <>
                          <ExternalLink className="w-5 h-5" />
                          <span>CONTINUAR PARA PAGAMENTO — {formatBRL(totalAmount)}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              VIEW 2: TELA DO PIX (QR Code, Copia e Cola & Polling em Tempo Real)
             ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {viewState === 'pix_display' && (
            <div className="space-y-6 text-center animate-in zoom-in-95 duration-200">
              <div className="p-4 rounded-2xl bg-[#14161c] border border-emerald-500/30 flex flex-col items-center space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 text-xs font-extrabold uppercase tracking-wider">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Aguardando Pagamento PIX em Tempo Real</span>
                </div>

                <p className="text-xs text-neutral-300 max-w-md">
                  Abra o aplicativo do seu banco, escolha <strong>Pagar com PIX</strong> e aponte a câmera para o QR Code abaixo ou utilize o botão <strong>COPIAR CÓDIGO PIX</strong>:
                </p>

                {/* QR Code Container */}
                <div className="p-3 bg-white rounded-2xl shadow-xl border-4 border-emerald-500/40 my-1">
                  {pixQrCodeBase64 ? (
                    <img
                      src={pixQrCodeBase64}
                      alt="QR Code PIX Mercado Pago"
                      className="w-52 h-52 sm:w-60 sm:h-60 object-contain mx-auto"
                    />
                  ) : (
                    <div className="w-52 h-52 flex items-center justify-center text-black">
                      <RefreshCw className="w-8 h-8 animate-spin" />
                    </div>
                  )}
                </div>

                {/* Value and Countdown Bar */}
                <div className="flex items-center justify-between w-full max-w-xs px-2 pt-1 text-xs">
                  <span className="font-bold text-neutral-400">Valor da compra:</span>
                  <span className="font-black text-yellow-400 text-base font-mono">{formatBRL(totalAmount)}</span>
                </div>

                <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                  <Clock className="w-3.5 h-3.5 text-yellow-400" />
                  <span>Código válido por: <strong className="text-white font-mono">{formatCountdown(pixCountdown)}</strong></span>
                </div>
              </div>

              {/* Botão Copiar Código PIX */}
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleCopyPix}
                  className={`w-full py-3.5 px-6 rounded-2xl font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg active:scale-98 ${
                    pixCopied
                      ? 'bg-emerald-500 text-black shadow-emerald-500/30'
                      : 'bg-[#1ec75f] hover:bg-[#18b554] text-white shadow-[#1ec75f]/30'
                  }`}
                >
                  {pixCopied ? (
                    <>
                      <CheckCircle2 className="w-5 h-5 text-black" />
                      <span>CÓDIGO PIX COPIADO COM SUCESSO!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-5 h-5" />
                      <span>COPIAR CÓDIGO PIX (COPIA E COLA)</span>
                    </>
                  )}
                </button>

                <p className="text-[11px] text-neutral-400">
                  Após pagar no seu banco, esta página será atualizada automaticamente em segundos liberando seus downloads.
                </p>
              </div>

              {/* Live Polling Spinner Indicator */}
              <div className="py-2 flex items-center justify-center gap-2 text-xs text-neutral-400">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                <span>Verificando recebimento junto ao Mercado Pago...</span>
              </div>
            </div>
          )}

          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              VIEW 3: PÁGINA / TELA DE SUCESSO (/pagamento/sucesso)
             ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {viewState === 'success' && (
            <div className="space-y-6 text-center animate-in zoom-in-95 duration-200">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-400 text-emerald-400 flex items-center justify-center mx-auto shadow-[0_0_40px_rgba(16,185,129,0.4)]">
                <CheckCircle2 className="w-10 h-10" />
              </div>

              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-xs font-black uppercase tracking-wider mb-2">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>PAGAMENTO APROVADO · PRODUTO LIBERADO</span>
                </div>
                <h3 className="text-xl sm:text-2xl font-black text-white">Compra Confirmada com Sucesso!</h3>
                <p className="text-xs text-neutral-300 mt-1">
                  Seu pedido foi autenticado e validado diretamente no Mercado Pago. Seus arquivos estão liberados para download!
                </p>
              </div>

              {isVerifying && (
                <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-xs text-blue-300 flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                  <span>Sincronizando confirmação oficial com o Mercado Pago...</span>
                </div>
              )}

              {/* Receipt Information Box */}
              <div className="bg-[#14161c] border border-white/[0.08] rounded-2xl p-4 sm:p-5 text-left text-xs space-y-2.5">
                <div className="flex justify-between border-b border-white/[0.08] pb-2">
                  <span className="text-neutral-400">Identificação do Pedido:</span>
                  <span className="font-bold text-white font-mono">{completedOrder?.orderId || '#ORD-CONFIRMADO'}</span>
                </div>

                <div className="flex justify-between border-b border-white/[0.08] pb-2">
                  <span className="text-neutral-400">Valor Total Pago:</span>
                  <span className="font-bold text-yellow-400 font-mono text-sm">{formatBRL(completedOrder?.total || totalAmount)}</span>
                </div>

                <div className="flex justify-between border-b border-white/[0.08] pb-2">
                  <span className="text-neutral-400">Forma de Pagamento:</span>
                  <span className="font-bold text-white uppercase">{completedOrder?.paymentMethod || 'MERCADO PAGO CHECKOUT PRO'}</span>
                </div>

                <div className="flex justify-between border-b border-white/[0.08] pb-2">
                  <span className="text-neutral-400">Status no Sistema:</span>
                  <span className="font-black text-emerald-400 uppercase">PAGO & LIBERADO</span>
                </div>

                <div className="flex justify-between">
                  <span className="text-neutral-400">Data e Hora:</span>
                  <span className="font-bold text-white">{completedOrder?.date || new Date().toLocaleString('pt-BR')}</span>
                </div>
              </div>

              {/* Download Buttons for Purchased Items */}
              {completedOrder?.items && completedOrder.items.length > 0 && (
                <div className="space-y-2 text-left bg-black/40 p-4 rounded-2xl border border-emerald-500/30">
                  <span className="text-xs font-black text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4" />
                    <span>Seus Produtos Prontos para Download:</span>
                  </span>

                  <div className="space-y-2 pt-1">
                    {completedOrder.items.map((it: any, idx: number) => {
                      const itemTitle = it.title || it.pack?.title || 'Produto Adquirido';
                      const postSale = it.postSaleUrl || it.pack?.postSaleUrl || completedOrder.postSaleUrls?.[idx] || completedOrder.postSaleUrls?.[0];
                      return (
                        <div key={idx} className="flex items-center justify-between p-2.5 rounded-xl bg-[#14161c] border border-white/5">
                          <span className="text-xs font-bold text-white truncate max-w-[200px]">{itemTitle}</span>
                          {postSale ? (
                            <a
                              href={postSale}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-3.5 py-1.5 rounded-lg bg-[#00d06c] hover:bg-[#00b85f] text-black font-extrabold text-xs flex items-center gap-1.5 cursor-pointer shadow-sm transition-all"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>BAIXAR PRODUTO</span>
                            </a>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                onClose();
                                setIsCustomerAreaOpen(true);
                              }}
                              className="px-3.5 py-1.5 rounded-lg bg-[#00d06c] hover:bg-[#00b85f] text-black font-extrabold text-xs flex items-center gap-1.5 cursor-pointer shadow-sm transition-all"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>BAIXAR PRODUTO</span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Direct Access Notification to Customer Area */}
              <div className="p-4 sm:p-5 rounded-2xl bg-[#14161c] border border-[#00d06c]/30 text-center space-y-3">
                <div className="flex items-center justify-center gap-2 text-[#00d06c] font-bold text-xs uppercase tracking-wider">
                  <Sparkles className="w-4 h-4 text-[#00d06c]" />
                  <span>Área do Cliente Liberada Permanentemente</span>
                </div>
                <p className="text-xs text-neutral-300 max-w-md mx-auto leading-relaxed">
                  Você também pode acessar e baixar todos os seus produtos a qualquer momento na sua <strong>Área do Cliente</strong> informando seu WhatsApp.
                </p>
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      setIsCustomerAreaOpen(true);
                    }}
                    className="w-full py-4 rounded-2xl bg-[#00d06c] hover:bg-[#00b85f] text-black font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_0_30px_rgba(0,208,108,0.4)] transition-all cursor-pointer active:scale-98"
                  >
                    <ShoppingBag className="w-5 h-5 text-black" />
                    <span>ACESSAR MINHA ÁREA DO CLIENTE</span>
                  </button>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-center pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="text-xs text-neutral-400 hover:text-white transition-colors cursor-pointer"
                >
                  Continuar Navegando na Loja Virtual
                </button>
              </div>
            </div>
          )}

          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              VIEW 4: PÁGINA / TELA PENDENTE (/pagamento/pendente)
             ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {viewState === 'pending' && (
            <div className="space-y-6 text-center animate-in zoom-in-95 duration-200">
              <div className="w-16 h-16 rounded-full bg-yellow-500/20 border-2 border-yellow-400 text-yellow-400 flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(234,179,8,0.3)]">
                <Clock className="w-10 h-10 animate-pulse" />
              </div>

              <div>
                <h3 className="text-xl font-black text-white">Pagamento em Análise</h3>
                <p className="text-xs text-neutral-300 mt-1 max-w-sm mx-auto">
                  Estamos aguardando a confirmação do seu pagamento pelo Mercado Pago.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-[#14161c] border border-white/[0.08] text-xs text-neutral-400 space-y-2">
                <p>Assim que a operadora aprovar, seus arquivos serão liberados automaticamente na Área do Cliente.</p>
                <div className="flex items-center justify-center gap-2 text-yellow-400 font-bold pt-1">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Sincronizando status...</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  setIsCustomerAreaOpen(true);
                }}
                className="w-full py-3.5 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-black font-extrabold text-xs transition-colors cursor-pointer"
              >
                Acompanhar na Área do Cliente
              </button>
            </div>
          )}

          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              VIEW 5: PÁGINA / TELA DE ERRO (/pagamento/erro)
             ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {viewState === 'error' && (
            <div className="space-y-6 text-center animate-in zoom-in-95 duration-200">
              <div className="w-16 h-16 rounded-full bg-red-500/20 border-2 border-red-400 text-red-400 flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(239,68,68,0.3)]">
                <AlertCircle className="w-10 h-10" />
              </div>

              <div>
                <h3 className="text-xl font-black text-white">Não foi possível aprovar o pagamento</h3>
                <p className="text-xs text-neutral-300 mt-1 max-w-sm mx-auto">
                  {formError || 'A operadora não autorizou a transação ou os dados informados possuem divergência.'}
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-[#14161c] border border-white/[0.08] text-xs text-neutral-400">
                Você pode tentar novamente com outro cartão de crédito ou escolher o <strong>PIX</strong> para aprovação imediata e sem riscos de recusa da operadora.
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setPaymentMethod('pix');
                    setViewState('checkout');
                    setFormError(null);
                  }}
                  className="w-full py-3.5 rounded-xl bg-[#1ec75f] hover:bg-[#18b554] text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-md"
                >
                  <QrCode className="w-4 h-4" />
                  <span>Pagar com PIX (Recomendado)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setViewState('checkout');
                    setFormError(null);
                  }}
                  className="w-full py-3.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs transition-colors cursor-pointer"
                >
                  Tentar Novamente
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
