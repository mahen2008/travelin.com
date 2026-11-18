<?php
// Pengaturan situs. Ubah sesuai kebutuhan.
return [
    // Lokasi database SQLite (dibuat otomatis saat pertama kali dibuka)
    'db_path'    => __DIR__ . '/data/travel.sqlite',

    // Bukti pembayaran disimpan di folder privat (tidak bisa dibuka langsung dari browser)
    'bukti_dir'  => __DIR__ . '/data/bukti',

    // Foto tujuan hasil unggahan admin (boleh dibuka publik)
    'foto_dir'   => __DIR__ . '/uploads/tujuan',
    'foto_url'   => 'uploads/tujuan',

    // Akun admin pertama. Hanya dipakai SEKALI, saat database dibuat.
    // Setelah login, segera ganti kata sandinya lewat tombol "Ganti kata sandi".
    'admin_nama'  => 'Admin',
    'admin_email' => 'admin@travel.com',
    'admin_sandi' => 'admin123',

    // Nomor WhatsApp untuk tombol konfirmasi (format 62...)
    'nomor_wa'   => '6285864923309',

    // Ukuran maksimal unggahan gambar (byte). 3 MB.
    'maks_upload' => 3 * 1024 * 1024,
];
