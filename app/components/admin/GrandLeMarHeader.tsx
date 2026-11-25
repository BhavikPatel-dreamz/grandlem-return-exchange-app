import { Link } from "react-router";

export type SettingsTab = "settings" | "form" | "policy" | "emails" | "analytics";
export type AppSection = "returns" | "settings" | "dashboard";

const settingsIcon = (
  <svg className="returbo-tab-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const formIcon = (
  <svg className="returbo-tab-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
  </svg>
);

const policyIcon = (
  <svg className="returbo-tab-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

const emailIcon = (
  <svg className="returbo-tab-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
);

const SETTINGS_TABS: { key: SettingsTab; label: string; to: string; icon: JSX.Element }[] = [
  { key: "settings", label: "General settings", to: "/app/settings", icon: settingsIcon },
  { key: "form", label: "Return form design", to: "/app/email-templates?tab=form", icon: formIcon },
  { key: "policy", label: "Return policy", to: "/app/email-templates?tab=policy", icon: policyIcon },
  { key: "emails", label: "Customer emails", to: "/app/email-templates?tab=emails", icon: emailIcon },
];

interface GrandLeMarHeaderProps {
  activeSection: AppSection;
  activeTab?: SettingsTab;
}

export function GrandLeMarHeader({ activeSection, activeTab }: GrandLeMarHeaderProps) {
  return (
    <header className="returbo-header">
      {/* Top Main Navigation Bar */}
      <div className="returbo-top-header">
        <div className="returbo-header-inner">
          <Link to="/app/returns" className="returbo-brand" aria-label="Grand Le Mar Returns">
            <span className="returbo-logo-mark" aria-hidden="true">G</span>
            <span className="returbo-brand-title">Grand Le Mar</span>
          </Link>

          <nav className="returbo-top-nav" aria-label="Primary navigation">
            <Link
              to="/app/returns"
              className={`returbo-top-nav-link ${activeSection === "returns" ? "active" : ""}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              <span>Returns</span>
            </Link>
            <Link
              to="/app/settings"
              className={`returbo-top-nav-link ${activeSection === "settings" ? "active" : ""}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span>Settings</span>
            </Link>
          </nav>
        </div>
      </div>

      {/* Settings internal navigation */}
      {activeSection === "settings" && (
        <div className="returbo-tabs-bar" role="tablist">
          <div className="returbo-tabs-inner">
            {SETTINGS_TABS.map((tab) => (
              <Link
                key={tab.key}
                to={tab.to}
                className={`returbo-tab-item ${activeTab === tab.key ? "active" : ""}`}
                role="tab"
                aria-selected={activeTab === tab.key}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}

export default GrandLeMarHeader;
