// ===== Menu hamburger =====
var tombolMenu = $(".tombol-menu");
var menu = $("nav .menu ul");

$(document).ready(function () {
    tombolMenu.click(function (e) {
        e.preventDefault();
        menu.toggle();
    });
    menu.click(function () {
        if ($(window).width() < 912) {
            menu.hide();
        }
    });
});

$(window).resize(function () {
    if ($(window).width() > 911) {
        menu.css("display", "flex");
    } else {
        menu.css("display", "none");
    }
});

// ===== Scroll: navbar putih, menu aktif, tombol kembali ke atas =====
var idSection = ["home", "aboutus", "support", "paket", "gallery", "team", "blog", "contact"];

function tandaiMenu() {
    var pos = $(window).scrollTop() + 120;
    var aktif = null;
    $.each(idSection, function (i, id) {
        var el = $("#" + id);
        if (el.length && el.offset().top <= pos) aktif = id;
    });
    $("nav .menu ul li a").removeClass("aktif");
    if (aktif) $('nav .menu ul li a[href="#' + aktif + '"]').addClass("aktif");
}

function aturScroll() {
    var y = $(window).scrollTop();
    if (y > 0) {
        $("nav").addClass("putih");
        $("nav img.hitam").show();
        $("nav img.putih").hide();
    } else {
        $("nav").removeClass("putih");
        $("nav img.hitam").hide();
        $("nav img.putih").show();
    }
    $("#ke-atas").toggleClass("tampil", y > 400);
    tandaiMenu();
}
$(window).on("scroll", aturScroll);
$(document).ready(aturScroll);

// ===== Animasi muncul saat scroll =====
(function () {
    var target = $(".form-pesan, .support > div, .tim > div, .testi, .blog .area, .faq details");
    if (!("IntersectionObserver" in window)) return;
    var pengamat = new IntersectionObserver(function (daftar) {
        daftar.forEach(function (e) {
            if (e.isIntersecting) {
                $(e.target).addClass("tampil");
                pengamat.unobserve(e.target);
            }
        });
    }, { threshold: 0.1 });
    target.each(function () {
        $(this).addClass("muncul");
        pengamat.observe(this);
    });
})();

// ===== Link "Help" membuka kotak chat (jika ada) =====
var linkChat = document.getElementById("buka-chat");
if (linkChat) {
    linkChat.addEventListener("click", function (e) {
        var tombol = document.querySelector(".cw-toggle");
        var panel = document.querySelector(".cw-panel");
        if (tombol && panel) {
            e.preventDefault();
            if (panel.hidden) tombol.click();
        }
    });
}

// =====================================================
//  KOMUNIKASI DENGAN SERVER (api.php)
// =====================================================
var csrf = "";
var pengguna = null;          // {id, nama, email, peran}
var NOMOR_WA = "";
var MAKS_UPLOAD = 3 * 1024 * 1024;

function bangunUrl(aksi, query) {
    var url = "api.php?aksi=" + encodeURIComponent(aksi);
    if (query) {
        $.each(query, function (k, v) {
            url += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(v);
        });
    }
    return url;
}

function panggil(url, opsi) {
    return fetch(url, opsi).then(function (r) {
        return r.json().then(
            function (j) { return { r: r, j: j }; },
            function () {
                return { r: r, j: { ok: false, galat: "Respons server tidak valid. Pastikan situs dibuka lewat server PHP (contoh: http://localhost/travel-php/)." } };
            }
        );
    }, function () {
        throw new Error("Tidak dapat terhubung ke server.");
    }).then(function (x) {
        if (!x.r.ok || x.j.ok === false) {
            var e = new Error(x.j.galat || "Terjadi kesalahan.");
            e.status = x.r.status;
            throw e;
        }
        return x.j;
    }).catch(function (e) {
        if (e.status === 401 && pengguna) {
            pengguna = null;
            perbaruiTampilanAkun();
        }
        throw e;
    });
}

function apiGet(aksi, query) {
    return panggil(bangunUrl(aksi, query), { credentials: "same-origin" });
}

function apiPost(aksi, data) {
    var opsi = { method: "POST", credentials: "same-origin", headers: { "X-CSRF-Token": csrf } };
    if (data instanceof FormData) {
        opsi.body = data;
    } else {
        opsi.headers["Content-Type"] = "application/json";
        opsi.body = JSON.stringify(data || {});
    }
    return panggil(bangunUrl(aksi), opsi);
}

function isAdmin() {
    return !!pengguna && pengguna.peran === "admin";
}

