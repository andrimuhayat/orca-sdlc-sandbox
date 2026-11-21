# ADR PROJ1-1: Paginasi limit/offset untuk GET /todos

- Status: diusulkan
- Tanggal: 2026-11-22
- Story: PROJ1-1, "Sebagai pengguna API, saya ingin mengambil todo per halaman agar respons tetap kecil saat data banyak."

## Konteks

`GET /todos` sekarang mengembalikan semua baris (`store.list()` → `SELECT id, title, done FROM todos ORDER BY id`) dan mengabaikan query string. Ukuran respons tumbuh tanpa batas mengikuti jumlah data.

Yang sudah ada dan membatasi desain:

- `src/app.js` memvalidasi input HTTP sendiri (contoh `invalid_title`) dan menulis error sebagai `{"error":{"code","message"}}`. `send()` hanya menulis header `content-type`.
- `src/store.js` punya dua implementasi dengan antarmuka yang sama: `memoryStore` (unit test) dan `pgStore` (server, integrasi, e2e). Tabel `todos(id serial PRIMARY KEY, title text NOT NULL, done boolean NOT NULL DEFAULT false)`.
- `test/integration/store.test.js` memanggil `store.list()` tanpa argumen dan mengharapkan array baris. Test ini tidak boleh diubah, jadi `list()` harus tetap seperti sekarang.
- Belum ada endpoint DELETE. Todo baru selalu mendapat id lebih besar, jadi muncul di ujung urutan `ORDER BY id`.
- Tidak ada auth dan tidak ada frontend.

## Keputusan

### 1. Kontrak GET /todos

| Parameter | Default | Rentang valid | Keterangan |
|---|---|---|---|
| `limit` | `20` | `1`..`100` | jumlah maksimum item di halaman |
| `offset` | `0` | `0` ke atas | posisi item pertama (0 = todo dengan id terkecil) |

Respons 200:

- Body tetap `{"items":[...]}`. Isinya todo dengan urutan `id` naik, dimulai dari posisi `offset`, paling banyak `limit` item.
- Header `X-Total-Count` berisi jumlah semua todo sebagai bilangan desimal tanpa pemisah, mis. `25`. Nilainya tidak bergantung pada `limit` dan `offset`. Header ini selalu dikirim pada 200 dari `GET /todos`, termasuk saat request tanpa query.
- `offset` >= total memberi 200 dengan `{"items":[]}` dan `X-Total-Count` = total. Ini bukan error.

Respons 400 untuk input yang tidak valid (aturan parsing di bagian 2):

- Body `{"error":{"code":"invalid_pagination","message":"<teks>"}}`, `content-type: application/json`, dan tanpa header `X-Total-Count`.

Parameter lain di query (mis. `page`, `sort`, `LIMIT` huruf besar) tetap diabaikan, seperti sekarang. Nama parameter peka huruf besar-kecil.

Contoh (data sintetis):

```http
GET /todos?limit=2&offset=1

HTTP/1.1 200 OK
content-type: application/json
x-total-count: 3

{"items":[{"id":2,"title":"Beli susu","done":false},{"id":3,"title":"Bayar listrik","done":false}]}
```

```http
GET /todos?offset=50

HTTP/1.1 200 OK
content-type: application/json
x-total-count: 3

{"items":[]}
```

```http
GET /todos?limit=0

HTTP/1.1 400 Bad Request
content-type: application/json

{"error":{"code":"invalid_pagination","message":"limit must be an integer from 1 to 100"}}
```

### 2. Aturan parsing "bilangan bulat"

Nilai dibaca dari `url.searchParams`, yang sudah melakukan percent-decoding. Catatan: `+` di query di-decode menjadi spasi. Untuk setiap parameter:

