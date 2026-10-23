// Dokumen RAB siap cetak: tabel rincian biaya, tabel rekening tujuan, dan kolom tanda tangan.
// - printRab(): cetak lewat dialog cetak browser (bisa juga "Simpan sebagai PDF").
// - downloadRabPdf(): membuat file PDF langsung (tanpa library), A4 portrait.

const nf = new Intl.NumberFormat("id-ID");
const rp = (n) => "Rp " + nf.format(Math.round(n || 0));
const dec = (v) => { const x = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(x) ? x : 0; };
const fmtD = (s) => { if (!s) return "-"; const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }); };
const SIGN_ROLES = [["diajukan", "Diajukan oleh"], ["diketahui", "Diketahui oleh"], ["disetujui", "Disetujui oleh"]];

export function rabModel(r, brand) {
  const items = (r.items || []).map((i) => ({ name: i.name || "", qty: dec(i.qty) || 1, unit: i.unit || "", price: i.price || 0, sub: (dec(i.qty) || 1) * (i.price || 0) }));
  const payees = (r.payees || []).map((p) => ({ name: p.name || "", bank: p.bank || "", account: p.account || "", amount: p.amount || 0, note: p.note || "" }));
  return {
    brand: brand?.name || "", title: r.title || "(tanpa judul)", date: fmtD(r.date), status: r.status || "", purpose: r.purpose || "", notes: r.notes || "",
    items, total: items.reduce((s, i) => s + i.sub, 0), payees, payTotal: payees.reduce((s, p) => s + (p.amount || 0), 0),
    signers: SIGN_ROLES.map(([k, label]) => ({ label, name: r.signers?.[k]?.name || "", title: r.signers?.[k]?.title || "" })),
  };
}
const slug = (s) => String(s || "rab").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "rab";