// =====================================================
//  UTILITAS
// =====================================================
function formatRupiah(angka) {
    return "Rp " + Number(angka).toLocaleString("id-ID");
}
function esc(teks) {
    return $("<div>").text(teks == null ? "" : teks).html();
}
function escAttr(teks) {
    return esc(teks).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function formatTanggal(str) {
    var d = new Date(str + "T00:00:00");
    return isNaN(d) ? str : d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function waktuLokal(s) {
    var d = new Date(String(s).replace(" ", "T") + "Z");
    return isNaN(d) ? s : d.toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function urlFoto(foto) {
    return 'url("' + String(foto).replace(/"/g, "%22") + '")';
}

// =====================================================
//  KATALOG & PEMESANAN (pelanggan)
// =====================================================
var katalog = { tujuan: [], paket: [], tambahan: [] };
var tujuanDipilih = null;     // id tujuan (string)
var paketDipilih = null;      // id paket (string)
var jumlahTambahan = {};      // id tambahan -> jumlah
var promoAktif = null;        // {kode, tipe, nilai, ket}
var diskonAkhir = 0;

function muatKatalog() {
    return apiGet("katalog").then(function (j) {
        katalog = { tujuan: j.tujuan, paket: j.paket, tambahan: j.tambahan };
    });
}

function cari(jenis, id) {
    var daftar = katalog[jenis] || [];
    for (var i = 0; i < daftar.length; i++) {
        if (String(daftar[i].id) === String(id)) return daftar[i];
    }
    return null;
}

// Harga paket & tambahan = harga dasar x pengali tujuan terpilih
function faktorHarga() {
    var t = cari("tujuan", tujuanDipilih);
    return t ? (parseFloat(t.faktor) || 1) : 1;
}
function hargaEfektif(dasar) {
    dasar = Number(dasar) || 0;
    var f = faktorHarga();
    if (Math.abs(f - 1) < 1e-9) return dasar;
    return Math.round(dasar * f / 1000) * 1000;
}
function labelTambahan(x) {
    return x.nama + " (per " + x.satuan + ")";
}
function peserta() {
    var n = parseInt($("#peserta").val());
    if (isNaN(n) || n < 1) n = 1;
    if (n > 50) n = 50;
    return n;
}

// ----- Tampilan katalog -----
function alatAdmin(jenis, id, sebaris) {
    return '<div class="alat-admin' + (sebaris ? " sebaris" : "") + '">' +
        '<button type="button" class="btn-edit" data-jenis="' + jenis + '" data-id="' + escAttr(id) + '" title="Ubah" aria-label="Ubah">✎</button>' +
        '<button type="button" class="btn-hapus" data-jenis="' + jenis + '" data-id="' + escAttr(id) + '" title="Hapus" aria-label="Hapus">🗑</button>' +
        '</div>';
}

function renderTujuan() {
    var admin = isAdmin();
    var h = "";
    katalog.tujuan.forEach(function (t) {
        h += '<div class="kartu-tujuan' + (String(t.id) === String(tujuanDipilih) ? " terpilih" : "") + '" data-id="' + escAttr(t.id) + '">' +
            (admin ? alatAdmin("tujuan", t.id) : "") +
            '<div class="gambar-tujuan" data-foto="' + escAttr(t.foto || "") + '"></div>' +
            '<h6>' + esc(t.nama) + '</h6>' +
            '<span class="harga">' + formatRupiah(t.harga) + '</span>' +
            '<button type="button" class="lihat-detail" data-id="' + escAttr(t.id) + '">Lihat detail</button>' +
            '</div>';
    });
    if (admin) h += '<button type="button" class="kartu-tambah" data-jenis="tujuan">+ Tambah tujuan</button>';
    if (!katalog.tujuan.length && !admin) h = "<p>Belum ada tujuan yang tersedia.</p>";
    $("#daftar-tujuan").html(h);
    $("#daftar-tujuan .gambar-tujuan").each(function () {
        var foto = $(this).attr("data-foto");
        if (foto) $(this).css("background-image", urlFoto(foto));
    });
}

function renderPaket() {
    var admin = isAdmin();
    var h = "";
    katalog.paket.forEach(function (p) {
        var terpilih = String(p.id) === String(paketDipilih);
        var isi = (p.isi || []).map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("");
        h += '<div class="kartu-paket' + (terpilih ? " terpilih" : "") + '" data-id="' + escAttr(p.id) + '">' +
            (admin ? alatAdmin("paket", p.id) : "") +
            '<h6>' + esc(p.nama) + '</h6>' +
            '<span class="harga">' + formatRupiah(hargaEfektif(p.harga)) + '</span>' +
            '<ul>' + isi + '</ul>' +
            (admin ? "" : '<a href="#" class="tombol pilih-paket" data-id="' + escAttr(p.id) + '">' + (terpilih ? "BATAL PILIH" : "PILIH PAKET") + '</a>') +
            '</div>';
    });
    if (admin) h += '<button type="button" class="kartu-tambah" data-jenis="paket">+ Tambah paket</button>';
    if (!katalog.paket.length && !admin) h = "<p>Belum ada paket yang tersedia.</p>";
    $("#daftar-paket").html(h);
}

function renderTambahan() {
    var admin = isAdmin();
    var h = "";
    katalog.tambahan.forEach(function (x) {
        var n = jumlahTambahan[x.id] || 0;
        h += '<div class="item-satuan" data-id="' + escAttr(x.id) + '">' +
            '<div class="info"><strong>' + esc(x.nama) + '</strong>' +
            '<span>' + formatRupiah(hargaEfektif(x.harga)) + ' / ' + esc(x.satuan) + '</span></div>' +
            (admin
                ? alatAdmin("tambahan", x.id, true)
                : '<div class="jumlah-kontrol">' +
                  '<button type="button" class="kurang">−</button>' +
                  '<input type="number" class="jumlah" value="' + n + '" min="0" max="99" inputmode="numeric" />' +
                  '<button type="button" class="tambah">+</button></div>') +
            '</div>';
    });
    if (admin) h += '<button type="button" class="kartu-tambah" data-jenis="tambahan">+ Tambah item tambahan</button>';
    if (!katalog.tambahan.length && !admin) h = "<p>Belum ada item tambahan.</p>";
    $("#daftar-tambahan").html(h);
}

function renderSemua() {
    if (tujuanDipilih && !cari("tujuan", tujuanDipilih)) tujuanDipilih = null;
    if (paketDipilih && !cari("paket", paketDipilih)) paketDipilih = null;
    renderTujuan();
    renderPaket();
    renderTambahan();
    hitungTotal();
}

// ----- Hitung total (hanya pratinjau; server menghitung ulang saat memesan) -----
function barisRingkasan(label, nilai, jenis, kelas) {
    var tombol = jenis
        ? ' <button type="button" class="hapus-pilihan" data-jenis="' + jenis + '">×</button>'
        : "";
    return '<div class="baris ' + (kelas || "") + '"><span>' + esc(label) + '</span><span>' +
           esc(nilai) + tombol + '</span></div>';
}

function hitungDiskon(subtotal) {
    if (!promoAktif || subtotal <= 0) return 0;
    if (promoAktif.tipe === "persen") return Math.round(subtotal * promoAktif.nilai / 100);
    return Math.min(promoAktif.nilai, subtotal);
}

function hitungTotal() {
    var p = peserta();
    var subtotal = 0;
    var html = "";
    var t = cari("tujuan", tujuanDipilih);
    var pk = cari("paket", paketDipilih);

    if (t) {
        var st = t.harga * p;
        subtotal += st;
        html += barisRingkasan("Tujuan: " + t.nama + " (" + p + " orang)", formatRupiah(st), "tujuan");
    }
    if (pk) {
        var sp = hargaEfektif(pk.harga) * p;
        subtotal += sp;
        html += barisRingkasan(pk.nama + " (" + p + " orang)", formatRupiah(sp), "paket");
    }
    katalog.tambahan.forEach(function (x) {
        var n = jumlahTambahan[x.id] || 0;
        if (n > 0) {
            var sub = hargaEfektif(x.harga) * n;
            subtotal += sub;
            html += barisRingkasan(labelTambahan(x) + " x" + n, formatRupiah(sub));
        }
    });

    diskonAkhir = hitungDiskon(subtotal);
    if (diskonAkhir > 0) {
        html += barisRingkasan("Diskon " + promoAktif.kode, "- " + formatRupiah(diskonAkhir), "promo", "diskon");
    }

    $("#isi-ringkasan").html(html || "<p>Belum ada pilihan.</p>");
    $("#total-harga").text(formatRupiah(subtotal - diskonAkhir));
}

// ----- Interaksi pelanggan -----
$("#daftar-tujuan").on("click", ".kartu-tujuan", function () {
    if (isAdmin()) return;
    var id = $(this).attr("data-id");
    tujuanDipilih = String(tujuanDipilih) === id ? null : id;
    renderSemua();
});
$("#daftar-tujuan").on("click", ".lihat-detail", function (e) {
    e.stopPropagation();
    bukaDetail($(this).attr("data-id"));
});
$("#daftar-paket").on("click", ".pilih-paket", function (e) {
    e.preventDefault();
    var id = $(this).attr("data-id");
    paketDipilih = String(paketDipilih) === id ? null : id;
    renderSemua();
});

function ubahJumlah(item, delta) {
    var input = item.find(".jumlah");
    var n = (parseInt(input.val()) || 0) + delta;
    if (n < 0 || n > 99) return;
    input.val(n);
    jumlahTambahan[item.attr("data-id")] = n;
    hitungTotal();
}
$("#daftar-tambahan").on("click", ".tambah", function () {
    ubahJumlah($(this).closest(".item-satuan"), 1);
});
$("#daftar-tambahan").on("click", ".kurang", function () {
    ubahJumlah($(this).closest(".item-satuan"), -1);
});
$("#daftar-tambahan").on("input", ".jumlah", function () {
    var n = parseInt($(this).val());
    if (isNaN(n) || n < 0) n = 0;
    if (n > 99) n = 99;
    if ($(this).val() !== "") $(this).val(n);
    jumlahTambahan[$(this).closest(".item-satuan").attr("data-id")] = n;
    hitungTotal();
});
$("#daftar-tambahan").on("focusout", ".jumlah", function () {
    if ($(this).val() === "") {
        $(this).val(0);
        jumlahTambahan[$(this).closest(".item-satuan").attr("data-id")] = 0;
        hitungTotal();
    }
});

$("#isi-ringkasan").on("click", ".hapus-pilihan", function () {
    var jenis = $(this).data("jenis");
    if (jenis === "tujuan") tujuanDipilih = null;
    else if (jenis === "paket") paketDipilih = null;
    else if (jenis === "promo") {
        promoAktif = null;
        $("#kode-promo").val("");
        infoPromo("", true);
    }
    renderSemua();
});

// ----- Jumlah peserta & data pemesan -----
$("#peserta-tambah").click(function () {
    $("#peserta").val(Math.min(50, peserta() + 1));
    hitungTotal();
});
$("#peserta-kurang").click(function () {
    $("#peserta").val(Math.max(1, peserta() - 1));
    hitungTotal();
});
$("#peserta").on("input", function () {
    if ($(this).val() !== "") $(this).val(peserta());
    hitungTotal();
});
$("#peserta").on("blur", function () {
    $(this).val(peserta());
    hitungTotal();
});

var hariIni = new Date();
$("#tanggal").attr("min", hariIni.getFullYear() + "-" +
    ("0" + (hariIni.getMonth() + 1)).slice(-2) + "-" +
    ("0" + hariIni.getDate()).slice(-2));
$("#nama, #tanggal").on("input change", function () {
    $("#pesan-error").text("");
});

// ----- Kode promo (divalidasi server) -----
function infoPromo(teks, ok) {
    $("#info-promo").text(teks).removeClass("ok gagal").addClass(teks ? (ok ? "ok" : "gagal") : "");
}
$("#terapkan-promo").click(function () {
    var kode = $.trim($("#kode-promo").val()).toUpperCase();
    if (!kode) {
        infoPromo("Masukkan kode promo terlebih dahulu.", false);
        return;
    }
    apiGet("cek_promo", { kode: kode }).then(function (j) {
        promoAktif = j.promo;
        infoPromo("Kode " + promoAktif.kode + " diterapkan: " + promoAktif.ket + ".", true);
        hitungTotal();
    }).catch(function (e) {
        promoAktif = null;
        infoPromo(e.message, false);
        hitungTotal();
    });
});

// ----- Popup detail tujuan -----
var kodeDetail = null;

function bukaDetail(id) {
    var d = cari("tujuan", id);
    if (!d) return;
    kodeDetail = id;
    $("#detail-judul").text(d.nama);
    $("#detail-durasi").text(d.durasi || "-");
    $("#detail-deskripsi").text(d.deskripsi || "");
    var ul = $("#detail-sorotan").empty();
    $.each(d.sorotan || [], function (i, s) {
        ul.append($("<li>").text(s));
    });
    var foto = $("#detail-foto").empty();
    if (d.foto) foto.append($("<div>").css("background-image", urlFoto(d.foto)));
    $("#pilih-dari-detail").prop("hidden", isAdmin());
    $("#modal-detail").prop("hidden", false);
}

$("#pilih-dari-detail").click(function (e) {
    e.preventDefault();
    if (cari("tujuan", kodeDetail)) {
        tujuanDipilih = String(kodeDetail);
        renderSemua();
    }
    $("#modal-detail").prop("hidden", true);
});

// Tutup popup (tombol ×, klik di luar kotak, atau tombol Esc)
$(".tutup-modal").click(function () {
    $(this).closest(".modal").prop("hidden", true);
});
$(".modal").click(function (e) {
    if (e.target === this) $(this).prop("hidden", true);
});
$(document).keydown(function (e) {
    if (e.key === "Escape") {
        $(".modal").prop("hidden", true);
        $("#cs-panel").prop("hidden", true);
    }
});

// ----- Membuat pesanan -----
function tampilError(teks, selektor) {
    $("#pesan-error").text(teks);
    if (selektor) {
        $(selektor)[0].scrollIntoView({ behavior: "smooth", block: "center" });
        $(selektor).focus();
    }
}

$("#pesan-final").click(function (e) {
    e.preventDefault();
    $("#pesan-error").text("");
    if (!pengguna || isAdmin()) {
        bukaAuth("masuk");
        return;
    }
    if (!tujuanDipilih) {
        tampilError("Pilih tujuan wisata terlebih dahulu.", "#daftar-tujuan");
        return;
    }
    if ($.trim($("#nama").val()) === "") {
        tampilError("Isi nama lengkap terlebih dahulu.", "#nama");
        return;
    }
    if (!$("#tanggal").val()) {
        tampilError("Pilih tanggal keberangkatan terlebih dahulu.", "#tanggal");
        return;
    }

    var items = {};
    $.each(jumlahTambahan, function (id, n) {
        if (n > 0 && cari("tambahan", id)) items[id] = n;
    });

    var tombol = $(this).addClass("sibuk");
    apiPost("pesan", {
        tujuan: tujuanDipilih,
        paket: paketDipilih,
        items: items,
        nama: $.trim($("#nama").val()),
        tanggal: $("#tanggal").val(),
        peserta: peserta(),
        promo: promoAktif ? promoAktif.kode : ""
    }).then(function (j) {
        // Reset pilihan, lalu buka pembayaran
        tujuanDipilih = null;
        paketDipilih = null;
        jumlahTambahan = {};
        promoAktif = null;
        $("#kode-promo").val("");
        infoPromo("", true);
        $("#peserta").val(1);
        $("#tanggal").val("");
        renderSemua();
        muatPesananSaya();
        bukaPembayaran(j.pesanan);
    }).catch(function (err) {
        tampilError(err.message);
    }).then(function () {
        tombol.removeClass("sibuk");
    });
});

// ----- Pembayaran & bukti -----
var pesananAktif = null;

function bukaPembayaran(p) {
    pesananAktif = p;
    $("#bayar-kode").text(p.kode);
    $("#nominal-modal").text(formatRupiah(p.total));
    $("#galat-bukti, #info-bukti").text("");
    $("#file-bukti").val("");
    $("#modal-bayar").prop("hidden", false);
}

$("#salin-nominal").click(function (e) {
    e.preventDefault();
    if (!pesananAktif) return;
    var tombol = $(this);
    if (navigator.clipboard) {
        navigator.clipboard.writeText(String(pesananAktif.total)).then(function () {
            tombol.text("TERSALIN ✓");
            setTimeout(function () { tombol.text("SALIN NOMINAL"); }, 2000);
        });
    }
});

$("#form-bukti").on("submit", function (e) {
    e.preventDefault();
    var galat = $("#galat-bukti").text("");
    var info = $("#info-bukti").text("");
    var berkas = $("#file-bukti")[0].files[0];
    if (!pesananAktif) return;
    if (!berkas) return galat.text("Pilih berkas bukti pembayaran terlebih dahulu.");
    if (berkas.size > MAKS_UPLOAD) return galat.text("Ukuran berkas maksimal 3 MB.");

    var fd = new FormData();
    fd.append("kode", pesananAktif.kode);
    fd.append("bukti", berkas);
    var tombol = $(this).find("button[type=submit]").addClass("sibuk");
    apiPost("upload_bukti", fd).then(function () {
        info.text("Bukti terkirim. Pesanan Anda sedang menunggu verifikasi admin.");
        $("#file-bukti").val("");
        muatPesananSaya();
    }).catch(function (err) {
        galat.text(err.message);
    }).then(function () {
        tombol.removeClass("sibuk");
    });
});

$("#kirim-bukti").click(function (e) {
    e.preventDefault();
    if (!pesananAktif || !NOMOR_WA) return;
    var pesan = "Halo, saya sudah memesan dengan kode " + pesananAktif.kode +
                " (total " + formatRupiah(pesananAktif.total) + "). Mohon dicek pembayarannya.";
    window.open("https://wa.me/" + NOMOR_WA + "?text=" + encodeURIComponent(pesan), "_blank");
});

// ----- Pesanan Saya & kartu pesanan (dipakai juga oleh admin) -----
var LABEL_STATUS = {
    menunggu_pembayaran: "Menunggu pembayaran",
    menunggu_verifikasi: "Menunggu verifikasi",
    lunas: "Lunas",
    batal: "Dibatalkan"
};
var daftarPesananSaya = [];
var daftarPesananAdmin = [];

function labelItem(i) {
    if (i.tipe === "tujuan") return "Tujuan: " + i.nama + " (" + i.jumlah + " orang)";
    if (i.tipe === "paket") return i.nama + " (" + i.jumlah + " orang)";
    return i.nama + " x" + i.jumlah;
}

function kartuPesanan(p, admin) {
    var items = p.items.map(function (i) {
        return "<li><span>" + esc(labelItem(i)) + "</span><span>" + formatRupiah(i.subtotal) + "</span></li>";
    }).join("");
    if (p.diskon > 0) {
        items += "<li><span>Diskon " + esc(p.promo_kode || "") + "</span><span>- " + formatRupiah(p.diskon) + "</span></li>";
    }

    var meta = "Dipesan " + esc(waktuLokal(p.dibuat)) + " · Berangkat " + esc(formatTanggal(p.tanggal)) +
               " · " + p.peserta + " peserta";
    if (admin) meta = "Pemesan: " + esc(p.pemesan) + " (" + esc(p.email) + ")<br>" + meta;

    var aksi = "";
    var linkBukti = p.ada_bukti
        ? '<a href="' + bangunUrl("bukti", { kode: p.kode }) + '" target="_blank" rel="noopener">Lihat bukti</a>'
        : "";
    if (admin) {
        var opsi = Object.keys(LABEL_STATUS).map(function (s) {
            return '<option value="' + s + '"' + (s === p.status ? " selected" : "") + ">" + LABEL_STATUS[s] + "</option>";
        }).join("");
        aksi = '<label>Status: <select class="ubah-status" data-kode="' + escAttr(p.kode) + '">' + opsi + "</select></label>" + linkBukti;
    } else {
        if (p.status === "menunggu_pembayaran" || p.status === "menunggu_verifikasi") {
            aksi += '<button type="button" class="tombol tombol-kecil unggah-bukti" data-kode="' + escAttr(p.kode) + '">' +
                    (p.ada_bukti ? "GANTI BUKTI" : "BAYAR / UNGGAH BUKTI") + "</button>";
        }
        if (p.status === "menunggu_pembayaran") {
            aksi += '<button type="button" class="tombol tombol-kecil tombol-bahaya batalkan-pesanan" data-kode="' + escAttr(p.kode) + '">BATALKAN</button>';
        }
        if (p.status === "lunas") {
            aksi += '<button type="button" class="tombol tombol-kecil lihat-tiket" data-kode="' + escAttr(p.kode) + '">LIHAT TIKET</button>';
        }
        aksi += linkBukti;
    }

    return '<div class="kartu-pesanan"><div class="kepala"><span class="kode">' + esc(p.kode) + "</span>" +
        '<span class="lencana status-' + escAttr(p.status) + '">' + esc(LABEL_STATUS[p.status] || p.status) + "</span></div>" +
        '<p class="meta">' + meta + "</p><ul>" + items + "</ul>" +
        '<div class="total-baris"><span>Total</span><span>' + formatRupiah(p.total) + "</span></div>" +
        '<div class="aksi-pesanan">' + aksi + "</div></div>";
}

function muatPesananSaya() {
    if (!pengguna || isAdmin()) return;
    apiGet("pesanan_saya").then(function (j) {
        daftarPesananSaya = j.pesanan;
        cekPesananLunas(j.pesanan);
        var h = j.pesanan.map(function (p) { return kartuPesanan(p, false); }).join("");
        $("#pesanan-saya").html(h || "<p>Belum ada pesanan.</p>");
    }).catch(function (e) {
        $("#pesanan-saya").html("<p>" + esc(e.message) + "</p>");
    });
}

$("#pesanan-saya").on("click", ".unggah-bukti", function () {
    var kode = $(this).attr("data-kode");
    var p = daftarPesananSaya.filter(function (x) { return x.kode === kode; })[0];
    if (p) bukaPembayaran(p);
});
$("#pesanan-saya").on("click", ".batalkan-pesanan", function () {
    var kode = $(this).attr("data-kode");
    if (!confirm("Batalkan pesanan " + kode + "?")) return;
    apiPost("batalkan", { kode: kode }).then(muatPesananSaya).catch(function (e) {
        alert(e.message);
    });
});

// =====================================================
//  TIKET DIGITAL (digambar di browser dengan canvas)
// =====================================================
// Pola Code 39: 9 elemen bergantian batang/spasi, N = tipis, W = tebal
var KODE39 = {
    "0": "NNNWWNWNN", "1": "WNNWNNNNW", "2": "NNWWNNNNW", "3": "WNWWNNNNN", "4": "NNNWWNNNW",
    "5": "WNNWWNNNN", "6": "NNWWWNNNN", "7": "NNNWNNWNW", "8": "WNNWNNWNN", "9": "NNWWNNWNN",
    "A": "WNNNNWNNW", "B": "NNWNNWNNW", "C": "WNWNNWNNN", "D": "NNNNWWNNW", "E": "WNNNWWNNN",
    "F": "NNWNWWNNN", "G": "NNNNNWWNW", "H": "WNNNNWWNN", "I": "NNWNNWWNN", "J": "NNNNWWWNN",
    "K": "WNNNNNNWW", "L": "NNWNNNNWW", "M": "WNWNNNNWN", "N": "NNNNWNNWW", "O": "WNNNWNNWN",
    "P": "NNWNWNNWN", "Q": "NNNNNNWWW", "R": "WNNNNNWWN", "S": "NNWNNNWWN", "T": "NNNNWNWWN",
    "U": "WWNNNNNNW", "V": "NWWNNNNNW", "W": "WWWNNNNNN", "X": "NWNNWNNNW", "Y": "WWNNWNNNN",
    "Z": "NWWNWNNNN", "-": "NWNNNNWNW", "*": "NWNNWNWNN"
};

function gambarBarcode(ctx, teks, x, y, tinggi) {
    var tipis = 2, tebal = 5;
    var isi = "*" + String(teks).toUpperCase().replace(/[^A-Z0-9\-]/g, "") + "*";
    var px = x;
    for (var i = 0; i < isi.length; i++) {
        var pola = KODE39[isi.charAt(i)];
        if (!pola) continue;
        for (var k = 0; k < 9; k++) {
            var w = pola.charAt(k) === "W" ? tebal : tipis;
            if (k % 2 === 0) ctx.fillRect(px, y, w, tinggi);
            px += w;
        }
        px += tipis;
    }
    return px - x;
}

function persegiBulat(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function potongTeks(ctx, teks, lebar) {
    teks = String(teks == null ? "" : teks);
    if (ctx.measureText(teks).width <= lebar) return teks;
    while (teks.length > 1 && ctx.measureText(teks + "…").width > lebar) teks = teks.slice(0, -1);
    return teks + "…";
}

function gambarTiket(p) {
    var kanvas = document.getElementById("kanvas-tiket");
    var ctx = kanvas.getContext("2d");
    var W = kanvas.width, H = kanvas.height, X = 700;
    var FONT = "Arial, Helvetica, sans-serif";

    var tujuan = p.items.filter(function (i) { return i.tipe === "tujuan"; })[0];
    var paket = p.items.filter(function (i) { return i.tipe === "paket"; })[0];

    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    ctx.setLineDash([]);

    // badan tiket
    persegiBulat(ctx, 0, 0, W, H, 24);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.save();
    persegiBulat(ctx, 0, 0, W, H, 24);
    ctx.clip();
    ctx.fillStyle = "#a608db";
    ctx.fillRect(0, 0, W, 86);
    ctx.fillStyle = "#faf4fd";
    ctx.fillRect(X, 86, W - X, H - 86);
    ctx.restore();

    // judul
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 32px " + FONT;
    ctx.textAlign = "left";
    ctx.fillText("TRAVELIN AJA DULU", 40, 56);
    ctx.font = "20px " + FONT;
    ctx.fillStyle = "#f1d6fb";
    ctx.textAlign = "right";
    ctx.fillText("TIKET DIGITAL", W - 40, 54);

    // isi
    function label(teks, x, y, rata) {
        ctx.font = "bold 14px " + FONT;
        ctx.fillStyle = "#8a8a8a";
        ctx.textAlign = rata || "left";
        ctx.fillText(teks, x, y);
    }
    function nilai(teks, x, y, ukuran, warna, lebar, rata) {
        ctx.font = "bold " + ukuran + "px " + FONT;
        ctx.fillStyle = warna;
        ctx.textAlign = rata || "left";
        ctx.fillText(potongTeks(ctx, teks, lebar), x, y);
    }

    label("TUJUAN", 40, 128);
    nilai(tujuan ? tujuan.nama : "-", 40, 170, 38, "#3a0850", 620);

    label("NAMA PEMESAN", 40, 214);
    nilai(p.nama, 40, 244, 24, "#333333", 290);
    label("TANGGAL BERANGKAT", 360, 214);
    nilai(formatTanggal(p.tanggal), 360, 244, 22, "#333333", 320);

    label("JUMLAH PESERTA", 40, 286);
    nilai(p.peserta + " orang", 40, 316, 24, "#333333", 290);
    label("PAKET", 360, 286);
    nilai(paket ? paket.nama : "Tanpa paket", 360, 316, 22, "#333333", 320);

    // barcode kode pesanan (Code 39)
    ctx.fillStyle = "#222222";
    gambarBarcode(ctx, p.kode, 40, 346, 44);
    ctx.font = "bold 16px 'Courier New', monospace";
    ctx.textAlign = "left";
    ctx.fillText(p.kode, 40, 416);

    // garis sobek + lekukan
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = "#cfc4d6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(X, 24);
    ctx.lineTo(X, H - 24);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(X, 0, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(X, H, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    // bagian kanan (stub)
    var tengah = X + (W - X) / 2;
    label("STATUS PEMBAYARAN", tengah, 140, "center");
    ctx.save();
    ctx.translate(tengah, 218);
    ctx.rotate(-0.14);
    ctx.strokeStyle = "#049261";
    ctx.lineWidth = 5;
    persegiBulat(ctx, -90, -38, 180, 76, 10);
    ctx.stroke();
    ctx.font = "bold 42px " + FONT;
    ctx.fillStyle = "#049261";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("LUNAS", 0, 3);
    ctx.restore();
    ctx.textBaseline = "alphabetic";

    label("TOTAL BAYAR", tengah, 308, "center");
    nilai(formatRupiah(p.total), tengah, 344, 28, "#049261", 260, "center");

    ctx.font = "13px " + FONT;
    ctx.fillStyle = "#777777";
    ctx.textAlign = "center";
    ctx.fillText("Tunjukkan tiket ini", tengah, 396);
    ctx.fillText("kepada pemandu", tengah, 414);
}

function bukaTiket(p) {
    gambarTiket(p);
    $("#unduh-tiket").attr({
        href: document.getElementById("kanvas-tiket").toDataURL("image/png"),
        download: "tiket-" + p.kode + ".png"
    });
    $("#modal-tiket").prop("hidden", false);
}

$("#pesanan-saya").on("click", ".lihat-tiket", function () {
    var kode = $(this).attr("data-kode");
    var p = daftarPesananSaya.filter(function (x) { return x.kode === kode; })[0];
    if (p && p.status === "lunas") bukaTiket(p);
});

// ----- Pemberitahuan saat pesanan diverifikasi admin -----
var statusSebelumnya = null;   // {kode: status}, null = belum pernah dimuat
var kodeToast = null;
var timerToast = null;

function tampilToast(teks, kode) {
    kodeToast = kode;
    $("#toast").text(teks).prop("hidden", false);
    clearTimeout(timerToast);
    timerToast = setTimeout(function () { $("#toast").prop("hidden", true); }, 15000);
}

function cekPesananLunas(daftar) {
    var baru = {};
    daftar.forEach(function (p) { baru[p.kode] = p.status; });
    if (statusSebelumnya) {
        daftar.forEach(function (p) {
            var lama = statusSebelumnya[p.kode];
            if (p.status === "lunas" && lama && lama !== "lunas") {
                tampilToast("Pembayaran pesanan " + p.kode + " sudah diverifikasi. Klik di sini untuk melihat tiket Anda.", p.kode);
            }
        });
    }
    statusSebelumnya = baru;
}

$("#toast").click(function () {
    var kode = kodeToast;
    $(this).prop("hidden", true);
    var p = daftarPesananSaya.filter(function (x) { return x.kode === kode; })[0];
    if (p && p.status === "lunas") bukaTiket(p);
});

// =====================================================
//  PANEL ADMIN
// =====================================================
$(".tab-admin").click(function () {
    var panel = $(this).data("panel");
    $(".tab-admin").addClass("tombol-hollow");
    $(this).removeClass("tombol-hollow");
    $("#panel-katalog, #panel-pesanan, #panel-promo, #panel-akun, #panel-chat").prop("hidden", true);
    $("#panel-" + panel).prop("hidden", false);
    if (panel === "pesanan") muatPesananAdmin();
    if (panel === "promo") muatPromo();
    if (panel === "akun") muatAkun();
    if (panel === "chat") muatPercakapan();
});

// ----- Kelola katalog -----
var formJenis = null;
var formId = null;
var namaJenis = { tujuan: "Tujuan Wisata", paket: "Paket", tambahan: "Item Tambahan" };

function medan(id, label, nilai, tipe, ekstra) {
    return '<label for="' + id + '">' + label + '</label>' +
           '<input type="' + (tipe || "text") + '" id="' + id + '" value="' + escAttr(nilai == null ? "" : nilai) + '" ' + (ekstra || "") + ' />';
}
function areaTeks(id, label, nilai) {
    return '<label for="' + id + '">' + label + '</label>' +
           '<textarea id="' + id + '" rows="4">' + esc(nilai || "") + '</textarea>';
}

function bukaFormAdmin(jenis, id) {
    formJenis = jenis;
    formId = id || null;
    var item = id ? cari(jenis, id) : null;
    if (id && !item) return;
    var h = "";

    if (jenis === "tujuan") {
        h += medan("f-nama", "Nama tujuan", item ? item.nama : "");
        h += medan("f-harga", "Harga per orang (Rp)", item ? item.harga : "", "number", 'min="0"');
        h += medan("f-faktor", "Pengali harga paket dan tambahan (1 = normal, 2 = dua kali lipat)", item ? item.faktor : 1, "number", 'min="0.1" step="0.1"');
        h += '<label for="f-foto-file">Unggah foto (JPG, PNG, atau WebP, maks. 3 MB)</label><input type="file" id="f-foto-file" accept="image/jpeg,image/png,image/webp" />';
        h += medan("f-foto", "Atau isi nama file di folder asset / alamat gambar", item ? item.foto : "asset/");
        h += medan("f-durasi", "Durasi", item ? item.durasi : "");
        h += areaTeks("f-deskripsi", "Deskripsi", item ? item.deskripsi : "");
        h += areaTeks("f-sorotan", "Sorotan (satu per baris)", item ? (item.sorotan || []).join("\n") : "");
    } else if (jenis === "paket") {
        h += medan("f-nama", "Nama paket", item ? item.nama : "");
        h += medan("f-harga", "Harga dasar per orang (Rp)", item ? item.harga : "", "number", 'min="0"');
        h += areaTeks("f-isi", "Isi paket (satu per baris)", item ? (item.isi || []).join("\n") : "");
    } else {
        h += medan("f-nama", "Nama item", item ? item.nama : "");
        h += medan("f-satuan", "Satuan (hari, malam, orang, paket, dll.)", item ? item.satuan : "");
        h += medan("f-harga", "Harga dasar per satuan (Rp)", item ? item.harga : "", "number", 'min="0"');
    }

    $("#judul-form-admin").text((item ? "Ubah " : "Tambah ") + namaJenis[jenis]);
    $("#isi-form-admin").html(h);
    $("#galat-admin").text("");
    $("#modal-admin").prop("hidden", false);
}

$("#form-admin").on("submit", function (e) {
    e.preventDefault();
    if (!isAdmin()) return;
    var galat = $("#galat-admin").text("");
    var fd = new FormData();
    fd.append("jenis", formJenis);
    if (formId) fd.append("id", formId);
    fd.append("nama", $("#f-nama").val());
    fd.append("harga", $("#f-harga").val());

    if (formJenis === "tujuan") {
        fd.append("faktor", $("#f-faktor").val());
        fd.append("foto", $("#f-foto").val());
        fd.append("durasi", $("#f-durasi").val());
        fd.append("deskripsi", $("#f-deskripsi").val());
        fd.append("sorotan", $("#f-sorotan").val());
        var berkas = $("#f-foto-file")[0].files[0];
        if (berkas) {
            if (berkas.size > MAKS_UPLOAD) return galat.text("Ukuran foto maksimal 3 MB.");
            fd.append("foto_file", berkas);
        }
    } else if (formJenis === "paket") {
        fd.append("isi", $("#f-isi").val());
    } else {
        fd.append("satuan", $("#f-satuan").val());
    }

    var tombol = $(this).find("button[type=submit]").addClass("sibuk");
    apiPost("simpan_item", fd).then(function () {
        $("#modal-admin").prop("hidden", true);
        return muatKatalog();
    }).then(renderSemua).catch(function (err) {
        galat.text(err.message);
    }).then(function () {
        tombol.removeClass("sibuk");
    });
});

$("#konten-paket").on("click", ".kartu-tambah", function () {
    if (isAdmin()) bukaFormAdmin($(this).data("jenis"));
});
$("#konten-paket").on("click", ".btn-edit", function (e) {
    e.stopPropagation();
    if (isAdmin()) bukaFormAdmin($(this).data("jenis"), $(this).attr("data-id"));
});
$("#konten-paket").on("click", ".btn-hapus", function (e) {
    e.stopPropagation();
    if (!isAdmin()) return;
    var jenis = $(this).data("jenis");
    var id = $(this).attr("data-id");
    var item = cari(jenis, id);
    if (!item || !confirm('Hapus "' + item.nama + '"?')) return;
    apiPost("hapus_item", { jenis: jenis, id: id }).then(muatKatalog).then(renderSemua).catch(function (err) {
        alert(err.message);
    });
});

// ----- Pesanan masuk -----
function renderPesananAdmin() {
    var filter = $("#filter-status").val();
    var daftar = daftarPesananAdmin.filter(function (p) { return !filter || p.status === filter; });
    var h = daftar.map(function (p) { return kartuPesanan(p, true); }).join("");
    $("#daftar-pesanan-admin").html(h || "<p>Tidak ada pesanan.</p>");
}
function muatPesananAdmin() {
    apiGet("semua_pesanan").then(function (j) {
        daftarPesananAdmin = j.pesanan;
        renderPesananAdmin();
    }).catch(function (e) {
        $("#daftar-pesanan-admin").html("<p>" + esc(e.message) + "</p>");
    });
}
$("#filter-status").on("change", renderPesananAdmin);
$("#muat-ulang-pesanan").click(muatPesananAdmin);
$("#daftar-pesanan-admin").on("change", ".ubah-status", function () {
    var pilihan = $(this);
    apiPost("ubah_status", { kode: pilihan.attr("data-kode"), status: pilihan.val() }).then(muatPesananAdmin).catch(function (e) {
        alert(e.message);
        muatPesananAdmin();
    });
});

// ----- Kode promo -----
function muatPromo() {
    apiGet("daftar_promo").then(function (j) {
        var h = j.promo.map(function (p) {
            return '<div class="baris-promo-admin"><div><strong>' + esc(p.kode) + '</strong> <span class="ket">' + esc(p.ket) +
                (p.aktif ? "" : " · nonaktif") + '</span></div><div class="aksi-pesanan">' +
                '<button type="button" class="tombol tombol-kecil toggle-promo" data-kode="' + escAttr(p.kode) + '" data-tipe="' + escAttr(p.tipe) +
                '" data-nilai="' + p.nilai + '" data-aktif="' + p.aktif + '">' + (p.aktif ? "NONAKTIFKAN" : "AKTIFKAN") + '</button>' +
                '<button type="button" class="tombol tombol-kecil tombol-bahaya hapus-promo" data-kode="' + escAttr(p.kode) + '">HAPUS</button></div></div>';
        }).join("");
        $("#daftar-promo").html(h || "<p>Belum ada kode promo.</p>");
    }).catch(function (e) {
        $("#daftar-promo").html("<p>" + esc(e.message) + "</p>");
    });
}
$("#form-promo").on("submit", function (e) {
    e.preventDefault();
    var galat = $("#galat-promo").text("");
    apiPost("simpan_promo", {
        kode: $("#promo-kode").val(),
        tipe: $("#promo-tipe").val(),
        nilai: $("#promo-nilai").val()
    }).then(function () {
        $("#form-promo")[0].reset();
        muatPromo();
    }).catch(function (err) {
        galat.text(err.message);
    });
});
$("#daftar-promo").on("click", ".toggle-promo", function () {
    var t = $(this);
    apiPost("simpan_promo", {
        kode: t.attr("data-kode"), tipe: t.attr("data-tipe"), nilai: t.attr("data-nilai"),
        aktif: t.attr("data-aktif") === "1" ? 0 : 1
    }).then(muatPromo).catch(function (e) { alert(e.message); });
});
$("#daftar-promo").on("click", ".hapus-promo", function () {
    var kode = $(this).attr("data-kode");
    if (!confirm("Hapus kode promo " + kode + "?")) return;
    apiPost("hapus_promo", { kode: kode }).then(muatPromo).catch(function (e) { alert(e.message); });
});

// ----- Kelola akun pelanggan -----
var daftarAkun = [];
var akunDiubah = null;      // id akun yang sedang diubah / direset sandinya

function cariAkun(id) {
    for (var i = 0; i < daftarAkun.length; i++) {
        if (String(daftarAkun[i].id) === String(id)) return daftarAkun[i];
    }
    return null;
}

function renderAkun() {
    var q = $.trim($("#cari-akun").val()).toLowerCase();
    var daftar = daftarAkun.filter(function (a) {
        return !q || a.nama.toLowerCase().indexOf(q) !== -1 || a.email.toLowerCase().indexOf(q) !== -1;
    });
    var h = daftar.map(function (a) {
        var id = escAttr(a.id);
        return '<div class="baris-promo-admin"><div><strong>' + esc(a.nama) + '</strong>' +
            (a.aktif ? "" : ' <span class="lencana status-batal">Nonaktif</span>') +
            '<br><span class="ket">' + esc(a.email) + " · " + a.jumlah_pesanan + " pesanan · daftar " + esc(waktuLokal(a.dibuat)) + '</span></div>' +
            '<div class="aksi-pesanan">' +
            '<button type="button" class="tombol tombol-kecil ubah-akun" data-id="' + id + '">UBAH</button>' +
            '<button type="button" class="tombol tombol-kecil reset-akun" data-id="' + id + '">RESET SANDI</button>' +
            '<button type="button" class="tombol tombol-kecil toggle-akun" data-id="' + id + '">' + (a.aktif ? "NONAKTIFKAN" : "AKTIFKAN") + '</button>' +
            '<button type="button" class="tombol tombol-kecil tombol-bahaya hapus-akun" data-id="' + id + '">HAPUS</button>' +
            '</div></div>';
    }).join("");
    $("#daftar-akun").html(h || "<p>Tidak ada akun pelanggan.</p>");
}

function muatAkun() {
    apiGet("daftar_pengguna").then(function (j) {
        daftarAkun = j.pengguna;
        renderAkun();
    }).catch(function (e) {
        $("#daftar-akun").html("<p>" + esc(e.message) + "</p>");
    });
}

function simpanAkun(a, aktif) {
    return apiPost("ubah_pengguna", { id: a.id, nama: a.nama, email: a.email, aktif: aktif ? 1 : 0 });
}

$("#cari-akun").on("input", renderAkun);
$("#muat-ulang-akun").click(muatAkun);

$("#daftar-akun").on("click", ".ubah-akun", function () {
    var a = cariAkun($(this).attr("data-id"));
    if (!a) return;
    akunDiubah = a.id;
    $("#akun-nama").val(a.nama);
    $("#akun-email").val(a.email);
    $("#akun-aktif").prop("checked", !!a.aktif);
    $("#galat-akun").text("");
    $("#modal-akun").prop("hidden", false);
});
$("#form-akun").on("submit", function (e) {
    e.preventDefault();
    var galat = $("#galat-akun").text("");
    apiPost("ubah_pengguna", {
        id: akunDiubah,
        nama: $("#akun-nama").val(),
        email: $("#akun-email").val(),
        aktif: $("#akun-aktif").is(":checked") ? 1 : 0
    }).then(function () {
        $("#modal-akun").prop("hidden", true);
        muatAkun();
    }).catch(function (err) {
        galat.text(err.message);
    });
});

$("#daftar-akun").on("click", ".toggle-akun", function () {
    var a = cariAkun($(this).attr("data-id"));
    if (!a) return;
    var pesan = a.aktif
        ? 'Nonaktifkan akun "' + a.nama + '"? Akun ini tidak bisa masuk sampai diaktifkan lagi.'
        : 'Aktifkan kembali akun "' + a.nama + '"?';
    if (!confirm(pesan)) return;
    simpanAkun(a, !a.aktif).then(muatAkun).catch(function (err) { alert(err.message); });
});

$("#daftar-akun").on("click", ".reset-akun", function () {
    var a = cariAkun($(this).attr("data-id"));
    if (!a) return;
    akunDiubah = a.id;
    $("#form-reset")[0].reset();
    $("#galat-reset").text("");
    $("#reset-untuk").text("Akun: " + a.nama + " (" + a.email + ")");
    $("#modal-reset").prop("hidden", false);
});
$("#form-reset").on("submit", function (e) {
    e.preventDefault();
    var galat = $("#galat-reset").text("");
    apiPost("reset_sandi", { id: akunDiubah, sandi_baru: $("#reset-sandi").val() }).then(function () {
        $("#modal-reset").prop("hidden", true);
        alert("Kata sandi berhasil diatur ulang. Sampaikan sandi baru ke pelanggan.");
    }).catch(function (err) {
        galat.text(err.message);
    });
});

$("#daftar-akun").on("click", ".hapus-akun", function () {
    var a = cariAkun($(this).attr("data-id"));
    if (!a || !confirm('Hapus akun "' + a.nama + '" secara permanen?')) return;
    apiPost("hapus_pengguna", { id: a.id }).then(muatAkun).catch(function (err) { alert(err.message); });
});

// =====================================================
//  CHAT DENGAN CS
// =====================================================
function renderGelembung(box, pesan, sebagaiAdmin, paksaBawah) {
    var el = box[0];
    var dekatBawah = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    var h = pesan.map(function (m) {
        var saya = sebagaiAdmin ? m.pengirim === "cs" : m.pengirim === "pelanggan";
        return '<div class="gelembung ' + (saya ? "saya" : "lawan") + '"><span class="teks">' + esc(m.isi) +
               '</span><span class="waktu">' + esc(waktuLokal(m.dibuat)) + "</span></div>";
    }).join("");
    box.append(h);
    if (paksaBawah || dekatBawah) el.scrollTop = el.scrollHeight;
}

function aturBadge(selektor, n) {
    $(selektor).text(n > 99 ? "99+" : n).prop("hidden", !(n > 0));
}

function elTerlihat(el) {
    if (!el || !el.offsetParent) return false;
    var r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
}

// ----- Sisi pelanggan -----
var chatTerakhirId = 0;
var chatPertama = true;

function muatChat() {
    if (!pengguna || isAdmin()) return $.Deferred().resolve().promise();
    var pertama = chatPertama;
    return apiGet("chat_ambil", { sejak: chatTerakhirId }).then(function (j) {
        var box = $("#isi-chat-pelanggan");
        if (pertama) {
            box.empty();
            chatPertama = false;
            if (!j.pesan.length) {
                box.html('<p class="kosong-cs">Belum ada pesan. Tulis pertanyaanmu di bawah, CS akan membalas.</p>');
            }
        }
        if (j.pesan.length) {
            box.find(".kosong-cs").remove();
            renderGelembung(box, j.pesan, false, pertama);
            chatTerakhirId = j.pesan[j.pesan.length - 1].id;
        }
        aturBadge("#badge-chat-pelanggan", 0);
    }).catch(function () {});
}

function periksaChatPelanggan() {
    if (!$("#cs-panel").prop("hidden")) {
        muatChat();
    } else {
        apiGet("chat_jumlah_belum").then(function (j) {
            aturBadge("#badge-chat-pelanggan", j.jumlah);
        }).catch(function () {});
    }
}

$("#form-chat-pelanggan").on("submit", function (e) {
    e.preventDefault();
    var galat = $("#galat-chat-pelanggan").text("");
    var isi = $.trim($("#input-chat-pelanggan").val());
    if (!isi) return;
    var tombol = $(this).find("button[type=submit]").addClass("sibuk");
    apiPost("chat_kirim", { isi: isi }).then(function () {
        $("#input-chat-pelanggan").val("");
        return muatChat();
    }).catch(function (err) {
        galat.text(err.message);
    }).then(function () {
        tombol.removeClass("sibuk");
    });
});

// ----- Widget chat mengambang -----
function bukaChatCS() {
    $("#cs-panel").prop("hidden", false);
    $("#cs-toggle").attr("aria-expanded", "true");
    $.when(muatChat()).then(function () {
        var el = document.getElementById("isi-chat-pelanggan");
        el.scrollTop = el.scrollHeight;
    });
    $("#input-chat-pelanggan").focus();
}
function tutupChatCS() {
    $("#cs-panel").prop("hidden", true);
    $("#cs-toggle").attr("aria-expanded", "false");
}
$("#cs-toggle").click(function () {
    if ($("#cs-panel").prop("hidden")) bukaChatCS();
    else tutupChatCS();
});
$("#cs-tutup").click(tutupChatCS);

// ----- Sisi admin -----
var chatAdminId = null;       // id pelanggan yang percakapannya terbuka
var chatAdminTerakhir = 0;

function muatPercakapan() {
    return apiGet("chat_daftar").then(function (j) {
        var h = j.percakapan.map(function (c) {
            return '<button type="button" class="item-percakapan' + (String(c.id) === String(chatAdminId) ? " aktif" : "") +
                '" data-id="' + escAttr(c.id) + '" data-nama="' + escAttr(c.nama) + '"><strong>' + esc(c.nama) +
                (c.belum_dibaca ? ' <span class="badge-chat">' + c.belum_dibaca + "</span>" : "") +
                "</strong><span>" + esc(c.terakhir) + "</span></button>";
        }).join("");
        $("#daftar-percakapan").html(h || "<p>Belum ada percakapan.</p>");
        aturBadge("#badge-chat-admin", j.total_belum_dibaca);
        if (chatAdminId) muatChatAdmin();
    }).catch(function () {});
}

function muatChatAdmin() {
    if (!chatAdminId) return;
    var idSaatIni = chatAdminId;
    var pertama = chatAdminTerakhir === 0;
    return apiGet("chat_ambil_admin", { pengguna_id: idSaatIni, sejak: chatAdminTerakhir }).then(function (j) {
        if (idSaatIni !== chatAdminId) return;   // admin sudah pindah percakapan
        var box = $("#isi-chat-admin");
        if (j.pesan.length) {
            renderGelembung(box, j.pesan, true, pertama);
            chatAdminTerakhir = j.pesan[j.pesan.length - 1].id;
        }
    }).catch(function () {});
}

$("#daftar-percakapan").on("click", ".item-percakapan", function () {
    chatAdminId = $(this).attr("data-id");
    chatAdminTerakhir = 0;
    $(".item-percakapan").removeClass("aktif");
    $(this).addClass("aktif");
    $("#judul-percakapan").text("Percakapan dengan " + $(this).attr("data-nama"));
    $("#isi-chat-admin").empty();
    $("#form-chat-admin").prop("hidden", false);
    $("#galat-chat-admin").text("");
    muatChatAdmin().then(muatPercakapan);
});

$("#form-chat-admin").on("submit", function (e) {
    e.preventDefault();
    var galat = $("#galat-chat-admin").text("");
    var isi = $.trim($("#input-chat-admin").val());
    if (!isi || !chatAdminId) return;
    var tombol = $(this).find("button[type=submit]").addClass("sibuk");
    apiPost("chat_balas", { pengguna_id: chatAdminId, isi: isi }).then(function () {
        $("#input-chat-admin").val("");
        return muatChatAdmin();
    }).then(muatPercakapan).catch(function (err) {
        galat.text(err.message);
    }).then(function () {
        tombol.removeClass("sibuk");
    });
});

function periksaChatAdmin() {
    if (!$("#panel-chat").prop("hidden")) {
        muatPercakapan();
    } else {
        apiGet("chat_jumlah_belum").then(function (j) {
            aturBadge("#badge-chat-admin", j.jumlah);
        }).catch(function () {});
    }
}

// Polling tiap 5 detik, berhenti saat tab browser tidak aktif atau belum login
var detakKe = 0;
setInterval(function () {
    if (document.hidden || !pengguna) return;
    detakKe++;
    if (isAdmin()) {
        periksaChatAdmin();
    } else {
        periksaChatPelanggan();
        if (detakKe % 6 === 0) muatPesananSaya();   // tiap 30 detik
    }
}, 5000);

// =====================================================
//  AKUN
// =====================================================
function perbaruiTampilanAkun() {
    var admin = isAdmin();
    $("#cs-widget").prop("hidden", !pengguna || admin);
    if (!pengguna || admin) $("#cs-panel").prop("hidden", true);
    $("#gerbang-login").prop("hidden", !!pengguna);
    $("#konten-paket").prop("hidden", !pengguna);
    if (pengguna) {
        $("#nama-akun").text(pengguna.nama);
        $("#label-peran").text(admin ? "(Admin)" : "(Pelanggan)");
        $("#toolbar-admin").prop("hidden", !admin);
        $(".khusus-pelanggan").prop("hidden", admin);
    }
}

function tabAuth(tab) {
    $(".tab-auth button").removeClass("aktif");
    $('.tab-auth button[data-tab="' + tab + '"]').addClass("aktif");
    $("#form-masuk").prop("hidden", tab !== "masuk");
    $("#form-daftar").prop("hidden", tab !== "daftar");
    $(".galat-auth").text("");
}
function bukaAuth(tab) {
    tabAuth(tab || "masuk");
    $("#modal-auth").prop("hidden", false);
}

$(".buka-auth").click(function () {
    bukaAuth($(this).data("tab"));
});
$(".tab-auth button").click(function () {
    tabAuth($(this).data("tab"));
});

function suksesMasuk(j) {
    csrf = j.csrf;
    pengguna = j.pengguna;
    $("#modal-auth").prop("hidden", true);
    $("#form-masuk, #form-daftar").each(function () { this.reset(); });
    perbaruiTampilanAkun();
    mulaiSetelahLogin();
}

function mulaiSetelahLogin() {
    return muatKatalog().then(function () {
        renderSemua();
        if (!isAdmin()) {
            if (!$("#nama").val()) $("#nama").val(pengguna.nama);
            muatPesananSaya();
            periksaChatPelanggan();
        } else {
            periksaChatAdmin();
        }
    }).catch(function (e) {
        $("#daftar-tujuan").html("<p>" + esc(e.message) + "</p>");
    });
}

$("#form-daftar").on("submit", function (e) {
    e.preventDefault();
    var galat = $("#galat-daftar").text("");
    var tombol = $(this).find("button[type=submit]").addClass("sibuk");
    apiPost("daftar", {
        nama: $("#daftar-nama").val(),
        email: $("#daftar-email").val(),
        sandi: $("#daftar-sandi").val()
    }).then(suksesMasuk).catch(function (err) {
        galat.text(err.message);
    }).then(function () {
        tombol.removeClass("sibuk");
    });
});

$("#form-masuk").on("submit", function (e) {
    e.preventDefault();
    var galat = $("#galat-masuk").text("");
    var tombol = $(this).find("button[type=submit]").addClass("sibuk");
    apiPost("masuk", {
        email: $("#masuk-email").val(),
        sandi: $("#masuk-sandi").val()
    }).then(suksesMasuk).catch(function (err) {
        galat.text(err.message);
    }).then(function () {
        tombol.removeClass("sibuk");
    });
});

$("#keluar").click(function () {
    apiPost("keluar").catch(function () {}).then(function () {
        location.hash = "#paket";
        location.reload();
    });
});

$("#ganti-sandi").click(function () {
    $("#form-sandi")[0].reset();
    $("#galat-sandi").text("");
    $("#modal-sandi").prop("hidden", false);
});
$("#form-sandi").on("submit", function (e) {
    e.preventDefault();
    var galat = $("#galat-sandi").text("");
    apiPost("ganti_sandi", {
        sandi_lama: $("#sandi-lama").val(),
        sandi_baru: $("#sandi-baru").val()
    }).then(function () {
        $("#modal-sandi").prop("hidden", true);
        alert("Kata sandi berhasil diganti.");
    }).catch(function (err) {
        galat.text(err.message);
    });
});

// =====================================================
//  Jalankan saat halaman dibuka
// =====================================================
apiGet("sesi").then(function (j) {
    csrf = j.csrf;
    pengguna = j.pengguna || null;
    NOMOR_WA = j.nomor_wa || "";
    perbaruiTampilanAkun();
    if (pengguna) return mulaiSetelahLogin();
}).catch(function (e) {
    $("#galat-gerbang").text(e.message);
});