1. Parameter tidak ada → pakai default.
2. Parameter muncul lebih dari sekali (`getAll(name).length > 1`) → 400, walaupun nilainya sama.
3. Nilai harus cocok dengan `^[0-9]+$`: satu atau lebih digit ASCII. Tidak ada tanda, spasi, titik, eksponen, prefiks hex atau digit non-ASCII. String kosong ditolak. Nol di depan boleh (`01` = 1).
4. Ubah dengan `Number(value)`, lalu cek rentang: `limit` 1..100, `offset` >= 0.
5. `offset` di atas `Number.MAX_SAFE_INTEGER` (2^53−1) dijepit ke `Number.MAX_SAFE_INTEGER`. Hasilnya identik dengan nilai aslinya, yaitu `items` kosong, karena `id serial` (int4) membatasi tabel ke paling banyak 2^31−1 baris. Penjepitan ini perlu karena nilai di atas batas bigint membuat Postgres gagal dengan `bigint out of range`, yang akan menjadi 500. Hal ini sudah diverifikasi di Postgres 16.

`limit` divalidasi lebih dulu, lalu `offset`. Error pertama yang dikembalikan. Validasi selesai sebelum store dipanggil, jadi request 400 tidak menyentuh database.

| Query | Hasil |
|---|---|
| (tanpa query) | `limit=20, offset=0` |
| `limit=5&offset=10` | `limit=5, offset=10` |
| `limit=100` | `limit=100` |
| `limit=01` | `limit=1` |
| `offset=0`, `offset=00` | `offset=0` |
| `offset=99999999999999999999` | 200, `offset` dijepit ke 2^53−1, `items` kosong |
| `limit=0`, `limit=101`, `limit=-1` | 400 |
| `limit=1.5`, `limit=1e2`, `limit=0x10`, `limit=abc` | 400 |
| `limit=` dan `limit` (tanpa `=`) | 400 (ada, tetapi kosong) |
| `limit=%2B5` (`+5`) | 400 |
| `limit=+5` (di-decode menjadi ` 5`), `limit=%205` | 400 |
| `limit=%E0%A5%AB` (digit Devanagari `५`) | 400 |
| `limit=5&limit=5` | 400 |
| `offset=-1` | 400 |
| `limit=abc&offset=-1` | 400 dengan pesan untuk `limit` |
| `page=2&LIMIT=500` | diabaikan → `limit=20, offset=0` |

Pesan error (bahasa Inggris, seperti `invalid_title`). Pesan bersifat informatif dan test cukup memeriksa status serta `error.code`:

- `limit` tidak valid: `limit must be an integer from 1 to 100`
- `offset` tidak valid: `offset must be an integer of 0 or more`
- parameter berulang: `limit must appear at most once` / `offset must appear at most once`

Tabel ini sudah diuji dengan prototipe parser di Node 24 (`URLSearchParams` yang sama dengan Node 22).

### 3. Layer validasi dan format error

Validasi dilakukan di `src/app.js` (layer HTTP), sama seperti `invalid_title`. Bentuknya fungsi murni di level modul, mis. `parsePagination(searchParams)`, yang mengembalikan `{ limit, offset }` atau pesan error. `app.js` memetakan error ke `400 invalid_pagination` lewat helper `error()` yang sudah ada.

`send()` diberi parameter header tambahan opsional, mis. `send(res, status, body, headers = {})`, supaya route bisa menulis `X-Total-Count`. Pemanggil lain tidak berubah.

Store tidak memvalidasi ulang. Prasyaratnya: `limit` adalah integer 1..100 dan `offset` adalah integer 0..`Number.MAX_SAFE_INTEGER`. Query pg tetap memakai parameter (`$1`, `$2`), jadi tidak ada risiko injeksi.

### 4. Antarmuka store.js

Fungsi baru di `memoryStore` dan `pgStore`:

```js
// limit: integer 1..100, offset: integer 0..Number.MAX_SAFE_INTEGER (divalidasi app.js)
listPage({ limit, offset }) → Promise<{ items: Array<{ id: number, title: string, done: boolean }>, total: number }>
```

- `items`: urut `id` naik, mulai di posisi `offset`, paling banyak `limit`.
- `total`: jumlah semua todo, diambil dari snapshot yang sama dengan `items` (bagian 5).
- `list()` dan `create()` tidak berubah. Setelah perubahan ini `app.js` hanya memanggil `listPage()`. `list()` dipertahankan karena dipakai test integrasi yang tidak boleh diubah.

Sketsa `memoryStore`. Baris di sana sudah urut id karena hanya di-push dengan id naik:

