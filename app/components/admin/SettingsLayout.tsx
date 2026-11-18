import type { ReactNode } from "react";
import { GrandLeMarHeader, type SettingsTab } from "./GrandLeMarHeader";

interface SettingsLayoutProps {
  activeTab: SettingsTab;
  children: ReactNode;
}

export function SettingsLayout({ activeTab, children }: SettingsLayoutProps) {
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--returbo-bg, #f6f6f7)" }}>
      <GrandLeMarHeader activeSection="settings" activeTab={activeTab} />
      <main className="returbo-container returbo-settings-container">
        {children}
      </main>
    </div>
  );
}

export default SettingsLayout;
