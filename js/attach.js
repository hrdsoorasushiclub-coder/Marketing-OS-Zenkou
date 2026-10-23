// Lampiran link dan gambar yang dipakai bersama (saran atasan di Report, standar/benchmark di Content Plan).
// Gambar dikecilkan lalu disimpan sebagai data URL di dokumen Firestore (tanpa Storage), jadi dibatasi jumlah dan ukurannya.
import { h, icon, dialog } from "./ui.js";

export const MAX_IMAGES = 3;
const MAX_CHARS = 700000; // batas total gambar per dokumen (Firestore maksimal 1 MB)
export const newUid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const safeHref = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; } };

export function compressImg(file, maxSide = 1100, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Gambar tidak bisa dibaca. Coba file lain.")); };
    img.src = url;
  });
}

// Isian lampiran: kembalikan { el, get() }. get() melempar Error kalau ada link tidak valid atau gambar terlalu besar.
export function attachEditor(init = {}) {
  let images = [...(init.images || [])];
  const links = h("textarea", { class: "textarea", rows: 3, placeholder: "Tempel link, satu baris satu link (https://...)" });
  links.value = (init.links || []).join("\n");
  const grid = h("div", { style: "display:flex;flex-wrap:wrap;gap:10px;margin-top:8px" });
  const paint = () => {
    grid.replaceChildren(...images.map((src, i) => h("div", { style: "position:relative" },
      h("img", { src, alt: "Lampiran " + (i + 1), style: "height:84px;width:auto;border-radius:8px;border:1px solid var(--line);display:block" }),
      h("button", { type: "button", class: "btn sm danger", "aria-label": "Hapus gambar", style: "position:absolute;top:4px;right:4px;padding:0 6px", onclick: () => { images.splice(i, 1); paint(); } }, "×"))));
  };
  const input = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true });
  input.addEventListener("change", async () => {
    const files = [...(input.files || [])];
    input.value = "";
    for (const f of files) {
      if (images.length >= MAX_IMAGES) { alert(`Maksimal ${MAX_IMAGES} gambar.`); break; }
      try { images.push(await compressImg(f)); } catch (e) { alert(e.message); }
    }
    paint();
  });
  paint();
  const el = h("div", {},
    h("div", { class: "field" }, h("label", {}, "Link"), links, h("span", { class: "hint" }, "Contoh: link Google Drive, Instagram, TikTok, atau artikel.")),
    h("div", { class: "field" }, h("label", {}, `Gambar (maks. ${MAX_IMAGES})`),
      h("button", { type: "button", class: "btn", onclick: () => input.click() }, icon("camera", 16), "Tambah gambar"), input, grid,
      h("span", { class: "hint" }, "Bisa ambil foto langsung atau pilih dari galeri. Gambar dikecilkan otomatis.")));
  return {
    el,
    get: () => {
      const out = [];
      for (const line of links.value.split("\n").map((x) => x.trim()).filter(Boolean)) {
        const u = safeHref(line);
        if (!u) throw new Error(`Link tidak valid: ${line.slice(0, 40)}. Awali dengan https://`);
        out.push(u);
      }
      if (images.reduce((t, s) => t + s.length, 0) > MAX_CHARS) throw new Error("Ukuran gambar terlalu besar. Kurangi jumlah gambar.");
      return { links: out, images: [...images] };
    },
  };
}

// Tampilan lampiran (link dan gambar). Kembalikan null kalau kosong.
export function attachView(att) {
  const links = (att?.links || []).map(safeHref).filter(Boolean), images = att?.images || [];
  if (!links.length && !images.length) return null;
  const host = (u) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, "") + (x.pathname.length > 1 ? x.pathname.slice(0, 24) + (x.pathname.length > 24 ? "…" : "") : ""); } catch { return u; } };
  return h("div", { style: "margin-top:8px" },
    links.map((u) => h("div", { style: "font-size:13.5px;margin:3px 0;word-break:break-all" }, h("a", { href: u, target: "_blank", rel: "noopener" }, host(u), " →"))),
    images.length ? h("div", { style: "display:flex;flex-wrap:wrap;gap:8px;margin-top:6px" }, images.map((src, i) =>
      h("img", { src, alt: "Lampiran " + (i + 1), title: "Klik untuk memperbesar", style: "height:84px;width:auto;border-radius:8px;border:1px solid var(--line);cursor:zoom-in",
        onclick: () => dialog({ title: "Lampiran", body: h("img", { src, alt: "", style: "max-width:100%;max-height:75vh;border-radius:8px;display:block;margin:auto" }), actions: [{ label: "Tutup" }] }) }))) : null);
}
