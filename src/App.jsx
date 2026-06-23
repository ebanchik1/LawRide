import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";

import SCHOOLS from "./schools.js";
import { getTimingLabel, TIMING_PROFILES, scoreApplicant, estimateOutcomes } from "./lib/estimate.js";
import { parseRecommendations } from "./lib/recommendations.js";

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}


const TIER_META = {
  T14:  { label:"T14",    color:"#38bdf8", bg:"rgba(56,189,248,0.14)" },
  T25:  { label:"Top 25", color:"#818cf8", bg:"rgba(129,140,248,0.14)" },
  T50:  { label:"Top 50", color:"#a78bfa", bg:"rgba(167,139,250,0.11)" },
  T100: { label:"Top 100",color:"#60a5fa", bg:"rgba(96,165,250,0.11)" },
};

export default function App() {
  const [gpa, setGpa] = useState("");
  const [lsat, setLsat] = useState("");
  const [urm, setUrm] = useState(false);
  const [softs, setSofts] = useState("average");
  const [appDate, setAppDate] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState([]);
  const [results, setResults] = useState([]);
  const [showDrop, setShowDrop] = useState(false);

  const [activeTab, setActiveTab] = useState("estimator");
  const [loading, setLoading] = useState(false);
  const [aiInsight, setAiInsight] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recs, setRecs] = useState(null);
  const [recStateFilter, setRecStateFilter] = useState("");
  const [recTuitionMax, setRecTuitionMax] = useState("");
  const [mounted, setMounted] = useState(false);


  useEffect(() => { setTimeout(() => setMounted(true), 50); }, []);

  const filtered = SCHOOLS.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) && !selected.find(x => x.name === s.name)
  ).slice(0, 9);

  const addSchool = s => { setSelected(p => [...p, s]); setSearch(""); setShowDrop(false); };
  const removeSchool = name => { setSelected(p => p.filter(s => s.name !== name)); setResults(p => p.filter(r => r.name !== name)); };

  const gpaNum = parseFloat(gpa);
  const lsatNum = parseInt(lsat);
  const gpaOk = gpaNum >= 2.0 && gpaNum <= 4.33;
  const lsatOk = lsatNum >= 120 && lsatNum <= 180;
  const canGo = gpaOk && lsatOk && selected.length > 0;
  const timingKey = getTimingLabel(appDate);
  const timing = TIMING_PROFILES[timingKey];

  const runEstimate = async () => {
    if (!canGo) return;
    setLoading(true);
    await new Promise(r => setTimeout(r, 700));
    const res = selected.map(s => ({ ...s, ...estimateOutcomes(gpaNum, lsatNum, s, urm, softs, timingKey) }))
      .sort((a, b) => b.accept - a.accept);
    setResults(res);
    setActiveTab("results");
    setAiInsight("");
    setLoading(false);
  };

  const getAI = async () => {
    if (!results.length) return;
    setAiLoading(true);
    setAiInsight("");
    try {
      const resp = await fetch("/api/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gpa: gpaNum,
          lsat: lsatNum,
          urm,
          softs,
          timingLabel: appDate ? timing.label : null,
          results: results.map(r => ({
            name: r.name, accept: r.accept, waitlist: r.waitlist, deny: r.deny,
            scholLabel: r.scholLabel, scholLikelihood: r.scholLikelihood,
            estMin: r.estMin, estMax: r.estMax, seats: r.seats
          }))
        })
      });
      if (!resp.ok) throw new Error("api");
      const d = await resp.json();
      setAiInsight(d.content?.[0]?.text || "Could not generate insight.");
    } catch(e) {
      setAiInsight("AI unavailable right now. The estimator and compare features still work fully — try AI Strategy again in a moment.");
    }
    setAiLoading(false);
  };

  const canRec = gpaOk && lsatOk;

  const getRecommendations = async () => {
    if (!canRec) return;
    setRecsLoading(true);
    setRecs(null);
    setActiveTab("recommendations");
    // Pre-score and sort schools, send only top ~40 most relevant
    let pool = SCHOOLS.map(s => ({
      ...s,
      _score: Math.abs(scoreApplicant(gpaNum, lsatNum, s))
    })).sort((a, b) => a._score - b._score);
    // If filters are active, prioritize matching schools but include others as fallback
    const stateF = recStateFilter;
    const tuitionF = recTuitionMax ? parseInt(recTuitionMax) * 1000 : 0;
    if (stateF || tuitionF) {
      const matching = pool.filter(s => {
        if (stateF && s.state !== stateF) return false;
        if (tuitionF && s.tuition > tuitionF) return false;
        return true;
      });
      const nonMatching = pool.filter(s => !matching.includes(s));
      pool = [...matching.slice(0, 30), ...nonMatching.slice(0, 10)];
    } else {
      pool = pool.slice(0, 40);
    }
    try {
      const resp = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gpa: gpaNum,
          lsat: lsatNum,
          urm,
          softs,
          timingKey,
          stateFilter: stateF || null,
          tuitionMax: tuitionF || null,
          schools: pool.map(s => ({
            name: s.name, tier: s.tier, city: s.city, state: s.state,
            accept_rate: s.accept_rate, median_lsat: s.median_lsat,
            median_gpa: s.median_gpa, tuition: s.tuition, med_grant: s.med_grant
          }))
        })
      });
      if (!resp.ok) {
        console.error("API error:", resp.status);
        setRecs({ error: `API returned ${resp.status}. Please try again.` });
        setRecsLoading(false);
        return;
      }
      const d = await resp.json();
      const text = d.content?.[0]?.text || "";
      const parsed = parseRecommendations(text, SCHOOLS);
      if (parsed.error) {
        setRecs({ error: parsed.error });
        setRecsLoading(false);
        return;
      }
      setRecs(parsed);
    } catch(e) {
      console.error("Recommendations error:", e);
      setRecs({ error: "Could not generate recommendations: " + (e.message || "Unknown error") });
    }
    setRecsLoading(false);
  };

  const tabs = [
    { id:"estimator", label:"Estimator" },
    { id:"recommendations", label:"Recommendations" },
    { id:"results", label:`Results${results.length ? ` (${results.length})` : ""}` },
    { id:"compare", label:"Compare" }
  ];

  // ── TIER COLORS (warm palette) ──
  const TIER_DOT = { T14:"#e05c2a", T25:"#9b6fe0", T50:"#2a7ae0", T100:"#2aae7a" };

  const OutcomeDonut = ({ accept, waitlist, deny, size=80 }) => {
    const total = accept + waitlist + deny;
    const r2 = 27, cx2 = size/2, cy2 = size/2, sw = 9;
    const circ = 2 * Math.PI * r2;
    const aDash = (accept/total)*circ, wDash = (waitlist/total)*circ, dDash = (deny/total)*circ;
    return (
      <svg width={size} height={size} style={{transform:"rotate(-90deg)",flexShrink:0}}>
        <circle cx={cx2} cy={cy2} r={r2} fill="none" stroke="#e8e4dc" strokeWidth={sw}/>
        <circle cx={cx2} cy={cy2} r={r2} fill="none" stroke="#2d9e5f" strokeWidth={sw}
          strokeDasharray={`${aDash} ${circ}`} strokeDashoffset={0}/>
        <circle cx={cx2} cy={cy2} r={r2} fill="none" stroke="#d97c1a" strokeWidth={sw}
          strokeDasharray={`${wDash} ${circ}`} strokeDashoffset={-aDash}/>
        <circle cx={cx2} cy={cy2} r={r2} fill="none" stroke="#cc3b2a" strokeWidth={sw}
          strokeDasharray={`${dDash} ${circ}`} strokeDashoffset={-(aDash+wDash)}/>
      </svg>
    );
  };

  const StatBar = ({ pct, color, height=4 }) => (
    <div style={{height,borderRadius:height,background:"#e8e4dc",overflow:"hidden"}}>
      <div style={{height:"100%",width:`${Math.min(100,Math.max(0,pct))}%`,borderRadius:height,background:color,transition:"width 0.8s cubic-bezier(.4,0,.2,1)"}}/>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#f0ede8",fontFamily:"'DM Sans',system-ui,sans-serif",color:"#1a1a1a"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;1,9..40,400&family=Instrument+Serif:ital@0;1&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        input,button{font-family:'DM Sans',sans-serif;}
        input:focus{outline:none;}
        input[type=date]::-webkit-calendar-picker-indicator{opacity:0.4;cursor:pointer;}
        ::-webkit-scrollbar{width:4px;}
        ::-webkit-scrollbar-thumb{background:#d4cfc7;border-radius:4px;}
        .nav-link{color:#444;font-size:14px;font-weight:500;cursor:pointer;padding:6px 14px;border-radius:20px;transition:background 0.15s;}
        .nav-link:hover{background:#e8e4dc;}
        .pill-tab{transition:all 0.18s;cursor:pointer;padding:7px 18px;border-radius:20px;font-size:13px;font-weight:500;border:none;white-space:nowrap;}
        .pill-tab:hover{background:#e4e0d8!important;}
        .school-row{transition:background 0.12s;}
        .school-row:hover{background:#f5f2ed!important;}
        .result-card{transition:all 0.18s;cursor:pointer;}
        .result-card:hover{box-shadow:0 4px 24px rgba(0,0,0,0.09)!important;transform:translateY(-1px);}
        .cta-btn{transition:all 0.18s;}
        .cta-btn:hover{background:#c94d1e!important;transform:translateY(-1px);box-shadow:0 4px 18px rgba(224,92,42,0.35)!important;}
        .outline-btn{transition:all 0.18s;}
        .outline-btn:hover{background:#e8e4dc!important;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}
        .fade-up{animation:fadeUp 0.4s ease forwards;}
        @keyframes spin{to{transform:rotate(360deg);}}
        .spin{animation:spin 0.8s linear infinite;display:inline-block;}
        .softs-tip-wrap:hover .softs-tip{opacity:1!important;}
        .grid-2col{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
        .grid-3col{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}
        .nav-tabs{display:flex;align-items:center;gap:2px;background:#e8e4dc;border-radius:24px;padding:3px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;}
        .nav-tabs::-webkit-scrollbar{display:none;}
        .nav-inner{display:flex;align-items:center;justify-content:space-between;max-width:960px;margin:0 auto;padding:0 24px;height:58px;}
        .rec-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
        .compare-stats{display:flex;gap:14px;}
        @media(max-width:640px){
          .nav-inner{padding:0 12px;height:52px;}
          .nav-tabs{padding:2px;}
          .pill-tab{padding:6px 12px;font-size:12px;}
          .grid-2col{grid-template-columns:1fr;}
          .grid-3col{grid-template-columns:1fr 1fr;}
          .rec-detail-grid{grid-template-columns:1fr;}
          .compare-stats{flex-direction:column;gap:4px;}
          .form-card{padding:16px!important;border-radius:14px!important;}
          .hero-section{padding:32px 0 28px!important;}
          .content-padding{padding:0 12px!important;}
          .result-card-inner{padding:12px 14px!important;}
          .rec-card-inner{padding:12px 14px!important;}
        }
      `}</style>

      {/* ── NAV ── */}
      <nav style={{background:"#f0ede8",borderBottom:"1px solid #e0dbd2",position:"sticky",top:0,zIndex:50,backdropFilter:"blur(8px)"}}>
        <div className="nav-inner">
          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
            <div style={{width:30,height:30,borderRadius:8,background:"#1a1a1a",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>⚖️</div>
            <span style={{fontFamily:"'Instrument Serif',serif",fontSize:18,fontWeight:400,color:"#1a1a1a",letterSpacing:"-0.3px"}}>ScholarshipIQ</span>
          </div>
          <div className="nav-tabs">
            {tabs.map(t => (
              <button key={t.id} className="pill-tab" onClick={() => setActiveTab(t.id)} style={{
                background:activeTab===t.id?"#fff":"transparent",
                color:activeTab===t.id?"#1a1a1a":"#666",
                boxShadow:activeTab===t.id?"0 1px 4px rgba(0,0,0,0.1)":"none",
              }}>{t.label}</button>
            ))}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
            <span style={{fontSize:11,color:"#999",fontWeight:500,letterSpacing:"0.06em",textTransform:"uppercase",display:"none"}}>2025 ABA 509</span>
          </div>
        </div>
      </nav>

      <div className="content-padding" style={{maxWidth:960,margin:"0 auto",padding:"0 24px"}}>

        {/* ── ESTIMATOR ── */}
        {activeTab==="estimator" && (
          <div style={{opacity:mounted?1:0,transition:"opacity 0.3s"}}>
            {/* Hero */}
            <div className="hero-section" style={{textAlign:"center",padding:"56px 0 44px"}}>
              <div style={{display:"inline-block",background:"#e8e4dc",borderRadius:20,padding:"4px 14px",fontSize:11,fontWeight:600,color:"#666",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:20}}>
                2025–26 Admissions Cycle
              </div>
              <h1 style={{fontFamily:"'Instrument Serif',serif",fontSize:"clamp(36px,5vw,56px)",fontWeight:400,lineHeight:1.1,color:"#1a1a1a",letterSpacing:"-1px",marginBottom:16}}>
                The scholarship estimator<br/><em>for serious applicants</em>
              </h1>
              <p style={{fontSize:16,color:"#666",lineHeight:1.6,maxWidth:480,margin:"0 auto"}}>
                Accept, waitlist, and deny probabilities — plus timing-adjusted scholarship estimates — across {SCHOOLS.length} ABA-accredited schools.
              </p>
            </div>

            {/* Form card */}
            <div className="form-card" style={{background:"#fff",borderRadius:20,border:"1px solid #e0dbd2",padding:32,marginBottom:16,boxShadow:"0 2px 12px rgba(0,0,0,0.04)"}}>
              <h2 style={{fontSize:13,fontWeight:600,color:"#999",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:24}}>Your Profile</h2>

              {/* GPA + LSAT */}
              <div className="grid-2col" style={{marginBottom:20}}>
                {[
                  {label:"Cumulative GPA",value:gpa,set:setGpa,min:2.0,max:4.33,step:.01,ph:"3.85",ok:gpaOk||!gpa,pct:gpa?((gpaNum-2)/2.33*100):0,r:[2.0,4.33]},
                  {label:"LSAT Score",value:lsat,set:setLsat,min:120,max:180,step:1,ph:"168",ok:lsatOk||!lsat,pct:lsat?((lsatNum-120)/60*100):0,r:[120,180]}
                ].map(f => (
                  <div key={f.label}>
                    <label style={{display:"block",fontSize:12,fontWeight:600,color:"#888",marginBottom:6,letterSpacing:"0.05em"}}>{f.label}</label>
                    <input value={f.value} onChange={e=>f.set(e.target.value)} placeholder={f.ph}
                      type="number" step={f.step} min={f.min} max={f.max}
                      style={{width:"100%",padding:"11px 14px",border:`1.5px solid ${f.value&&!f.ok?"#e05c2a":f.value&&f.ok?"#c8c2ba":"#e0dbd2"}`,borderRadius:10,fontSize:18,fontWeight:700,color:"#1a1a1a",background:f.value&&f.ok?"#fff":"#faf9f7",transition:"border-color 0.2s"}}/>
                    {f.value && f.ok && (
                      <div style={{marginTop:7}}>
                        <div style={{height:3,borderRadius:3,background:"#e8e4dc",overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${Math.min(100,f.pct)}%`,background:"#e05c2a",borderRadius:3,transition:"width 0.7s ease"}}/>
                        </div>
                        <div style={{display:"flex",justifyContent:"space-between",marginTop:3,fontSize:10,color:"#bbb"}}>
                          <span>{f.r[0]}</span><span>{f.r[1]}</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Application Date */}
              <div className="grid-2col" style={{marginBottom:20}}>
                <div>
                  <label style={{display:"block",fontSize:12,fontWeight:600,color:"#888",marginBottom:6,letterSpacing:"0.05em"}}>
                    Application Date <span style={{fontWeight:400,color:"#bbb"}}>(optional)</span>
                  </label>
                  <input value={appDate} onChange={e=>setAppDate(e.target.value)} type="date"
                    min="2025-09-01" max="2026-06-30"
                    style={{width:"100%",padding:"11px 14px",border:"1.5px solid #e0dbd2",borderRadius:10,fontSize:14,fontWeight:500,color:"#1a1a1a",background:"#faf9f7"}}/>
                </div>
                <div style={{display:"flex",alignItems:"center"}}>
                  {appDate ? (
                    <div style={{padding:"12px 16px",background:"#faf9f7",borderRadius:10,border:"1px solid #e0dbd2",width:"100%"}}>
                      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
                        <div style={{width:7,height:7,borderRadius:"50%",background:timing.color,flexShrink:0}}/>
                        <span style={{fontSize:12,fontWeight:700,color:timing.color}}>{timing.label}</span>
                      </div>
                      <div style={{fontSize:12,color:"#888",lineHeight:1.5}}>{timing.desc}</div>
                    </div>
                  ) : (
                    <div style={{fontSize:12,color:"#bbb",lineHeight:1.7,padding:"12px 0"}}>
                      Adding a date adjusts probabilities and scholarship estimates based on rolling admissions cycle data.
                    </div>
                  )}
                </div>
              </div>

              {/* Softs + URM */}
              <div className="grid-2col" style={{marginBottom:24,paddingBottom:24,borderBottom:"1px solid #f0ede8"}}>
                <div>
                  <label style={{display:"flex",alignItems:"center",gap:5,fontSize:12,fontWeight:600,color:"#888",marginBottom:8,letterSpacing:"0.05em"}}>
                    Soft Factors
                    <span style={{position:"relative",display:"inline-flex",cursor:"help"}} className="softs-tip-wrap">
                      <span style={{width:15,height:15,borderRadius:"50%",background:"#e0dbd2",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"#999",lineHeight:1}}>?</span>
                      <span className="softs-tip" style={{position:"absolute",bottom:"calc(100% + 8px)",left:"50%",transform:"translateX(-50%)",width:240,padding:"10px 12px",borderRadius:10,background:"#1a1a1a",color:"#e8e4dc",fontSize:11,lineHeight:1.6,fontWeight:400,letterSpacing:"0",boxShadow:"0 8px 24px rgba(0,0,0,0.2)",pointerEvents:"none",opacity:0,transition:"opacity 0.15s",zIndex:60,textAlign:"left"}}>
                        Work experience, leadership, community involvement, publications, and personal statement strength. <strong style={{color:"#e05c2a"}}>Excellent</strong> = T14-level WE, notable achievements. <strong style={{color:"#fbbf24"}}>Good</strong> = solid WE or strong extracurriculars. <strong style={{color:"#ccc"}}>Average</strong> = standard applicant profile.
                        <span style={{position:"absolute",bottom:-5,left:"50%",transform:"translateX(-50%) rotate(45deg)",width:10,height:10,background:"#1a1a1a"}}/>
                      </span>
                    </span>
                  </label>
                  <div style={{display:"flex",gap:6}}>
                    {["average","good","excellent"].map(s => (
                      <button key={s} onClick={() => setSofts(s)} style={{
                        flex:1,padding:"8px 4px",borderRadius:8,border:`1.5px solid ${softs===s?"#1a1a1a":"#e0dbd2"}`,
                        cursor:"pointer",fontSize:13,fontWeight:softs===s?700:400,
                        background:softs===s?"#1a1a1a":"#faf9f7",
                        color:softs===s?"#fff":"#666",transition:"all 0.15s"
                      }}>{s.charAt(0).toUpperCase()+s.slice(1)}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{display:"block",fontSize:12,fontWeight:600,color:"#888",marginBottom:8,letterSpacing:"0.05em"}}>URM Status</label>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div onClick={() => setUrm(!urm)} style={{
                      width:44,height:24,borderRadius:12,cursor:"pointer",position:"relative",
                      background:urm?"#1a1a1a":"#e0dbd2",transition:"background 0.25s",flexShrink:0
                    }}>
                      <div style={{position:"absolute",top:3,left:urm?22:3,width:18,height:18,borderRadius:9,background:"#fff",transition:"left 0.22s",boxShadow:"0 1px 4px rgba(0,0,0,0.2)"}}/>
                    </div>
                    <span style={{fontSize:13,color:urm?"#1a1a1a":"#999",fontWeight:urm?600:400}}>{urm?"Yes — applied":"Not applicable"}</span>
                  </div>
                </div>
              </div>

              {/* School Search */}
              <div>
                <label style={{display:"block",fontSize:12,fontWeight:600,color:"#888",marginBottom:8,letterSpacing:"0.05em"}}>
                  Target Schools <span style={{fontWeight:400,color:"#bbb"}}>({selected.length} selected)</span>
                </label>
                <div style={{position:"relative"}}>
                  <input value={search}
                    onChange={e=>{setSearch(e.target.value);setShowDrop(true);}}
                    onFocus={()=>setShowDrop(true)}
                    onBlur={()=>setTimeout(()=>setShowDrop(false),160)}
                    placeholder={`Search or browse ${SCHOOLS.length} schools...`}
                    style={{width:"100%",padding:"11px 14px",border:"1.5px solid #e0dbd2",borderRadius:10,fontSize:14,fontWeight:400,color:"#1a1a1a",background:"#faf9f7",transition:"border-color 0.2s",boxSizing:"border-box"}}
                    onFocusCapture={e=>{e.target.style.borderColor="#1a1a1a";}}
                    onBlurCapture={e=>{e.target.style.borderColor="#e0dbd2";}}
                  />
                  {showDrop && filtered.length > 0 && (
                    <div style={{
                      position:"absolute",top:"calc(100% + 5px)",left:0,right:0,zIndex:100,borderRadius:12,
                      background:"#fff",border:"1px solid #e0dbd2",
                      boxShadow:"0 16px 40px rgba(0,0,0,0.12)",
                      overflowY:"auto",maxHeight:300
                    }}>
                      {filtered.map((s,i) => (
                        <div key={s.name} className="school-row" onMouseDown={() => addSchool(s)} style={{
                          padding:"10px 14px",cursor:"pointer",display:"flex",justifyContent:"space-between",
                          alignItems:"center",borderBottom:i<filtered.length-1?"1px solid #f0ede8":"none",
                          background:"#fff"
                        }}>
                          <div>
                            <div style={{fontSize:13,fontWeight:500,color:"#1a1a1a"}}>{s.name}</div>
                            <div style={{fontSize:11,color:"#999",marginTop:1}}>
                              #{s.usNews} US News &middot; {s.city}, {s.state} &middot; {Math.round(s.accept_rate*100)}% accept &middot; {s.median_lsat} / {s.median_gpa}
                            </div>
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0,marginLeft:8}}>
                            <div style={{width:7,height:7,borderRadius:"50%",background:TIER_DOT[s.tier]}}/>
                            <span style={{fontSize:11,color:TIER_DOT[s.tier],fontWeight:600}}>{TIER_META[s.tier].label}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {selected.length > 0 && (
                  <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:10}}>
                    {selected.map(s => (
                      <div key={s.name} style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px 4px 10px",borderRadius:20,fontSize:12,fontWeight:500,background:"#f0ede8",border:"1px solid #e0dbd2",color:"#444"}}>
                        <div style={{width:5,height:5,borderRadius:"50%",background:TIER_DOT[s.tier],flexShrink:0}}/>
                        {s.name}
                        <button onClick={() => removeSchool(s.name)} style={{background:"none",border:"none",color:"#aaa",cursor:"pointer",padding:"0 0 0 3px",fontSize:14,lineHeight:1,transition:"color 0.15s"}}
                          onMouseOver={e=>e.target.style.color="#333"} onMouseOut={e=>e.target.style.color="#aaa"}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <button className="cta-btn" onClick={runEstimate} disabled={!canGo||loading} style={{
              width:"100%",padding:"15px",borderRadius:12,border:"none",
              cursor:canGo?"pointer":"not-allowed",fontSize:15,fontWeight:600,letterSpacing:"0.01em",
              background:canGo?"#e05c2a":"#e0dbd2",
              color:canGo?"#fff":"#aaa",
              boxShadow:canGo?"0 2px 12px rgba(224,92,42,0.25)":"none",
              transition:"all 0.18s",display:"flex",alignItems:"center",justifyContent:"center",gap:8
            }}>
              {loading ? <><span className="spin" style={{display:"inline-block",width:16,height:16,border:"2px solid rgba(255,255,255,0.3)",borderTopColor:"#fff",borderRadius:"50%"}}></span> Calculating...</> : "Estimate my chances →"}
            </button>

            <button onClick={getRecommendations} disabled={!canRec||recsLoading} style={{
              width:"100%",marginTop:10,padding:"13px",borderRadius:12,border:"1.5px solid #e0dbd2",
              cursor:canRec?"pointer":"not-allowed",fontSize:14,fontWeight:500,
              background:"#fff",color:canRec?"#333":"#bbb",
              transition:"all 0.18s",display:"flex",alignItems:"center",justifyContent:"center",gap:8
            }}
              onMouseOver={e=>{if(canRec)e.currentTarget.style.background="#f0ede8";}}
              onMouseOut={e=>e.currentTarget.style.background="#fff"}
            >
              {recsLoading?<><span className="spin" style={{display:"inline-block",width:14,height:14,border:"2px solid #ddd",borderTopColor:"#999",borderRadius:"50%"}}></span> Generating...</>:"🎯 Get school recommendations"}
            </button>

            <p style={{textAlign:"center",fontSize:11,color:"#bbb",marginTop:12,lineHeight:1.6}}>
              Based on 2025 ABA 509 data · LSD.law cycle decisions · Spivey Consulting methodology
            </p>
          </div>
        )}

        {/* ── RESULTS ── */}
        {activeTab==="results" && (
          <div style={{padding:"32px 0"}}>
            {results.length === 0 ? (
              <div style={{textAlign:"center",padding:"80px 0"}}>
                <div style={{fontSize:48,marginBottom:16}}>📊</div>
                <p style={{fontSize:16,color:"#666",marginBottom:20}}>No results yet. Fill in your stats and run an estimate.</p>
                <button className="outline-btn" onClick={() => setActiveTab("estimator")} style={{padding:"10px 22px",borderRadius:10,border:"1.5px solid #e0dbd2",background:"#fff",color:"#333",cursor:"pointer",fontSize:14,fontWeight:500}}>← Back to Estimator</button>
              </div>
            ) : (
              <div>
                {/* Results header */}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24,flexWrap:"wrap",gap:12}}>
                  <div>
                    <h2 style={{fontFamily:"'Instrument Serif',serif",fontSize:28,fontWeight:400,color:"#1a1a1a",letterSpacing:"-0.5px",marginBottom:4}}>
                      Your estimates
                    </h2>
                    <p style={{fontSize:13,color:"#999"}}>
                      GPA {gpa} &middot; LSAT {lsat} &middot; {results.length} school{results.length>1?"s":""}
                      {appDate && <span style={{color:timing.color}}> &middot; {timing.label}</span>}
                    </p>
                  </div>
                  <button onClick={getAI} disabled={aiLoading} className="cta-btn" style={{
                    padding:"9px 18px",borderRadius:10,border:"none",
                    background:aiLoading?"#f0ede8":"#1a1a1a",color:aiLoading?"#999":"#fff",
                    cursor:"pointer",fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:6,
                    boxShadow:aiLoading?"none":"0 2px 8px rgba(0,0,0,0.15)"
                  }}>
                    {aiLoading?<><span className="spin" style={{display:"inline-block",width:13,height:13,border:"2px solid #ccc",borderTopColor:"#666",borderRadius:"50%"}}></span> Analyzing...</>:"✦ AI Strategy"}
                  </button>
                </div>

                {appDate && timing.admPenalty > 0 && (
                  <div style={{marginBottom:16,padding:"12px 16px",borderRadius:10,background:"#fff8f5",border:`1px solid ${timing.color}33`,display:"flex",gap:10,alignItems:"flex-start"}}>
                    <span style={{fontSize:16,flexShrink:0}}>⏱</span>
                    <div style={{fontSize:13,lineHeight:1.6}}>
                      <span style={{fontWeight:700,color:timing.color}}>{timing.label} — </span>
                      <span style={{color:"#666"}}>{timing.desc}</span>
                    </div>
                  </div>
                )}

                {aiInsight && (
                  <div className="fade-up" style={{marginBottom:16,padding:"16px 18px",borderRadius:12,background:"#fff",border:"1px solid #e0dbd2",boxShadow:"0 2px 12px rgba(0,0,0,0.04)"}}>
                    <div style={{fontSize:11,fontWeight:700,color:"#e05c2a",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.1em"}}>✦ AI Strategy</div>
                    <p style={{fontSize:13,lineHeight:1.75,color:"#333"}}>{aiInsight}</p>
                  </div>
                )}

                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {results.map((r,i) => {
                    const isOpen = expanded === r.name;
                    const seatsColor = r.seats===0?"#cc3b2a":r.seats<30?"#d97c1a":r.seats<80?"#d4a017":"#2d9e5f";
                    return (
                      <div key={r.name} className="result-card" style={{
                        background:"#fff",borderRadius:14,border:"1px solid #e0dbd2",
                        overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,0.04)",
                        borderLeft:`3px solid ${TIER_DOT[r.tier]}`
                      }} onClick={() => setExpanded(isOpen?null:r.name)}>
                        <div className="result-card-inner" style={{padding:"16px 18px"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,flexWrap:"wrap",gap:8}}>
                            <div>
                              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:3}}>
                                <span style={{fontSize:11,color:"#bbb",fontWeight:600}}>#{i+1}</span>
                                <span style={{fontWeight:700,fontSize:15,color:"#1a1a1a"}}>{r.name}</span>
                                <span style={{fontSize:11,padding:"2px 8px",borderRadius:20,background:`${TIER_DOT[r.tier]}15`,color:TIER_DOT[r.tier],fontWeight:600,border:`1px solid ${TIER_DOT[r.tier]}30`}}>
                                  {TIER_META[r.tier].label}
                                </span>
                                <span style={{fontSize:11,padding:"2px 8px",borderRadius:20,background:`${seatsColor}12`,color:seatsColor,fontWeight:600,border:`1px solid ${seatsColor}25`}}>
                                  {r.seats===0?"⚠ Near Capacity":r.seats<30?`⚡ ~${r.seats} seats`:`~${r.seats} seats`}
                                </span>
                              </div>
                              <div style={{fontSize:11,color:"#bbb",display:"flex",gap:10}}>
                                <span>GPA: <span style={{color:"#888"}}>{r.gpaPos}</span></span>
                                <span>LSAT: <span style={{color:"#888"}}>{r.lsatPos}</span></span>
                              </div>
                            </div>
                            <div style={{textAlign:"right",flexShrink:0}}>
                              <div style={{fontSize:13,fontWeight:700,color:r.scholColor}}>{r.scholEmoji} {r.scholLabel}</div>
                              <div style={{fontSize:11,color:"#999",marginTop:2}}>
                                {r.estMax>0?`~$${r.estMin.toLocaleString()}–$${r.estMax.toLocaleString()}/yr`:"No aid est."}
                              </div>
                            </div>
                          </div>

                          {/* Outcome block */}
                          <div style={{background:"#faf9f7",borderRadius:10,padding:"12px 14px",border:"1px solid #f0ede8"}}>
                            <div style={{fontSize:10,fontWeight:700,color:"#bbb",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:10}}>Admission Outcome Estimates</div>
                            <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
                              <div style={{position:"relative",flexShrink:0}}>
                                <OutcomeDonut accept={r.accept} waitlist={r.waitlist} deny={r.deny} size={80}/>
                                <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column"}}>
                                  <div style={{fontSize:17,fontWeight:800,color:"#2d9e5f",lineHeight:1}}>{r.accept}%</div>
                                  <div style={{fontSize:9,color:"#bbb",marginTop:1}}>accept</div>
                                </div>
                              </div>
                              <div style={{flex:1,minWidth:120}}>
                                {[{label:"Accept",pct:r.accept,color:"#2d9e5f"},{label:"Waitlist",pct:r.waitlist,color:"#d97c1a"},{label:"Deny",pct:r.deny,color:"#cc3b2a"}].map(o=>(
                                  <div key={o.label} style={{marginBottom:7}}>
                                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4,fontSize:12}}>
                                      <span style={{color:"#888"}}>{o.label}</span>
                                      <span style={{fontWeight:700,color:o.color}}>{o.pct}%</span>
                                    </div>
                                    <StatBar pct={o.pct} color={o.color} height={4}/>
                                  </div>
                                ))}
                              </div>
                              <div style={{display:"flex",flexDirection:"column",gap:7,flexShrink:0}}>
                                <div style={{background:"#fff",borderRadius:8,padding:"7px 11px",textAlign:"center",border:"1px solid #e0dbd2"}}>
                                  <div style={{fontSize:10,color:"#bbb",marginBottom:2}}>ABA Accept</div>
                                  <div style={{fontSize:15,fontWeight:700,color:"#1a1a1a"}}>{Math.round(r.accept_rate*100)}%</div>
                                </div>
                                <div style={{background:"#fff",borderRadius:8,padding:"7px 11px",textAlign:"center",border:"1px solid #e0dbd2"}}>
                                  <div style={{fontSize:10,color:"#bbb",marginBottom:2}}>Schol Likelihood</div>
                                  <div style={{fontSize:15,fontWeight:700,color:"#e05c2a"}}>{r.scholLikelihood}%</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Expanded detail */}
                        {isOpen && (
                          <div style={{padding:"0 18px 16px",borderTop:"1px solid #f0ede8",paddingTop:14}}>
                            <div className="grid-2col" style={{marginBottom:12}}>
                              {[{label:"GPA",val:gpaNum,p25:r.p25_gpa,med:r.median_gpa,p75:r.p75_gpa,fmt:v=>v.toFixed(2)},{label:"LSAT",val:lsatNum,p25:r.p25_lsat,med:r.median_lsat,p75:r.p75_lsat,fmt:v=>v}].map(({label,val,p25,med,p75,fmt})=>{
                                const pct=Math.min(100,Math.max(0,((val-p25)/(p75-p25))*100));
                                return (
                                  <div key={label} style={{background:"#faf9f7",borderRadius:9,padding:"10px 12px",border:"1px solid #f0ede8"}}>
                                    <div style={{fontSize:10,color:"#bbb",marginBottom:6,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em"}}>{label} vs Enrolled Class</div>
                                    <div style={{position:"relative",height:6,borderRadius:3,background:"#e8e4dc",marginBottom:6}}>
                                      <div style={{position:"absolute",left:`${Math.min(97,Math.max(2,((med-p25)/(p75-p25))*100))}%`,top:-2,width:1.5,height:10,background:"#ccc",borderRadius:1}}/>
                                      <div style={{position:"absolute",left:`${Math.min(95,Math.max(2,pct))}%`,top:-3,width:12,height:12,borderRadius:"50%",background:"#e05c2a",transform:"translate(-50%,0)",boxShadow:"0 0 6px rgba(224,92,42,0.4)",transition:"left 0.5s ease"}}/>
                                    </div>
                                    <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#bbb"}}>
                                      <span>{fmt(p25)}</span><span style={{color:"#999"}}>med</span><span>{fmt(p75)}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="grid-3col" style={{marginBottom:appDate?12:0}}>
                              {[{label:"Tuition",val:`$${r.tuition.toLocaleString()}`},{label:"% Receiving Aid",val:`${r.pct_grant}%`},{label:"% Half+",val:`${r.pct_half}%`},{label:"Median Grant",val:`$${r.med_grant.toLocaleString()}`},{label:"P25 Grant",val:`$${r.p25_grant.toLocaleString()}`},{label:"P75 Grant",val:`$${r.p75_grant.toLocaleString()}`}].map(({label,val})=>(
                                <div key={label} style={{background:"#faf9f7",borderRadius:8,padding:"8px 10px",border:"1px solid #f0ede8"}}>
                                  <div style={{fontSize:10,color:"#bbb",marginBottom:2}}>{label}</div>
                                  <div style={{fontWeight:700,color:"#444",fontSize:13}}>{val}</div>
                                </div>
                              ))}
                            </div>
                            {(r.biglaw_fc_pct != null || r.bar_passage_rate != null || r.employment_rate != null) && (
                              <div className="grid-3col" style={{marginBottom:12}}>
                                {[
                                  {label:"BigLaw + FC",val:r.biglaw_fc_pct != null ? `${r.biglaw_fc_pct}%` : "—",color:"#2a7ae0"},
                                  {label:"Bar Passage",val:r.bar_passage_rate != null ? `${r.bar_passage_rate}%` : "—",color:"#2d9e5f"},
                                  {label:"Employed 10mo",val:r.employment_rate != null ? `${r.employment_rate}%` : "—",color:"#1a1a1a"}
                                ].map(({label,val,color})=>(
                                  <div key={label} style={{background:"#f6f9ff",borderRadius:8,padding:"8px 10px",border:"1px solid #e8edf5"}}>
                                    <div style={{fontSize:10,color:"#bbb",marginBottom:2}}>{label}</div>
                                    <div style={{fontWeight:700,color,fontSize:13}}>{val}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                            {appDate && (
                              <div style={{background:"#faf9f7",borderRadius:9,padding:"10px 12px",border:"1px solid #f0ede8"}}>
                                <div style={{fontSize:10,fontWeight:700,color:"#bbb",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Timing · {timing.label}</div>
                                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,fontSize:11}}>
                                  <div><span style={{color:"#bbb"}}>Adm: </span><span style={{color:timing.color,fontWeight:700}}>-{Math.round(r.admPenalty*100)}%</span></div>
                                  <div><span style={{color:"#bbb"}}>Schol: </span><span style={{color:timing.color,fontWeight:700}}>-{Math.round(r.scholPenalty*100)}%</span></div>
                                  <div><span style={{color:"#bbb"}}>WL+: </span><span style={{color:"#d97c1a",fontWeight:700}}>+{Math.round((timing.wlShift||0)*100)}pp</span></div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        <div style={{textAlign:"center",padding:"2px 0 8px",fontSize:10,color:"#ccc"}}>
                          {isOpen?"▲ collapse":"▼ expand details"}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{marginTop:14,padding:"12px 14px",borderRadius:10,background:"#fff",border:"1px solid #f0ede8",fontSize:11,color:"#bbb",lineHeight:1.7}}>
                  <strong style={{color:"#999"}}>Sources:</strong> ABA Standard 509 2025 · LSD.Law 2025-26 cycle · Spivey Consulting methodology · BARBRI/LawSchoolNumbers timing research · AccessLex application timing study. Outcomes are probabilistic estimates — individual results vary.
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── RECOMMENDATIONS ── */}
        {activeTab==="recommendations" && (
          <div style={{padding:"32px 0"}}>
            <div style={{marginBottom:28}}>
              <h2 style={{fontFamily:"'Instrument Serif',serif",fontSize:32,fontWeight:400,color:"#1a1a1a",letterSpacing:"-0.5px",marginBottom:6}}>
                School recommendations
              </h2>
              <p style={{fontSize:14,color:"#888",lineHeight:1.6}}>
                AI-curated reach, target, and safety picks based on your GPA {gpaNum ? gpaNum.toFixed(2) : "—"} and LSAT {lsatNum || "—"}.
              </p>
            </div>

            {recsLoading && (
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"80px 0",gap:16}}>
                <div style={{width:40,height:40,border:"3px solid #e0dbd2",borderTopColor:"#e05c2a",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
                <p style={{fontSize:14,color:"#999"}}>{`Analyzing your profile across ${SCHOOLS.length} schools...`}</p>
              </div>
            )}

            {!recsLoading && !recs && (
              <div style={{textAlign:"center",padding:"60px 0"}}>
                <div style={{fontSize:52,marginBottom:16}}>🎯</div>
                <p style={{fontSize:16,color:"#666",marginBottom:8}}>Enter your GPA and LSAT on the Estimator tab,</p>
                <p style={{fontSize:16,color:"#666",marginBottom:24}}>then come back and generate your recommendations.</p>
                <button onClick={()=>setActiveTab("estimator")} className="outline-btn" style={{padding:"10px 22px",borderRadius:10,border:"1.5px solid #e0dbd2",background:"#fff",color:"#333",cursor:"pointer",fontSize:14,fontWeight:500}}>← Go to Estimator</button>
              </div>
            )}

            {!recsLoading && recs && recs.error && (
              recs.error === "shared_link" ? (
                <div style={{textAlign:"center",padding:"50px 20px"}}>
                  <div style={{fontSize:48,marginBottom:16}}>🔒</div>
                  <h3 style={{fontFamily:"'Instrument Serif',serif",fontSize:22,fontWeight:400,color:"#1a1a1a",marginBottom:10}}>AI Recommendations</h3>
                  <p style={{fontSize:14,color:"#666",lineHeight:1.7,maxWidth:420,margin:"0 auto 20px"}}>
                    AI-powered recommendations are available when running ScholarshipIQ directly in Claude. The estimator, results, and compare features work fully on shared links.
                  </p>
                  <button onClick={()=>setActiveTab("estimator")} className="outline-btn" style={{padding:"10px 22px",borderRadius:10,border:"1.5px solid #e0dbd2",background:"#fff",color:"#333",cursor:"pointer",fontSize:14,fontWeight:500}}>← Use the Estimator</button>
                </div>
              ) : (
                <div style={{padding:20,background:"#fff5f5",borderRadius:12,border:"1px solid #fcc",color:"#c00",fontSize:14}}>{recs.error}</div>
              )
            )}

            {!recsLoading && recs && !recs.error && (() => {
              const allStates = [...new Set(SCHOOLS.map(s => s.state))].sort();

              return (
              <div className="fade-up">
                {/* Summary card */}
                <div style={{background:"#1a1a1a",borderRadius:16,padding:"20px 24px",marginBottom:24,boxShadow:"0 4px 20px rgba(0,0,0,0.12)"}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#e05c2a",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8}}>✦ Strategic Overview</div>
                  <p style={{fontSize:15,color:"#e8e4dc",lineHeight:1.75}}>{recs.summary}</p>
                </div>

                {/* Filters */}
                <div style={{background:"#fff",borderRadius:12,border:"1px solid #e0dbd2",padding:"14px 18px",marginBottom:20,boxShadow:"0 1px 4px rgba(0,0,0,0.03)"}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#999",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>Filter & Regenerate</div>
                  <div className="grid-2col">
                    <div>
                      <label style={{display:"block",fontSize:12,fontWeight:600,color:"#888",marginBottom:5}}>Preferred State</label>
                      <select value={recStateFilter} onChange={e => setRecStateFilter(e.target.value)}
                        style={{width:"100%",padding:"9px 12px",border:"1.5px solid #e0dbd2",borderRadius:8,fontSize:13,fontWeight:500,color:"#1a1a1a",background:"#faf9f7",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                        <option value="">All States</option>
                        {allStates.map(st => <option key={st} value={st}>{st}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{display:"block",fontSize:12,fontWeight:600,color:"#888",marginBottom:5}}>Max Tuition</label>
                      <select value={recTuitionMax} onChange={e => setRecTuitionMax(e.target.value)}
                        style={{width:"100%",padding:"9px 12px",border:"1.5px solid #e0dbd2",borderRadius:8,fontSize:13,fontWeight:500,color:"#1a1a1a",background:"#faf9f7",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                        <option value="">Any Tuition</option>
                        <option value="30">Under $30k</option>
                        <option value="40">Under $40k</option>
                        <option value="50">Under $50k</option>
                        <option value="60">Under $60k</option>
                        <option value="70">Under $70k</option>
                        <option value="80">Under $80k</option>
                      </select>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
                    {(recStateFilter || recTuitionMax) && (
                      <>
                        <button onClick={getRecommendations} disabled={recsLoading}
                          style={{padding:"7px 16px",borderRadius:8,border:"none",background:"#e05c2a",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:600,transition:"all 0.15s",boxShadow:"0 2px 8px rgba(224,92,42,0.25)"}}
                          onMouseOver={e=>e.target.style.background="#c94d1e"} onMouseOut={e=>e.target.style.background="#e05c2a"}
                        >🎯 Regenerate with filters</button>
                        <button onClick={() => { setRecStateFilter(""); setRecTuitionMax(""); }}
                          style={{padding:"7px 14px",borderRadius:8,border:"1px solid #e0dbd2",background:"#faf9f7",color:"#888",cursor:"pointer",fontSize:12,fontWeight:500,transition:"all 0.15s"}}
                          onMouseOver={e=>e.target.style.background="#e8e4dc"} onMouseOut={e=>e.target.style.background="#faf9f7"}
                        >✕ Clear</button>
                      </>
                    )}
                  </div>
                </div>

                {/* Buckets */}
                {[
                  { key:"reach", label:"Reach Schools", emoji:"🚀", desc:"Long shots worth the application", color:"#cc3b2a", bg:"#fff8f7", border:"#fad5d0" },
                  { key:"target", label:"Target Schools", emoji:"🎯", desc:"Strong fits where you're competitive", color:"#2a7ae0", bg:"#f6f9ff", border:"#cddcfa" },
                  { key:"safety", label:"Safety Schools", emoji:"🏆", desc:"High-probability admits with scholarship upside", color:"#2d9e5f", bg:"#f5fbf8", border:"#c0e8d2" },
                ].map(bucket => {
                  const bucketSchools = recs[bucket.key] || [];
                  return (
                  <div key={bucket.key} style={{marginBottom:20}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                      <span style={{fontSize:20}}>{bucket.emoji}</span>
                      <div>
                        <h3 style={{fontSize:16,fontWeight:700,color:"#1a1a1a",letterSpacing:"-0.2px"}}>{bucket.label}</h3>
                        <p style={{fontSize:12,color:"#999"}}>{bucket.desc}</p>
                      </div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:10}}>
                      {bucketSchools.length === 0 && (
                        <div style={{padding:"16px",background:"#faf9f7",borderRadius:10,border:"1px solid #f0ede8",fontSize:13,color:"#bbb",textAlign:"center"}}>
                          No schools in this category
                        </div>
                      )}
                      {bucketSchools.map((school, si) => {
                        const schoolData = SCHOOLS.find(s => s.name === school.name);
                        return (
                          <div key={si} className="rec-card-inner" style={{background:"#fff",borderRadius:13,border:`1px solid ${bucket.border}`,padding:"16px 18px",boxShadow:"0 1px 6px rgba(0,0,0,0.04)",borderLeft:`3px solid ${bucket.color}`}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8,marginBottom:10}}>
                              <div>
                                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:3}}>
                                  <span style={{fontWeight:700,fontSize:15,color:"#1a1a1a"}}>{school.name}</span>
                                  {schoolData && (
                                    <>
                                      <span style={{fontSize:11,fontWeight:700,color:"#999"}}>#{schoolData.usNews}</span>
                                      <span style={{fontSize:10,padding:"2px 8px",borderRadius:20,background:`${TIER_DOT[schoolData.tier]}15`,color:TIER_DOT[schoolData.tier],fontWeight:600,border:`1px solid ${TIER_DOT[schoolData.tier]}30`}}>
                                        {TIER_META[schoolData.tier].label}
                                      </span>
                                    </>
                                  )}
                                </div>
                                {schoolData && (
                                  <>
                                    <div style={{fontSize:12,color:"#666",marginBottom:3}}>
                                      📍 {schoolData.city}, {schoolData.state}
                                    </div>
                                    <div style={{display:"flex",gap:12,fontSize:11,color:"#bbb",flexWrap:"wrap"}}>
                                      <span>Accept: <span style={{color:"#666",fontWeight:600}}>{Math.round(schoolData.accept_rate*100)}%</span></span>
                                      <span>Med LSAT: <span style={{color:"#666",fontWeight:600}}>{schoolData.median_lsat}</span></span>
                                      <span>Med GPA: <span style={{color:"#666",fontWeight:600}}>{schoolData.median_gpa}</span></span>
                                      <span>Tuition: <span style={{color:"#666",fontWeight:600}}>${schoolData.tuition.toLocaleString()}</span></span>
                                    </div>
                                  </>
                                )}
                              </div>
                              {schoolData && (
                                selected.find(s=>s.name===schoolData.name) ? (
                                  <span style={{
                                    padding:"5px 12px",borderRadius:8,border:"1.5px solid #a5d6a7",
                                    background:"#e6f4ea",color:"#2e7d32",fontSize:12,fontWeight:600,
                                    whiteSpace:"nowrap",flexShrink:0
                                  }}>✓ Added</span>
                                ) : (
                                  <button onClick={(e)=>{
                                    e.stopPropagation();
                                    addSchool(schoolData);
                                  }} style={{
                                    padding:"5px 12px",borderRadius:8,border:"1.5px solid #e0dbd2",
                                    background:"#faf9f7",color:"#444",cursor:"pointer",fontSize:12,fontWeight:600,
                                    whiteSpace:"nowrap",transition:"all 0.15s",flexShrink:0
                                  }}
                                    onMouseOver={e=>{e.target.style.background="#e8e4dc";e.target.style.borderColor="#ccc";}}
                                    onMouseOut={e=>{e.target.style.background="#faf9f7";e.target.style.borderColor="#e0dbd2";}}
                                  >+ Add to list</button>
                                )
                              )}
                            </div>
                            <div className="rec-detail-grid">
                              <div style={{background:bucket.bg,borderRadius:9,padding:"10px 12px"}}>
                                <div style={{fontSize:10,fontWeight:700,color:bucket.color,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>Why apply</div>
                                <div style={{fontSize:12,color:"#444",lineHeight:1.6}}>{school.reason}</div>
                              </div>
                              <div style={{background:"#faf9f7",borderRadius:9,padding:"10px 12px",border:"1px solid #f0ede8"}}>
                                <div style={{fontSize:10,fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>💡 Tactical tip</div>
                                <div style={{fontSize:12,color:"#444",lineHeight:1.6}}>{school.tip}</div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  );
                })}

                <button onClick={getRecommendations} style={{
                  width:"100%",marginTop:8,padding:"11px",borderRadius:10,
                  border:"1.5px solid #e0dbd2",background:"#fff",color:"#666",
                  cursor:"pointer",fontSize:13,fontWeight:500,transition:"all 0.15s"
                }}
                  onMouseOver={e=>e.currentTarget.style.background="#f0ede8"}
                  onMouseOut={e=>e.currentTarget.style.background="#fff"}
                >↻ Regenerate recommendations</button>
              </div>
              );
            })()}
          </div>
        )}

        {/* ── COMPARE ── */}
        {activeTab==="compare" && (
          <div style={{padding:"32px 0"}}>
            {results.length < 2 ? (
              <div style={{textAlign:"center",padding:"80px 0"}}>
                <div style={{fontSize:48,marginBottom:16}}>⚖️</div>
                <p style={{fontSize:16,color:"#666",marginBottom:20}}>Add 2+ schools and run estimates to compare.</p>
                <button className="outline-btn" onClick={() => setActiveTab("estimator")} style={{padding:"10px 22px",borderRadius:10,border:"1.5px solid #e0dbd2",background:"#fff",color:"#333",cursor:"pointer",fontSize:14,fontWeight:500}}>← Back to Estimator</button>
              </div>
            ) : (
              <div>
                <h2 style={{fontFamily:"'Instrument Serif',serif",fontSize:28,fontWeight:400,color:"#1a1a1a",letterSpacing:"-0.5px",marginBottom:20}}>Side-by-side comparison</h2>
                <div style={{background:"#fff",borderRadius:14,border:"1px solid #e0dbd2",overflow:"hidden",marginBottom:20,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",minWidth:650,borderCollapse:"collapse",fontSize:13}}>
                      <thead>
                        <tr style={{borderBottom:"1px solid #f0ede8",background:"#faf9f7"}}>
                          {["School","Accept","Waitlist","Deny","Scholarship","Est. Aid/yr","BigLaw+FC","Seats"].map(h=>(
                            <th key={h} style={{padding:"12px 14px",textAlign:h==="School"?"left":"center",color:"#999",fontWeight:600,fontSize:11,textTransform:"uppercase",letterSpacing:"0.08em",whiteSpace:"nowrap"}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {results.map((r,i)=>{
                          const sc=r.seats===0?"#cc3b2a":r.seats<30?"#d97c1a":r.seats<80?"#d4a017":"#2d9e5f";
                          return (
                            <tr key={r.name} style={{borderBottom:"1px solid #f0ede8"}}>
                              <td style={{padding:"14px",borderLeft:`3px solid ${TIER_DOT[r.tier]}`}}>
                                <div style={{fontWeight:600,fontSize:13,color:"#1a1a1a"}}>{r.name}</div>
                                <div style={{fontSize:11,color:TIER_DOT[r.tier],marginTop:1,fontWeight:500}}>{TIER_META[r.tier].label} · #{i+1}</div>
                              </td>
                              <td style={{padding:"14px",textAlign:"center"}}><span style={{fontWeight:800,color:"#2d9e5f",fontSize:16}}>{r.accept}%</span></td>
                              <td style={{padding:"14px",textAlign:"center"}}><span style={{fontWeight:700,color:"#d97c1a"}}>{r.waitlist}%</span></td>
                              <td style={{padding:"14px",textAlign:"center"}}><span style={{fontWeight:700,color:"#cc3b2a"}}>{r.deny}%</span></td>
                              <td style={{padding:"14px",textAlign:"center"}}><span style={{color:r.scholColor,fontWeight:600}}>{r.scholEmoji} {r.scholLabel}</span></td>
                              <td style={{padding:"14px",textAlign:"center",color:r.estMax>0?"#666":"#ccc",fontSize:12}}>{r.estMax>0?`$${r.estMin.toLocaleString()}-$${r.estMax.toLocaleString()}`:"—"}</td>
                              <td style={{padding:"14px",textAlign:"center"}}><span style={{color:"#2a7ae0",fontWeight:700}}>{r.biglaw_fc_pct != null ? `${r.biglaw_fc_pct}%` : "—"}</span></td>
                              <td style={{padding:"14px",textAlign:"center"}}><span style={{color:sc,fontWeight:700}}>{r.seats===0?"~0":r.seats}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <h3 style={{fontSize:12,color:"#999",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:12}}>Acceptance Probability Ranking</h3>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {[...results].sort((a,b)=>b.accept-a.accept).map(r=>(
                    <div key={r.name} style={{background:"#fff",borderRadius:11,border:"1px solid #e0dbd2",padding:"13px 16px",boxShadow:"0 1px 4px rgba(0,0,0,0.03)"}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:8,fontSize:13,flexWrap:"wrap",gap:6}}>
                        <span style={{fontWeight:600,color:"#1a1a1a"}}>{r.name}</span>
                        <div className="compare-stats">
                          <span style={{color:"#2d9e5f",fontWeight:700}}>{r.accept}% accept</span>
                          <span style={{color:"#d97c1a",fontWeight:600}}>{r.waitlist}% WL</span>
                          <span style={{color:"#cc3b2a",fontWeight:600}}>{r.deny}% deny</span>
                        </div>
                      </div>
                      <div style={{display:"flex",height:7,borderRadius:4,overflow:"hidden",gap:1}}>
                        <div style={{width:`${r.accept}%`,background:"#2d9e5f",transition:"width 0.8s ease"}}/>
                        <div style={{width:`${r.waitlist}%`,background:"#d97c1a",transition:"width 0.8s ease"}}/>
                        <div style={{width:`${r.deny}%`,background:"#cc3b2a",transition:"width 0.8s ease"}}/>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

      </div>
      <Analytics />
    </div>
  );
}