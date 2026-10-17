// Manajemen Komplain per outlet: catat komplain pelanggan, pantau statusnya (sudah ditangani atau belum),
// dan lihat rekap masalah per outlet.
// Data: brands/{brandId}/complaints (satu dokumen per komplain) dan brands/{brandId}/complaint_outlets
// (daftar outlet yang didaftarkan supervisor) lewat store.listSub/saveSub/deleteSub.
// Mengikuti aturan Firestore brands/{brandId}/{sub} yang sudah ada, jadi tidak ada perubahan aturan.

import { h, icon, toast, dialog, confirmDialog, isLead } from "../ui.js";

const COL = "complaints";
const OUTLET_COL = "complaint_outlets";

export const STATUS = ["Belum ditangani", "Diproses", "Selesai"];
const STATUS_KIND = { "Belum ditangani": "bad", Diproses: "warn", Selesai: "ok" };
const PRIORITIES = ["Rendah", "Sedang", "Tinggi"];
const PRIORITY_KIND = { Rendah: "", Sedang: "warn", Tinggi: "bad" };
const CATEGORIES = [
  "Rasa & kualitas makanan", "Pelayanan staf", "Kebersihan", "Waktu tunggu", "Harga & promo",
  "Pesanan salah atau kurang", "Pengiriman (ojol)", "Fasilitas outlet", "Lainnya",
];
const CHANNELS = ["Langsung di outlet", "Google Maps", "Instagram", "WhatsApp", "GoFood / GrabFood / ShopeeFood", "Telepon", "Lainnya"];
const PERIODS = [["all", "Semua waktu"], ["30", "30 hari terakhir"], ["month", "Bulan ini"], ["lastmonth", "Bulan lalu"], ["quarter", "Kuartal ini"]];

const UI = { tab: "list", q: "", outlet: "", status: "", cat: "", period: "all" };

