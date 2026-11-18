<?php
declare(strict_types=1);

date_default_timezone_set('Asia/Jakarta');

function config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $cfg = require __DIR__ . '/config.php';
    }
    return $cfg;
}

function amankanFolder(string $dir, string $isi): void
{
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    $f = $dir . '/.htaccess';
    if (!file_exists($f)) {
        file_put_contents($f, $isi);
    }
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    $cfg = config();

    // Folder data (database + bukti) tertutup dari akses langsung lewat browser
    amankanFolder(dirname($cfg['db_path']), "Require all denied\n");
    amankanFolder($cfg['bukti_dir'], "Require all denied\n");
    // Folder unggahan publik: file PHP tidak boleh diakses/dijalankan
    amankanFolder(dirname($cfg['foto_dir']), "<FilesMatch \"\\.(php|phtml|phar)$\">\nRequire all denied\n</FilesMatch>\n");
    if (!is_dir($cfg['foto_dir'])) {
        mkdir($cfg['foto_dir'], 0755, true);
    }

    $pdo = new PDO('sqlite:' . $cfg['db_path']);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA busy_timeout = 5000');

    buatSkema($pdo);
    isiAwal($pdo, $cfg);
    return $pdo;
}

function buatSkema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS pengguna (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nama TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        sandi_hash TEXT NOT NULL,
        peran TEXT NOT NULL DEFAULT 'pelanggan',
        dibuat TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS tujuan (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nama TEXT NOT NULL,
        harga INTEGER NOT NULL,
        faktor REAL NOT NULL DEFAULT 1,
        foto TEXT NOT NULL DEFAULT '',
        durasi TEXT NOT NULL DEFAULT '',
        deskripsi TEXT NOT NULL DEFAULT '',
        sorotan TEXT NOT NULL DEFAULT ''
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS paket (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nama TEXT NOT NULL,
        harga INTEGER NOT NULL,
        isi TEXT NOT NULL DEFAULT ''
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS tambahan (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nama TEXT NOT NULL,
        satuan TEXT NOT NULL,
        harga INTEGER NOT NULL
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS promo (
        kode TEXT PRIMARY KEY,
        tipe TEXT NOT NULL,
        nilai INTEGER NOT NULL,
        aktif INTEGER NOT NULL DEFAULT 1
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS pesanan (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kode TEXT NOT NULL UNIQUE,
        pengguna_id INTEGER NOT NULL REFERENCES pengguna(id),
        nama TEXT NOT NULL,
        tanggal TEXT NOT NULL,
        peserta INTEGER NOT NULL,
        subtotal INTEGER NOT NULL,
        promo_kode TEXT,
        diskon INTEGER NOT NULL DEFAULT 0,
        total INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'menunggu_pembayaran',
        bukti TEXT,
        dibuat TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS pesanan_item (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pesanan_id INTEGER NOT NULL REFERENCES pesanan(id) ON DELETE CASCADE,
        tipe TEXT NOT NULL,
        nama TEXT NOT NULL,
        harga INTEGER NOT NULL,
        jumlah INTEGER NOT NULL,
        subtotal INTEGER NOT NULL
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS percobaan_login (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kunci TEXT NOT NULL,
        waktu INTEGER NOT NULL
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)");

    // Migrasi: kolom "aktif" untuk database lama yang dibuat sebelum fitur kelola akun
    $adaAktif = false;
    foreach ($pdo->query('PRAGMA table_info(pengguna)')->fetchAll() as $kol) {
        if ($kol['name'] === 'aktif') {
            $adaAktif = true;
            break;
        }
    }
    if (!$adaAktif) {
        $pdo->exec('ALTER TABLE pengguna ADD COLUMN aktif INTEGER NOT NULL DEFAULT 1');
    }

    // Chat pelanggan <-> CS. Satu pelanggan = satu percakapan.
    $pdo->exec("CREATE TABLE IF NOT EXISTS chat_pesan (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pengguna_id INTEGER NOT NULL REFERENCES pengguna(id) ON DELETE CASCADE,
        pengirim TEXT NOT NULL,
        isi TEXT NOT NULL,
        dibaca INTEGER NOT NULL DEFAULT 0,
        dibuat TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )");
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_chat_pengguna ON chat_pesan (pengguna_id, id)');
}

function isiAwal(PDO $pdo, array $cfg): void
{
    $st = $pdo->query("SELECT v FROM meta WHERE k = 'terisi'");
    if ($st->fetchColumn() !== false) {
        return;
    }

    $pdo->beginTransaction();
    try {
        // Akun admin pertama
        $a = $pdo->prepare("INSERT OR IGNORE INTO pengguna (nama, email, sandi_hash, peran) VALUES (?, ?, ?, 'admin')");
        $a->execute([
            $cfg['admin_nama'],
            strtolower($cfg['admin_email']),
            password_hash($cfg['admin_sandi'], PASSWORD_DEFAULT),
        ]);

        // Tujuan: nama, harga, faktor, foto, durasi, deskripsi, sorotan
        $tujuan = [
            ['Gunung Bromo', 400000, 1, 'asset/blog1.jpg', '2 hari 1 malam',
                'Nikmati matahari terbit di atas lautan pasir dan kawah yang ikonik di Jawa Timur.',
                "Sunrise di Penanjakan\nLautan pasir dan Kawah Bromo\nSavana Bukit Teletubbies"],
            ['Yogyakarta', 300000, 0.8, 'asset/blog2.jpg', '2-3 hari',
                'Perpaduan budaya, sejarah, dan kuliner khas yang membuat siapa pun ingin kembali.',
                "Candi Prambanan dan Borobudur\nKeraton dan Taman Sari\nMalioboro dan angkringan"],
            ['Raja Ampat', 1500000, 4, 'asset/foto2.jpg', '4 hari 3 malam',
                'Gugusan pulau karang dengan laut jernih dan keanekaragaman bawah laut kelas dunia.',
                "Snorkeling dan diving\nPanorama gugusan pulau\nPantai pasir putih"],
            ['Bali', 450000, 1.2, 'asset/foto6.jpg', '3 hari 2 malam',
                'Pulau dewata dengan pura di tepi laut, sawah berundak, dan pantai yang tak pernah sepi.',
                "Pura Tanah Lot saat senja\nSawah berundak Tegallalang\nPantai dan kuliner khas"],
            ['Labuan Bajo', 1200000, 3, 'asset/foto4.jpg', '3 hari 2 malam',
                'Gerbang menuju Taman Nasional Komodo dengan pulau-pulau savana dan laut biru yang memukau.',
                "Trekking Pulau Padar\nMelihat komodo di habitatnya\nIsland hopping dan snorkeling"],
            ['Lombok', 700000, 1.6, 'asset/foto5.jpg', '3 hari 2 malam',
                'Pantai berpasir putih, gili yang tenang, dan panorama Rinjani yang menenangkan.',
                "Gili Trawangan, Meno, dan Air\nPantai pasir putih Selong Belanak\nKuliner dan budaya Sasak"],
        ];
        $t = $pdo->prepare('INSERT INTO tujuan (nama, harga, faktor, foto, durasi, deskripsi, sorotan) VALUES (?,?,?,?,?,?,?)');
        foreach ($tujuan as $r) {
            $t->execute($r);
        }

        $paket = [
            ['Paket A', 500000, "🏕️ Wisata 1 hari\n🚗 Transportasi\n🎟️ Tiket masuk"],
            ['Paket B', 1200000, "🏕️ Wisata 2 hari 1 malam\n🚗 Transportasi\n🏨 Penginapan\n🎫 Tour guide"],
            ['Paket C', 2000000, "🏕️ Wisata 3 hari 2 malam\n🚗 Transportasi\n🏨 Penginapan\n🎫 Tour guide\n📸 Dokumentasi foto & video"],
        ];
        $p = $pdo->prepare('INSERT INTO paket (nama, harga, isi) VALUES (?,?,?)');
        foreach ($paket as $r) {
            $p->execute($r);
        }

        $tambahan = [
            ['Transportasi', 'hari', 300000],
            ['Penginapan', 'malam', 250000],
            ['Tour Guide', 'hari', 200000],
            ['Tiket Masuk', 'orang', 50000],
            ['Dokumentasi Foto & Video', 'paket', 150000],
        ];
        $x = $pdo->prepare('INSERT INTO tambahan (nama, satuan, harga) VALUES (?,?,?)');
        foreach ($tambahan as $r) {
            $x->execute($r);
        }

        $pr = $pdo->prepare('INSERT OR IGNORE INTO promo (kode, tipe, nilai, aktif) VALUES (?,?,?,1)');
        $pr->execute(['HEMAT10', 'persen', 10]);
        $pr->execute(['DISKON50K', 'nominal', 50000]);

        $pdo->exec("INSERT INTO meta (k, v) VALUES ('terisi', '1')");
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}
