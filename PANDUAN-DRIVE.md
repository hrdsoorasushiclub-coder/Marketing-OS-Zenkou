# Panduan: Unggah file langsung ke Google Drive

Fitur ini membuat logo, aset brand, file hasil editing, dan cover konten bisa **ditarik (drag and drop) langsung ke sistem**. File tersimpan di Google Drive milikmu. Sistem hanya menyimpan link-nya.

Pemasangan **sekali saja**, sekitar 15 menit. Sebelum dipasang, sistem tetap jalan seperti biasa (tempel link manual).

## Cara kerjanya
1. Kamu tarik file ke kotak unggah.
2. Sistem meminta "izin unggah" ke fungsi Netlify (`netlify/functions/drive.js`). Fungsi ini memastikan kamu sudah login dan berhak atas brand tersebut.
3. File dikirim browser langsung ke Google Drive (tidak lewat Netlify, jadi tidak memakan kuota Netlify).
4. Folder dibuat otomatis: `Zenkou Marketing OS / <id brand> / Logo` atau `Konten / 2026-10`, dst.

Kunci Google disimpan di Netlify, tidak pernah sampai ke browser.

## Pemasangan

### 1. Buat project di Google Cloud
1. Buka https://console.cloud.google.com dengan **akun Google pemilik Drive** (akun yang file-nya mau dipakai).
2. Klik pemilih project di atas > **New project** > beri nama `Zenkou OS` > **Create**.
3. Menu **APIs & Services > Library**, cari **Google Drive API**, klik **Enable**.

### 2. Layar persetujuan (consent screen)
1. **APIs & Services > OAuth consent screen** (atau **Google Auth Platform**) > **Get started**.
2. Isi nama aplikasi `Zenkou OS`, email kamu. Audience: **External**.
3. Di bagian **Data Access / Scopes**, tambahkan `.../auth/drive.file`. Izin ini hanya membolehkan aplikasi mengakses file **yang dibuat aplikasi sendiri**, bukan seluruh Drive.
4. **Penting:** ubah status ke **In production** (tombol **Publish app**). Kalau dibiarkan "Testing", izin otomatis mati setiap 7 hari dan unggahan tiba-tiba gagal.

### 3. Buat OAuth client
1. **Credentials > Create credentials > OAuth client ID** > jenis **Web application**.
2. Pada **Authorized redirect URIs** isi: `https://developers.google.com/oauthplayground`
3. **Create**, lalu catat **Client ID** dan **Client secret**.

### 4. Ambil refresh token
1. Buka https://developers.google.com/oauthplayground
2. Klik ikon roda gigi kanan atas > centang **Use your own OAuth credentials** > isi Client ID dan Client secret tadi.
3. Di kolom kiri, ketik scope `https://www.googleapis.com/auth/drive.file` lalu **Authorize APIs**.
4. Login dengan akun pemilik Drive. Kalau muncul peringatan "Google hasn't verified this app", klik **Advanced > Go to Zenkou OS (unsafe)**. Ini aplikasimu sendiri, jadi aman. Izinkan.
5. Klik **Exchange authorization code for tokens**, lalu salin **Refresh token**.

Perlakukan refresh token seperti kata sandi. Jangan ditaruh di GitHub atau dikirim lewat chat.

### 5. Isi environment variable di Netlify
**Site configuration > Environment variables**, tambahkan:

| Nama | Isi |
|---|---|
| `GOOGLE_CLIENT_ID` | Client ID dari langkah 3 |
| `GOOGLE_CLIENT_SECRET` | Client secret dari langkah 3 |
| `GOOGLE_REFRESH_TOKEN` | Refresh token dari langkah 4 |
| `FIREBASE_PROJECT_ID` | `supervisi-medsos` (kalau sebelumnya sudah diisi, biarkan) |
| `DRIVE_ROOT_NAME` | Opsional. Nama folder induk, default `Zenkou Marketing OS` |
| `DRIVE_PUBLIC` | Opsional. Isi `0` kalau folder tidak mau dibuka untuk "siapa saja yang punya link" |

### 6. Deploy ulang
Perubahan environment variable baru terbaca setelah deploy berikutnya. Unggah file-file baru ke GitHub, tunggu Netlify selesai deploy (ingat: tiap deploy production memakai 15 kredit).

## Cara pakai
- **Brand Set Up > Brand Guideline > Logo**: tarik file logo ke kotak, nama terisi otomatis, klik Simpan.
- **Brand Set Up > Aset brand**: pilih kategori dulu, file masuk ke folder kategori itu.
- **Content Plan > buka konten > File hasil editing**: tarik satu atau banyak file. Cover juga bisa diunggah di bawahnya.
- **Content Plan, langsung di tabel**: tarik file ke baris konten, otomatis tersimpan sebagai file hasil editing konten itu.

Ukuran maksimal 2 GB per file. Lebih dari itu, unggah manual ke Drive lalu tempel link.

## Soal pratinjau gambar
Folder induk dibuat dengan akses "siapa saja yang punya link boleh melihat" supaya logo dan cover tampil di sistem. Siapa pun yang tahu link file bisa membukanya. Kalau tidak mau, set `DRIVE_PUBLIC=0`: file tetap tersimpan, tapi pratinjau gambar tidak tampil dan hanya akun yang punya akses Drive yang bisa membuka link.

## Masalah umum
| Pesan | Penyebab dan solusi |
|---|---|
| "Google Drive belum dipasang di Netlify" | Salah satu dari tiga variabel `GOOGLE_*` belum diisi, atau belum deploy ulang. |
| "Izin Google Drive sudah kedaluwarsa atau dicabut" | Biasanya consent screen masih "Testing". Ubah ke In production, lalu ulangi langkah 4 dan ganti `GOOGLE_REFRESH_TOKEN`. |
| "Fungsi unggah belum aktif di hosting ini" | Folder `netlify/functions` belum ikut ter-deploy. Pastikan `drive.js` ada di sana di GitHub. |
| "Unggah langsung butuh mode Firebase" | Kamu sedang di mode demo. |
| Unggahan gagal di tengah jalan | Koneksi putus. Coba lagi; sistem sudah mengulang otomatis 3 kali. |

## Penting: akun layanan (service account) tidak bisa dipakai
Akun layanan tidak punya kuota di My Drive pribadi, jadi unggahan akan ditolak Google. Itu sebabnya panduan ini memakai akun Google kamu sendiri lewat refresh token.
