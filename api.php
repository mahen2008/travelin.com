<?php
declare(strict_types=1);

require __DIR__ . '/db.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

ini_set('session.use_strict_mode', '1');
session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'httponly' => true,
    'samesite' => 'Lax',
    'secure'   => !empty($_SERVER['HTTPS']),
]);
session_start();
if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

const STATUS_VALID = ['menunggu_pembayaran', 'menunggu_verifikasi', 'lunas', 'batal'];
const JENIS_TABEL  = ['tujuan' => 'tujuan', 'paket' => 'paket', 'tambahan' => 'tambahan'];

// ---------- Utilitas respons & validasi ----------

function kirim(array $data, int $kode = 200)
{
    http_response_code($kode);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function galat(string $pesan, int $kode = 400)
{
    kirim(['ok' => false, 'galat' => $pesan], $kode);
}

function masukan(): array
{
    $ct = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($ct, 'application/json') !== false) {
        $j = json_decode(file_get_contents('php://input') ?: '', true);
        return is_array($j) ? $j : [];
    }
    return $_POST;
}

function wajibPost(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        galat('Metode tidak diizinkan.', 405);
    }
    $t = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($t) || !hash_equals($_SESSION['csrf'], $t)) {
        galat('Sesi tidak valid. Muat ulang halaman lalu coba lagi.', 403);
    }
}

function penggunaSaatIni(): ?array
{
    static $cache = false;
    if ($cache !== false) {
        return $cache;
    }
    $cache = null;
    if (!empty($_SESSION['uid'])) {
        $st = db()->prepare('SELECT id, nama, email, peran, aktif FROM pengguna WHERE id = ?');
        $st->execute([$_SESSION['uid']]);
        $r = $st->fetch();
        if ($r && (int)$r['aktif'] === 1) {
            $r['id'] = (int)$r['id'];
            unset($r['aktif']);
            $cache = $r;
        } else {
            unset($_SESSION['uid']);
        }
    }
    return $cache;
}

function wajibLogin(): array
{
    $u = penggunaSaatIni();
    if (!$u) {
        galat('Silakan masuk terlebih dahulu.', 401);
    }
    return $u;
}

function wajibAdmin(): array
{
    $u = wajibLogin();
    if ($u['peran'] !== 'admin') {
        galat('Hanya admin yang dapat melakukan ini.', 403);
    }
    return $u;
}

function teks($v, int $min, int $maks, string $label): string
{
    $v = trim((string)$v);
    $p = mb_strlen($v);
    if ($p < $min) {
        galat("$label wajib diisi.");
    }
    if ($p > $maks) {
        galat("$label terlalu panjang (maksimal $maks karakter).");
    }
    return $v;
}

function angka($v, int $min, int $maks, string $label): int
{
    if (!is_numeric($v) || (float)$v != floor((float)$v)) {
        galat("$label harus berupa angka bulat.");
    }
    $n = (int)$v;
    if ($n < $min || $n > $maks) {
        galat("$label harus antara $min dan $maks.");
    }
    return $n;
}

function barisList($v, int $maksBaris, int $maksPanjang): string
{
    $out = [];
    foreach (preg_split('/\R/u', (string)$v) ?: [] as $b) {
        $b = trim($b);
        if ($b === '') {
            continue;
        }
        $out[] = mb_substr($b, 0, $maksPanjang);
        if (count($out) >= $maksBaris) {
            break;
        }
    }
    return implode("\n", $out);
}

function pecahBaris(string $s): array
{
    return $s === '' ? [] : explode("\n", $s);
}

function hargaEfektif(int $dasar, float $faktor): int
{
    if (abs($faktor - 1.0) < 1e-9) {
        return $dasar;
    }
    return (int)(round($dasar * $faktor / 1000) * 1000);
}

// ---------- Percobaan login (pembatasan) ----------

function kunciPercobaan(string $email): string
{
    return $email . '|' . ($_SERVER['REMOTE_ADDR'] ?? '');
}

function batasiPercobaan(string $email): void
{
    $pdo = db();
    $pdo->prepare('DELETE FROM percobaan_login WHERE waktu < ?')->execute([time() - 600]);
    $st = $pdo->prepare('SELECT COUNT(*) FROM percobaan_login WHERE kunci = ?');
    $st->execute([kunciPercobaan($email)]);
    if ((int)$st->fetchColumn() >= 5) {
        galat('Terlalu banyak percobaan. Coba lagi dalam 10 menit.', 429);
    }
}

function catatGagal(string $email): void
{
    db()->prepare('INSERT INTO percobaan_login (kunci, waktu) VALUES (?, ?)')
        ->execute([kunciPercobaan($email), time()]);
}