```js
async listPage({ limit, offset }) {
  return { items: rows.slice(offset, offset + limit).map((r) => ({ ...r })), total: rows.length };
},
```

### 5. Satu query, satu snapshot

`pgStore.listPage` mengambil total dan halaman dalam satu statement SQL:

```sql
SELECT c.total, p.id, p.title, p.done
FROM (SELECT count(*)::int AS total FROM todos) AS c
LEFT JOIN (SELECT id, title, done FROM todos ORDER BY id LIMIT $1 OFFSET $2) AS p ON true
ORDER BY p.id
```

```js
async listPage({ limit, offset }) {
  const r = await pool.query(PAGE_SQL, [limit, offset]);
  return {
    total: r.rows[0].total,
    items: r.rows.filter((row) => row.id !== null).map(({ id, title, done }) => ({ id, title, done })),
  };
},
```

- Konsistensi: di Postgres (READ COMMITTED), satu statement membaca satu snapshot yang diambil saat statement mulai, termasuk semua subquery-nya. Karena itu dalam satu respons selalu berlaku `items.length === max(0, min(limit, total − offset))`, dan klien bisa menghitung "masih ada halaman berikutnya" dengan `offset + items.length < total` tanpa race.
- `LEFT JOIN ... ON true` menjamin selalu ada minimal satu baris. Saat halaman kosong (tabel kosong atau `offset` >= total), hasilnya satu baris dengan `total` terisi dan `id` NULL. `id` adalah primary key, jadi NULL hanya berarti "tidak ada item".
- `count(*)::int` aman karena jumlah baris <= 2^31−1, dan `pg` mengembalikan int4 sebagai `number`. Tanpa cast, bigint dikembalikan sebagai string.
- Baris item tetap melewati type parser `pg` yang sama dengan `list()` dan `create()`.
- Sudah diverifikasi di Postgres 16: tabel kosong → `total 0` + satu baris NULL; 25 baris dengan `LIMIT 5 OFFSET 10` → id 11..15, total 25; `OFFSET 30` dan `OFFSET 9007199254740991` → total 25 + satu baris NULL.

Antar-request tidak ada jaminan konsistensi; ini sifat bawaan offset pagination. Karena belum ada DELETE dan todo baru masuk di ujung, halaman yang sudah dibaca tidak bergeser oleh insert biasa. Pengecualiannya insert konkuren yang commit tidak berurutan terhadap id-nya, yang bisa menyisipkan item di halaman yang sudah dibaca. Cursor pagination di luar scope.

### 6. Skema, index dan migrasi

Tidak ada perubahan skema, index atau migrasi. `ORDER BY id LIMIT/OFFSET` memakai index `todos_pkey` yang sudah ada (EXPLAIN: `Limit → Index Scan using todos_pkey`). `count(*)` memakai seq scan O(n), yang wajar untuk skala sandbox. Tidak ada urutan deploy khusus.

### 7. Auth

Tidak ada auth sekarang, dan story ini tidak menambahkannya.

### 8. API contract

Tidak ada file OpenAPI. Perubahan ini hanya menyentuh satu endpoint di satu service tanpa konsumen lintas layer (tidak ada frontend atau codegen klien). Kontrak di ADR ini cukup.

## Alternatif yang ditolak

