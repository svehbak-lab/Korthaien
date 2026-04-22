import { useState, useEffect, useRef } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// PRICE RULES ENGINE
// ─────────────────────────────────────────────────────────────────────────────
// Round up to nearest x9 (e.g. 127 → 129, 50 → 59, 13 → 19)
function roundToX9(val) {
  const base = Math.floor(val / 10) * 10;
  const candidate = base + 9;
  return candidate < val ? candidate + 10 : candidate;
}

const DEFAULT_RULES = {
  // mythic and rare share the same rules
  mythic_rare: [
    { min_usd: 0,    max_usd: 0.99,  nok: 10 },
    { min_usd: 1.00, max_usd: 1.49,  nok: 15 },
    { min_usd: 1.50, max_usd: 2.49,  nok: 25 },
    { min_usd: 2.50, max_usd: 4.99,  nok: 49 },
    { min_usd: 5.00, max_usd: 999,   multiply: 12 }, // × 12, round to x9
  ],
  uncommon: [
    { min_usd: 0,    max_usd: 0.29,  nok: 5 },
    { min_usd: 0.30, max_usd: 0.59,  nok: 7 },
    { min_usd: 0.60, max_usd: 0.99,  nok: 10 },
    { min_usd: 1.00, max_usd: 999,   nok: 15 },
  ],
  common:   [
    { min_usd: 0,    max_usd: 0.19,  nok: 3 },
    { min_usd: 0.20, max_usd: 0.39,  nok: 5 },
    { min_usd: 0.40, max_usd: 999,   nok: 8 },
  ],
};

