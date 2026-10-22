import { h, icon } from "./ui.js";

/* Unggah file langsung dari sistem ke Google Drive.
   Alur: (1) minta "sesi unggah" ke fungsi Netlify /drive (yang memeriksa login + akses brand dan menyiapkan folder),
         (2) browser mengirim file ke Google per potongan 8 MB. File tidak melewati Netlify.
   Hasilnya link Drive biasa, sehingga data lama berbasis link tetap jalan. */

const CHUNK = 8 * 1024 * 1024; // kelipatan 256 KiB, syarat Google
const MAX_BYTES = 2 * 1024 ** 3;

export const fmtSize = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function putChunk(url, blob, start, total, onSent) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    x.setRequestHeader("Content-Range", `bytes ${start}-${start + blob.size - 1}/${total}`);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onSent(start + e.loaded); };
    x.onload = () => {
      if (x.status === 308) return resolve(null);               // potongan diterima, lanjut
      if (x.status === 200 || x.status === 201) { try { return resolve(JSON.parse(x.responseText)); } catch { return reject(new Error("Balasan Google tidak terbaca.")); } }
      reject(new Error(`Google menolak unggahan (${x.status}).`));
    };
    x.onerror = () => reject(new Error("Koneksi terputus saat mengunggah."));
    x.send(blob);
  });
}

/** Unggah satu file. path = subfolder di dalam folder brand, mis. ["Logo"] atau ["Konten", "2026-10"]. */
export async function uploadToDrive({ store, brandId, path, file, onProgress = () => {} }) {
  if (store.mode !== "firebase") throw new Error("Unggah langsung butuh mode Firebase. Di mode demo, tempel link saja.");
  if (file.size === 0) throw new Error(`"${file.name}" kosong.`);
  if (file.size > MAX_BYTES) throw new Error(`"${file.name}" terlalu besar (${fmtSize(file.size)}). Maksimal 2 GB; untuk file lebih besar, unggah manual ke Drive lalu tempel link.`);
  path = typeof path === "function" ? path() : path;
  const token = await store.getToken();
  let res;
  try {
    res = await fetch("/.netlify/functions/drive", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ brandId, path, name: file.name, size: file.size, mimeType: file.type || "application/octet-stream" }),
    });
  } catch { throw new Error("Fungsi unggah tidak terjangkau. Pastikan web dideploy ke Netlify dengan folder netlify/functions."); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || (res.status === 404 ? "Fungsi unggah belum aktif di hosting ini (folder netlify/functions belum ikut ter-deploy)." : `Gagal menyiapkan unggahan (${res.status}).`));

  let sent = 0, done = null;
  while (!done) {
    const end = Math.min(sent + CHUNK, file.size);
    let attempt = 0;
    for (;;) {
      try { done = await putChunk(j.uploadUrl, file.slice(sent, end), sent, file.size, (n) => onProgress(Math.min(n, file.size) / file.size)); break; }
      catch (e) { if (++attempt >= 3 || !/terputus/.test(e.message)) throw e; await new Promise((r) => setTimeout(r, 1000 * attempt)); }
    }
    sent = end;
    onProgress(sent / file.size);
    if (sent >= file.size && !done) throw new Error("Google belum mengonfirmasi file selesai. Coba lagi.");
  }
  return { id: done.id, name: done.name || file.name, size: file.size, mimeType: done.mimeType || file.type, url: done.webViewLink || `https://drive.google.com/file/d/${done.id}/view` };
}

/** Kotak tarik-dan-lepas (juga bisa diklik). onUploaded dipanggil per file yang berhasil. */
export function dropzone({ store, brandId, path, multiple = false, accept = "", label = "Tarik file ke sini, atau klik untuk memilih", onUploaded }) {
  const input = h("input", { type: "file", class: "dz-input", multiple, accept, tabindex: "-1", "aria-hidden": "true" });
  const list = h("div", { class: "dz-list", role: "status", "aria-live": "polite" });
  const demo = store.mode !== "firebase";
  const box = h("div", { class: "dropzone" + (demo ? " off" : ""), role: "button", tabindex: demo ? "-1" : "0", "aria-label": label, "aria-disabled": demo ? "true" : null },
    icon("upload", 22), h("b", {}, label), h("span", { class: "muted" }, demo ? "Tidak aktif di mode demo. Tempel link saja." : "Tersimpan otomatis di Google Drive."));
  const pick = () => !demo && input.click();
  box.addEventListener("click", pick);
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
  for (const t of ["dragenter", "dragover"]) box.addEventListener(t, (e) => { e.preventDefault(); if (!demo) box.classList.add("over"); });
  for (const t of ["dragleave", "drop"]) box.addEventListener(t, () => box.classList.remove("over"));
  box.addEventListener("drop", (e) => { e.preventDefault(); if (!demo) go([...e.dataTransfer.files]); });
  input.addEventListener("change", () => { go([...input.files]); input.value = ""; });

  async function go(files) {
    if (!multiple) files = files.slice(0, 1);
    for (const file of files) {
      const bar = h("span", { class: "dz-bar" }); const bg = h("span", { class: "dz-track" }, bar);
      const msg = h("span", { class: "muted" }, "0%");
      const row = h("div", { class: "dz-row" }, h("span", { class: "dz-name" }, file.name), bg, msg);
      list.append(row);
      try {
        const r = await uploadToDrive({ store, brandId, path, file, onProgress: (p) => { bar.style.width = `${Math.round(p * 100)}%`; msg.textContent = `${Math.round(p * 100)}%`; } });
        row.classList.add("ok"); msg.textContent = "Selesai";
        setTimeout(() => row.remove(), 2500);
        await onUploaded?.(r);
      } catch (e) {
        row.classList.add("bad"); msg.textContent = e.message;
        row.append(h("button", { class: "linklike small", type: "button", onclick: () => row.remove() }, "Tutup"));
      }
    }
  }
  return h("div", { class: "dz" }, box, input, list);
}
