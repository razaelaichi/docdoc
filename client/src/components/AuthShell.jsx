import { usePageTitle } from "../lib/usePageTitle.js";
import { Brand } from "./Layout.jsx";

const ASIDE = {
  doctor: {
    statement:
      "One record per patient, compiled from every hospital they have visited. Each entry is copied word for word and cited to the page it came from.",
    rows: [
      ["Penicillin", "[S7 p.1]", "“Allergy: Penicillin - generalised rash and itching (2010)”"],
      ["Metformin", "[S1 p.2]", "“Metformin: 500 mg twice daily”"],
    ],
    head: "Allergies",
  },
  patient: {
    statement:
      "Your medical records in one place. Add each document once; share your whole history with a new doctor in one step, and take it back whenever you want.",
    rows: [
      ["Discharge summary", "2019", "Sunrise Hospital · added by you"],
      ["Blood test", "2025", "From your visit with Dr Menon"],
    ],
    head: "Your records",
  },
};

// Sign-in, registration and password pages: the form on the left, what the product promises on the right.
export default function AuthShell({ title, lede, children, links, audience = "doctor" }) {
  usePageTitle(title);
  const aside = ASIDE[audience];
  return (
    <div className="auth">
      <main id="main" tabIndex={-1} className="auth-main">
        <Brand to={audience === "patient" ? "/patient/login" : "/login"} />
        <div className="auth-form">
          {audience === "patient" && <p className="audience-tag">For patients</p>}
          <h1>{title}</h1>
          {lede && <p className="lede">{lede}</p>}
          {children}
          {links && <div className="auth-links">{links}</div>}
        </div>
      </main>
      <aside className="auth-aside" aria-hidden="true">
        <p className="statement">{aside.statement}</p>
        <div className="specimen">
          <div className="specimen-head">
            <span>{aside.head}</span>
            <span>Example</span>
          </div>
          {aside.rows.map(([label, cite, quote]) => (
            <div className="specimen-row" key={label}>
              <span className="fact-label">{label}</span>
              <span className="cite">{cite}</span>
              <span className="fact-quote">{quote}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
