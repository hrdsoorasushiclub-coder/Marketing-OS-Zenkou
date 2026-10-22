// Report per brand: kuartal (Q1 sampai Q4) dan tahunan.
// Data Instagram ditarik lewat Netlify Function (netlify/functions/instagram.js) lalu disimpan sebagai
// snapshot per kuartal di brands/{id}/ig_reports, sehingga laporan lama tetap bisa dibuka tanpa memanggil API lagi.
// Realisasi konten dan KOL dibaca dari data Content Plan dan Media & KOL yang sudah ada.

import { h, icon, toast, fmtDate, dialog, confirmDialog } from "../ui.js";

const PERIODS = [["Q1", "Q1 (Jan–Mar)", 0, 2], ["Q2", "Q2 (Apr–Jun)", 3, 5], ["Q3", "Q3 (Jul–Sep)", 6, 8], ["Q4", "Q4 (Okt–Des)", 9, 11], ["ANNUAL", "Tahunan", 0, 11]];
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];
const TYPES = ["Feed Post", "Reels", "Carousel", "Story", "Video"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const pad = (n) => String(n).padStart(2, "0");
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const range = (y, key) => {
  const [, , m0, m1] = PERIODS.find((p) => p[0] === key);
  return { since: `${y}-${pad(m0 + 1)}-01`, until: `${y}-${pad(m1 + 1)}-${pad(new Date(y, m1 + 1, 0).getDate())}` };
};
const inRange = (d, r) => !!d && d >= r.since && d <= r.until;
const nf = new Intl.NumberFormat("id-ID");
const fmtNum = (v) => (v == null || !Number.isFinite(v) ? "—" : nf.format(Math.round(v)));
const fmtPct = (v) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("id-ID", { maximumFractionDigits: 2 }) + "%");
const fmtRp = (v) => (v ? "Rp " + nf.format(v) : "—");
const num = (v) => (typeof v === "number" ? v : 0);

const agg = (ps) => {
  const reach = ps.reduce((s, p) => s + num(p.reach), 0);
  const views = ps.reduce((s, p) => s + num(p.views), 0);
  const inter = ps.reduce((s, p) => s + (p.interactions ?? num(p.likes) + num(p.comments)), 0);
  return { count: ps.length, reach, views, inter, er: reach ? (inter / reach) * 100 : null };
};
const delta = (cur, prev) => (prev && prev > 0 && cur != null ? `${cur >= prev ? "+" : ""}${(((cur - prev) / prev) * 100).toLocaleString("id-ID", { maximumFractionDigits: 0 })}% vs periode lalu` : "");
const stat = (label, value, sub) => h("div", { class: "kstat" }, h("div", { class: "kv" }, value), h("div", { class: "kl" }, label), sub && h("div", { class: "ks" }, sub));
const section = (title, ...kids) => h("div", { style: "margin-top:26px" }, h("h3", { style: "font-size:17px;margin-bottom:10px" }, title), ...kids);
const table = (heads, rows) => h("div", { class: "tablewrap plain" }, h("table", {},
  h("thead", {}, h("tr", {}, heads.map(([t, isNum]) => h("th", { class: isNum ? "num" : "" }, t)))),
  h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c, i) => h("td", { class: heads[i][1] ? "num" : "" }, c)))))));
const safeHref = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; } };

/* ---------- grafik (SVG dan batang CSS, tanpa library; ikut tema gelap dan tercetak di PDF) ---------- */
const PX = "print-color-adjust:exact;-webkit-print-color-adjust:exact;";
const compact = (v) => new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(v);
const sv = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  kids.flat().forEach((k) => { if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); });
  return e;
};
const legend = (series) => h("div", { class: "row-tight", style: "margin-bottom:6px;font-size:13px" }, series.map((s) =>
  h("span", { style: "display:inline-flex;align-items:center;gap:6px" }, h("i", { style: `width:12px;height:12px;border-radius:3px;background:${s.color};display:inline-block;` + PX }), s.name)));