/* ---------- bantu ---------- */
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const parseYmd = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const dayDiff = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
const shortDay = (s) => (s ? parseYmd(s).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—");
const stamp = (iso) => { try { return new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const newId = () => `kp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const norm = (s) => String(s || "").trim().replace(/\s+/g, " ");
const same = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();
const isOpen = (c) => c.status !== "Selesai";
const chip = (txt, kind = "") => h("span", { class: "chip" + (kind ? " " + kind : "") }, txt);
const opts = (list, cur) => list.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h("option", { value: v, selected: v === cur }, l); });
const sel = (list, cur, attrs = {}) => h("select", { class: "select", ...attrs }, opts(list, cur));
const stat = (label, value, sub) => h("div", { class: "kstat" }, h("div", { class: "kv" }, value), h("div", { class: "kl" }, label), sub && h("div", { class: "ks" }, sub));
const pct = (v) => (v == null ? "—" : Math.round(v) + "%");
const days = (v) => (v == null ? "—" : v.toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " hari");

function rangeOf(key) {
  const t = todayStr(), d = new Date();
  if (key === "30") return [addDays(t, -29), t];
  if (key === "month") return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
  if (key === "lastmonth") return [ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), ymd(new Date(d.getFullYear(), d.getMonth(), 0))];
  if (key === "quarter") { const q = Math.floor(d.getMonth() / 3); return [ymd(new Date(d.getFullYear(), q * 3, 1)), ymd(new Date(d.getFullYear(), q * 3 + 3, 0))]; }
  return null;
}

function download(name, rows) {
  const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const a = h("a", { href: URL.createObjectURL(new Blob(["﻿" + rows.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv;charset=utf-8;" })), download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

// Ringkasan angka untuk sekumpulan komplain.
function summarize(list) {
  const done = list.filter((c) => c.status === "Selesai");
  const times = done.filter((c) => c.resolvedDate && c.date).map((c) => Math.max(0, dayDiff(c.date, c.resolvedDate)));
  const open = list.filter(isOpen);
  const oldest = open.length ? Math.max(...open.map((c) => Math.max(0, dayDiff(c.date, todayStr())))) : null;
  return {
    total: list.length,
    belum: list.filter((c) => c.status === "Belum ditangani").length,
    proses: list.filter((c) => c.status === "Diproses").length,
    selesai: done.length,
    rate: list.length ? (done.length / list.length) * 100 : null,
    avgDays: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
    oldest,
  };
}

async function loadPeople(ctx) {
  try {
    const users = (await ctx.store.listUsers()).filter((u) => u.active !== false);
    const ok = users.filter((u) => (u.brands || []).includes("*") || (u.brands || []).includes(ctx.brand.id));
    return ok.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  } catch { return [{ uid: ctx.user.uid, name: ctx.user.name }]; }
}

/* ====================================================================== */
export async function render(ctx) {
  const { store, brand, user } = ctx;
  const lead = isLead(user);
  const crumbs = [{ label: "Operation", href: "#/ops" }, { label: brand.name }, { label: "Komplain Outlet" }];
  if (!brand.id || brand.id === "-") {
    return { crumbs, node: h("div", { class: "empty" }, h("h3", {}, "Belum ada brand"), h("p", {}, "Tambahkan brand lebih dulu di Pengaturan > Brand.")) };
  }

  let items = [], outlets = [], people = [];
  const load = async () => { [items, outlets] = await Promise.all([store.listSub(brand.id, COL), store.listSub(brand.id, OUTLET_COL)]); };
  try { await load(); people = await loadPeople(ctx); } catch (e) {
    return { crumbs, node: h("div", { class: "notice warn" }, h("b", {}, "Data komplain gagal dimuat. "), e.message || String(e)) };
  }

  // Semua nama outlet yang dikenal: yang didaftarkan supervisor + yang sudah dipakai di komplain.
  const outletNames = () => {
    const out = [];
    for (const n of [...outlets.map((o) => o.name), ...items.map((c) => c.outlet)]) { const v = norm(n); if (v && !out.some((x) => same(x, v))) out.push(v); }
    return out.sort((a, b) => a.localeCompare(b, "id"));
  };
  if (UI.outlet && !outletNames().some((n) => same(n, UI.outlet))) UI.outlet = "";

  const guard = async (fn) => { try { await fn(); } catch (e) { toast(e.message || String(e), "err"); } };
  const reload = async () => { await load(); paint(); };
  const inPeriod = (c) => { const r = rangeOf(UI.period); return !r || (c.date >= r[0] && c.date <= r[1]); };

  const filtered = () => {
    const q = UI.q.toLowerCase();
    return items.filter((c) =>
      inPeriod(c)
      && (!UI.outlet || same(c.outlet, UI.outlet))
      && (!UI.status || c.status === UI.status)
      && (!UI.cat || c.category === UI.cat)
      && (!q || [c.outlet, c.problem, c.customer, c.category, c.action, c.pic?.name].some((x) => String(x || "").toLowerCase().includes(q))))
      .sort((a, b) => (isOpen(b) - isOpen(a)) || String(b.date).localeCompare(String(a.date)) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  };

  /* ---------- simpan perubahan ---------- */
  const save = async (rec) => { await store.saveSub(brand.id, COL, rec); await reload(); };

  async function changeStatus(c, to, action) {
    const at = new Date().toISOString();
    const rec = {
      ...c, status: to, log: [...(c.log || []), { at, by: user.name, text: `Status: ${c.status} → ${to}` }],
      resolvedAt: to === "Selesai" ? at : null, resolvedDate: to === "Selesai" ? todayStr() : null, resolvedBy: to === "Selesai" ? user.name : null,
    };
    if (action != null) rec.action = action;
    await save(rec);
  }

  /* ---------- formulir tambah / ubah ---------- */
  function openForm(existing, preset = {}) {
    const c = existing || { id: newId(), date: todayStr(), status: "Belum ditangani", priority: "Sedang", category: CATEGORIES[0], channel: CHANNELS[0], log: [] };
    const f = {};
    f.outlet = h("input", { class: "input", id: "kp-outlet", list: "kp-outlets", value: c.outlet || "", placeholder: "Pilih atau ketik nama outlet", autocomplete: "off" });
    const dl = h("datalist", { id: "kp-outlets" }, outletNames().map((n) => h("option", { value: n })));
    f.date = h("input", { class: "input", id: "kp-date", type: "date", value: c.date, max: todayStr() });
    f.priority = sel(PRIORITIES, c.priority || "Sedang", { id: "kp-prio" });
    f.category = sel(CATEGORIES, c.category, { id: "kp-cat" });
    f.channel = sel(CHANNELS, c.channel, { id: "kp-chan" });
    f.problem = h("textarea", { class: "textarea", id: "kp-prob", rows: 4, placeholder: "Apa yang dikeluhkan pelanggan? Tulis kronologi singkat." });
    f.problem.value = c.problem || "";
    f.customer = h("input", { class: "input", id: "kp-cust", value: c.customer || "", placeholder: "Opsional" });
    f.contact = h("input", { class: "input", id: "kp-contact", value: c.contact || "", placeholder: "No. WhatsApp atau akun, opsional" });
    const startStatus = preset.status || c.status;
    f.status = sel(STATUS, startStatus, { id: "kp-status" });
    f.pic = h("select", { class: "select", id: "kp-pic" }, h("option", { value: "" }, "Belum ditentukan"),
      people.map((p) => h("option", { value: p.uid, selected: p.uid === c.pic?.uid }, p.name)));
    f.action = h("textarea", { class: "textarea", id: "kp-act", rows: 3, placeholder: "Apa yang sudah atau akan dilakukan? Contoh: ganti menu, permintaan maaf, voucher kompensasi." });
    f.action.value = c.action || "";
    const actHint = h("div", { class: "hint" });
    const syncHint = () => { actHint.textContent = f.status.value === "Selesai" ? "Wajib diisi saat status Selesai." : "Isi bila sudah ada tindakan."; };
    f.status.addEventListener("change", syncHint); syncHint();

    const two = (a, b) => h("div", { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px" }, a, b);
    const field = (label, id, node, hint) => h("div", { class: "field" }, h("label", { for: id }, label), node, hint);
    const logs = (c.log || []).slice().reverse();
    const body = h("div", {},
      two(field("Outlet *", "kp-outlet", [f.outlet, dl]), field("Tanggal komplain *", "kp-date", f.date)),
      field("Masalah komplain *", "kp-prob", f.problem),
      two(field("Jenis masalah", "kp-cat", f.category), field("Tingkat", "kp-prio", f.priority)),
      two(field("Diterima lewat", "kp-chan", f.channel), field("Penanggung jawab", "kp-pic", f.pic)),
      two(field("Nama pelanggan", "kp-cust", f.customer), field("Kontak pelanggan", "kp-contact", f.contact)),
      field("Status", "kp-status", f.status),
      field("Penanganan / tindak lanjut", "kp-act", f.action, actHint),
      logs.length > 0 && h("div", { class: "field" }, h("span", { class: "lbl" }, "Riwayat"),
        h("ul", { class: "kp-log" }, logs.map((l) => h("li", {}, h("span", { class: "muted" }, `${stamp(l.at)} · ${l.by || "—"}`), " ", l.text)))));

    const actions = [{ label: "Batal" }];
    if (existing && lead) {
      actions.unshift({ label: "Hapus", kind: "danger", onClick: async () => {
        if (!(await confirmDialog("Hapus komplain ini? Ini tidak bisa dibatalkan.", "Ya, hapus"))) return false;
        await store.deleteSub(brand.id, COL, c.id); await reload(); toast("Komplain dihapus.");
      } });
    }
    actions.push({ label: existing ? "Simpan" : "Catat komplain", kind: "primary", onClick: async () => {
      const outlet = norm(f.outlet.value);
      const problem = f.problem.value.trim();
      if (!outlet) throw new Error("Outlet wajib diisi.");
      if (!f.date.value) throw new Error("Tanggal komplain wajib diisi.");
      if (!problem) throw new Error("Tulis masalah komplainnya.");
      const status = f.status.value;
      const action = f.action.value.trim();
      if (status === "Selesai" && !action) throw new Error("Isi penanganan sebelum menandai komplain Selesai.");
      const known = outletNames().find((n) => same(n, outlet)) || outlet; // samakan huruf besar-kecil dengan yang sudah ada
      const person = people.find((p) => p.uid === f.pic.value);
      const at = new Date().toISOString();
      const log = [...(c.log || [])];
      if (!existing) log.push({ at, by: user.name, text: "Komplain dicatat" });
      else if (c.status !== status) log.push({ at, by: user.name, text: `Status: ${c.status} → ${status}` });
      if (existing && (c.pic?.uid || "") !== (person?.uid || "")) log.push({ at, by: user.name, text: `Penanggung jawab: ${person?.name || "dikosongkan"}` });
      const rec = {
        ...c, outlet: known, date: f.date.value, problem, category: f.category.value, priority: f.priority.value, channel: f.channel.value,
        customer: norm(f.customer.value), contact: norm(f.contact.value), status, action, pic: person ? { uid: person.uid, name: person.name } : null,
        createdAt: c.createdAt || at, createdBy: c.createdBy || user.name, log,
        resolvedAt: status === "Selesai" ? (c.status === "Selesai" && c.resolvedAt ? c.resolvedAt : at) : null,
        resolvedDate: status === "Selesai" ? (c.status === "Selesai" && c.resolvedDate ? c.resolvedDate : todayStr()) : null,
        resolvedBy: status === "Selesai" ? (c.status === "Selesai" && c.resolvedBy ? c.resolvedBy : user.name) : null,
      };
      await save(rec);
      toast(existing ? "Komplain diperbarui." : "Komplain dicatat.");
    } });
    dialog({ title: existing ? "Ubah komplain" : "Catat komplain", body, actions, onClose: () => paint() });
  }

  /* ---------- kelola daftar outlet ---------- */
  function openOutlets() {
    const list = h("div", { class: "kp-outlet-list" });
    const input = h("input", { class: "input", id: "kp-newoutlet", placeholder: "Nama outlet, mis. Soora Sushi Club Tunjungan Plaza", autocomplete: "off" });
    const paintList = () => {
      const used = (n) => items.filter((c) => same(c.outlet, n)).length;
      list.replaceChildren(...(outlets.length
        ? outlets.slice().sort((a, b) => a.name.localeCompare(b.name, "id")).map((o) => h("div", { class: "kp-orow" },
          h("span", {}, o.name, " ", h("span", { class: "muted" }, `${used(o.name)} komplain`)),
          h("button", { class: "btn sm ghost", type: "button", "aria-label": `Hapus ${o.name} dari daftar`, onclick: () => guard(async () => {
            if (used(o.name) && !(await confirmDialog(`${o.name} sudah punya ${used(o.name)} komplain. Menghapusnya dari daftar tidak menghapus komplain itu. Lanjutkan?`, "Ya, hapus dari daftar"))) return;
            await store.deleteSub(brand.id, OUTLET_COL, o.id); await load(); paintList();
          }) }, icon("trash", 15))))
        : [h("p", { class: "muted" }, "Belum ada outlet terdaftar. Outlet juga otomatis muncul begitu ada komplain yang memakainya.")]));
    };
    const add = () => guard(async () => {
      const name = norm(input.value);
      if (!name) return;
      if (outlets.some((o) => same(o.name, name))) throw new Error("Outlet ini sudah ada di daftar.");
      await store.saveSub(brand.id, OUTLET_COL, { id: newId().replace("kp-", "ol-"), name });
      input.value = ""; await load(); paintList();
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    paintList();
    dialog({
      title: "Kelola outlet",
      body: h("div", {},
        h("p", { class: "muted", style: "margin-bottom:12px" }, `Daftar outlet ${brand.name}. Outlet yang terdaftar tetap tampil di rekap walau belum ada komplain.`),
        h("div", { class: "row-tight", style: "margin-bottom:12px" }, input, h("button", { class: "btn primary", type: "button", onclick: add }, icon("plus", 15), "Tambah")),
        list),
      actions: [{ label: "Selesai" }],
      onClose: () => paint(),
    });
  }

  /* ---------- tampilan ---------- */
  const summary = h("div");
  const toolbar = h("div", { class: "toolbar" });
  const out = h("div");
  const tabs = h("div", { class: "tabs", role: "tablist" });

  const statusCell = (c) => {
    const s = sel(STATUS, c.status, { class: "select inline", "aria-label": `Status komplain ${c.outlet}`, onchange: (e) => {
      const to = e.target.value;
      if (to === "Selesai") { openForm(c, { status: "Selesai" }); e.target.value = c.status; return; }
      guard(async () => { await changeStatus(c, to); toast("Status diperbarui."); });
    } });
    return h("div", {}, chip(c.status, STATUS_KIND[c.status]), h("div", { style: "margin-top:6px" }, s));
  };

  function paintList(list) {
    if (!items.length) {
      return h("div", { class: "empty" }, h("h3", {}, "Belum ada komplain"), h("p", {}, "Catat komplain pelanggan per outlet supaya statusnya bisa dipantau sampai selesai."),
        h("button", { class: "btn primary", type: "button", onclick: () => openForm() }, icon("plus", 16), "Catat komplain pertama"));
    }
    if (!list.length) return h("div", { class: "empty slim" }, h("p", {}, "Tidak ada komplain yang cocok dengan filter."));
    return h("div", { class: "tablewrap plain" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Tanggal", "Outlet", "Masalah", "Status", "PIC", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, list.map((c) => {
        const age = isOpen(c) ? Math.max(0, dayDiff(c.date, todayStr())) : null;
        const took = !isOpen(c) && c.resolvedDate ? Math.max(0, dayDiff(c.date, c.resolvedDate)) : null;
        return h("tr", {},
          h("td", { style: "white-space:nowrap" }, shortDay(c.date),
            h("div", { class: "muted" }, age != null
              ? h("span", { class: age >= 3 ? "kp-late" : "" }, age === 0 ? "Hari ini" : `${age} hari terbuka`)
              : (took === 0 ? "Selesai di hari yang sama" : `Selesai dalam ${took} hari`))),
          h("td", { class: "kp-out" }, h("button", { class: "linklike", type: "button", onclick: () => { UI.outlet = c.outlet; paint(); } }, c.outlet)),
          h("td", { class: "kp-prob" },
            h("div", { class: "row-tight" }, chip(c.priority || "Sedang", PRIORITY_KIND[c.priority]), chip(c.category || "Lainnya"), c.channel && h("span", { class: "muted" }, c.channel)),
            h("div", { class: "kp-text", title: c.problem }, c.problem),
            c.customer && h("div", { class: "muted" }, `Pelanggan: ${c.customer}${c.contact ? " · " + c.contact : ""}`),
            c.action && h("div", { class: "kp-act" }, h("b", {}, "Penanganan: "), c.action)),
          h("td", { class: "kp-st" }, statusCell(c)),
          h("td", {}, c.pic?.name || h("span", { class: "muted" }, "—")),
          h("td", { class: "act" }, h("button", { class: "btn sm", type: "button", onclick: () => openForm(c) }, icon("edit", 14), "Ubah")));
      }))));
  }

  function paintRecap(list) {
    const names = outletNames();
    const rows = names.map((n) => ({ n, s: summarize(list.filter((c) => same(c.outlet, n))) }))
      .sort((a, b) => ((b.s.belum + b.s.proses) - (a.s.belum + a.s.proses)) || (b.s.total - a.s.total) || a.n.localeCompare(b.n, "id"));
    const cats = CATEGORIES.map((k) => [k, list.filter((c) => (c.category || "Lainnya") === k).length]).filter((x) => x[1]).sort((a, b) => b[1] - a[1]);
    const maxCat = cats.length ? cats[0][1] : 1;
    if (!rows.length) return h("div", { class: "empty" }, h("h3", {}, "Belum ada data"), h("p", {}, "Rekap muncul setelah ada komplain atau outlet terdaftar."));
    return h("div", {},
      h("h3", { class: "kp-h" }, "Per outlet"),
      h("div", { class: "tablewrap plain" }, h("table", {},
        h("thead", {}, h("tr", {}, [["Outlet"], ["Total", 1], ["Belum ditangani", 1], ["Diproses", 1], ["Selesai", 1], ["% selesai"], ["Rata-rata selesai", 1], ["Terlama belum selesai", 1]].map(([t, n]) => h("th", { class: n ? "num" : "" }, t)))),
        h("tbody", {}, rows.map(({ n, s }) => h("tr", {},
          h("td", {}, h("button", { class: "linklike", type: "button", onclick: () => { UI.outlet = n; UI.tab = "list"; paint(); } }, n)),
          h("td", { class: "num" }, s.total),
          h("td", { class: "num" }, s.belum ? h("b", { class: "kp-late" }, s.belum) : 0),
          h("td", { class: "num" }, s.proses), h("td", { class: "num" }, s.selesai),
          h("td", { style: "min-width:120px" }, s.total ? h("div", { class: "row-tight", style: "flex-wrap:nowrap" }, h("div", { class: "bar", style: "flex:1;min-width:60px" }, h("i", { style: `width:${Math.round(s.rate)}%` })), h("span", {}, pct(s.rate))) : h("span", { class: "muted" }, "—")),
          h("td", { class: "num" }, days(s.avgDays)),
          h("td", { class: "num" }, s.oldest == null ? "—" : h("span", { class: s.oldest >= 3 ? "kp-late" : "" }, `${s.oldest} hari`))))))),
      h("h3", { class: "kp-h" }, "Masalah yang paling sering"),
      cats.length ? h("div", { class: "tablewrap plain" }, h("table", {},
        h("thead", {}, h("tr", {}, [["Jenis masalah"], ["Jumlah", 1], [""]].map(([t, n]) => h("th", { class: n ? "num" : "" }, t)))),
        h("tbody", {}, cats.map(([k, v]) => h("tr", {}, h("td", {}, k), h("td", { class: "num" }, v), h("td", { style: "min-width:140px" }, h("div", { class: "bar" }, h("i", { class: "kp-warnbar", style: `width:${Math.round((v / maxCat) * 100)}%` }))))))))
        : h("div", { class: "empty slim" }, h("p", {}, "Belum ada komplain pada periode ini.")));
  }

  function exportCsv() {
    const list = filtered();
    const r = [["Tanggal", "Outlet", "Jenis masalah", "Masalah", "Tingkat", "Diterima lewat", "Pelanggan", "Kontak", "Status", "Penanganan", "Penanggung jawab", "Tanggal selesai", "Dicatat oleh"]];
    list.forEach((c) => r.push([c.date, c.outlet, c.category, c.problem, c.priority, c.channel, c.customer, c.contact, c.status, c.action, c.pic?.name, c.resolvedDate, c.createdBy]));
    download(`komplain-${brand.id}-${todayStr()}.csv`, r);
  }

  function paint() {
    // Tab
    tabs.replaceChildren(...[["list", "Daftar komplain"], ["recap", "Rekap per outlet"]].map(([k, l]) =>
      h("button", { type: "button", role: "tab", "aria-selected": String(UI.tab === k), onclick: () => { UI.tab = k; paint(); } }, l)));
    // Filter
    const names = outletNames();
    const periodSel = sel(PERIODS, UI.period, { "aria-label": "Periode", onchange: (e) => { UI.period = e.target.value; paint(); } });
    if (UI.tab === "list") {
      const search = h("div", { class: "search" }, icon("search", 16),
        h("input", { class: "input", type: "search", placeholder: "Cari masalah, pelanggan, outlet…", value: UI.q, "aria-label": "Cari komplain", oninput: (e) => { UI.q = e.target.value; clearTimeout(paint.t); paint.t = setTimeout(() => paintBody(), 150); } }));
      toolbar.replaceChildren(search,
        sel([["", "Semua outlet"], ...names], UI.outlet, { "aria-label": "Outlet", onchange: (e) => { UI.outlet = e.target.value; paint(); } }),
        sel([["", "Semua status"], ...STATUS], UI.status, { "aria-label": "Status", onchange: (e) => { UI.status = e.target.value; paint(); } }),
        sel([["", "Semua jenis masalah"], ...CATEGORIES], UI.cat, { "aria-label": "Jenis masalah", onchange: (e) => { UI.cat = e.target.value; paint(); } }),
        periodSel);
    } else {
      toolbar.replaceChildren(periodSel);
    }
    paintBody();
  }

  function paintBody() {
    const base = UI.tab === "list" ? filtered() : items.filter(inPeriod);
    const s = summarize(base);
    summary.replaceChildren(h("div", { class: "kstats" },
      stat("Total komplain", s.total, UI.tab === "list" ? "sesuai filter" : "pada periode ini"),
      stat("Belum ditangani", s.belum, s.oldest != null && s.belum ? `terlama ${s.oldest} hari` : ""),
      stat("Diproses", s.proses),
      stat("Selesai", s.selesai, s.rate == null ? "" : `${pct(s.rate)} dari total`),
      stat("Rata-rata penyelesaian", days(s.avgDays), "dari tanggal komplain")));
    out.replaceChildren(UI.tab === "list" ? paintList(base) : paintRecap(base));
  }

  paint();

  return {
    crumbs,
    node: h("div", {},
      h("div", { class: "page-head" },
        h("div", { class: "grow" }, h("h1", {}, "Komplain Outlet"),
          h("p", { class: "lead" }, `Catat komplain pelanggan ${brand.name} per outlet, pantau sampai selesai, dan lihat masalah yang paling sering muncul.`)),
        h("div", { class: "actions" },
          lead && h("button", { class: "btn", type: "button", onclick: openOutlets }, "Kelola outlet"),
          h("button", { class: "btn", type: "button", onclick: exportCsv }, "Unduh CSV"),
          h("button", { class: "btn primary", type: "button", onclick: () => openForm() }, icon("plus", 16), "Catat komplain"))),
      tabs, summary, toolbar, out),
  };
}
