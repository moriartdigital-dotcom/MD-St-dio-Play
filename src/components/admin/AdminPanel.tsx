import React, { useState } from 'react';
import { useStore } from '../../context/StoreContext';
import { AdminHeader, AdminTab } from './AdminHeader';
import { AdminLoginModal } from './AdminLoginModal';
import { DashboardTab } from './DashboardTab';
import { MusicTab } from './MusicTab';
import { AppearanceTab } from './AppearanceTab';
import { CheckoutTab } from './CheckoutTab';
import { FirebaseTab } from './FirebaseTab';
import { OrdersTab } from './OrdersTab';
import { FlyerShowTab } from './FlyerShowTab';
import { MidiVariadosTab } from './MidiVariadosTab';
import { MidiGospelTab } from './MidiGospelTab';

export const AdminPanel: React.FC = () => {
  const { isAdminAuthenticated } = useStore();
  const [currentTab, setCurrentTab] = useState<AdminTab>('dashboard');

  if (!isAdminAuthenticated) {
    return <AdminLoginModal />;
  }

  return (
    <div className="min-h-screen bg-[#090a0d] text-[#e1e3e7] flex flex-col selection:bg-emerald-500 selection:text-black">
      {/* Admin Top Navigation & Header */}
      <AdminHeader
        currentTab={currentTab}
        onSelectTab={(tab) => setCurrentTab(tab)}
      />

      {/* Main Admin Content Body */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 py-6 w-full animate-in fade-in duration-200">
        {currentTab === 'dashboard' && (
          <DashboardTab onNavigateToTab={(tab) => setCurrentTab(tab)} />
        )}
        {currentTab === 'music' && <MusicTab />}
        {currentTab === 'midi_variados' && <MidiVariadosTab />}
        {currentTab === 'midi_gospel' && <MidiGospelTab />}
        {currentTab === 'flyer_show' && <FlyerShowTab />}
        {currentTab === 'appearance' && <AppearanceTab />}
        {currentTab === 'checkout' && <CheckoutTab />}
        {currentTab === 'firebase' && <FirebaseTab />}
        {currentTab === 'orders' && <OrdersTab />}
      </main>

      {/* Admin Footer */}
      <footer className="w-full bg-[#07080a] border-t border-white/5 py-4 px-4 sm:px-6 text-center text-xs text-neutral-500">
        MD Stúdio Play Admin System · Plataforma Integrada de Gestão Musical & E-commerce
      </footer>
    </div>
  );
};