// Batang horizontal: rows = [{label, value, text, color?, title?}]
const hbars = (rows, color) => {
  const max = Math.max(1, ...rows.map((r) => r.value || 0));
  return h("div", { style: PX + "margin-top:4px" }, rows.map((r) => h("div", { style: "display:grid;grid-template-columns:minmax(80px,220px) 1fr auto;gap:10px;align-items:center;margin:7px 0;font-size:13.5px" },
    h("div", { style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap", title: r.title || "" }, r.label),
    h("div", { style: "height:12px;border-radius:999px;background:var(--line-2);overflow:hidden;" + PX },
      h("i", { style: `display:block;height:100%;width:${(r.value || 0) > 0 ? Math.max(2, Math.round(((r.value || 0) / max) * 100)) : 0}%;background:${r.color || color || "var(--brand)"};border-radius:999px;` + PX })),
    h("div", { style: "font-weight:700;white-space:nowrap" }, r.text))));
};
// Batang vertikal berkelompok: groups = [{label, vals:[...]}], series = [{name, color}]
const vbars = (groups, series) => {
  const n = groups.length, gw = Math.max(64, Math.min(110, 640 / n)), L = 46, W = L + n * gw + 10, H = 230, T = 16, B = 28, ph = H - T - B;
  const max = Math.max(1, ...groups.flatMap((g) => g.vals)), bw = Math.min(26, (gw - 14) / series.length);
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": "Grafik batang per bulan", style: "max-width:100%;height:auto;font-family:inherit" });
  [0, 0.5, 1].forEach((t) => {
    const y = T + ph - t * ph;
    svg.append(sv("line", { x1: L, x2: W - 6, y1: y, y2: y, style: "stroke:var(--line);stroke-width:1" }), sv("text", { x: L - 6, y: y + 4, "text-anchor": "end", style: "font-size:11px;fill:var(--ink-3)" }, compact(max * t)));
  });
  groups.forEach((g, i) => {
    const gx = L + i * gw + (gw - bw * series.length) / 2;
    g.vals.forEach((v, j) => {
      const bh = Math.round((v / max) * ph), x = gx + j * bw;
      svg.append(sv("rect", { x, y: T + ph - bh, width: bw - 3, height: Math.max(bh, v > 0 ? 1 : 0), rx: 3, style: `fill:${series[j].color}` }),
        sv("text", { x: x + (bw - 3) / 2, y: T + ph - bh - 4, "text-anchor": "middle", style: "font-size:10.5px;fill:var(--ink-2)" }, v ? compact(v) : ""));
    });
    svg.append(sv("text", { x: L + i * gw + gw / 2, y: H - 8, "text-anchor": "middle", style: "font-size:12px;fill:var(--ink-2)" }, g.label));
  });
  return h("div", { style: "overflow-x:auto" }, legend(series), svg);
};
// Garis: pts = [{date, v}]
const lineChart = (pts) => {
  const W = 640, H = 210, L = 56, R = 16, T = 16, B = 30, ph = H - T - B, pw = W - L - R;
  const vs = pts.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const X = (i) => L + (pts.length === 1 ? 0 : (i / (pts.length - 1)) * pw), Y = (v) => T + ph - ((v - lo) / span) * ph;
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": "Grafik pertumbuhan followers", style: "max-width:100%;height:auto;font-family:inherit" });
  [lo, lo + span / 2, hi].forEach((v) => svg.append(sv("line", { x1: L, x2: W - R, y1: Y(v), y2: Y(v), style: "stroke:var(--line);stroke-width:1" }), sv("text", { x: L - 6, y: Y(v) + 4, "text-anchor": "end", style: "font-size:11px;fill:var(--ink-3)" }, nf.format(Math.round(v)))));
  svg.append(sv("polyline", { points: pts.map((p, i) => `${X(i)},${Y(p.v)}`).join(" "), style: "fill:none;stroke:var(--brand);stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round" }));
  pts.forEach((p, i) => svg.append(sv("circle", { cx: X(i), cy: Y(p.v), r: 3.5, style: "fill:var(--brand)" })));
  svg.append(sv("text", { x: L, y: H - 8, "text-anchor": "start", style: "font-size:12px;fill:var(--ink-2)" }, pts[0].date),
    sv("text", { x: W - R, y: H - 8, "text-anchor": "end", style: "font-size:12px;fill:var(--ink-2)" }, pts.at(-1).date));
  return h("div", { style: "overflow-x:auto" }, svg);
};

export async function render(ctx) {
  const { store, brand } = ctx;
  const crumbs = [{ label: "Operation", href: "#/ops" }, { label: brand.name }, { label: "Report" }];
  if (!brand.id || brand.id === "-") return { crumbs, node: h("div", { class: "empty" }, h("h3", {}, "Belum ada brand"), h("p", {}, "Tambahkan brand lebih dulu di Pengaturan > Brand.")) };

  let [content, kols, snaps, follows] = await Promise.all([
    store.listContent(brand.id), store.listSub(brand.id, "kol_campaigns"), store.listSub(brand.id, "ig_reports"), store.listSub(brand.id, "ig_followers"),
  ]);
  const nowD = new Date();
  const S = { y: nowD.getFullYear(), key: "Q" + (Math.floor(nowD.getMonth() / 3) + 1), busy: false };
  const body = h("div");
  const snapMap = () => new Map(snaps.map((s) => [s.id, s]));

  // Snapshot untuk satu periode: kuartal = 1 dokumen, tahunan = gabungan kuartal yang sudah ditarik.
  const docsFor = (y, key) => { const m = snapMap(); return (key === "ANNUAL" ? QUARTERS : [key]).flatMap((q) => [m.get(`${y}-${q}`), m.get(`${y}-${q}-manual`)]).filter(Boolean); };
  const postsOf = (docs) => { const seen = new Map(); docs.forEach((d) => (d.posts || []).forEach((p) => seen.set(p.id, p))); return [...seen.values()]; };
  const prevOf = (y, key) => {
    if (key === "ANNUAL") return [y - 1, "ANNUAL"];
    const i = QUARTERS.indexOf(key);
    return i === 0 ? [y - 1, "Q4"] : [y, QUARTERS[i - 1]];
  };

  /* ---------- tarik data Instagram ---------- */
  async function sync() {
    if (S.busy) return;
    const token = await store.getToken();
    if (!token) throw new Error("Tarik data Instagram hanya tersedia saat OS terhubung ke Firebase (bukan mode demo).");
    const keys = (S.key === "ANNUAL" ? QUARTERS : [S.key]).filter((q) => range(S.y, q).since <= today());
    if (!keys.length) throw new Error("Periode ini belum dimulai.");
    S.busy = true; draw();
    try {
      for (const k of keys) {
        const r = range(S.y, k);
        const res = await fetch("/.netlify/functions/instagram", {
          method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ brandId: brand.id, since: r.since, until: r.until < today() ? r.until : today() }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || (res.status === 404 ? "Fungsi Instagram belum aktif di hosting ini. Deploy lewat Git atau Netlify CLI supaya folder netlify/functions ikut terpasang." : `Gagal menarik data (${res.status}).`));
        const doc = { id: `${S.y}-${k}`, year: S.y, period: k, since: r.since, until: r.until, syncedAt: new Date().toISOString(), username: j.profile.username, followers: j.profile.followers, mediaCount: j.profile.mediaCount, posts: j.posts, truncated: !!j.truncated };
        await store.saveSub(brand.id, "ig_reports", doc);
        await store.saveSub(brand.id, "ig_followers", { id: today(), date: today(), followers: j.profile.followers });
        snaps = [...snaps.filter((s) => s.id !== doc.id), doc];
        follows = [...follows.filter((f) => f.id !== today()), { id: today(), date: today(), followers: j.profile.followers }];
      }
      toast(`Data Instagram ${keys.join(", ")} ${S.y} tersimpan.`);
    } finally { S.busy = false; draw(); }
  }

  /* ---------- input manual ---------- */
  const qOf = (date) => `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
  const erOf = (p) => (p.reach ? ((p.interactions ?? num(p.likes) + num(p.comments)) / p.reach) * 100 : null);

  async function removeManual(post) {
    const id = `${qOf(post.date)}-manual`;
    const cur = snaps.find((s) => s.id === id);
    if (!cur) return;
    const rest = (cur.posts || []).filter((x) => x.id !== post.id);
    if (!rest.length) { await store.deleteSub(brand.id, "ig_reports", id); snaps = snaps.filter((s) => s.id !== id); return; }
    const doc = { ...cur, posts: rest, syncedAt: new Date().toISOString() };
    await store.saveSub(brand.id, "ig_reports", doc);
    snaps = [...snaps.filter((s) => s.id !== id), doc];
  }

  async function saveManual(post, old) {
    if (old) await removeManual(old);
    const [y, q] = qOf(post.date).split("-");
    const id = `${y}-${q}-manual`;
    const cur = snaps.find((s) => s.id === id);
    const doc = { id, year: Number(y), period: q, manual: true, syncedAt: new Date().toISOString(), posts: [...(cur?.posts || []).filter((x) => x.id !== post.id), post] };
    await store.saveSub(brand.id, "ig_reports", doc);
    snaps = [...snaps.filter((s) => s.id !== id), doc];
    if (S.key !== "ANNUAL") S.key = q;
    S.y = Number(y);
  }

  function openManual(ex, pre) {
    const src = ex || pre || {};
    const n = (v) => (v === "" || v == null ? null : Math.max(0, Number(v) || 0));
    const f = {};
    const inp = (k, label, attrs = {}) => { f[k] = h("input", { class: "input", ...attrs, oninput: () => upd() }); return h("div", { class: "field" }, h("label", {}, label), f[k]); };
    const erBox = h("div", { class: "notice", style: "margin-bottom:6px" });
    const upd = () => {
      const reach = n(f.reach.value);
      const it = ["likes", "comments", "saved", "shares"].reduce((t, k) => t + (n(f[k].value) || 0), 0);
      erBox.replaceChildren(h("b", {}, "ER: "), reach ? fmtPct((it / reach) * 100) : "isi Reach dulu", ` · interaksi ${fmtNum(it)} (like + komentar + save + share)`);
    };
    const typeSel = h("select", { class: "select" }, TYPES.map((t) => h("option", { value: t, selected: t === (src.type || "Feed Post") }, t)));
    const grid = (...k) => h("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:0 12px" }, ...k);
    const body = h("div", {},
      grid(inp("date", "Tanggal tayang", { type: "date", value: src.date || today() }), h("div", { class: "field" }, h("label", {}, "Tipe konten"), typeSel)),
      inp("caption", "Judul / caption singkat", { type: "text", value: src.caption || "", maxlength: 140 }),
      inp("link", "Link konten (opsional)", { type: "url", value: src.permalink || "", placeholder: "https://www.instagram.com/p/..." }),
      grid(inp("reach", "Reach", { type: "number", min: 0, value: ex?.reach ?? "" }), inp("views", "Views (opsional)", { type: "number", min: 0, value: ex?.views ?? "" }),
        inp("likes", "Likes", { type: "number", min: 0, value: ex?.likes ?? "" }), inp("comments", "Komentar", { type: "number", min: 0, value: ex?.comments ?? "" }),
        inp("saved", "Save", { type: "number", min: 0, value: ex?.saved ?? "" }), inp("shares", "Share", { type: "number", min: 0, value: ex?.shares ?? "" })),
      inp("followers", "Followers akun pada tanggal ini (opsional)", { type: "number", min: 0, value: "" }),
      erBox);
    upd();
    dialog({
      title: ex ? "Ubah konten" : pre ? "Input insight konten" : "Input konten manual", body,
      actions: [{ label: "Batal" }, { label: "Simpan", kind: "primary", onClick: async () => {
        const date = f.date.value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Tanggal wajib diisi.");
        const reach = n(f.reach.value);
        if (reach == null) throw new Error("Reach wajib diisi supaya ER bisa dihitung.");
        const likes = n(f.likes.value) || 0, comments = n(f.comments.value) || 0, saved = n(f.saved.value) || 0, shares = n(f.shares.value) || 0;
        const post = { id: ex?.id || "m-" + Date.now().toString(36), manual: true, cid: ex?.cid || pre?.cid || null, date, type: typeSel.value, permalink: f.link.value.trim(), caption: f.caption.value.trim().slice(0, 140),
          reach, views: n(f.views.value), likes, comments, saved, shares, interactions: likes + comments + saved + shares };
        await saveManual(post, ex);
        const fol = n(f.followers.value);
        if (fol != null) {
          await store.saveSub(brand.id, "ig_followers", { id: date, date, followers: fol });
          follows = [...follows.filter((x) => x.id !== date), { id: date, date, followers: fol }];
        }
        toast("Konten tersimpan.");
        draw();
      } }],
    });
  }

  async function delManual(post) {
    if (!(await confirmDialog("Hapus konten ini dari report?", "Hapus"))) return;
    await removeManual(post);
    toast("Konten dihapus.");
    draw();
  }

  function exportCsv(posts) {
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""').replace(/\s+/g, " ")}"`;
    const lines = [["Tanggal", "Tipe", "Link", "Reach", "Views", "Likes", "Komentar", "Save", "Share", "Interaksi", "Caption"].join(",")]
      .concat(posts.slice().sort((a, b) => a.date.localeCompare(b.date)).map((p) => [p.date, p.type, p.permalink, p.reach, p.views, p.likes, p.comments, p.saved, p.shares, p.interactions, p.caption].map(q).join(",")));
    const a = h("a", { href: URL.createObjectURL(new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" })), download: `report-${brand.id}-${S.y}-${S.key}.csv` });
    document.body.append(a); a.click(); a.remove();
  }

  /* ---------- tampilan ---------- */
  function draw() {
    const r = range(S.y, S.key);
    const label = PERIODS.find((p) => p[0] === S.key)[1];
    const docs = docsFor(S.y, S.key);
    const posts = postsOf(docs);
    const A = agg(posts);
    const [py, pk] = prevOf(S.y, S.key);
    const prevDocs = docsFor(py, pk);
    const P = prevDocs.length ? agg(postsOf(prevDocs)) : null;
    const missing = S.key === "ANNUAL" ? QUARTERS.filter((q) => range(S.y, q).since <= today() && !docs.some((d) => d.period === q)) : [];

    const fl = follows.filter((f) => inRange(f.date, r)).sort((a, b) => a.date.localeCompare(b.date));
    const lastFollowers = fl.length ? fl.at(-1).followers : [...docs].reverse().find((d) => d.followers != null)?.followers;
    const growth = fl.length > 1 ? fl.at(-1).followers - fl[0].followers : null;

    const plan = content.filter((c) => inRange(c.date, r));
    const published = plan.filter((c) => c.status === "Published");
    const byPillar = {};
    plan.forEach((c) => { const k = c.pillar || "Tanpa pillar"; (byPillar[k] ||= { total: 0, pub: 0 }).total++; if (c.status === "Published") byPillar[k].pub++; });
    const linked = new Set(snaps.flatMap((x) => x.posts || []).map((x) => x.cid).filter(Boolean));
    const toPostType = (t) => (TYPES.includes(t) ? t : "Feed Post");
    const pending = published.filter((c) => (c.platforms || []).includes("Instagram") && !linked.has(c.id)).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const pendBlock = section("Konten Published, insight belum diisi",
      h("p", { class: "muted", style: "margin-bottom:10px" }, `${pending.length} konten sudah Published tapi belum punya data insight. Klik "Input insight", isi angkanya, lalu konten masuk ke report.`),
      table([["Tanggal"], ["Konten"], [""]], pending.map((c) => [fmtDate(c.date), c.title || "(tanpa judul)",
        h("div", { class: "no-print" }, h("button", { class: "btn sm primary", type: "button", onclick: () => openManual(null, {
          cid: c.id, date: c.date || today(), type: toPostType(c.type), caption: c.title || "",
          permalink: /instagram\.com/.test(c.postLink || "") ? c.postLink : "" }) }, "Input insight"))])));
    const kolRows = kols.filter((k) => inRange(k.postedAt, r));
    const kolViews = kolRows.reduce((s, k) => s + num(k.views), 0);
    const kolSpend = kolRows.filter((k) => k.type === "paid").reduce((s, k) => s + num(k.price), 0);

    const byType = {};
    posts.forEach((p) => (byType[p.type] ||= []).push(p));
    const byMonth = {};
    posts.forEach((p) => (byMonth[p.date.slice(0, 7)] ||= []).push(p));

    const tabs = h("div", { class: "tabs", role: "tablist" }, PERIODS.map(([k, t]) =>
      h("button", { type: "button", role: "tab", "aria-selected": String(S.key === k), onclick: () => { S.key = k; draw(); } }, t)));
    const years = [nowD.getFullYear(), nowD.getFullYear() - 1, nowD.getFullYear() - 2];
    const yearSel = h("select", { class: "select", "aria-label": "Tahun", style: "width:auto", onchange: (e) => { S.y = Number(e.target.value); draw(); } },
      years.map((y) => h("option", { value: y, selected: y === S.y }, y)));

    S.rank ||= "er";
    const prevLabel = P ? `${PERIODS.find((x) => x[0] === pk)[1]} ${py}` : "";
    const rankRows = posts.filter((p) => (S.rank === "er" ? erOf(p) != null : p.reach != null)).sort((a, b) => (S.rank === "er" ? erOf(b) - erOf(a) : (b.reach || 0) - (a.reach || 0))).slice(0, 10).map((p) => ({
      label: safeHref(p.permalink) ? h("a", { href: safeHref(p.permalink), target: "_blank", rel: "noopener" }, p.caption || "(tanpa caption)") : (p.caption || "(tanpa caption)"), title: p.caption || "",
      value: S.rank === "er" ? erOf(p) : p.reach, text: S.rank === "er" ? `${fmtPct(erOf(p))} · reach ${fmtNum(p.reach)}` : `${fmtNum(p.reach)} · ER ${fmtPct(erOf(p))}` }));
    const cmp = P ? [["Konten tayang", A.count, P.count, fmtNum], ["Total reach", A.reach, P.reach, fmtNum], ["Total views", A.views, P.views, fmtNum], ["Interaksi", A.inter, P.inter, fmtNum], ["ER", A.er, P.er, fmtPct]] : [];
    const charts = !posts.length ? [] : [
      section("Reach & interaksi per bulan", vbars(Object.keys(byMonth).sort().map((m) => { const a = agg(byMonth[m]); return { label: String(MONTHS[Number(m.slice(5)) - 1]).slice(0, 3) + " " + m.slice(2, 4), vals: [a.reach || 0, a.inter || 0] }; }),
        [{ name: "Reach", color: "var(--brand)" }, { name: "Interaksi", color: "var(--ok)" }])),
      section("ER per tipe konten", hbars(Object.entries(byType).map(([t, ps]) => { const a = agg(ps); return { label: t, value: a.er || 0, text: `${fmtPct(a.er)} · ${a.count} konten` }; }).sort((a, b) => b.value - a.value))),
      P && section(`Perbandingan dengan ${prevLabel}`, h("div", {}, legend([{ name: `${label} ${S.y}`, color: "var(--brand)" }, { name: prevLabel, color: "var(--ink-3)" }]),
        cmp.map(([t, a, b, f]) => h("div", { style: "margin:12px 0" }, h("div", { style: "font-weight:700;font-size:13.5px" }, t, " ", h("span", { class: "muted", style: "font-weight:400" }, t === "ER" ? "" : delta(a, b))),
          hbars([{ label: `${label} ${S.y}`, value: a || 0, text: f(a) }, { label: prevLabel, value: b || 0, text: f(b), color: "var(--ink-3)" }]))))),
      section("Peringkat konten", h("div", {}, h("div", { class: "row-tight no-print", style: "margin-bottom:8px" },
        [["er", "Berdasarkan ER"], ["reach", "Berdasarkan reach"]].map(([k, t]) => h("button", { class: "btn sm" + (S.rank === k ? " primary" : ""), type: "button", "aria-pressed": String(S.rank === k), onclick: () => { S.rank = k; draw(); } }, t))),
        rankRows.length ? hbars(rankRows) : h("p", { class: "muted" }, "Belum ada data untuk diurutkan."))),
      section("Pertumbuhan followers", fl.length >= 2 ? lineChart(fl.map((f) => ({ date: f.date, v: f.followers }))) : h("p", { class: "muted" }, "Grafik muncul setelah ada minimal 2 data followers di periode ini. Isi kolom Followers saat input insight, atau tarik data Instagram.")),
    ];

    const igBlock = !posts.length
      ? h("div", { class: "empty slim" }, h("p", {}, store.mode === "firebase"
          ? `Belum ada data Instagram untuk ${label} ${S.y}. Klik "Input konten manual" untuk mengisi sendiri (ER langsung terhitung), atau "Tarik data Instagram" bila API sudah terpasang.`
          : "Belum ada konten di periode ini. Klik \"Input konten manual\" untuk mengisi sendiri; ER langsung terhitung."))
      : h("div", {},
          missing.length > 0 && h("div", { class: "notice warn", style: "margin-bottom:14px" }, h("b", {}, "Laporan tahunan belum lengkap. "), `Kuartal ${missing.join(", ")} belum ditarik. Klik "Tarik data Instagram" untuk melengkapinya.`),
          docs.some((d) => d.truncated) && h("div", { class: "notice warn", style: "margin-bottom:14px" }, "Jumlah konten melebihi batas tarik (150 per kuartal), jadi sebagian konten tertua tidak ikut terhitung."),
          h("div", { class: "kstats" },
            stat("Konten tayang", fmtNum(A.count), delta(A.count, P?.count)),
            stat("Total reach", fmtNum(A.reach), delta(A.reach, P?.reach) || "jumlah reach tiap konten"),
            stat("Total views", fmtNum(A.views), delta(A.views, P?.views)),
            stat("Interaksi", fmtNum(A.inter), delta(A.inter, P?.inter) || "like, komentar, save, share"),
            stat("ER (interaksi / reach)", fmtPct(A.er), P?.er != null ? `periode lalu ${fmtPct(P.er)}` : ""),
            stat("Followers", fmtNum(lastFollowers), growth != null ? `${growth >= 0 ? "+" : ""}${fmtNum(growth)} selama periode` : "pertumbuhan terhitung setelah ≥2 kali tarik data")),
          ...charts,
          section("Per tipe konten", table([["Tipe"], ["Jumlah", 1], ["Rata-rata reach", 1], ["Interaksi", 1], ["ER", 1]],
            Object.entries(byType).map(([t, ps]) => { const a = agg(ps); return [t, fmtNum(a.count), fmtNum(a.count ? a.reach / a.count : null), fmtNum(a.inter), fmtPct(a.er)]; }))),
          section("Per bulan", table([["Bulan"], ["Konten", 1], ["Reach", 1], ["Views", 1], ["Interaksi", 1]],
            Object.keys(byMonth).sort().map((m) => { const a = agg(byMonth[m]); return [`${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`, fmtNum(a.count), fmtNum(a.reach), fmtNum(a.views), fmtNum(a.inter)]; }))),
          section("5 konten terbaik (berdasarkan interaksi)", table([["Tanggal"], ["Tipe"], ["Konten"], ["Reach", 1], ["Interaksi", 1]],
            posts.slice().sort((a, b) => (b.interactions ?? 0) - (a.interactions ?? 0)).slice(0, 5).map((p) => [
              fmtDate(p.date), p.type, safeHref(p.permalink) ? h("a", { href: safeHref(p.permalink), target: "_blank", rel: "noopener" }, p.caption || "(tanpa caption)") : (p.caption || "—"),
              fmtNum(p.reach), fmtNum(p.interactions ?? num(p.likes) + num(p.comments))]))));

    const listBlock = section("Semua konten (dengan ER per konten)", table([[ "Tanggal" ], [ "Tipe" ], [ "Konten" ], [ "Reach", 1 ], [ "Interaksi", 1 ], [ "ER", 1 ], [ "" ]],
      posts.slice().sort((a, b) => b.date.localeCompare(a.date)).map((p) => [
        fmtDate(p.date), p.type, safeHref(p.permalink) ? h("a", { href: safeHref(p.permalink), target: "_blank", rel: "noopener" }, p.caption || "(tanpa caption)") : (p.caption || "—"),
        fmtNum(p.reach), fmtNum(p.interactions ?? num(p.likes) + num(p.comments)), fmtPct(erOf(p)),
        p.manual ? h("div", { class: "row-tight no-print" }, h("button", { class: "btn sm", type: "button", onclick: () => openManual(p) }, "Ubah"), h("button", { class: "btn sm danger", type: "button", onclick: () => delManual(p).catch((e) => toast(e.message || String(e), "err")) }, "Hapus")) : ""])));

    const planBlock = !plan.length
      ? h("div", { class: "empty slim" }, h("p", {}, "Belum ada konten terjadwal di Content Plan untuk periode ini."))
      : h("div", {},
          h("div", { class: "kstats" }, stat("Konten terencana", fmtNum(plan.length)), stat("Sudah Published", fmtNum(published.length), fmtPct((published.length / plan.length) * 100) + " dari rencana")),
          table([["Pillar"], ["Terencana", 1], ["Published", 1], ["Realisasi"]], Object.entries(byPillar).sort((a, b) => b[1].total - a[1].total).map(([k, v]) =>
            [k, fmtNum(v.total), fmtNum(v.pub), h("div", { class: "bar", style: "min-width:90px" }, h("i", { style: `width:${Math.round((v.pub / v.total) * 100)}%` }))])));

    const kolBlock = !kolRows.length
      ? h("div", { class: "empty slim" }, h("p", {}, "Belum ada hasil posting KOL dengan tanggal tayang di periode ini."))
      : h("div", { class: "kstats" }, stat("KOL tayang", fmtNum(kolRows.length)), stat("Views KOL", fmtNum(kolViews)), stat("Biaya paid", fmtRp(kolSpend)));

    const apiDocs = docs.filter((d) => !d.manual);
    const synced = apiDocs.length ? Math.max(...apiDocs.map((d) => +new Date(d.syncedAt))) : null;
    body.replaceChildren(
      h("div", { class: "row-tight no-print", style: "margin-bottom:6px" }, yearSel, tabs),
      h("h2", { style: "font-size:22px;margin:6px 0 4px" }, `Report ${label} ${S.y}`),
      h("p", { class: "muted", style: "margin-bottom:16px" }, `${brand.name}${apiDocs[0]?.username ? " · @" + apiDocs[0].username : ""}${synced ? " · data Instagram terakhir ditarik " + fmtDate(new Date(synced).toISOString()) : ""}`),
      ...(pending.length ? [pendBlock] : []), section("Instagram", igBlock), ...(posts.length > 0 ? [listBlock] : []), section("Realisasi Content Plan", planBlock), section("Media & KOL", kolBlock));
    actions.replaceChildren(
      h("button", { class: "btn primary", type: "button", onclick: () => openManual() }, icon("arrow", 16), "Input konten manual"),
      h("button", { class: "btn", type: "button", disabled: S.busy, onclick: () => sync().catch((e) => toast(e.message || String(e), "err")) }, S.busy ? "Menarik data…" : "Tarik data Instagram"),
      h("button", { class: "btn", type: "button", disabled: !posts.length, onclick: () => exportCsv(posts) }, icon("copy", 16), "Unduh CSV"),
      h("button", { class: "btn", type: "button", onclick: () => window.print() }, "Cetak / PDF"));
  }

  const actions = h("div", { class: "actions no-print" });
  const node = h("div", {},
    h("div", { class: "page-head" },
      h("div", { class: "grow" }, h("h1", {}, "Report"), h("p", { class: "lead" }, "Laporan performa per kuartal dan tahunan. Angka Instagram diambil langsung dari akun brand lewat API, lalu digabung dengan realisasi Content Plan dan KOL.")),
      actions),
    body);
  draw();
  return { crumbs, node };
}
