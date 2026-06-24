import { useParams, Link } from "react-router-dom";
import SCHOOLS from "./schools.js";

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const TIER_DOT = { T14: "#e05c2a", T25: "#9b6fe0", T50: "#2a7ae0", T100: "#2aae7a" };
const TIER_LABEL = { T14: "T14", T25: "Top 25", T50: "Top 50", T100: "Top 100" };

export { slugify };

export default function SchoolPage() {
  const { slug } = useParams();
  const school = SCHOOLS.find(s => slugify(s.name) === slug);

  if (!school) {
    return (
      <div style={{ minHeight: "100vh", background: "#f0ede8", fontFamily: "'DM Sans',system-ui,sans-serif", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
          <h1 style={{ fontFamily: "'Instrument Serif',serif", fontSize: 28, marginBottom: 12 }}>School not found</h1>
          <Link to="/" style={{ color: "#e05c2a", textDecoration: "none", fontWeight: 600 }}>← Back to LawRide</Link>
        </div>
      </div>
    );
  }

  const tierColor = TIER_DOT[school.tier];

  const StatBox = ({ label, value, color }) => (
    <div style={{ background: "#fff", borderRadius: 10, padding: "14px 16px", border: "1px solid #e0dbd2" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || "#1a1a1a" }}>{value}</div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f0ede8", fontFamily: "'DM Sans',system-ui,sans-serif", color: "#1a1a1a" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;1,9..40,400&family=Instrument+Serif:ital@0;1&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
      `}</style>

      <nav style={{ background: "#f0ede8", borderBottom: "1px solid #e0dbd2", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 960, margin: "0 auto", padding: "0 24px", height: 58 }}>
          <Link to="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", color: "#1a1a1a" }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>⚖️</div>
            <span style={{ fontFamily: "'Instrument Serif',serif", fontSize: 18, fontWeight: 400, letterSpacing: "-0.3px" }}>LawRide</span>
          </Link>
          <Link to="/" style={{ color: "#e05c2a", textDecoration: "none", fontSize: 14, fontWeight: 600 }}>← Back to Estimator</Link>
        </div>
      </nav>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>
        {/* Hero */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, background: `${tierColor}15`, color: tierColor, fontWeight: 700, border: `1px solid ${tierColor}30` }}>
              {TIER_LABEL[school.tier]}
            </span>
            <span style={{ fontSize: 12, color: "#999", fontWeight: 600 }}>#{school.usNews} US News</span>
          </div>
          <h1 style={{ fontFamily: "'Instrument Serif',serif", fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 400, lineHeight: 1.15, letterSpacing: "-0.5px", marginBottom: 8 }}>
            {school.name}
          </h1>
          <p style={{ fontSize: 15, color: "#888" }}>📍 {school.city}, {school.state}</p>
        </div>

        {/* Key Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 28 }}>
          <StatBox label="Median LSAT" value={school.median_lsat} />
          <StatBox label="Median GPA" value={school.median_gpa.toFixed(2)} />
          <StatBox label="Accept Rate" value={`${Math.round(school.accept_rate * 100)}%`} color="#2d9e5f" />
          <StatBox label="Tuition" value={`$${school.tuition.toLocaleString()}`} />
          <StatBox label="Class Size" value={school.class_size} />
          <StatBox label="Median Grant" value={school.med_grant > 0 ? `$${school.med_grant.toLocaleString()}` : "—"} color="#e05c2a" />
        </div>

        {/* LSAT & GPA Ranges */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
          {[
            { label: "LSAT Range", p25: school.p25_lsat, med: school.median_lsat, p75: school.p75_lsat },
            { label: "GPA Range", p25: school.p25_gpa.toFixed(2), med: school.median_gpa.toFixed(2), p75: school.p75_gpa.toFixed(2) }
          ].map(r => (
            <div key={r.label} style={{ background: "#fff", borderRadius: 12, padding: "16px 18px", border: "1px solid #e0dbd2" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>{r.label}</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#bbb", marginBottom: 2 }}>25th</div>
                  <div style={{ fontWeight: 700 }}>{r.p25}</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#e05c2a", marginBottom: 2 }}>Median</div>
                  <div style={{ fontWeight: 800, color: "#e05c2a" }}>{r.med}</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#bbb", marginBottom: 2 }}>75th</div>
                  <div style={{ fontWeight: 700 }}>{r.p75}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Scholarship Info */}
        <div style={{ background: "#fff", borderRadius: 14, padding: "20px 22px", border: "1px solid #e0dbd2", marginBottom: 28 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 16 }}>Scholarship Data</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
            <StatBox label="% Receiving Aid" value={`${school.pct_grant}%`} />
            <StatBox label="% Half+ Tuition" value={`${school.pct_half}%`} />
            <StatBox label="% Full Ride" value={`${school.pct_full}%`} />
            <StatBox label="P25 Grant" value={school.p25_grant > 0 ? `$${school.p25_grant.toLocaleString()}` : "—"} />
            <StatBox label="Median Grant" value={school.med_grant > 0 ? `$${school.med_grant.toLocaleString()}` : "—"} color="#e05c2a" />
            <StatBox label="P75 Grant" value={school.p75_grant > 0 ? `$${school.p75_grant.toLocaleString()}` : "—"} />
          </div>
        </div>

        {/* Employment Outcomes */}
        <div style={{ background: "#fff", borderRadius: 14, padding: "20px 22px", border: "1px solid #e0dbd2", marginBottom: 28 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 16 }}>Employment Outcomes</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <StatBox label="BigLaw + Fed Clerkship" value={school.biglaw_fc_pct != null ? `${school.biglaw_fc_pct}%` : "—"} color="#2a7ae0" />
            <StatBox label="Bar Passage Rate" value={school.bar_passage_rate != null ? `${school.bar_passage_rate}%` : "—"} color="#2d9e5f" />
            <StatBox label="Employed at 10 Months" value={school.employment_rate != null ? `${school.employment_rate}%` : "—"} color="#1a1a1a" />
          </div>
        </div>

        {/* CTA */}
        <div style={{ background: "#1a1a1a", borderRadius: 16, padding: "28px 24px", textAlign: "center" }}>
          <h2 style={{ fontFamily: "'Instrument Serif',serif", fontSize: 24, fontWeight: 400, color: "#f0ede8", marginBottom: 10 }}>
            Check your chances at {school.name}
          </h2>
          <p style={{ fontSize: 14, color: "#999", marginBottom: 20, lineHeight: 1.6 }}>
            Enter your GPA and LSAT to get timing-adjusted acceptance, waitlist, and scholarship probability estimates.
          </p>
          <Link to={`/?school=${encodeURIComponent(school.name)}`} style={{
            display: "inline-block", padding: "13px 28px", borderRadius: 10, background: "#e05c2a", color: "#fff",
            textDecoration: "none", fontSize: 15, fontWeight: 700, boxShadow: "0 2px 12px rgba(224,92,42,0.35)"
          }}>
            Estimate my chances →
          </Link>
        </div>

        {/* Footer */}
        <p style={{ textAlign: "center", fontSize: 11, color: "#bbb", marginTop: 24, lineHeight: 1.7 }}>
          Data from 2025 ABA Standard 509 Required Disclosures. Outcomes are estimates, not guarantees.
        </p>
      </div>
    </div>
  );
}
