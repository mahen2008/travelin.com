TRAVELIN AJA DULU - VERSI SERVER (PHP + SQLite)
================================================

KEBUTUHAN
- PHP 8.0 atau lebih baru dengan ekstensi: pdo_sqlite, sqlite3, fileinfo, mbstring
  (XAMPP versi terbaru sudah menyertakannya; cek di php.ini bahwa baris
  extension=pdo_sqlite, extension=sqlite3, extension=fileinfo tidak diberi tanda ;)
- Apache (XAMPP) dengan .htaccess aktif (AllowOverride All) agar folder data/ tertutup.
  Situs TIDAK bisa dijalankan dengan Live Server (127.0.0.1:5500), karena itu tidak menjalankan PHP.

CARA PASANG (XAMPP)
1. Salin folder travel-php ke C:\xampp\htdocs\
2. Salin folder asset milikmu (logo, foto, video, qris.png, dll.) ke dalam travel-php\
   (juga chat.css dan chat.js jika masih dipakai)
3. Jalankan Apache dari XAMPP Control Panel
4. Buka http://localhost/travel-php/
5. Database dibuat otomatis saat halaman pertama dibuka (folder data/ terbentuk sendiri)

AKUN ADMIN PERTAMA (diatur di config.php)
- Email : admin@travel.com
- Sandi : admin123
- Setelah masuk, SEGERA ganti lewat tautan "Ganti kata sandi".
- Mengubah admin_sandi di config.php setelah database terbentuk tidak berpengaruh;
  ganti lewat menu, atau hapus folder data/ untuk memulai dari awal.

STRUKTUR
  index.html     tampilan situs
  style.css      gaya
  javascript.js  logika tampilan, memanggil api.php
  api.php        semua proses server (akun, katalog, pesanan, unggahan)
  db.php         koneksi + skema database + data awal
  config.php     pengaturan (nomor WA, akun admin awal, batas unggahan)
  data/          (otomatis) database + bukti pembayaran, tertutup dari browser
  uploads/       (otomatis) foto tujuan yang diunggah admin

YANG DIKERJAKAN SERVER
- Login/daftar dengan kata sandi ter-hash (bcrypt), sesi aman, perlindungan CSRF,
  pembatasan percobaan login (5x per 10 menit).
- Peran admin dan pelanggan diperiksa di SERVER, bukan di browser.
- Katalog (tujuan, paket, tambahan) tersimpan di database dan sama untuk semua pengunjung.
- Total pesanan dihitung ulang di server dari harga di database; angka dari browser tidak dipercaya.
- Pesanan tersimpan (riwayat tidak hilang), lengkap dengan status:
  menunggu pembayaran -> menunggu verifikasi -> lunas / dibatalkan.
- Bukti pembayaran diunggah ke folder privat; hanya pemilik pesanan dan admin yang bisa melihatnya.
- Admin: kelola katalog (termasuk unggah foto), lihat dan ubah status pesanan, kelola kode promo.
- Admin: kelola akun pelanggan (ubah data, nonaktifkan/aktifkan, reset sandi, hapus jika belum punya pesanan).
- Chat CS: pelanggan menulis dari bagian "Chat dengan CS" di dashboard, admin membalas lewat tab "Chat Pelanggan".
  Pesan diambil otomatis tiap 5 detik (polling), tabel chat_pesan dibuat otomatis, database lama dimigrasi otomatis.
  Chat pelanggan berupa tombol "Chat CS" mengambang di kanan bawah (hanya tampil untuk pelanggan yang login);
  jika diklik, panel chat naik dari bawah.
  Catatan: chat.js/chat.css (widget lama) tidak diubah dan berjalan terpisah.
- Tiket digital: saat admin mengubah status pesanan menjadi Lunas, pelanggan melihat tombol "Lihat Tiket" di "Pesanan Saya"
  (muncul otomatis, daftar pesanan disegarkan tiap 30 detik, dan ada pemberitahuan singkat). Tiket berupa gambar PNG
  yang digambar di browser, berisi tujuan, nama, tanggal, peserta, paket, total, dan barcode Code 39 dari kode pesanan.

SEBELUM DIPUBLIKASIKAN
- Pakai HTTPS.
- Ganti sandi admin, dan sesuaikan nomor_wa di config.php.
- Jika memungkinkan, pindahkan folder data/ ke luar folder publik dan ubah db_path serta bukti_dir
  di config.php. Jika memakai Nginx, tambahkan aturan untuk menolak akses ke /data/.
- Pembayaran QRIS masih statis: admin mengecek mutasi lalu mengubah status menjadi Lunas.
  Verifikasi otomatis butuh payment gateway (Midtrans, Xendit, dll.).
- Lakukan backup berkala pada file data/travel.sqlite dan folder data/bukti.