- **Dua query di pool tanpa transaksi** (`count` + `SELECT ... LIMIT OFFSET`, mis. `Promise.all`): paling sederhana, tetapi total dan halaman bisa tidak cocok jika ada insert di antara keduanya.
- **Dua query dalam transaksi `REPEATABLE READ READ ONLY`**: konsisten, tetapi butuh `pool.connect()`, `BEGIN`/`COMMIT`/`ROLLBACK` dan `release()` di setiap jalur error, plus 4 round trip. Lebih banyak cara untuk gagal (koneksi bocor) demi hasil yang sama dengan satu statement.
- **`count(*) OVER ()` di query halaman**: total hilang saat halaman kosong (`offset` >= total), sehingga butuh query fallback.
- **`json_agg` dalam satu baris**: konsisten dan kode JS-nya pendek, tetapi item tidak lagi melewati type parser `pg`. Kolom baru seperti `timestamptz` atau `bigint` nanti akan diserialisasi berbeda dari `create()`.
- **Mengubah `list()` menjadi `list({ limit, offset })` → `{ items, total }`**: merusak `test/integration/store.test.js`, yang tidak boleh diubah. Overload dengan tipe kembalian berbeda per argumen juga ditolak.
- **Validasi di store**: store tidak tahu soal HTTP. Validasi input HTTP sudah ada di `app.js`.
- **Parsing longgar (`parseInt`/`Number` langsung)**: `parseInt("1.5")` = 1, `Number("")` = 0, `Number(" 5")` = 5, `Number("0x10")` = 16. Semuanya akan lolos diam-diam, padahal AC4 mewajibkan 400.
- **Menolak `offset` besar dengan 400**: AC4 hanya menyebut `offset` negatif sebagai tidak valid. Menjepit nilainya memberi hasil yang identik tanpa menambah kasus error.
- **`limit=` kosong dianggap tidak ada (pakai default)**: aturan "ada berarti divalidasi" lebih sederhana, dan string kosong memang bukan bilangan bulat.
- **Parameter berulang: ambil yang pertama** (perilaku `searchParams.get`): ambigu dan diam-diam. Ditolak dengan 400.
- **Menolak nol di depan (`01`)**: tidak ada manfaatnya, hanya menambah aturan.
- **Total di body atau header `Link`**: AC2 dan AC3 mewajibkan body tetap `{"items":[...]}` dan total di `X-Total-Count`.

## Konsekuensi

- Respons `GET /todos` dibatasi paling banyak 100 item, dan klien tahu total dari `X-Total-Count`.
- Perubahan perilaku: `GET /todos` tanpa query sekarang mengembalikan paling banyak 20 item. Untuk 20 item atau kurang, body identik dengan sekarang (AC5). Klien yang punya lebih dari 20 todo dan mengandalkan daftar penuh harus mulai memakai paginasi. Header `X-Total-Count` ikut muncul pada request tanpa query.
- Test yang ada tetap lulus tanpa diubah: unit test memakai 1 item, `store.list()` tidak berubah, dan e2e memakai 1 item.
- Setiap request menjalankan `count(*)` O(n) dan melewati `offset` baris lewat index. Jika tabel tumbuh ke jutaan baris, pertimbangkan estimasi total atau cursor pagination (story terpisah).
- `list()` tidak lagi punya pemanggil produksi. Fungsi ini dipertahankan demi test integrasi yang ada dan bisa dihapus di story lain yang boleh menyentuh test itu.
- Jika kelak ada klien browser lintas origin, perlu header `Access-Control-Expose-Headers: X-Total-Count`. Itu di luar scope sekarang.

## Catatan untuk implementasi

Muat dalam satu PR. Perkiraan sekitar 45 baris di `src/` dan 120–150 baris test di file baru, jadi jauh di bawah ~400 baris.

Test baru (file baru; file test yang ada tidak disentuh):

- `test/unit/pagination.test.js` (HTTP + `memoryStore`, pola `withServer` seperti `app.test.js`):
  - 25 todo, tanpa query → id 1..20, `X-Total-Count: 25`.
  - `limit=5&offset=10` → id 11..15.
  - `offset=25` dan `offset=30` → `{"items":[]}`, `X-Total-Count: 25`.
  - 0 todo → `{"items":[]}`, `X-Total-Count: 0`.
  - `limit=100` diterima; `limit=01` → 1 item; `offset=99999999999999999999` → 200 dengan items kosong.
  - Setiap baris 400 dari tabel di bagian 2 → status 400, `error.code === "invalid_pagination"`, tanpa `X-Total-Count`.
  - `page=2&LIMIT=500` diabaikan.
- `test/integration/pagination.test.js` (`pgStore.listPage`; panggil `reset()` di `before` karena file integrasi berbagi database dan berjalan berurutan):
  - 3 todo: `{limit:2, offset:1}` → id [2, 3], total 3.
  - `{limit:20, offset:5}` → items kosong, total 3. Ini kasus `LEFT JOIN` dengan baris NULL.
  - `{limit:20, offset:Number.MAX_SAFE_INTEGER}` → items kosong, total 3. Ini regresi untuk bigint overflow.
  - `total` bertipe `number`.
