// Penghubung unggah file ke Google Drive.
// Browser tidak pernah memegang kunci Google. Fungsi ini: cek login + akses brand, siapkan folder di Drive,
// lalu membuat "sesi unggah" sekali pakai. File dikirim browser langsung ke Google (tidak lewat Netlify,
// jadi tidak memakan kuota Netlify dan tidak kena batas ukuran fungsi).
//
// Environment variable (Netlify > Site configuration > Environment variables):
//   FIREBASE_PROJECT_ID    : sama dengan projectId di js/config.js
//   GOOGLE_CLIENT_ID       : OAuth client ID dari Google Cloud
//   GOOGLE_CLIENT_SECRET   : OAuth client secret
//   GOOGLE_REFRESH_TOKEN   : refresh token akun Google pemilik Drive (lihat PANDUAN-DRIVE.md)
//   DRIVE_ROOT_NAME        : opsional, nama folder induk (default "Zenkou Marketing OS")
//   DRIVE_PUBLIC           : opsional, "0" bila folder tidak ingin dibuka untuk "siapa saja yang punya link"

const json = (code, body) => ({ statusCode: code, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const FOLDER = "application/vnd.google-apps.folder";
const FIELDS = "id,name,mimeType,size,webViewLink,thumbnailLink";
const cache = { token: null, exp: 0, folders: new Map() };

async function canAccess(idToken, brandId) {
  const pid = process.env.FIREBASE_PROJECT_ID;
  if (!pid || !idToken) return false;
  const [, payload] = idToken.split(".");
  let uid;
  try { uid = JSON.parse(Buffer.from(payload, "base64url").toString()).user_id; } catch { return false; }
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/users/${uid}`, { headers: { authorization: `Bearer ${idToken}` } });
  if (!r.ok) return false;
  const f = (await r.json()).fields || {};
  if (f.active?.booleanValue === false) return false;
  const brands = (f.brands?.arrayValue?.values || []).map((v) => v.stringValue);
  return brands.includes("*") || brands.includes(brandId);
}

async function accessToken() {
  if (cache.token && Date.now() < cache.exp - 60000) return cache.token;
  const { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret, GOOGLE_REFRESH_TOKEN: rt } = process.env;
  if (!id || !secret || !rt) { const e = new Error("Google Drive belum dipasang di Netlify. Ikuti PANDUAN-DRIVE.md."); e.status = 501; throw e; }
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: rt, grant_type: "refresh_token" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const e = new Error(j.error === "invalid_grant"
      ? "Izin Google Drive sudah kedaluwarsa atau dicabut. Buat refresh token baru (PANDUAN-DRIVE.md, bagian Masalah umum)."
      : `Gagal masuk ke Google (${j.error || r.status}).`);
    e.status = 502; throw e;
  }
  cache.token = j.access_token; cache.exp = Date.now() + (j.expires_in || 3600) * 1000;
  return cache.token;
}

const g = async (tok, url, init = {}) => {
  const r = await fetch(url, { ...init, headers: { authorization: `Bearer ${tok}`, ...(init.headers || {}) } });
  if (!r.ok) { const t = await r.text().catch(() => ""); const e = new Error(`Google Drive ${r.status}: ${t.slice(0, 200)}`); e.status = 502; throw e; }
  return r;
};
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
// Nama aman untuk Drive: tanpa karakter kontrol / pemisah path, maksimal 120 karakter.
const clean = (s, fb) => (String(s || "").replace(/[\u0000-\u001f\\/]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)) || fb;

async function findOrCreateFolder(tok, name, parent, { share } = {}) {
  const key = `${parent || "root"}/${name}`;
  if (cache.folders.has(key)) return cache.folders.get(key);
  const q = `mimeType='${FOLDER}' and name='${esc(name)}' and trashed=false and ${parent ? `'${esc(parent)}' in parents` : "'root' in parents"}`;
  const found = await (await g(tok, `https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q, fields: "files(id)", pageSize: "1", spaces: "drive" })}`)).json();
  let id = found.files?.[0]?.id;
  if (!id) {
    const made = await (await g(tok, "https://www.googleapis.com/drive/v3/files?fields=id", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }),
    })).json();
    id = made.id;
    // Folder induk dibuka sekali untuk "siapa saja yang punya link" agar gambar bisa tampil di sistem.
    // Folder di dalamnya otomatis ikut.
    if (share) await g(tok, `https://www.googleapis.com/drive/v3/files/${id}/permissions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "reader", type: "anyone" }),
    });
  }
  cache.folders.set(key, id);
  return id;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Gunakan POST." });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Isi permintaan tidak valid." }); }
  const { brandId, path, name, mimeType } = body;
  const size = Number(body.size);
  if (!brandId || !/^[\w-]{1,80}$/.test(brandId)) return json(400, { error: "brandId tidak valid." });
  if (!name || !Number.isFinite(size) || size <= 0) return json(400, { error: "Nama dan ukuran file wajib diisi." });
  if (size > 5 * 1024 ** 3) return json(400, { error: "File terlalu besar (maksimal 5 GB)." });
  if (!Array.isArray(path) || path.length > 3) return json(400, { error: "Lokasi folder tidak valid." });

  const idToken = (event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
  if (!(await canAccess(idToken, brandId))) return json(403, { error: "Kamu tidak punya akses ke brand ini." });

  try {
    const tok = await accessToken();
    const share = process.env.DRIVE_PUBLIC !== "0";
    let parent = await findOrCreateFolder(tok, clean(process.env.DRIVE_ROOT_NAME, "Zenkou Marketing OS"), null, { share });
    parent = await findOrCreateFolder(tok, brandId, parent);
    for (const seg of path) parent = await findOrCreateFolder(tok, clean(seg, "Lainnya"), parent);

    const origin = event.headers.origin || event.headers.Origin || "";
    const r = await g(tok, `https://www.googleapis.com/upload/drive/v3/files?${new URLSearchParams({ uploadType: "resumable", fields: FIELDS })}`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": mimeType || "application/octet-stream",
        "x-upload-content-length": String(size),
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify({ name: clean(name, "file"), parents: [parent] }),
    });
    const uploadUrl = r.headers.get("location");
    if (!uploadUrl) return json(502, { error: "Google tidak memberi alamat unggah." });
    return json(200, { uploadUrl, folderId: parent });
  } catch (e) {
    // Token yang ditolak bisa jadi sudah dicabut: buang cache agar percobaan berikutnya mengambil yang baru.
    if (/Drive 401/.test(e.message)) cache.token = null;
    return json(e.status || 500, { error: e.message });
  }
};
exports._cache = cache;
