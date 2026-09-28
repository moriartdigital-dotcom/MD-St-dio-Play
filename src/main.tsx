import React, { Component, ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { StoreProvider } from './context/StoreContext';
import './index.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('App ErrorBoundary caught:', error, errorInfo);
  }

  handleReset = () => {
    localStorage.clear();
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0b0c0e] text-white flex flex-col items-center justify-center p-6 text-center">
          <h2 className="text-2xl font-black mb-2 text-amber-400">MD Stúdio Play</h2>
          <p className="text-neutral-400 text-sm mb-6 max-w-md">
            Ocorreu uma pequena instabilidade ao carregar o catálogo. Clique no botão abaixo para restaurar e recarregar a loja.
          </p>
          <button
            onClick={this.handleReset}
            className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-black font-extrabold rounded-full transition-all cursor-pointer shadow-lg shadow-amber-500/20"
          >
            Recarregar Loja Completa
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <StoreProvider>
        <App />
      </StoreProvider>
    </ErrorBoundary>
  </StrictMode>
);
