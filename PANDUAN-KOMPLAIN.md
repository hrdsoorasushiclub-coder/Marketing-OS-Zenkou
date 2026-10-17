# Komplain Outlet

Menu: **Operation > Komplain Outlet**. Data terpisah per brand (ikuti brand aktif di pojok kiri atas).

## Yang bisa dilakukan
- **Catat komplain** (semua member): outlet, tanggal, jenis masalah, kronologi masalah, tingkat (Rendah/Sedang/Tinggi), diterima lewat apa (outlet, Google Maps, Instagram, ojol, dst.), nama dan kontak pelanggan (opsional), serta penanggung jawab (PIC).
- **Status penanganan**: *Belum ditangani*, *Diproses*, *Selesai*. Status bisa diganti langsung dari tabel. Untuk menandai **Selesai**, hasil penanganan wajib diisi dulu (misalnya: menu diganti, permintaan maaf, voucher).
- **Riwayat**: setiap pencatatan, perubahan status, dan pergantian PIC tercatat (siapa dan kapan) di dalam formulir ubah.
- **Filter**: outlet, status, jenis masalah, periode, dan pencarian teks.
- **Rekap per outlet** (tab kedua): total komplain, jumlah belum ditangani/diproses/selesai, persentase selesai, rata-rata hari penyelesaian, dan umur komplain terlama yang belum selesai. Di bawahnya ada daftar jenis masalah yang paling sering muncul. Klik nama outlet untuk langsung melihat daftar komplainnya.
- **Unduh CSV** mengikuti filter yang sedang aktif.

## Outlet
Nama outlet bisa diketik saat mencatat komplain (huruf besar-kecil otomatis disamakan dengan yang sudah ada). Supervisor/Executive juga bisa mendaftarkan semua outlet lewat **Kelola outlet**, supaya outlet yang belum punya komplain tetap tampil di rekap dan muncul sebagai pilihan.

## Hak akses
- Semua member brand: melihat, mencatat, dan mengubah komplain.
- Hanya Supervisor dan Executive: menghapus komplain dan mengelola daftar outlet.

## Data dan aturan Firestore
Disimpan di `brands/{brandId}/complaints` dan `brands/{brandId}/complaint_outlets`. Keduanya mengikuti aturan yang sama dengan `content_plan` dan `job_assignments` (`brands/{brandId}/{sub}`), jadi **tidak ada aturan baru** dan tidak ada perubahan di `store.js`.

Catatan: pembatasan hapus untuk Supervisor/Executive dilakukan di aplikasi, bukan di aturan Firestore.

## Mengubah isian pilihan
Daftar jenis masalah, kanal, tingkat, dan status ada di bagian atas `js/views/komplain.js` (`CATEGORIES`, `CHANNELS`, `PRIORITIES`, `STATUS`).

## File yang berubah
- Baru: `js/views/komplain.js`, `PANDUAN-KOMPLAIN.md`
- Diubah: `js/main.js` (menu), `js/views/ops.js` (rute), `js/ui.js` (ikon), `css/app.css` (gaya)