/* ====================== CETAK (HTML) ====================== */
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function rabHtml(d) {
  const blank = (n) => Array.from({ length: n }, () => `<tr>${"<td>&nbsp;</td>".repeat(6)}</tr>`).join("");
  const payRows = d.payees.length
    ? d.payees.map((p, i) => `<tr><td class="c">${i + 1}</td><td>${esc(p.name)}</td><td>${esc(p.bank)}</td><td>${esc(p.account)}</td><td class="r">${p.amount ? rp(p.amount) : ""}</td><td>${esc(p.note)}</td></tr>`).join("")
      + (d.payTotal ? `<tr class="tot"><td colspan="4" class="r">Total transfer</td><td class="r">${rp(d.payTotal)}</td><td></td></tr>` : "")
    : blank(2);
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>RAB - ${esc(d.title)}</title><style>
@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font:12px/1.45 Helvetica,Arial,sans-serif;color:#111;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.brand{font-size:11px;color:#555;letter-spacing:.06em;text-transform:uppercase}h1{font-size:20px;margin:2px 0 2px}h2{font-size:14px;margin:0 0 10px;font-weight:600}
h3{font-size:13px;margin:20px 0 6px}.meta{margin:8px 0 14px}.meta div{display:flex;gap:8px;margin:2px 0}.meta b{width:84px;flex:none}
table{width:100%;border-collapse:collapse;margin-top:4px}th,td{border:1px solid #777;padding:5px 7px;vertical-align:top}th{background:#e8e8e8;text-align:left}
.r{text-align:right}.c{text-align:center}.tot td{font-weight:700;background:#f3f3f3}thead{display:table-header-group}tr{page-break-inside:avoid}
.notes{white-space:pre-wrap;border:1px solid #bbb;padding:6px 8px;border-radius:4px}
.sign{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:26px;page-break-inside:avoid}.sign>div{text-align:center}
.sign .sp{height:78px}.sign .ln{border-top:1px solid #111;margin:0 14px;padding-top:4px;font-weight:700;min-height:20px}.sign .t{font-size:11px;color:#444;min-height:15px}.sign .d{font-size:11px;margin-top:8px;color:#444}
</style></head><body>
<div class="brand">${esc(d.brand)}</div><h1>RENCANA ANGGARAN BIAYA (RAB)</h1><h2>${esc(d.title)}</h2>
<div class="meta"><div><b>Tanggal</b><span>${esc(d.date)}</span></div><div><b>Status</b><span>${esc(d.status)}</span></div>${d.purpose ? `<div><b>Keperluan</b><span>${esc(d.purpose)}</span></div>` : ""}</div>
<table><thead><tr><th class="c" style="width:32px">No</th><th>Item</th><th class="r" style="width:46px">Qty</th><th style="width:62px">Satuan</th><th class="r" style="width:96px">Harga satuan</th><th class="r" style="width:104px">Subtotal</th></tr></thead><tbody>
${d.items.map((i, n) => `<tr><td class="c">${n + 1}</td><td>${esc(i.name)}</td><td class="r">${nf.format(i.qty)}</td><td>${esc(i.unit)}</td><td class="r">${rp(i.price)}</td><td class="r">${rp(i.sub)}</td></tr>`).join("")}
<tr class="tot"><td colspan="5" class="r">Total</td><td class="r">${rp(d.total)}</td></tr></tbody></table>
${d.notes ? `<h3>Catatan</h3><div class="notes">${esc(d.notes)}</div>` : ""}
<h3>Tujuan transfer / pembayaran</h3>
<table><thead><tr><th class="c" style="width:32px">No</th><th>Atas nama</th><th style="width:80px">Bank</th><th style="width:130px">No. rekening</th><th class="r" style="width:100px">Jumlah</th><th>Keterangan</th></tr></thead><tbody>${payRows}</tbody></table>
<div class="sign">${d.signers.map((s) => `<div><div>${esc(s.label)},</div><div class="sp"></div><div class="ln">${esc(s.name)}</div><div class="t">${esc(s.title)}</div><div class="d">Tanggal: ..................</div></div>`).join("")}</div>
</body></html>`;
}
export function printRab(r, brand) {
  const html = rabHtml(rabModel(r, brand));
  const f = document.createElement("iframe");
  f.setAttribute("aria-hidden", "true");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.append(f);
  const w = f.contentWindow;
  w.document.open(); w.document.write(html); w.document.close();
  const go = () => { try { w.focus(); w.print(); } finally { setTimeout(() => f.remove(), 60000); } };
  if (w.document.readyState === "complete") setTimeout(go, 150); else f.onload = () => setTimeout(go, 150);
}

/* ====================== PDF (tanpa library) ====================== */
// Lebar huruf Helvetica (per 1000 em) untuk karakter ASCII 32..126; huruf tebal dihitung sedikit lebih lebar.
const HW = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const clean = (s) => String(s ?? "").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/\u2026/g, "...").replace(/[\u00B7\u2022]/g, "-").replace(/[^\n\x20-\x7E\u00A0-\u00FF]/g, "?");
const tw = (s, size, bold) => { let w = 0; for (const ch of s) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? HW[c - 32] : 556; } return (w / 1000) * size * (bold ? 1.06 : 1); };
const pesc = (s) => s.replace(/[\\()]/g, "\\$&");
function wrap(text, width, size, bold) {
  const out = [];
  for (const para of clean(text).split("\n")) {
    let line = "";
    for (let word of para.split(" ")) {
      while (tw(word, size, bold) > width) { // kata terlalu panjang (mis. nomor rekening): potong
        let k = word.length; while (k > 1 && tw(word.slice(0, k), size, bold) > width) k--;
        if (line) { out.push(line); line = ""; }
        out.push(word.slice(0, k)); word = word.slice(k);
      }
      const t = line ? line + " " + word : word;
      if (tw(t, size, bold) <= width) line = t; else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

function buildPdf(pages) {
  const objs = [];
  const kids = pages.map((_, i) => `${5 + 2 * i} 0 R`).join(" ");
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((cmds, i) => {
    const stream = cmds.join("\n");
    objs[5 + 2 * i] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + 2 * i} 0 R >>`;
    objs[6 + 2 * i] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n"; const off = [];
  for (let k = 1; k < objs.length; k++) { off[k] = out.length; out += `${k} 0 obj\n${objs[k]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + off.slice(1).map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
  return bytes;
}

export function rabPdfBytes(r, brand) {
  const d = rabModel(r, brand);
  const PW = 595.28, PH = 841.89, M = 40, CW = PW - 2 * M, LH = 12.5;
  const pages = [[]]; let y = M;
  const cur = () => pages.at(-1);
  const Y = (top) => (PH - top).toFixed(2);
  const txt = (x, top, s, size = 10, bold = false, align = "l", w = 0, gray = 0) => {
    s = clean(s); const t = tw(s, size, bold);
    const tx = align === "r" ? x + w - t : align === "c" ? x + (w - t) / 2 : x;
    cur().push(`BT ${gray} g /${bold ? "F2" : "F1"} ${size} Tf ${tx.toFixed(2)} ${Y(top)} Td (${pesc(s)}) Tj ET 0 g`);
  };
  const box = (x, top, w, h, fill) => {
    if (fill != null) cur().push(`${fill} g ${x.toFixed(2)} ${Y(top + h)} ${w.toFixed(2)} ${h.toFixed(2)} re f 0 g`);
    cur().push(`0.5 w 0.45 G ${x.toFixed(2)} ${Y(top + h)} ${w.toFixed(2)} ${h.toFixed(2)} re S 0 G`);
  };
  const hline = (x1, x2, top) => cur().push(`0.8 w ${x1.toFixed(2)} ${Y(top)} m ${x2.toFixed(2)} ${Y(top)} l S`);
  const LIMIT = PH - M - 24;
  const newPage = () => { pages.push([]); y = M; txt(M, y + 8, `${d.brand} - RAB: ${d.title} (lanjutan)`, 8.5, false, "l", 0, 0.4); y += 22; };
  const ensure = (h) => { if (y + h > LIMIT) newPage(); };

  // Tabel: cols = [{w, a:"l|r|c"}], header = [..], rows = [[..]]
  const table = (cols, header, rows, totalLabel, totalCells) => {
    const drawRow = (cells, o = {}) => {
      const lines = cells.map((c, i) => wrap(String(c ?? ""), cols[i].w - 10, 9.5, !!o.bold));
      const h = Math.max(1, ...lines.map((l) => l.length)) * LH + 8;
      if (y + h > LIMIT) { newPage(); if (!o.header) drawRow(header, { bold: true, header: true, fill: 0.9 }); }
      let x = M;
      cols.forEach((c, i) => {
        box(x, y, c.w, h, o.fill);
        lines[i].forEach((ln, k) => txt(x + 5, y + 4 + 9.5 * 0.85 + k * LH, ln, 9.5, !!o.bold, c.a || "l", c.w - 10));
        x += c.w;
      });
      y += h;
    };
    drawRow(header, { bold: true, header: true, fill: 0.9 });
    rows.forEach((r) => drawRow(r));
    if (totalCells) {
      const lastW = cols.at(-1).w, restW = cols.slice(0, -1).reduce((s, c) => s + c.w, 0);
      ensure(LH + 8);
      box(M, y, restW, LH + 8, 0.95); box(M + restW, y, lastW, LH + 8, 0.95);
      txt(M + 5, y + 4 + 9.5 * 0.85, totalLabel, 9.5, true, "r", restW - 10);
      txt(M + restW + 5, y + 4 + 9.5 * 0.85, totalCells, 9.5, true, "r", lastW - 10);
      y += LH + 8;
    }
  };

  // Judul
  txt(M, y + 9, d.brand.toUpperCase(), 9, false, "l", 0, 0.4); y += 22;
  txt(M, y + 14, "RENCANA ANGGARAN BIAYA (RAB)", 16, true); y += 24;
  wrap(d.title, CW, 12, false).forEach((ln) => { txt(M, y + 10, ln, 12); y += 15; });
  y += 6;
  [["Tanggal", d.date], ["Status", d.status], ["Keperluan", d.purpose]].filter(([, v]) => v).forEach(([k, v]) => {
    const ls = wrap(v, CW - 80, 10, false); ensure(ls.length * 13);
    txt(M, y + 9, k, 10, true); ls.forEach((ln, i) => txt(M + 80, y + 9 + i * 13, ln, 10)); y += ls.length * 13 + 1;
  });
  y += 8;

  // Rincian biaya
  table([{ w: 28, a: "c" }, { w: CW - 28 - 40 - 52 - 82 - 92, a: "l" }, { w: 40, a: "r" }, { w: 52, a: "l" }, { w: 82, a: "r" }, { w: 92, a: "r" }],
    ["No", "Item", "Qty", "Satuan", "Harga satuan", "Subtotal"],
    d.items.map((i, n) => [n + 1, i.name, nf.format(i.qty), i.unit, rp(i.price), rp(i.sub)]), "Total", rp(d.total));

  if (d.notes) {
    y += 14; ensure(40); txt(M, y + 10, "Catatan", 11, true); y += 16;
    wrap(d.notes, CW, 10, false).forEach((ln) => { ensure(LH); txt(M, y + 9, ln, 10); y += LH; });
  }

  // Rekening tujuan
  y += 16; ensure(70); txt(M, y + 10, "Tujuan transfer / pembayaran", 11, true); y += 16;
  const payRows = d.payees.length ? d.payees.map((p, n) => [n + 1, p.name, p.bank, p.account, p.amount ? rp(p.amount) : "", p.note]) : [["", "", "", "", "", ""], ["", "", "", "", "", ""]];
  table([{ w: 28, a: "c" }, { w: 135, a: "l" }, { w: 60, a: "l" }, { w: 110, a: "l" }, { w: 85, a: "r" }, { w: CW - 28 - 135 - 60 - 110 - 85, a: "l" }],
    ["No", "Atas nama", "Bank", "No. rekening", "Jumlah", "Keterangan"], payRows, d.payTotal ? "Total transfer" : null, d.payTotal ? rp(d.payTotal) : null);

  // Tanda tangan
  y += 22; ensure(150);
  const cw = CW / 3;
  d.signers.forEach((s, i) => {
    const x = M + i * cw;
    txt(x, y + 10, s.label + ",", 10, false, "c", cw);
    hline(x + 18, x + cw - 18, y + 92);
    wrap(s.name, cw - 36, 10, true).forEach((ln, k) => txt(x, y + 105 + k * 12, ln, 10, true, "c", cw));
    wrap(s.title, cw - 36, 9, false).forEach((ln, k) => txt(x, y + 118 + k * 11, ln, 9, false, "c", cw, 0.3));
    txt(x, y + 138, "Tanggal: ..................", 9, false, "c", cw, 0.3);
  });

  // Footer: nomor halaman
  const total = pages.length;
  pages.forEach((p, i) => {
    const t = clean(`Halaman ${i + 1} dari ${total}`), x = PW - M - tw(t, 8, false);
    p.push(`BT 0.4 g /F1 8 Tf ${x.toFixed(2)} ${(M - 18).toFixed(2)} Td (${pesc(t)}) Tj ET 0 g`);
  });
  return buildPdf(pages);
}

export function downloadRabPdf(r, brand) {
  const bytes = rabPdfBytes(r, brand);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  a.download = `RAB-${slug(r.title)}.pdf`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
