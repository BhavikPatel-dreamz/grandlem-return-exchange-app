import { Link } from "react-router";

export type SettingsTab = "inspection" | "analytics" | "emails" | "settings";
export type AppSection = "returns" | "settings" | "dashboard";

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
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7h18v11H3zM3 7l9 6 9-6" />
              </svg>
              Returns
            </Link>
            <Link
              to="/app/settings"
              className={`returbo-top-nav-link ${activeSection === "settings" ? "active" : ""}`}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.3 4.3c.4-1.7 2.9-1.7 3.4 0a1.7 1.7 0 002.6 1.1c1.5-.9 3.3.8 2.4 2.4a1.7 1.7 0 001 2.5c1.8.5 1.8 2.9 0 3.4a1.7 1.7 0 00-1 2.5c.9 1.6-.9 3.3-2.4 2.4a1.7 1.7 0 00-2.6 1.1c-.5 1.7-3 1.7-3.4 0a1.7 1.7 0 00-2.6-1.1c-1.5.9-3.3-.8-2.4-2.4a1.7 1.7 0 00-1-2.5c-1.8-.5-1.8-2.9 0-3.4a1.7 1.7 0 001-2.5c-.9-1.6.9-3.3 2.4-2.4a1.7 1.7 0 002.6-1.1z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </Link>
          </nav>
        </div>
      </div>

      {/* Settings internal navigation */}
      {activeSection === "settings" && (
        <div className="returbo-tabs-bar" role="tablist">
          <div className="returbo-tabs-inner">
          <Link
            to="/app/inspection"
            className={`returbo-tab-item ${activeTab === "inspection" ? "active" : ""}`}
            role="tab"
            aria-selected={activeTab === "inspection"}
          >
            <svg
              className="returbo-tab-icon"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
            <span>Inspection</span>
          </Link>

          <Link
            to="/app/analytics"
            className={`returbo-tab-item ${activeTab === "analytics" ? "active" : ""}`}
            role="tab"
            aria-selected={activeTab === "analytics"}
          >
            <svg
              className="returbo-tab-icon"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            <span>Analytics</span>
          </Link>

          <Link
            to="/app/email-templates"
            className={`returbo-tab-item ${activeTab === "emails" ? "active" : ""}`}
            role="tab"
            aria-selected={activeTab === "emails"}
          >
            <svg
              className="returbo-tab-icon"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
            <span>Emails</span>
          </Link>

          <Link
            to="/app/settings"
            className={`returbo-tab-item ${activeTab === "settings" ? "active" : ""}`}
            role="tab"
            aria-selected={activeTab === "settings"}
          >
            <svg
              className="returbo-tab-icon"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <span>Existing Settings</span>
          </Link>
          </div>
        </div>
      )}
    </header>
  );
}

export default GrandLeMarHeader;