function mulaiSesi(int $uid): void
{
    session_regenerate_id(true);
    $_SESSION['uid'] = $uid;
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

// ---------- Berkas unggahan ----------

function simpanGambar(array $f, string $dir, int $maks): string
{
    if (($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        galat('Unggah gambar gagal. Pastikan ukurannya tidak melebihi batas.');
    }
    if ((int)$f['size'] > $maks) {
        galat('Ukuran gambar terlalu besar (maksimal ' . round($maks / 1048576, 1) . ' MB).');
    }
    if (!is_uploaded_file($f['tmp_name'])) {
        galat('Berkas tidak valid.');
    }
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
    $daftarExt = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    $ext = $daftarExt[$mime] ?? null;
    if ($ext === null || @getimagesize($f['tmp_name']) === false) {
        galat('Format gambar harus JPG, PNG, atau WebP.');
    }
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    $nama = bin2hex(random_bytes(16)) . '.' . $ext;
    if (!move_uploaded_file($f['tmp_name'], $dir . '/' . $nama)) {
        galat('Gagal menyimpan gambar di server.', 500);
    }
    return $nama;
}

function cekUnggahanKosong(): void
{
    // Jika berkas melebihi post_max_size, PHP mengosongkan $_POST dan $_FILES
    if (empty($_FILES) && empty($_POST) && (int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
        galat('Ukuran berkas melebihi batas server.');
    }
}

function fotoValid(string $f): bool
{
    if (str_contains($f, '..')) {
        return false;
    }
    return (bool)(preg_match('#^(asset|uploads)/[A-Za-z0-9_\-./]+$#', $f) || preg_match('#^https?://[^\s"\'<>]+$#i', $f));
}

function hapusFotoLokal(string $foto): void
{
    if (preg_match('#^uploads/tujuan/([a-f0-9]{32}\.(jpg|png|webp))$#', $foto, $m)) {
        $path = config()['foto_dir'] . '/' . $m[1];
        if (is_file($path)) {
            @unlink($path);
        }
    }
}

// ---------- Format data ----------

function formatTujuan(array $r): array
{
    return [
        'id' => (string)$r['id'], 'nama' => $r['nama'], 'harga' => (int)$r['harga'],
        'faktor' => (float)$r['faktor'], 'foto' => $r['foto'], 'durasi' => $r['durasi'],
        'deskripsi' => $r['deskripsi'], 'sorotan' => pecahBaris($r['sorotan']),
    ];
}

function ambilPesanan(string $where, array $params, bool $admin, int $batas = 200): array
{
    $pdo = db();
    $sql = 'SELECT p.*, u.nama AS pemesan, u.email AS email_pemesan
            FROM pesanan p JOIN pengguna u ON u.id = p.pengguna_id ' . $where .
           ' ORDER BY p.id DESC LIMIT ' . (int)$batas;
    $st = $pdo->prepare($sql);
    $st->execute($params);
    $rows = $st->fetchAll();
    if (!$rows) {
        return [];
    }
    $ids = array_map(fn($r) => (int)$r['id'], $rows);
    $in = implode(',', array_fill(0, count($ids), '?'));
    $si = $pdo->prepare("SELECT * FROM pesanan_item WHERE pesanan_id IN ($in) ORDER BY id");
    $si->execute($ids);
    $items = [];
    foreach ($si->fetchAll() as $i) {
        $items[(int)$i['pesanan_id']][] = [
            'tipe' => $i['tipe'], 'nama' => $i['nama'], 'harga' => (int)$i['harga'],
            'jumlah' => (int)$i['jumlah'], 'subtotal' => (int)$i['subtotal'],
        ];
    }
    $hasil = [];
    foreach ($rows as $r) {
        $o = [
            'kode' => $r['kode'], 'nama' => $r['nama'], 'tanggal' => $r['tanggal'],
            'peserta' => (int)$r['peserta'], 'subtotal' => (int)$r['subtotal'],
            'promo_kode' => $r['promo_kode'], 'diskon' => (int)$r['diskon'],
            'total' => (int)$r['total'], 'status' => $r['status'],
            'ada_bukti' => !empty($r['bukti']), 'dibuat' => $r['dibuat'],
            'items' => $items[(int)$r['id']] ?? [],
        ];
        if ($admin) {
            $o['pemesan'] = $r['pemesan'];
            $o['email'] = $r['email_pemesan'];
        }
        $hasil[] = $o;
    }
    return $hasil;
}

function formatChat(array $r): array
{
    return [
        'id' => (int)$r['id'], 'pengirim' => $r['pengirim'],
        'isi' => $r['isi'], 'dibuat' => $r['dibuat'],
    ];
}

function infoPromo(array $p): array
{
    $ket = $p['tipe'] === 'persen'
        ? 'Diskon ' . (int)$p['nilai'] . '%'
        : 'Potongan Rp ' . number_format((int)$p['nilai'], 0, ',', '.');
    return ['kode' => $p['kode'], 'tipe' => $p['tipe'], 'nilai' => (int)$p['nilai'], 'ket' => $ket, 'aktif' => (int)$p['aktif']];
}

// ---------- Router ----------

$aksi = (string)($_GET['aksi'] ?? '');
$cfg = config();

try {
    switch ($aksi) {

        // ===== Sesi & akun =====
        case 'sesi':
            $u = penggunaSaatIni();
            kirim(['ok' => true, 'pengguna' => $u, 'csrf' => $_SESSION['csrf'], 'nomor_wa' => $cfg['nomor_wa']]);
            break;

        case 'daftar':
            wajibPost();
            $in = masukan();
            $nama = teks($in['nama'] ?? '', 1, 60, 'Nama');
            $email = strtolower(trim((string)($in['email'] ?? '')));
            $sandi = (string)($in['sandi'] ?? '');
            if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 120) {
                galat('Format email tidak valid.');
            }
            if (mb_strlen($sandi) < 8) {
                galat('Kata sandi minimal 8 karakter.');
            }
            if (strlen($sandi) > 200) {
                galat('Kata sandi terlalu panjang.');
            }
            $pdo = db();
            $cek = $pdo->prepare('SELECT 1 FROM pengguna WHERE email = ?');
            $cek->execute([$email]);
            if ($cek->fetchColumn()) {
                galat('Email sudah terdaftar. Silakan masuk.');
            }
            try {
                $pdo->prepare("INSERT INTO pengguna (nama, email, sandi_hash, peran) VALUES (?, ?, ?, 'pelanggan')")
                    ->execute([$nama, $email, password_hash($sandi, PASSWORD_DEFAULT)]);
            } catch (PDOException $e) {
                galat('Email sudah terdaftar. Silakan masuk.');
            }
            mulaiSesi((int)$pdo->lastInsertId());
            kirim(['ok' => true, 'pengguna' => ['id' => (int)$_SESSION['uid'], 'nama' => $nama, 'email' => $email, 'peran' => 'pelanggan'], 'csrf' => $_SESSION['csrf']]);
            break;

        case 'masuk':
            wajibPost();
            $in = masukan();
            $email = strtolower(trim((string)($in['email'] ?? '')));
            $sandi = (string)($in['sandi'] ?? '');
            if ($email === '' || $sandi === '') {
                galat('Isi email dan kata sandi.');
            }
            batasiPercobaan($email);
            $st = db()->prepare('SELECT * FROM pengguna WHERE email = ?');
            $st->execute([$email]);
            $u = $st->fetch();
            if (!$u) {
                password_hash($sandi, PASSWORD_DEFAULT); // samakan waktu respons
                catatGagal($email);
                galat('Email atau kata sandi salah.', 401);
            }
            if (!password_verify($sandi, $u['sandi_hash'])) {
                catatGagal($email);
                galat('Email atau kata sandi salah.', 401);
            }
            if ((int)$u['aktif'] !== 1) {
                galat('Akun ini dinonaktifkan. Hubungi admin untuk bantuan.', 403);
            }
            db()->prepare('DELETE FROM percobaan_login WHERE kunci = ?')->execute([kunciPercobaan($email)]);
            mulaiSesi((int)$u['id']);
            kirim(['ok' => true, 'pengguna' => ['id' => (int)$u['id'], 'nama' => $u['nama'], 'email' => $u['email'], 'peran' => $u['peran']], 'csrf' => $_SESSION['csrf']]);
            break;

        case 'keluar':
            wajibPost();
            $_SESSION = [];
            session_destroy();
            kirim(['ok' => true]);
            break;

        case 'ganti_sandi':
            wajibPost();
            $u = wajibLogin();
            $in = masukan();
            $lama = (string)($in['sandi_lama'] ?? '');
            $baru = (string)($in['sandi_baru'] ?? '');
            if (mb_strlen($baru) < 8) {
                galat('Kata sandi baru minimal 8 karakter.');
            }
            if (strlen($baru) > 200) {
                galat('Kata sandi terlalu panjang.');
            }
            $st = db()->prepare('SELECT sandi_hash FROM pengguna WHERE id = ?');
            $st->execute([$u['id']]);
            if (!password_verify($lama, (string)$st->fetchColumn())) {
                galat('Kata sandi lama salah.');
            }
            db()->prepare('UPDATE pengguna SET sandi_hash = ? WHERE id = ?')
                ->execute([password_hash($baru, PASSWORD_DEFAULT), $u['id']]);
            kirim(['ok' => true]);
            break;

        // ===== Katalog =====
        case 'katalog':
            wajibLogin();
            $pdo = db();
            $tujuan = array_map('formatTujuan', $pdo->query('SELECT * FROM tujuan ORDER BY id')->fetchAll());
            $paket = array_map(function ($r) {
                return ['id' => (string)$r['id'], 'nama' => $r['nama'], 'harga' => (int)$r['harga'], 'isi' => pecahBaris($r['isi'])];
            }, $pdo->query('SELECT * FROM paket ORDER BY id')->fetchAll());
            $tambahan = array_map(function ($r) {
                return ['id' => (string)$r['id'], 'nama' => $r['nama'], 'satuan' => $r['satuan'], 'harga' => (int)$r['harga']];
            }, $pdo->query('SELECT * FROM tambahan ORDER BY id')->fetchAll());
            kirim(['ok' => true, 'tujuan' => $tujuan, 'paket' => $paket, 'tambahan' => $tambahan]);
            break;

        case 'simpan_item':
            wajibPost();
            wajibAdmin();
            cekUnggahanKosong();
            $in = masukan();
            $jenis = (string)($in['jenis'] ?? '');
            if (!isset(JENIS_TABEL[$jenis])) {
                galat('Jenis data tidak dikenal.');
            }
            $id = (int)($in['id'] ?? 0);
            $pdo = db();
            $nama = teks($in['nama'] ?? '', 1, 100, 'Nama');
            $harga = angka($in['harga'] ?? '', 0, 1000000000, 'Harga');

            if ($jenis === 'tujuan') {
                $faktor = (float)($in['faktor'] ?? 1);
                if (!is_finite($faktor) || $faktor < 0.1 || $faktor > 100) {
                    galat('Pengali harga harus antara 0,1 dan 100.');
                }
                $durasi = teks($in['durasi'] ?? '', 0, 60, 'Durasi');
                $deskripsi = teks($in['deskripsi'] ?? '', 0, 1000, 'Deskripsi');
                $sorotan = barisList($in['sorotan'] ?? '', 10, 120);
                $foto = trim((string)($in['foto'] ?? ''));
                if ($foto !== '' && !fotoValid($foto)) {
                    galat('Alamat foto tidak valid. Gunakan nama file di folder asset (contoh: asset/bali.jpg), alamat gambar https, atau unggah gambar.');
                }
                $lama = null;
                if ($id) {
                    $st = $pdo->prepare('SELECT foto FROM tujuan WHERE id = ?');
                    $st->execute([$id]);
                    $lama = $st->fetch();
                    if (!$lama) {
                        galat('Tujuan tidak ditemukan.', 404);
                    }
                }
                if (!empty($_FILES['foto_file']) && ($_FILES['foto_file']['error'] ?? 0) !== UPLOAD_ERR_NO_FILE) {
                    $nm = simpanGambar($_FILES['foto_file'], $cfg['foto_dir'], (int)$cfg['maks_upload']);
                    $foto = $cfg['foto_url'] . '/' . $nm;
                }
                if ($id) {
                    $pdo->prepare('UPDATE tujuan SET nama=?, harga=?, faktor=?, foto=?, durasi=?, deskripsi=?, sorotan=? WHERE id=?')
                        ->execute([$nama, $harga, $faktor, $foto, $durasi, $deskripsi, $sorotan, $id]);
                    if ($lama && $lama['foto'] !== $foto) {
                        hapusFotoLokal((string)$lama['foto']);
                    }
                } else {
                    $pdo->prepare('INSERT INTO tujuan (nama, harga, faktor, foto, durasi, deskripsi, sorotan) VALUES (?,?,?,?,?,?,?)')
                        ->execute([$nama, $harga, $faktor, $foto, $durasi, $deskripsi, $sorotan]);
                }
            } elseif ($jenis === 'paket') {
                $isi = barisList($in['isi'] ?? '', 15, 120);
                if ($id) {
                    $pdo->prepare('UPDATE paket SET nama=?, harga=?, isi=? WHERE id=?')->execute([$nama, $harga, $isi, $id]);
                } else {
                    $pdo->prepare('INSERT INTO paket (nama, harga, isi) VALUES (?,?,?)')->execute([$nama, $harga, $isi]);
                }
            } else {
                $satuan = teks($in['satuan'] ?? '', 1, 30, 'Satuan');
                if ($id) {
                    $pdo->prepare('UPDATE tambahan SET nama=?, satuan=?, harga=? WHERE id=?')->execute([$nama, $satuan, $harga, $id]);
                } else {
                    $pdo->prepare('INSERT INTO tambahan (nama, satuan, harga) VALUES (?,?,?)')->execute([$nama, $satuan, $harga]);
                }
            }
            kirim(['ok' => true]);
            break;

        case 'hapus_item':
            wajibPost();
            wajibAdmin();
            $in = masukan();
            $jenis = (string)($in['jenis'] ?? '');
            if (!isset(JENIS_TABEL[$jenis])) {
                galat('Jenis data tidak dikenal.');
            }
            $id = (int)($in['id'] ?? 0);
            $pdo = db();
            if ($jenis === 'tujuan') {
                $st = $pdo->prepare('SELECT foto FROM tujuan WHERE id = ?');
                $st->execute([$id]);
                $foto = $st->fetchColumn();
                if ($foto !== false) {
                    hapusFotoLokal((string)$foto);
                }
            }
            $pdo->prepare('DELETE FROM ' . JENIS_TABEL[$jenis] . ' WHERE id = ?')->execute([$id]);
            kirim(['ok' => true]);
            break;

        // ===== Promo =====
        case 'cek_promo':
            wajibLogin();
            $kode = strtoupper(trim((string)($_GET['kode'] ?? '')));
            $st = db()->prepare('SELECT * FROM promo WHERE kode = ? AND aktif = 1');
            $st->execute([$kode]);
            $p = $st->fetch();
            if (!$p) {
                galat('Kode promo tidak valid.');
            }
            kirim(['ok' => true, 'promo' => infoPromo($p)]);
            break;

        case 'daftar_promo':
            wajibAdmin();
            $rows = db()->query('SELECT * FROM promo ORDER BY kode')->fetchAll();
            kirim(['ok' => true, 'promo' => array_map('infoPromo', $rows)]);
            break;

        case 'simpan_promo':
            wajibPost();
            wajibAdmin();
            $in = masukan();
            $kode = strtoupper(trim((string)($in['kode'] ?? '')));
            if (!preg_match('/^[A-Z0-9_\-]{3,20}$/', $kode)) {
                galat('Kode promo 3-20 karakter: huruf, angka, tanda minus, atau garis bawah.');
            }
            $tipe = (string)($in['tipe'] ?? '');
            if (!in_array($tipe, ['persen', 'nominal'], true)) {
                galat('Tipe promo tidak valid.');
            }
            $nilai = angka($in['nilai'] ?? '', 1, 1000000000, 'Nilai');
            if ($tipe === 'persen' && $nilai > 100) {
                galat('Diskon persen maksimal 100.');
            }
            $aktif = isset($in['aktif']) ? ((int)(bool)$in['aktif']) : 1;
            db()->prepare('INSERT INTO promo (kode, tipe, nilai, aktif) VALUES (?,?,?,?)
                           ON CONFLICT(kode) DO UPDATE SET tipe = excluded.tipe, nilai = excluded.nilai, aktif = excluded.aktif')
                ->execute([$kode, $tipe, $nilai, $aktif]);
            kirim(['ok' => true]);
            break;

        case 'hapus_promo':
            wajibPost();
            wajibAdmin();
            $in = masukan();
            db()->prepare('DELETE FROM promo WHERE kode = ?')->execute([strtoupper(trim((string)($in['kode'] ?? '')))]);
            kirim(['ok' => true]);
            break;

        // ===== Pesanan (pelanggan) =====
        case 'pesan':
            wajibPost();
            $u = wajibLogin();
            if ($u['peran'] === 'admin') {
                galat('Akun admin tidak dapat membuat pesanan.', 403);
            }
            $in = masukan();
            $pdo = db();

            $st = $pdo->prepare('SELECT * FROM tujuan WHERE id = ?');
            $st->execute([(int)($in['tujuan'] ?? 0)]);
            $t = $st->fetch();
            if (!$t) {
                galat('Pilih tujuan wisata terlebih dahulu.');
            }
            $nama = teks($in['nama'] ?? '', 1, 60, 'Nama');
            $tanggal = (string)($in['tanggal'] ?? '');
            if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $tanggal, $m) || !checkdate((int)$m[2], (int)$m[3], (int)$m[1])) {
                galat('Tanggal keberangkatan tidak valid.');
            }
            if ($tanggal < date('Y-m-d')) {
                galat('Tanggal keberangkatan tidak boleh sebelum hari ini.');
            }
            $peserta = angka($in['peserta'] ?? 1, 1, 50, 'Jumlah peserta');
            $faktor = (float)$t['faktor'];

            $baris = [];
            $subtotal = 0;
            $h = (int)$t['harga'];
            $baris[] = ['tujuan', $t['nama'], $h, $peserta, $h * $peserta];
            $subtotal += $h * $peserta;

            if (!empty($in['paket'])) {
                $sp = $pdo->prepare('SELECT * FROM paket WHERE id = ?');
                $sp->execute([(int)$in['paket']]);
                $pk = $sp->fetch();
                if (!$pk) {
                    galat('Paket yang dipilih tidak ditemukan.');
                }
                $hp = hargaEfektif((int)$pk['harga'], $faktor);
                $baris[] = ['paket', $pk['nama'], $hp, $peserta, $hp * $peserta];
                $subtotal += $hp * $peserta;
            }

            $items = is_array($in['items'] ?? null) ? $in['items'] : [];
            if (count($items) > 50) {
                galat('Terlalu banyak item tambahan.');
            }
            $sx = $pdo->prepare('SELECT * FROM tambahan WHERE id = ?');
            foreach ($items as $idItem => $n) {
                $n = (int)$n;
                if ($n <= 0) {
                    continue;
                }
                if ($n > 99) {
                    galat('Jumlah item tambahan maksimal 99.');
                }
                $sx->execute([(int)$idItem]);
                $x = $sx->fetch();
                if (!$x) {
                    galat('Item tambahan tidak ditemukan. Muat ulang halaman.');
                }
                $hx = hargaEfektif((int)$x['harga'], $faktor);
                $baris[] = ['tambahan', $x['nama'] . ' (per ' . $x['satuan'] . ')', $hx, $n, $hx * $n];
                $subtotal += $hx * $n;
            }

            $promoKode = null;
            $diskon = 0;
            $kp = strtoupper(trim((string)($in['promo'] ?? '')));
            if ($kp !== '') {
                $sr = $pdo->prepare('SELECT * FROM promo WHERE kode = ? AND aktif = 1');
                $sr->execute([$kp]);
                $pr = $sr->fetch();
                if (!$pr) {
                    galat('Kode promo tidak valid.');
                }
                $promoKode = $pr['kode'];
                $diskon = $pr['tipe'] === 'persen'
                    ? (int)round($subtotal * (int)$pr['nilai'] / 100)
                    : min((int)$pr['nilai'], $subtotal);
            }
            $total = $subtotal - $diskon;

            $pdo->beginTransaction();
            try {
                do {
                    $kode = 'TRV-' . date('ymd') . '-' . strtoupper(bin2hex(random_bytes(2)));
                    $ada = $pdo->prepare('SELECT 1 FROM pesanan WHERE kode = ?');
                    $ada->execute([$kode]);
                } while ($ada->fetchColumn());

                $pdo->prepare('INSERT INTO pesanan (kode, pengguna_id, nama, tanggal, peserta, subtotal, promo_kode, diskon, total)
                               VALUES (?,?,?,?,?,?,?,?,?)')
                    ->execute([$kode, $u['id'], $nama, $tanggal, $peserta, $subtotal, $promoKode, $diskon, $total]);
                $pid = (int)$pdo->lastInsertId();
                $si = $pdo->prepare('INSERT INTO pesanan_item (pesanan_id, tipe, nama, harga, jumlah, subtotal) VALUES (?,?,?,?,?,?)');
                foreach ($baris as $b) {
                    $si->execute([$pid, $b[0], $b[1], $b[2], $b[3], $b[4]]);
                }
                $pdo->commit();
            } catch (Throwable $e) {
                $pdo->rollBack();
                throw $e;
            }
            $hasil = ambilPesanan('WHERE p.id = ?', [$pid], false, 1);
            kirim(['ok' => true, 'pesanan' => $hasil[0]]);
            break;

        case 'pesanan_saya':
            $u = wajibLogin();
            kirim(['ok' => true, 'pesanan' => ambilPesanan('WHERE p.pengguna_id = ?', [$u['id']], false, 100)]);
            break;

        case 'upload_bukti':
            wajibPost();
            $u = wajibLogin();
            cekUnggahanKosong();
            $kode = (string)($_POST['kode'] ?? '');
            $st = db()->prepare('SELECT * FROM pesanan WHERE kode = ? AND pengguna_id = ?');
            $st->execute([$kode, $u['id']]);
            $p = $st->fetch();
            if (!$p) {
                galat('Pesanan tidak ditemukan.', 404);
            }
            if (!in_array($p['status'], ['menunggu_pembayaran', 'menunggu_verifikasi'], true)) {
                galat('Pesanan ini tidak dapat menerima bukti pembayaran.');
            }
            if (empty($_FILES['bukti'])) {
                galat('Pilih berkas bukti pembayaran terlebih dahulu.');
            }
            $nm = simpanGambar($_FILES['bukti'], $cfg['bukti_dir'], (int)$cfg['maks_upload']);
            if (!empty($p['bukti'])) {
                $lama = $cfg['bukti_dir'] . '/' . basename((string)$p['bukti']);
                if (is_file($lama)) {
                    @unlink($lama);
                }
            }
            db()->prepare("UPDATE pesanan SET bukti = ?, status = 'menunggu_verifikasi' WHERE id = ?")->execute([$nm, $p['id']]);
            kirim(['ok' => true]);
            break;

        case 'bukti':
            $u = wajibLogin();
            $kode = (string)($_GET['kode'] ?? '');
            $st = db()->prepare('SELECT pengguna_id, bukti FROM pesanan WHERE kode = ?');
            $st->execute([$kode]);
            $p = $st->fetch();
            if (!$p || empty($p['bukti'])) {
                galat('Bukti tidak ditemukan.', 404);
            }
            if ($u['peran'] !== 'admin' && (int)$p['pengguna_id'] !== $u['id']) {
                galat('Tidak diizinkan.', 403);
            }
            $path = $cfg['bukti_dir'] . '/' . basename((string)$p['bukti']);
            if (!is_file($path)) {
                galat('Berkas bukti tidak ditemukan.', 404);
            }
            $mime = (new finfo(FILEINFO_MIME_TYPE))->file($path) ?: 'application/octet-stream';
            header('Content-Type: ' . $mime);
            header('Content-Length: ' . filesize($path));
            header('Content-Disposition: inline');
            readfile($path);
            exit;

        case 'batalkan':
            wajibPost();
            $u = wajibLogin();
            $in = masukan();
            $st = db()->prepare('SELECT id, status FROM pesanan WHERE kode = ? AND pengguna_id = ?');
            $st->execute([(string)($in['kode'] ?? ''), $u['id']]);
            $p = $st->fetch();
            if (!$p) {
                galat('Pesanan tidak ditemukan.', 404);
            }
            if ($p['status'] !== 'menunggu_pembayaran') {
                galat('Hanya pesanan yang belum dibayar yang dapat dibatalkan.');
            }
            db()->prepare("UPDATE pesanan SET status = 'batal' WHERE id = ?")->execute([$p['id']]);
            kirim(['ok' => true]);
            break;

        // ===== Pesanan (admin) =====
        case 'semua_pesanan':
            wajibAdmin();
            kirim(['ok' => true, 'pesanan' => ambilPesanan('', [], true, 200)]);
            break;

        case 'ubah_status':
            wajibPost();
            wajibAdmin();
            $in = masukan();
            $status = (string)($in['status'] ?? '');
            if (!in_array($status, STATUS_VALID, true)) {
                galat('Status tidak valid.');
            }
            $st = db()->prepare('UPDATE pesanan SET status = ? WHERE kode = ?');
            $st->execute([$status, (string)($in['kode'] ?? '')]);
            if ($st->rowCount() === 0) {
                galat('Pesanan tidak ditemukan.', 404);
            }
            kirim(['ok' => true]);
            break;

        // ===== Kelola akun pelanggan (admin) =====
        case 'daftar_pengguna':
            wajibAdmin();
            $rows = db()->query("SELECT u.id, u.nama, u.email, u.aktif, u.dibuat,
                    (SELECT COUNT(*) FROM pesanan p WHERE p.pengguna_id = u.id) AS jumlah_pesanan
                FROM pengguna u WHERE u.peran = 'pelanggan' ORDER BY u.id DESC LIMIT 500")->fetchAll();
            kirim(['ok' => true, 'pengguna' => array_map(function ($r) {
                return [
                    'id' => (int)$r['id'], 'nama' => $r['nama'], 'email' => $r['email'],
                    'aktif' => (int)$r['aktif'], 'dibuat' => $r['dibuat'],
                    'jumlah_pesanan' => (int)$r['jumlah_pesanan'],
                ];
            }, $rows)]);
            break;

        case 'ubah_pengguna':
            wajibPost();
            wajibAdmin();
            $in = masukan();
            $id = (int)($in['id'] ?? 0);
            $pdo = db();
            $st = $pdo->prepare("SELECT id FROM pengguna WHERE id = ? AND peran = 'pelanggan'");
            $st->execute([$id]);
            if (!$st->fetch()) {
                galat('Akun pelanggan tidak ditemukan.', 404);
            }
            $nama = teks($in['nama'] ?? '', 1, 60, 'Nama');
            $email = strtolower(trim((string)($in['email'] ?? '')));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 120) {
                galat('Format email tidak valid.');
            }
            $aktif = !empty($in['aktif']) ? 1 : 0;
            $cek = $pdo->prepare('SELECT 1 FROM pengguna WHERE email = ? AND id <> ?');
            $cek->execute([$email, $id]);
            if ($cek->fetchColumn()) {
                galat('Email sudah dipakai akun lain.');
            }
            $pdo->prepare('UPDATE pengguna SET nama = ?, email = ?, aktif = ? WHERE id = ?')
                ->execute([$nama, $email, $aktif, $id]);
            kirim(['ok' => true]);
            break;

        case 'reset_sandi':
            wajibPost();
            wajibAdmin();
            $in = masukan();
            $id = (int)($in['id'] ?? 0);
            $baru = (string)($in['sandi_baru'] ?? '');
            if (mb_strlen($baru) < 8) {
                galat('Kata sandi baru minimal 8 karakter.');
            }
            if (strlen($baru) > 200) {
                galat('Kata sandi terlalu panjang.');
            }
            $st = db()->prepare("UPDATE pengguna SET sandi_hash = ? WHERE id = ? AND peran = 'pelanggan'");
            $st->execute([password_hash($baru, PASSWORD_DEFAULT), $id]);
            if ($st->rowCount() === 0) {
                galat('Akun pelanggan tidak ditemukan.', 404);
            }
            kirim(['ok' => true]);
            break;

            case 'hapus_pengguna':
               wajibPost();
               wajibAdmin();
               $in = masukan();
               $id = (int)($in['id'] ?? 0);
               $pdo = db();
               $st = $pdo->prepare("SELECT id FROM pengguna WHERE id = ? AND peran = 'pelanggan'");
               $st->execute([$id]);
               if (!$st->fetch()) {
               galat('Akun pelanggan tidak ditemukan.', 404);
             }
    
    
    $pdo->prepare('DELETE FROM pesanan WHERE pengguna_id = ?')->execute([$id]);

    // 2. Setelah itu hapus akun penggunanya
    $pdo->prepare('DELETE FROM pengguna WHERE id = ?')->execute([$id]);
    
    kirim(['ok' => true]);
    break;

        // ===== Chat CS: pelanggan =====
        case 'chat_ambil':
            $u = wajibLogin();
            if ($u['peran'] === 'admin') {
                galat('Gunakan panel chat admin.', 403);
            }
            $sejak = max(0, (int)($_GET['sejak'] ?? 0));
            $pdo = db();
            $st = $pdo->prepare('SELECT * FROM chat_pesan WHERE pengguna_id = ? AND id > ? ORDER BY id LIMIT 200');
            $st->execute([$u['id'], $sejak]);
            $rows = $st->fetchAll();
            $pdo->prepare("UPDATE chat_pesan SET dibaca = 1 WHERE pengguna_id = ? AND pengirim = 'cs' AND dibaca = 0")
                ->execute([$u['id']]);
            kirim(['ok' => true, 'pesan' => array_map('formatChat', $rows)]);
            break;

        case 'chat_kirim':
            wajibPost();
            $u = wajibLogin();
            if ($u['peran'] === 'admin') {
                galat('Gunakan panel chat admin.', 403);
            }
            $in = masukan();
            $isi = teks($in['isi'] ?? '', 1, 1000, 'Pesan');
            $pdo = db();
            $sc = $pdo->prepare("SELECT COUNT(*) FROM chat_pesan WHERE pengguna_id = ? AND pengirim = 'pelanggan' AND dibuat > datetime('now', '-1 minute')");
            $sc->execute([$u['id']]);
            if ((int)$sc->fetchColumn() >= 15) {
                galat('Terlalu banyak pesan. Tunggu sebentar lalu coba lagi.', 429);
            }
            $pdo->prepare("INSERT INTO chat_pesan (pengguna_id, pengirim, isi) VALUES (?, 'pelanggan', ?)")
                ->execute([$u['id'], $isi]);
            kirim(['ok' => true]);
            break;

        // ===== Chat CS: admin =====
        case 'chat_daftar':
            wajibAdmin();
            $rows = db()->query("SELECT u.id, u.nama, u.email,
                    (SELECT COUNT(*) FROM chat_pesan c WHERE c.pengguna_id = u.id AND c.pengirim = 'pelanggan' AND c.dibaca = 0) AS belum_dibaca,
                    (SELECT c.isi FROM chat_pesan c WHERE c.pengguna_id = u.id ORDER BY c.id DESC LIMIT 1) AS terakhir,
                    (SELECT MAX(c.id) FROM chat_pesan c WHERE c.pengguna_id = u.id) AS id_terakhir
                FROM pengguna u
                WHERE u.peran = 'pelanggan' AND EXISTS (SELECT 1 FROM chat_pesan c WHERE c.pengguna_id = u.id)
                ORDER BY id_terakhir DESC LIMIT 200")->fetchAll();
            $total = 0;
            $daftar = array_map(function ($r) use (&$total) {
                $total += (int)$r['belum_dibaca'];
                return [
                    'id' => (int)$r['id'], 'nama' => $r['nama'], 'email' => $r['email'],
                    'belum_dibaca' => (int)$r['belum_dibaca'],
                    'terakhir' => mb_substr((string)$r['terakhir'], 0, 60),
                ];
            }, $rows);
            kirim(['ok' => true, 'percakapan' => $daftar, 'total_belum_dibaca' => $total]);
            break;

        case 'chat_ambil_admin':
            wajibAdmin();
            $uid = (int)($_GET['pengguna_id'] ?? 0);
            $sejak = max(0, (int)($_GET['sejak'] ?? 0));
            $pdo = db();
            $st = $pdo->prepare('SELECT * FROM chat_pesan WHERE pengguna_id = ? AND id > ? ORDER BY id LIMIT 200');
            $st->execute([$uid, $sejak]);
            $rows = $st->fetchAll();
            $pdo->prepare("UPDATE chat_pesan SET dibaca = 1 WHERE pengguna_id = ? AND pengirim = 'pelanggan' AND dibaca = 0")
                ->execute([$uid]);
            kirim(['ok' => true, 'pesan' => array_map('formatChat', $rows)]);
            break;

        case 'chat_balas':
            wajibPost();
            wajibAdmin();
            $in = masukan();
            $uid = (int)($in['pengguna_id'] ?? 0);
            $isi = teks($in['isi'] ?? '', 1, 1000, 'Pesan');
            $pdo = db();
            $st = $pdo->prepare("SELECT 1 FROM pengguna WHERE id = ? AND peran = 'pelanggan'");
            $st->execute([$uid]);
            if (!$st->fetchColumn()) {
                galat('Pelanggan tidak ditemukan.', 404);
            }
            $pdo->prepare("INSERT INTO chat_pesan (pengguna_id, pengirim, isi) VALUES (?, 'cs', ?)")
                ->execute([$uid, $isi]);
            kirim(['ok' => true]);
            break;

        case 'chat_jumlah_belum':
            // Ringan, untuk badge: pelanggan = balasan CS belum dibaca, admin = pesan pelanggan belum dibaca
            $u = wajibLogin();
            $pengirim = $u['peran'] === 'admin' ? 'pelanggan' : 'cs';
            if ($u['peran'] === 'admin') {
                $st = db()->prepare('SELECT COUNT(*) FROM chat_pesan WHERE pengirim = ? AND dibaca = 0');
                $st->execute([$pengirim]);
            } else {
                $st = db()->prepare('SELECT COUNT(*) FROM chat_pesan WHERE pengirim = ? AND dibaca = 0 AND pengguna_id = ?');
                $st->execute([$pengirim, $u['id']]);
            }
            kirim(['ok' => true, 'jumlah' => (int)$st->fetchColumn()]);
            break;

        default:
            galat('Aksi tidak dikenal.', 404);
    }
} catch (Throwable $e) {
    error_log('[travel api] ' . $e->getMessage());
    galat('Terjadi kesalahan pada server.', 500);
}