function applyRule(rules, rarity, usd) {
  const r = (rarity || "").toLowerCase();
  // mythic and rare use the same tier
  const tierKey = (r === "mythic" || r === "rare") ? "mythic_rare" : r;
  const tier = rules[tierKey] || rules.mythic_rare;
  for (const rule of tier) {
    if (usd >= rule.min_usd && usd <= rule.max_usd) {
      if (rule.multiply) return roundToX9(usd * rule.multiply);
      return rule.nok;
    }
  }
  return 99;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEMO DATA
// ─────────────────────────────────────────────────────────────────────────────
const DEMO_CARDS = [
  { id:"d-1", name:"Ragavan, Nimble Pilferer", sku:"MH2-138", set_code:"mh2", collector_number:"138", rarity:"mythic",   price_nok:350, stock:2, category_id:"demo-mh2-mythic",   category_name:"Modern Horizons 2 - Mythic" },
  { id:"d-2", name:"Solitude",                 sku:"MH2-032", set_code:"mh2", collector_number:"32",  rarity:"mythic",   price_nok:180, stock:1, category_id:"demo-mh2-mythic",   category_name:"Modern Horizons 2 - Mythic" },
  { id:"d-3", name:"Grief",                    sku:"MH2-086", set_code:"mh2", collector_number:"86",  rarity:"mythic",   price_nok:120, stock:3, category_id:"demo-mh2-mythic",   category_name:"Modern Horizons 2 - Mythic" },
  { id:"d-4", name:"Dragon's Rage Channeler",  sku:"MH2-121", set_code:"mh2", collector_number:"121", rarity:"uncommon", price_nok:15,  stock:8, category_id:"demo-mh2-uncommon", category_name:"Modern Horizons 2 - Uncommon" },
  { id:"d-5", name:"Murktide Regent",          sku:"MH2-052", set_code:"mh2", collector_number:"52",  rarity:"mythic",   price_nok:250, stock:1, category_id:"demo-mh2-mythic",   category_name:"Modern Horizons 2 - Mythic" },
  { id:"d-6", name:"Subtlety",                 sku:"MH2-067", set_code:"mh2", collector_number:"67",  rarity:"mythic",   price_nok:90,  stock:4, category_id:"demo-mh2-mythic",   category_name:"Modern Horizons 2 - Mythic" },
  { id:"d-7", name:"Urza's Saga",              sku:"MH2-259", set_code:"mh2", collector_number:"259", rarity:"rare",     price_nok:149, stock:2, category_id:"demo-mh2-rare",     category_name:"Modern Horizons 2 - Rare" },
  { id:"d-8", name:"Endurance",                sku:"MH2-157", set_code:"mh2", collector_number:"157", rarity:"mythic",   price_nok:200, stock:1, category_id:"demo-mh2-mythic",   category_name:"Modern Horizons 2 - Mythic" },
];

const DEMO_CATEGORIES = [
  { id:"demo-mh2-mythic",   name:"Modern Horizons 2 - Mythic" },
  { id:"demo-mh2-rare",     name:"Modern Horizons 2 - Rare" },
  { id:"demo-mh2-uncommon", name:"Modern Horizons 2 - Uncommon" },
];

// ─────────────────────────────────────────────────────────────────────────────
// SCRYFALL
// ─────────────────────────────────────────────────────────────────────────────
async function scryfallLookup(card) {
  try {
    // Only use set/number lookup if both are present
    if (card.set_code && card.collector_number) {
      const r = await fetch(`https://api.scryfall.com/cards/${card.set_code}/${card.collector_number}`);
      if (r.ok) return await r.json();
    }
    // Fall back to fuzzy name search
    if (!card.name) return null;
    const r2 = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(card.name)}`);
    if (!r2.ok) return null;
    return await r2.json();
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// SMALL COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
const RARITY_STYLE = {
  mythic:   { bg:"rgba(251,146,60,.12)", color:"#c2500a", border:"rgba(251,146,60,.3)" },
  rare:     { bg:"rgba(234,179,8,.10)",  color:"#a16207", border:"rgba(234,179,8,.3)" },
  uncommon: { bg:"rgba(59,130,246,.08)", color:"#1d4ed8", border:"rgba(59,130,246,.2)" },
  common:   { bg:"rgba(0,0,0,.04)",      color:"#71717a", border:"rgba(0,0,0,.1)" },
};

function RarityBadge({ rarity }) {
  const s = RARITY_STYLE[(rarity||"").toLowerCase()] || RARITY_STYLE.common;
  return (
    <span style={{ fontSize:10, padding:"2px 8px", borderRadius:20, border:`1px solid ${s.border}`, background:s.bg, color:s.color, fontWeight:600, letterSpacing:".06em", textTransform:"uppercase" }}>
      {rarity||"—"}
    </span>
  );
}

function DiffPill({ pct }) {
  if (pct === null || pct === undefined) return <span style={{ color:"#d4d4d8", fontSize:11 }}>—</span>;
  if (Math.abs(pct) < 5) return <span style={{ color:"#a1a1aa", fontSize:11 }}>≈ 0%</span>;
  if (pct > 0) return <span style={{ fontSize:11, fontWeight:700, color:"#dc2626" }}>+{pct.toFixed(0)}%</span>;
  return <span style={{ fontSize:11, fontWeight:700, color:"#16a34a" }}>{pct.toFixed(0)}%</span>;
}

function Spinner() {
  return <span style={{ display:"inline-block", animation:"spin .8s linear infinite" }}>⟳</span>;
}

function CardPreview({ src, visible, x, y }) {
  if (!visible || !src) return null;
  return (
    <div style={{ position:"fixed", left:x+16, top:y-80, zIndex:1000, pointerEvents:"none", filter:"drop-shadow(0 16px 32px rgba(0,0,0,.25))" }}>
      <img src={src} alt="" style={{ width:160, borderRadius:8 }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY DROPDOWN
// ─────────────────────────────────────────────────────────────────────────────
function CategoryDropdown({ categories, value, onChange, loading }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef();
  const inputRef = useRef();

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const selected = categories.find(c => c.id === value);
  const filtered = categories.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div ref={ref} style={{ position:"relative", minWidth:280 }}>
      <button
        onClick={() => { if (!loading) { setOpen(o => !o); setSearch(""); } }}
        style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, width:"100%",
          background:"#fff", border:"1px solid #e4e4e7", borderRadius:8, padding:"7px 12px",
          color: selected ? "#18181b" : "#a1a1aa", fontSize:12, cursor:loading?"not-allowed":"pointer",
          boxShadow:"0 1px 2px rgba(0,0,0,.04)", textAlign:"left" }}>
        <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>
          {loading ? "Laster kategorier…" : selected ? selected.name : "Velg kategori…"}
        </span>
        <span style={{ fontSize:9, color:"#a1a1aa", flexShrink:0, display:"inline-block", transform:open?"rotate(180deg)":"none", transition:"transform .15s" }}>▾</span>
      </button>

      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, right:0, background:"#fff",
          border:"1px solid #e4e4e7", borderRadius:10, boxShadow:"0 8px 24px rgba(0,0,0,.10)",
          zIndex:300, overflow:"hidden" }}>
          {/* search inside dropdown */}
          <div style={{ padding:"8px 10px", borderBottom:"1px solid #f4f4f5" }}>
            <input
              ref={inputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filtrer kategorier…"
              style={{ width:"100%", background:"#f4f4f5", border:"1px solid #e4e4e7", borderRadius:6,
                padding:"5px 10px", fontSize:11, color:"#18181b" }}
            />
          </div>
          <div style={{ maxHeight:280, overflowY:"auto" }}>
            {/* All categories option */}
            <div onClick={() => { onChange(null); setOpen(false); setSearch(""); }}
              style={{ padding:"9px 14px", fontSize:12, cursor:"pointer", fontStyle:"italic",
                color: value===null ? "#0369a1" : "#71717a",
                background: value===null ? "#f0f9ff" : "transparent",
                borderBottom:"1px solid #fafafa" }}>
              Alle kategorier
            </div>
            {filtered.length === 0 && (
              <div style={{ padding:"12px 14px", fontSize:11, color:"#a1a1aa", textAlign:"center" }}>Ingen treff</div>
            )}
            {filtered.map(cat => (
              <div key={cat.id}
                onClick={() => { onChange(cat.id); setOpen(false); setSearch(""); }}
                style={{ padding: cat.isParent ? "8px 14px" : "7px 14px 7px 26px",
                  fontSize: cat.isParent ? 12 : 11,
                  cursor:"pointer",
                  background: cat.id===value ? "#f0f9ff" : cat.isParent ? "#fafafa" : "transparent",
                  color: cat.id===value ? "#0369a1" : cat.isParent ? "#18181b" : "#52525b",
                  borderBottom:"1px solid #f4f4f5",
                  fontWeight: cat.isParent ? 600 : cat.id===value ? 500 : 400,
                  borderLeft: !cat.isParent ? "2px solid #f0f0f0" : "none",
                  marginLeft: !cat.isParent ? 14 : 0,
                }}>
                {cat.isParent ? cat.name : `↳ ${cat.name}`}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS PANEL
// ─────────────────────────────────────────────────────────────────────────────
function Settings({ cfg, onSave, onClose }) {
  const [local, setLocal] = useState(cfg);
  const setKey = (k, v) => setLocal(p => ({ ...p, [k]: v }));
  const setRule = (rarity, i, field, val) => {
    const copy = { ...local.rules, [rarity]: local.rules[rarity].map((r, j) => j===i ? { ...r, [field]: parseFloat(val)||0 } : r) };
    setLocal(p => ({ ...p, rules: copy }));
  };
  const addRule = r => setLocal(p => ({ ...p, rules: { ...p.rules, [r]: [...(p.rules[r]||[]), { min_usd:0, max_usd:999, nok:50 }] } }));
  const delRule = (r, i) => setLocal(p => ({ ...p, rules: { ...p.rules, [r]: p.rules[r].filter((_,j)=>j!==i) } }));

  return (
    <div style={{ position:"fixed", inset:0, zIndex:200, background:"rgba(0,0,0,.35)", backdropFilter:"blur(4px)", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:"#fff", border:"1px solid #e4e4e7", borderRadius:16, width:"100%", maxWidth:560, maxHeight:"88vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,.12)" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"20px 24px", borderBottom:"1px solid #f4f4f5" }}>
          <span style={{ fontWeight:600, fontSize:14, color:"#18181b", letterSpacing:".04em" }}>INNSTILLINGER</span>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"#a1a1aa", fontSize:18, cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ padding:"24px", display:"flex", flexDirection:"column", gap:24 }}>
          <section>
            <div style={{ fontSize:10, color:"#a1a1aa", letterSpacing:".12em", marginBottom:12 }}>MYSTORE API</div>
            {[["mystoreUrl","Store URL","https://korthaien.mystore.no/api/v1"],["mystoreKey","API-nøkkel","Bearer token..."]].map(([k,l,ph])=>(
              <div key={k} style={{ marginBottom:10 }}>
                <div style={{ fontSize:11, color:"#71717a", marginBottom:4 }}>{l}</div>
                <input type={k.includes("Key")?"password":"text"} value={local[k]} onChange={e=>setKey(k,e.target.value)} placeholder={ph}
                  style={{ width:"100%", background:"#f4f4f5", border:"1px solid #e4e4e7", borderRadius:8, padding:"8px 12px", color:"#18181b", fontSize:12, fontFamily:"inherit" }} />
              </div>
            ))}
            <div style={{ fontSize:11, color:"#a1a1aa", marginTop:4 }}>Scryfall trenger ingen nøkkel — gratis og åpent ✓</div>
          </section>
          <section>
            <div style={{ fontSize:10, color:"#a1a1aa", letterSpacing:".12em", marginBottom:12 }}>VALUTAKURS</div>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:12, color:"#71717a" }}>1 USD =</span>
              <input type="number" step=".1" value={local.usdNok} onChange={e=>setKey("usdNok",parseFloat(e.target.value))}
                style={{ width:80, background:"#f4f4f5", border:"1px solid #e4e4e7", borderRadius:8, padding:"6px 10px", color:"#18181b", fontSize:12, fontFamily:"inherit" }} />
              <span style={{ fontSize:12, color:"#71717a" }}>NOK</span>
            </div>
          </section>
          <section>
            <div style={{ fontSize:10, color:"#a1a1aa", letterSpacing:".12em", marginBottom:16 }}>PRISREGLER <span style={{ color:"#d4d4d8" }}>— intervall USD → foreslått NOK</span></div>
            {[["mythic_rare","Mythic / Rare"],["uncommon","Uncommon"],["common","Common"]].map(([key, label]) => (
              <div key={key} style={{ marginBottom:20 }}>
                <div style={{ marginBottom:6, display:"flex", alignItems:"center", gap:6 }}>
                  {key === "mythic_rare"
                    ? <><RarityBadge rarity="mythic" /><RarityBadge rarity="rare" /></>
                    : <RarityBadge rarity={key} />}
                </div>
                <div style={{ display:"flex", gap:6, marginBottom:4 }}>
                  <span style={{ fontSize:9, color:"#d4d4d8", width:70, textAlign:"center" }}>FRA USD</span>
                  <span style={{ fontSize:9, color:"#d4d4d8", width:70, textAlign:"center" }}>TIL USD</span>
                  <span style={{ fontSize:9, color:"#d4d4d8", width:90, textAlign:"center" }}>REGEL</span>
                </div>
                {(local.rules[key]||[]).map((rule,i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:5 }}>
                    <input type="number" step=".01" value={rule.min_usd ?? 0} onChange={e=>setRule(key,i,"min_usd",e.target.value)}
                      style={{ width:70, background:"#f4f4f5", border:"1px solid #e4e4e7", borderRadius:6, padding:"4px 8px", color:"#18181b", fontSize:11, fontFamily:"inherit", textAlign:"center" }} />
                    <span style={{ fontSize:10, color:"#a1a1aa" }}>–</span>
                    <input type="number" step=".01" value={rule.max_usd} onChange={e=>setRule(key,i,"max_usd",e.target.value)}
                      style={{ width:70, background:"#f4f4f5", border:"1px solid #e4e4e7", borderRadius:6, padding:"4px 8px", color:"#18181b", fontSize:11, fontFamily:"inherit", textAlign:"center" }} />
                    <span style={{ fontSize:10, color:"#a1a1aa" }}>→</span>
                    {rule.multiply != null ? (
                      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                        <span style={{ fontSize:10, color:"#a1a1aa" }}>×</span>
                        <input type="number" step=".1" value={rule.multiply} onChange={e=>setRule(key,i,"multiply",e.target.value)}
                          style={{ width:44, background:"#fef9c3", border:"1px solid #fde68a", borderRadius:6, padding:"4px 8px", color:"#92400e", fontSize:11, fontFamily:"inherit", textAlign:"center" }} />
                        <span style={{ fontSize:9, color:"#a1a1aa" }}>→ x9</span>
                        <button onClick={()=>setRule(key,i,"multiply",undefined)||setRule(key,i,"nok",50)}
                          style={{ fontSize:9, color:"#a1a1aa", background:"none", border:"none", cursor:"pointer" }}>fast pris</button>
                      </div>
                    ) : (
                      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                        <input type="number" value={rule.nok} onChange={e=>setRule(key,i,"nok",e.target.value)}
                          style={{ width:64, background:"#f4f4f5", border:"1px solid #e4e4e7", borderRadius:6, padding:"4px 8px", color:"#18181b", fontSize:11, fontFamily:"inherit", textAlign:"center" }} />
                        <span style={{ fontSize:10, color:"#a1a1aa" }}>kr</span>
                        <button onClick={()=>{ const copy={...local.rules}; copy[key]=copy[key].map((r,j)=>j===i?{...r,multiply:12,nok:undefined}:r); setLocal(p=>({...p,rules:copy})); }}
                          style={{ fontSize:9, color:"#a1a1aa", background:"none", border:"none", cursor:"pointer" }}>× faktor</button>
                      </div>
                    )}
                    <button onClick={()=>delRule(key,i)} style={{ background:"none", border:"none", color:"#d4d4d8", cursor:"pointer", fontSize:13 }}>✕</button>
                  </div>
                ))}
                <button onClick={()=>addRule(key)} style={{ fontSize:10, color:"#a1a1aa", background:"none", border:"none", cursor:"pointer", fontFamily:"inherit" }}>+ legg til intervall</button>
              </div>
            ))}
          </section>
        </div>
        <div style={{ padding:"16px 24px", borderTop:"1px solid #f4f4f5", display:"flex", justifyContent:"flex-end", gap:10 }}>
          <button onClick={onClose} style={{ padding:"8px 16px", background:"none", border:"1px solid #e4e4e7", borderRadius:8, color:"#71717a", fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Avbryt</button>
          <button onClick={()=>{onSave(local);onClose();}} style={{ padding:"8px 20px", background:"#16a34a", border:"none", borderRadius:8, color:"#fff", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>Lagre</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
function loadCfg() {
  try {
    const saved = localStorage.getItem("kardex_cfg");
    if (saved) return { mystoreUrl:"", mystoreKey:"", usdNok:10.6, rules:DEFAULT_RULES, ...JSON.parse(saved) };
  } catch {}
  return { mystoreUrl:"", mystoreKey:"", usdNok:10.6, rules:DEFAULT_RULES };
}

export default function App() {
  const [cfg, setCfgRaw] = useState(loadCfg);

  function setCfg(newCfg) {
    setCfgRaw(newCfg);
    try { localStorage.setItem("kardex_cfg", JSON.stringify(newCfg)); } catch {}
  }
  const [showSettings, setShowSettings] = useState(false);
  const [categories, setCategories]     = useState([]);
  const [catsLoading, setCatsLoading]   = useState(false);
  const [selectedCat, setSelectedCat]   = useState(null);
  const [cards, setCards]               = useState([]);
  const [approved, setApproved]         = useState({});
  const [newPrices, setNewPrices]       = useState({});
  const [loading, setLoading]           = useState(false);
  const [progress, setProgress]         = useState({ done:0, total:0 });
  const [status, setStatus]             = useState("");
  const [filter, setFilter]             = useState("all");
  const [onlyInStock, setOnlyInStock]    = useState(false);
  const [priceMin, setPriceMin]          = useState("");
  const [priceMax, setPriceMax]          = useState("");
  const [search, setSearch]             = useState("");
  const [sort, setSort]                 = useState("diff_desc");
  const [log, setLog]                   = useState([]);
  const [pushing, setPushing]           = useState(false);
  const [preview, setPreview]           = useState({ visible:false, src:null, x:0, y:0 });

  const configured = !!(cfg.mystoreUrl && cfg.mystoreKey);

  // ── fetch categories ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!configured) { setCategories(DEMO_CATEGORIES); return; }
    async function fetchCats() {
      setCatsLoading(true);
      try {
        let all = [], page = 1, totalPages = 1;
        while (page <= totalPages) {
          const r = await fetch(`${cfg.mystoreUrl}/categories?page[number]=${page}&page[size]=50`, {
            headers: { Authorization:`Bearer ${cfg.mystoreKey}`, Accept:"application/vnd.api+json" },
          });
          if (!r.ok) break;
          const data = await r.json();
          const batch = Array.isArray(data.data) ? data.data : [];
          if (!batch.length) break;
          all = [...all, ...batch];
          if (page === 1 && data.links?.last) {
            const m = data.links.last.match(/page\[number\]=(\d+)/);
            if (m) totalPages = Math.min(parseInt(m[1]), 10); // max 10 pages = 500 categories
          }
          page++;
          await new Promise(res => setTimeout(res, 300)); // respect rate limit
        }
        // Build hierarchy: parents first, then children indented underneath
        const flat = all.map(c => ({
          id:        String(c.id),
          name:      c.attributes?.name?.no || String(c.id),
          parent_id: c.relationships?.parent?.data ? String(c.relationships.parent.data.id) : null,
        }));
        const byId = Object.fromEntries(flat.map(c => [c.id, c]));
        // Sort: parents alphabetically, children alphabetically under their parent
        const parents = flat.filter(c => !c.parent_id).sort((a,b) => a.name.localeCompare(b.name, "no"));
        const children = flat.filter(c => c.parent_id);
        const ordered = [];
        for (const parent of parents) {
          ordered.push({ ...parent, isParent: true });
          const kids = children.filter(c => c.parent_id === parent.id).sort((a,b) => a.name.localeCompare(b.name, "no"));
          for (const kid of kids) ordered.push({ ...kid, isParent: false });
        }
        // Also add orphan children (parent not in list)
        const orphans = children.filter(c => !byId[c.parent_id]).sort((a,b) => a.name.localeCompare(b.name, "no"));
        ordered.push(...orphans);
        setCategories(ordered);
      } catch(e) { setStatus("Kategorifeil: " + e.message); }
      setCatsLoading(false);
    }
    fetchCats();
  }, [cfg.mystoreUrl, cfg.mystoreKey]);

  // ── enrich with Scryfall ──────────────────────────────────────────────────
  async function enrichWithScryfall(rawCards) {
    const safeCards = Array.isArray(rawCards) ? rawCards : [];
    setProgress({ done:0, total:safeCards.length });
    const enriched = [];
    for (let i = 0; i < safeCards.length; i++) {
      const card = safeCards[i];
      const sf = await scryfallLookup(card);
      await new Promise(r => setTimeout(r, 120));
      const usd    = sf ? parseFloat(sf.prices?.usd || sf.prices?.usd_foil || 0) : 0;
      const image  = sf?.image_uris?.normal || sf?.card_faces?.[0]?.image_uris?.normal || null;
      const rarity = card.rarity || sf?.rarity || "";
      const sugNok = usd > 0 ? applyRule(cfg.rules, rarity, usd) : null;
      const diffPct = sugNok && card.price_nok ? ((card.price_nok - sugNok) / sugNok) * 100 : null;
      enriched.push({ ...card, rarity, sf_usd:usd, sf_image:image, sugNok, diffPct });
      setProgress({ done:i+1, total:safeCards.length });
    }
    return enriched;
  }

  // ── load demo ─────────────────────────────────────────────────────────────
  async function loadDemo() {
    setLoading(true); setLog([]); setApproved({}); setNewPrices({});
    setStatus("Henter Scryfall-priser for demodata…");
    const source = selectedCat ? DEMO_CARDS.filter(c => c.category_id === selectedCat) : DEMO_CARDS;
    const result = await enrichWithScryfall(source);
    setCards(result);
    setStatus(`${result.length} kort lastet (demo)`);
    setLoading(false);
  }

  // ── load from Mystore ─────────────────────────────────────────────────────
  async function loadMystore() {
    setLoading(true); setLog([]); setApproved({}); setNewPrices({});
    try {
      // Use category relationship URL if a category is selected
      const baseUrl = selectedCat
        ? `${cfg.mystoreUrl}/categories/${selectedCat}/products`
        : `${cfg.mystoreUrl}/products`;
      let all = [], page = 1, totalPages = 1;
      while (page <= totalPages) {
        setStatus(`Henter side ${page} av ${totalPages} fra Mystore…`);
        const r = await fetch(`${baseUrl}?page[number]=${page}&page[size]=50`, {
          headers: { Authorization:`Bearer ${cfg.mystoreKey}`, Accept:"application/vnd.api+json" },
        });
        if (!r.ok) throw new Error(`Mystore svarte ${r.status}`);
        const data = await r.json();
        const batch = Array.isArray(data.data) ? data.data : [];
        if (batch.length === 0) break;
        all = [...all, ...batch];
        if (page === 1 && data.links?.last) {
          const m = data.links.last.match(/page\[number\]=(\d+)/);
          if (m) totalPages = parseInt(m[1]);
        }
        setStatus(`${all.length} produkter hentet (side ${page} av ${totalPages})…`);
        page++;
        await new Promise(res => setTimeout(res, 200));
      }
      const raw = all.map(p => ({
        id:               String(p.id),
        name:             p.attributes?.name?.no || p.attributes?.name || "",
        sku:              p.attributes?.sku || "",
        set_code:         "",
        collector_number: p.attributes?.collector_number || "",
        rarity:           (p.attributes?.rarity || "").toLowerCase(),
        price_nok:        parseFloat(p.attributes?.price || p.attributes?.regular_price || 0),
        stock:            parseInt(p.attributes?.stock || 0),
        category_id:      String(p.relationships?.categories?.data?.[0]?.id || ""),
        category_name:    "",
      }));
      setStatus(`${raw.length} kort — henter Scryfall-priser…`);
      const result = await enrichWithScryfall(raw);
      setCards(result);
      setStatus(`${result.length} kort lastet ✓`);
    } catch(e) {
      setStatus("Feil: " + e.message);
    }
    setLoading(false);
  }

  // ── push updates to Mystore ───────────────────────────────────────────────
  async function pushUpdates() {
    setPushing(true);
    const toUpdate = cards.filter(c => approved[c.id]);
    const newLog = [];
    for (const c of toUpdate) {
      const price = newPrices[c.id] ?? c.sugNok;
      if (!price) continue;
      try {
        if (configured) {
          await fetch(`${cfg.mystoreUrl}/products/${c.id}`, {
            method:"PATCH",
            headers:{ Authorization:`Bearer ${cfg.mystoreKey}`, "Content-Type":"application/vnd.api+json" },
            body: JSON.stringify({ price }),
          });
        } else {
          await new Promise(r => setTimeout(r, 60));
        }
        newLog.push({ name:c.name, old:c.price_nok, next:price, ok:true });
        setCards(prev => prev.map(x => x.id===c.id ? {...x, price_nok:price, diffPct:0} : x));
      } catch(e) {
        newLog.push({ name:c.name, old:c.price_nok, next:price, ok:false, err:e.message });
      }
    }
    setLog(newLog);
    setApproved({});
    setStatus(`Ferdig — ${newLog.filter(l=>l.ok).length} kort oppdatert`);
    setPushing(false);
  }

  // ── filtered + sorted view ────────────────────────────────────────────────
  const displayed = cards
    .filter(c => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (filter==="over"     && !((c.diffPct||0) >  5)) return false;
      if (filter==="under"    && !((c.diffPct||0) < -5)) return false;
      if (filter==="changed"  && !(Math.abs(c.diffPct||0) > 5)) return false;
      if (filter==="approved" && !approved[c.id]) return false;
      if (onlyInStock && !(c.stock > 0)) return false;
      if (priceMin !== "" && (c.price_nok||0) < parseFloat(priceMin)) return false;
      if (priceMax !== "" && (c.price_nok||0) > parseFloat(priceMax)) return false;
      return true;
    })
    .sort((a,b) => {
      if (sort==="diff_desc") return Math.abs(b.diffPct||0) - Math.abs(a.diffPct||0);
      if (sort==="diff_asc")  return Math.abs(a.diffPct||0) - Math.abs(b.diffPct||0);
      if (sort==="name")      return a.name.localeCompare(b.name);
      if (sort==="price_d")   return (b.price_nok||0) - (a.price_nok||0);
      if (sort==="price_a")   return (a.price_nok||0) - (b.price_nok||0);
      return 0;
    });

  const approvedCount = Object.values(approved).filter(Boolean).length;
  const overCount     = cards.filter(c=>(c.diffPct||0)>5).length;
  const underCount    = cards.filter(c=>(c.diffPct||0)<-5).length;

  function approveAll() {
    const map = {};
    displayed.forEach(c => { if (c.sugNok) map[c.id] = true; });
    setApproved(p => ({...p,...map}));
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily:"'DM Mono','Fira Mono',monospace", background:"#f4f4f5", minHeight:"100vh", color:"#18181b" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=DM+Sans:wght@400;500;600&display=swap');
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
        body { background:#f4f4f5; }
        ::-webkit-scrollbar { width:4px; height:4px; }
        ::-webkit-scrollbar-track { background:#f4f4f5; }
        ::-webkit-scrollbar-thumb { background:#d4d4d8; border-radius:2px; }
        input, select, button { font-family:inherit; }
        input:focus { outline:none; border-color:#a1a1aa !important; }
        @keyframes spin { to { transform:rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .fade-up { animation:fadeUp .2s ease both; }
        .trow { transition:background .1s; }
        .trow:hover { background:rgba(0,0,0,.025) !important; }
        .abtn { transition:all .15s; }
        .abtn:hover { transform:scale(1.08); }
      `}</style>

      {showSettings && <Settings cfg={cfg} onSave={c => setCfg(c)} onClose={() => setShowSettings(false)} />}
      <CardPreview {...preview} />

      {/* ── HEADER ─────────────────────────────────────────────────── */}
      <header style={{ background:"#fff", borderBottom:"1px solid #e4e4e7", position:"sticky", top:0, zIndex:100, boxShadow:"0 1px 3px rgba(0,0,0,.05)" }}>
        <div style={{ maxWidth:1360, margin:"0 auto", padding:"0 20px", height:52, display:"flex", alignItems:"center", gap:16 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, flex:1 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <polygon points="12,2 22,7 22,17 12,22 2,17 2,7" fill="none" stroke="#f59e0b" strokeWidth="1.5"/>
              <polygon points="12,6 18,9.5 18,16.5 12,20 6,16.5 6,9.5" fill="#f59e0b" opacity=".15"/>
              <circle cx="12" cy="12" r="2" fill="#f59e0b"/>
            </svg>
            <span style={{ fontWeight:600, fontSize:15, color:"#18181b", letterSpacing:".07em" }}>KARDEX</span>
            <span style={{ fontSize:10, color:"#a1a1aa", letterSpacing:".12em" }}>PRISVERKTØY</span>
            <div style={{ width:1, height:16, background:"#e4e4e7", margin:"0 4px" }}/>
            <span style={{ fontSize:10, color:"#a1a1aa" }}>via Scryfall</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            {!configured && <div style={{ fontSize:10, color:"#92400e", background:"#fffbeb", border:"1px solid #fde68a", borderRadius:6, padding:"3px 10px" }}>DEMO</div>}
            <button onClick={() => setShowSettings(true)}
              style={{ fontSize:11, color:"#52525b", background:"#f4f4f5", border:"1px solid #e4e4e7", borderRadius:8, padding:"5px 12px", cursor:"pointer" }}>
              ⚙ Innstillinger
            </button>
          </div>
        </div>
      </header>

      {/* ── CATEGORY + FETCH BAR ───────────────────────────────────── */}
      <div style={{ background:"#fff", borderBottom:"1px solid #e4e4e7", padding:"12px 20px" }}>
        <div style={{ maxWidth:1360, margin:"0 auto", display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
          <span style={{ fontSize:11, color:"#a1a1aa", whiteSpace:"nowrap" }}>Kategori:</span>
          <CategoryDropdown
            categories={categories}
            value={selectedCat}
            onChange={v => { setSelectedCat(v); setCards([]); setLog([]); setApproved({}); }}
            loading={catsLoading}
          />
          <button
            onClick={configured ? loadMystore : loadDemo}
            disabled={loading}
            style={{ display:"flex", alignItems:"center", gap:6, background:"#18181b", border:"none",
              borderRadius:8, padding:"8px 16px", color:loading?"#71717a":"#fff", fontSize:11,
              cursor:loading?"not-allowed":"pointer", fontWeight:500, whiteSpace:"nowrap" }}>
            {loading ? <Spinner /> : "↓"}
            {loading ? `${progress.done}/${progress.total} kort…` : configured ? "Hent produkter" : "Last demo"}
          </button>
          {loading && progress.total > 0 && (
            <div style={{ width:160, height:3, background:"#f0f0f0", borderRadius:2, overflow:"hidden" }}>
              <div style={{ height:"100%", background:"#f59e0b", borderRadius:2, transition:"width .3s",
                width:`${(progress.done/progress.total)*100}%` }}/>
            </div>
          )}
          <div style={{ marginLeft:"auto", display:"flex", gap:8, alignItems:"center" }}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Søk kortnavn…"
              style={{ background:"#f4f4f5", border:"1px solid #e4e4e7", borderRadius:8, padding:"7px 12px", color:"#18181b", fontSize:11, width:190 }} />
            <select value={sort} onChange={e=>setSort(e.target.value)}
              style={{ background:"#f4f4f5", border:"1px solid #e4e4e7", borderRadius:8, padding:"7px 10px", color:"#18181b", fontSize:11, cursor:"pointer" }}>
              <option value="diff_desc">Størst avvik</option>
              <option value="diff_asc">Minst avvik</option>
              <option value="name">Navn A–Å</option>
              <option value="price_d">Høyest pris</option>
              <option value="price_a">Lavest pris</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── FILTER + STATUS ────────────────────────────────────────── */}
      <div style={{ background:"#fafafa", borderBottom:"1px solid #f0f0f0", padding:"8px 20px" }}>
        <div style={{ maxWidth:1360, margin:"0 auto", display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          {[["all","Alle"],["over","For dyre"],["under","For billige"],["changed","Endringer"],["approved","Godkjent"]].map(([v,l])=>(
            <button key={v} onClick={()=>setFilter(v)}
              style={{ fontSize:10, padding:"4px 11px", borderRadius:6, border:`1px solid ${filter===v?"#a1a1aa":"#e4e4e7"}`,
                cursor:"pointer", letterSpacing:".06em", background:filter===v?"#18181b":"transparent",
                color:filter===v?"#fff":"#71717a" }}>
              {l}
            </button>
          ))}
          <div style={{ width:1, height:16, background:"#e4e4e7" }}/>
          <span style={{ fontSize:10, color:"#a1a1aa" }}>Pris:</span>
          <input
            type="number" placeholder="Min kr" value={priceMin} onChange={e=>setPriceMin(e.target.value)}
            style={{ width:72, background:"#fff", border:"1px solid #e4e4e7", borderRadius:6, padding:"4px 8px", color:"#18181b", fontSize:11 }} />
          <span style={{ fontSize:10, color:"#d4d4d8" }}>–</span>
          <input
            type="number" placeholder="Maks kr" value={priceMax} onChange={e=>setPriceMax(e.target.value)}
            style={{ width:72, background:"#fff", border:"1px solid #e4e4e7", borderRadius:6, padding:"4px 8px", color:"#18181b", fontSize:11 }} />
          {(priceMin !== "" || priceMax !== "") && (
            <button onClick={()=>{ setPriceMin(""); setPriceMax(""); }}
              style={{ fontSize:10, color:"#a1a1aa", background:"none", border:"none", cursor:"pointer", padding:"0 2px" }}>✕</button>
          )}
          <div style={{ width:1, height:16, background:"#e4e4e7" }}/>
          <button onClick={()=>setOnlyInStock(p=>!p)}
            style={{ fontSize:10, padding:"4px 11px", borderRadius:6, border:`1px solid ${onlyInStock?"#16a34a":"#e4e4e7"}`,
              cursor:"pointer", letterSpacing:".06em", background:onlyInStock?"#dcfce7":"transparent",
              color:onlyInStock?"#16a34a":"#71717a", display:"flex", alignItems:"center", gap:4 }}>
            {onlyInStock ? "✓" : ""} På lager
          </button>
          {status && (
            <span style={{ fontSize:10, color:"#a1a1aa", marginLeft:6, display:"flex", alignItems:"center", gap:5 }}>
              {loading && <Spinner />} {status}
            </span>
          )}
        </div>
      </div>

      <main style={{ maxWidth:1360, margin:"0 auto", padding:"16px 20px" }}>

        {/* ── STAT CARDS ───────────────────────────────────────────── */}
        {cards.length > 0 && (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:14 }} className="fade-up">
            {[
              { l:"Totalt", v:cards.length, u:"kort" },
              { l:"For dyre", v:overCount, u:"kort", c:"#dc2626" },
              { l:"For billige", v:underCount, u:"kort", c:"#16a34a" },
              { l:"Godkjent", v:approvedCount, u:"klar", c:"#2563eb" },
            ].map(s=>(
              <div key={s.l} style={{ background:"#fff", border:"1px solid #e4e4e7", borderRadius:10, padding:"12px 16px", boxShadow:"0 1px 3px rgba(0,0,0,.04)" }}>
                <div style={{ fontSize:9, color:"#a1a1aa", letterSpacing:".12em", marginBottom:5 }}>{s.l.toUpperCase()}</div>
                <div style={{ fontSize:26, fontWeight:600, color:s.c||"#18181b", lineHeight:1 }}>{s.v}</div>
                <div style={{ fontSize:9, color:"#d4d4d8", marginTop:2 }}>{s.u}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── ACTION ROW ───────────────────────────────────────────── */}
        {cards.length > 0 && (
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
            <button onClick={approveAll}
              style={{ fontSize:10, padding:"5px 12px", background:"#f4f4f5", border:"1px solid #e4e4e7", borderRadius:6, color:"#52525b", cursor:"pointer", letterSpacing:".06em" }}>
              GODKJENN ALLE ({displayed.filter(c=>c.sugNok).length})
            </button>
            <button onClick={()=>setApproved({})}
              style={{ fontSize:10, padding:"5px 12px", background:"transparent", border:"1px solid #e4e4e7", borderRadius:6, color:"#a1a1aa", cursor:"pointer" }}>
              NULLSTILL
            </button>
            <div style={{ flex:1 }}/>
            {approvedCount > 0 && (
              <button onClick={pushUpdates} disabled={pushing}
                style={{ display:"flex", alignItems:"center", gap:8, fontSize:11, padding:"8px 18px",
                  background:pushing?"#15803d":"#16a34a", border:"none", borderRadius:8,
                  color:"#fff", cursor:pushing?"not-allowed":"pointer", fontWeight:500 }}>
                {pushing ? <Spinner /> : "↑"} {pushing ? "Oppdaterer…" : `Oppdater ${approvedCount} kort i Mystore`}
                {!configured && !pushing && " (demo)"}
              </button>
            )}
          </div>
        )}

        {/* ── TABLE ────────────────────────────────────────────────── */}
        {cards.length > 0 ? (
          <div style={{ border:"1px solid #e4e4e7", borderRadius:12, overflow:"hidden", background:"#fff", boxShadow:"0 1px 4px rgba(0,0,0,.05)" }} className="fade-up">
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ background:"#fafafa", borderBottom:"1px solid #f0f0f0" }}>
                  {["#","Kort","Kategori","Raritet","Din pris","Scryfall USD","≈ NOK","Avvik","Regelforslag","Ny pris",""].map((h,i)=>(
                    <th key={i} style={{ padding:"9px 12px", textAlign:"left", fontSize:9, color:"#a1a1aa", letterSpacing:".1em", fontWeight:600, whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayed.map((card, idx) => {
                  const isApproved = !!approved[card.id];
                  const hasChange  = card.sugNok !== null && Math.abs(card.diffPct||0) > 1;
                  return (
                    <tr key={card.id} className="trow" style={{ borderBottom:"1px solid #fafafa", background:isApproved?"rgba(22,163,74,.05)":"transparent" }}>
                      <td style={{ padding:"9px 12px", color:"#d4d4d8", fontSize:10, width:28 }}>{idx+1}</td>
                      <td style={{ padding:"9px 12px" }}>
                        <div
                          onMouseEnter={e=>card.sf_image&&setPreview({visible:true,src:card.sf_image,x:e.clientX,y:e.clientY})}
                          onMouseMove={e=>setPreview(p=>({...p,x:e.clientX,y:e.clientY}))}
                          onMouseLeave={()=>setPreview(p=>({...p,visible:false}))}
                          style={{ cursor:card.sf_image?"crosshair":"default" }}
                        >
                          <div style={{ color:"#18181b", fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight:500, whiteSpace:"nowrap" }}>{card.name}</div>
                          {card.sku && <div style={{ fontSize:9, color:"#d4d4d8", marginTop:1 }}>{card.sku}</div>}
                        </div>
                      </td>
                      <td style={{ padding:"9px 12px", color:"#71717a", fontSize:10, maxWidth:160 }}>
                        <span style={{ display:"block", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {card.category_name || (card.set_code||"").toUpperCase() || "—"}
                        </span>
                      </td>
                      <td style={{ padding:"9px 12px" }}><RarityBadge rarity={card.rarity} /></td>
                      <td style={{ padding:"9px 12px", color:"#52525b", fontFamily:"DM Mono,monospace" }}>{card.price_nok?`${card.price_nok} kr`:"—"}</td>
                      <td style={{ padding:"9px 12px", fontFamily:"DM Mono,monospace" }}>
                        {card.sf_usd>0 ? <span style={{ color:"#18181b" }}>${card.sf_usd.toFixed(2)}</span> : <span style={{ color:"#d4d4d8" }}>ingen data</span>}
                      </td>
                      <td style={{ padding:"9px 12px", color:"#71717a", fontSize:10, fontFamily:"DM Mono,monospace" }}>
                        {card.sf_usd>0 ? `${Math.round(card.sf_usd*cfg.usdNok)} kr` : "—"}
                      </td>
                      <td style={{ padding:"9px 12px" }}><DiffPill pct={card.diffPct} /></td>
                      <td style={{ padding:"9px 12px", fontFamily:"DM Mono,monospace" }}>
                        {card.sugNok ? <span style={{ color:hasChange?"#d97706":"#a1a1aa" }}>{card.sugNok} kr</span> : <span style={{ color:"#e4e4e7" }}>—</span>}
                      </td>
                      <td style={{ padding:"7px 10px" }}>
                        {card.sugNok!=null
                          ? <input type="number" value={newPrices[card.id]??card.sugNok}
                              onChange={e=>setNewPrices(p=>({...p,[card.id]:parseInt(e.target.value)||0}))}
                              style={{ width:66, background:"#f4f4f5", border:"1px solid #e4e4e7", borderRadius:6, padding:"4px 8px", color:"#18181b", fontSize:11 }} />
                          : <span style={{ color:"#e4e4e7" }}>—</span>}
                      </td>
                      <td style={{ padding:"9px 10px" }}>
                        {card.sugNok!=null && (
                          <button className="abtn" onClick={()=>setApproved(p=>({...p,[card.id]:!p[card.id]}))}
                            style={{ width:28, height:28, borderRadius:6, border:`1px solid ${isApproved?"#16a34a":"#e4e4e7"}`,
                              background:isApproved?"#dcfce7":"#f4f4f5", color:isApproved?"#16a34a":"#a1a1aa",
                              cursor:"pointer", fontSize:14, display:"flex", alignItems:"center", justifyContent:"center" }}>
                            {isApproved?"✓":"+"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {displayed.length===0 && (
              <div style={{ padding:48, textAlign:"center", color:"#a1a1aa", fontSize:12 }}>Ingen kort matcher valgt filter</div>
            )}
          </div>
        ) : !loading && (
          <div style={{ textAlign:"center", padding:"80px 0" }}>
            <div style={{ fontSize:40, marginBottom:12, opacity:.15 }}>⬡</div>
            <div style={{ fontSize:13, color:"#71717a" }}>
              {selectedCat ? "Trykk «Hent produkter» for å laste inn kortene" : "Velg en kategori ovenfor, deretter «Hent produkter»"}
            </div>
            {!configured && <div style={{ fontSize:11, color:"#a1a1aa", marginTop:6 }}>Eller koble til Mystore i ⚙ Innstillinger</div>}
          </div>
        )}

        {/* ── UPDATE LOG ───────────────────────────────────────────── */}
        {log.length>0 && (
          <div style={{ marginTop:14, background:"#f0fdf4", border:"1px solid #bbf7d0", borderRadius:10, padding:"14px 16px" }} className="fade-up">
            <div style={{ fontSize:9, color:"#16a34a", letterSpacing:".14em", marginBottom:10 }}>OPPDATERINGSLOGG</div>
            {log.map((l,i)=>(
              <div key={i} style={{ display:"flex", gap:12, fontSize:11, padding:"3px 0", alignItems:"center" }}>
                <span style={{ color:l.ok?"#16a34a":"#dc2626", width:12 }}>{l.ok?"✓":"✗"}</span>
                <span style={{ color:"#52525b", flex:1 }}>{l.name}</span>
                <span style={{ color:"#a1a1aa" }}>{l.old} kr</span>
                <span style={{ color:"#d4d4d8" }}>→</span>
                <span style={{ color:"#18181b", fontWeight:500 }}>{l.next} kr</span>
                {l.err && <span style={{ color:"#dc2626", fontSize:10 }}>{l.err}</span>}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
