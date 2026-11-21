# ADR PROJ1-2: Auth API dengan password scrypt dan token sesi opak

- Status: diusulkan
- Tanggal: 2026-11-22
- Story: PROJ1-2, "Sebagai pengguna API, saya ingin membuat akun dan login dengan email dan password agar request saya bisa dikenali sebagai milik saya."

## Konteks

API ini belum punya user maupun auth. Yang sudah ada dan membatasi desain:

- `src/app.js` merutekan dengan `if (method && pathname)`, memvalidasi input sendiri (`invalid_title`), dan menulis error sebagai `{"error":{"code","message"}}`. `readJson` membatasi body 10 kB, mengembalikan `{}` untuk body kosong, dan melempar `SyntaxError` yang dipetakan ke 400 `invalid_json`. Route yang tidak cocok memberi 404 `not_found`.
- `src/store.js` punya dua implementasi dengan antarmuka yang sama: `memoryStore` (unit test, satu instance baru per server) dan `pgStore` (server, integrasi, e2e). Skema dibuat saat `pgStore()` start dengan `CREATE TABLE IF NOT EXISTS`. `reset()` hanya ada di `pgStore`.
- Test yang ada tidak boleh diubah: `test/unit/app.test.js` (memakai `createApp(memoryStore())`), `test/integration/store.test.js` dan `test/e2e/api.test.js` (keduanya memanggil `reset()`).
- Runtime dependency hanya `pg`, jadi semua kriptografi memakai `node:crypto` di Node 22.
- Keputusan user: token opak yang disimpan di DB (bukan HMAC atau JWT stateless), tanpa kedaluwarsa.
- PR #6 (PROJ1-1, paginasi) masih open dan juga mengubah `app.js` dan `store.js`. PR itu menambah parameter `headers` opsional di `send()` dan fungsi `listPage()`.
- PROJ1-3 (draf) akan melindungi `/todos` dengan sesi dari story ini dan memberi pemilik pada todo.

## Keputusan

### 1. Kontrak HTTP

Semua respons JSON memakai `content-type: application/json` dan format error yang sama (AC7). Pesan error memakai bahasa Inggris seperti `invalid_title`. Test cukup memeriksa status dan `error.code`, kecuali untuk `invalid_credentials` dan `unauthorized`: pesannya harus identik di semua kasus.

| Route | Sukses | Error |
|---|---|---|
| `POST /users` | 201 `{"id","email"}` | 400 `invalid_json`, 400 `invalid_email`, 400 `invalid_password`, 409 `email_taken` |
| `POST /sessions` | 201 `{"token"}` + `cache-control: no-store` | 400 `invalid_json`, 401 `invalid_credentials` |
| `GET /me` | 200 `{"id","email"}` | 401 `unauthorized` + `www-authenticate: Bearer` |
| `DELETE /sessions/current` | 204 tanpa body dan tanpa `content-type` | 401 `unauthorized` + `www-authenticate: Bearer` |

Pesan error:

| Code | Status | Message |
|---|---|---|
| `invalid_email` | 400 | `email must be 3 to 254 characters with exactly one @` |
| `invalid_password` | 400 | `password must be 8 to 72 characters` |
| `email_taken` | 409 | `email is already registered` |
| `invalid_credentials` | 401 | `invalid email or password` (sama untuk semua kasus AC3) |
| `unauthorized` | 401 | `a valid bearer token is required` (sama untuk semua kasus AC5/AC6) |

Kombinasi method dan path lain (mis. `GET /users`, `POST /me`, `DELETE /sessions/123`, `/me/`) tetap 404 `not_found` seperti router sekarang. Tidak ada 405. Query string diabaikan. Body pada `GET /me` dan `DELETE` tidak dibaca.

**`POST /users`**

- Email: jika bukan string, invalid. Nilainya di-`trim()`, lalu harus memenuhi: `length` 3..254 (diukur setelah trim, sebelum lowercase), `split('@').length === 2` dengan kedua bagian tidak kosong, dan tidak memuat U+0000. Postgres `text` tidak bisa menyimpan U+0000, dan tanpa aturan ini input itu menjadi 500. Selain itu tidak ada aturan lain (`a b@c` valid sesuai AC1). Disimpan sebagai `trimmed.toLowerCase()`.
- Password: harus string dengan `length` 8..72, tidak di-trim. "Karakter" berarti UTF-16 code unit (`String.prototype.length`), sama dengan validasi `title`. Delapan spasi valid.
- Respons 201 berisi email yang sudah dinormalisasi. Respons tidak pernah memuat password atau hash. Tidak ada header `Location`, karena belum ada `GET /users/:id`.

| Email (body) | Hasil |
|---|---|
| `"  Ani@Example.TEST "` | 201, disimpan `ani@example.test` |
| `"a@b"` (3), 254 karakter | 201 |
| `"ab"`, `"   "`, `"@b"`, `"a@"`, `"a@b@c"`, 255 karakter | 400 `invalid_email` |
| tidak ada, `null`, `123`, `["a@b"]` | 400 `invalid_email` |
| `"ANI@example.test"` setelah `ani@example.test` terdaftar | 409 `email_taken` |

```http
POST /users
content-type: application/json

{"email":"  Ani@Example.TEST ","password":"kata-sandi-ani"}

HTTP/1.1 201 Created
content-type: application/json

{"id":1,"email":"ani@example.test"}
```

```http
POST /users

{"email":"ani-example.test","password":"pendek"}

HTTP/1.1 400 Bad Request
content-type: application/json

{"error":{"code":"invalid_email","message":"email must be 3 to 254 characters with exactly one @"}}
```

**`POST /sessions`**

- `email` dan `password` harus string. Jika tidak, langsung 401 tanpa query dan tanpa scrypt. Ini tidak membocorkan apa pun, karena tidak bergantung pada data akun.
- Email di-trim dan di-lowercase seperti saat registrasi, lalu dicari. Format email dan panjang password tidak divalidasi di sini. Email yang formatnya salah sama dengan email tidak terdaftar, sehingga semua kasus AC3 memberi 401 yang sama, bukan 400.
- Untuk field string, lookup dan verifikasi selalu dijalankan (bagian 4). Jika berhasil, sesi baru dibuat. Setiap login membuat sesi baru, dan sesi lama tetap berlaku.

```http
POST /sessions

{"email":"ANI@example.test","password":"kata-sandi-ani"}

HTTP/1.1 201 Created
content-type: application/json
cache-control: no-store

{"token":"Y29udG9oLXRva2VuLXNpbnRldGlzLVBST0oxLTItMDE"}
```

```http
POST /sessions

{"email":"ani@example.test","password":"salah-sandi"}

HTTP/1.1 401 Unauthorized
content-type: application/json

{"error":{"code":"invalid_credentials","message":"invalid email or password"}}
```

`cache-control: no-store` mencegah token disimpan oleh cache di antara klien dan server (praktik yang sama dengan respons token OAuth, RFC 6749 §5.1).

**`GET /me`**

```http
GET /me
authorization: Bearer Y29udG9oLXRva2VuLXNpbnRldGlzLVBST0oxLTItMDE

HTTP/1.1 200 OK
content-type: application/json

{"id":1,"email":"ani@example.test"}
```

```http
GET /me

HTTP/1.1 401 Unauthorized
content-type: application/json
www-authenticate: Bearer

{"error":{"code":"unauthorized","message":"a valid bearer token is required"}}
```

**`DELETE /sessions/current`**

Menghapus hanya sesi milik token di header, dengan satu statement `DELETE ... WHERE token_hash = $1`. Jika satu baris terhapus, responsnya 204. Jika tidak ada baris yang terhapus (token tidak dikenal atau sudah logout), responsnya 401. Dua logout bersamaan dengan token yang sama memberi tepat satu 204. Sesi lain milik user yang sama tidak tersentuh (AC6).

```http
DELETE /sessions/current
authorization: Bearer Y29udG9oLXRva2VuLXNpbnRldGlzLVBST0oxLTItMDE

HTTP/1.1 204 No Content
```

`www-authenticate: Bearer` dikirim pada setiap 401 `unauthorized`, sesuai RFC 6750 §3. Header ini sengaja tidak dikirim pada 401 `invalid_credentials`. `POST /sessions` bukan resource yang dilindungi bearer, dan challenge `Bearer` di situ akan menyesatkan. Status 401 untuk login gagal diwajibkan oleh AC3.

### 2. Urutan validasi dan body JSON yang bukan object

Urutan per route. Error pertama yang dikembalikan, dan validasi lokal selesai sebelum database disentuh.

- `POST /users`: `invalid_json` → `invalid_email` → `invalid_password` → hash → INSERT (`email_taken` atau 201). Jika email dan password sama-sama salah, hasilnya `invalid_email`. Jika email sudah terdaftar tetapi password tidak valid, hasilnya `invalid_password`.
- `POST /sessions`: `invalid_json` → `invalid_credentials` (field hilang atau bukan string) → lookup + verifikasi → 201.
- `GET /me`, `DELETE /sessions/current`: header `Authorization` (bagian 3) → lookup → 200 atau 204.

Body yang JSON valid tetapi bukan object (array, string, angka, boolean, `null`) diperlakukan sebagai object tanpa field. `POST /users` menjadi 400 `invalid_email`, dan `POST /sessions` menjadi 401 `invalid_credentials`. Ini sama dengan perilaku `/todos` sekarang (`[]` → `invalid_title`). Pesan `invalid_json` ("body must be JSON up to 10 kB") akan salah untuk body yang memang JSON. Implementasinya membaca field dari `body !== null && typeof body === 'object' ? body : {}`. `null` wajib dijaga karena destrukturisasi `null` melempar `TypeError` (500). Body kosong tetap `{}`, sama seperti sekarang.

### 3. Parsing header `Authorization`

Nilai dibaca dari `req.headersDistinct.authorization` (array semua baris header), bukan dari `req.headers.authorization`. Untuk header berulang, Node menyimpan baris pertama di `req.headers` dan membuang sisanya tanpa tanda. Hal ini sudah diverifikasi di Node 24.

1. Harus ada tepat satu baris `Authorization`. Jika tidak ada atau berulang, hasilnya 401, walaupun nilainya sama.
2. Nilai harus cocok dengan `/^Bearer[ \t]+(\S+)$/i`, dan grup 1 adalah token.
   - Skema case-insensitive (RFC 9110 §11.1), jadi `bearer` dan `BEARER` diterima.
   - Satu atau lebih spasi atau tab di antara skema dan token diterima. Spasi di awal dan akhir nilai sudah dibuang oleh parser HTTP Node (diverifikasi).
   - Token adalah sisa nilai tanpa whitespace. Karakternya tidak dicek lebih jauh, karena token yang salah format akan gagal di lookup dan tetap memberi 401.
3. Hash token (bagian 5), lalu cari sesinya. Jika tidak ketemu, hasilnya 401.

| Header | Hasil |
|---|---|
| tidak ada | 401 |
| `Bearer <token>`, `bearer <token>`, `BEARER <token>` | lookup |
| `Bearer    <token>`, `Bearer\t<token>`, `   Bearer <token>   ` | lookup |
| nilai kosong, `Bearer`, `Bearer    ` | 401 |
| `Basic <x>`, `Token <x>`, `Bearer<token>` | 401 |
| `Bearer a b` | 401 |
| dua baris `Authorization` (nilainya sama atau berbeda) | 401 |
| `Bearer a, Bearer b` (satu baris, gabungan `fetch`) | 401 |

Tabel ini sudah diuji dengan prototipe parser. Catatan untuk test: `fetch` menggabungkan header berulang menjadi satu baris `a, b`. Untuk mengirim dua baris sungguhan, pakai `http.request` dengan header array datar, mis. `['host', 'x', 'authorization', 'Bearer t', 'authorization', 'Bearer t']`. `host` wajib ada, karena tanpa itu Node membalas 400.

### 4. Password: scrypt, format hash, waktu respons

Parameter: `N = 16384` (2^14), `r = 8`, `p = 5`, `keylen = 32` byte, salt 16 byte dari `crypto.randomBytes` (acak per hash, jadi per user).

- Ini salah satu set yang setara di OWASP Password Storage Cheat Sheet (2^17/8/1, 2^16/8/2, 2^15/8/3, 2^14/8/5). Memorinya 16 MiB per hash. Set 2^17/8/1 butuh 128 MiB per hash, sehingga 4 login bersamaan di threadpool libuv akan memakai 512 MiB.
- Hasil ukur di Apple M4 (Node 24, median 5 kali): 2^14/8/5 = 105 ms, 2^15/8/3 = 138 ms, 2^17/8/1 = 194 ms. Di runner CI kemungkinan 2–3 kali lebih lambat.
- Selalu pakai `crypto.scrypt` async (via `util.promisify`), bukan `scryptSync`. Versi sync memblok event loop sekitar 100 ms per request.
- `maxmem` diisi `256 * N * r` (2 kali kebutuhan) di setiap panggilan, dihitung dari parameter yang dipakai. Default Node (32 MiB) sudah menolak N = 2^15, r = 8 dengan `ERR_CRYPTO_INVALID_SCRYPT_PARAMS` (diverifikasi). Tanpa ini, menaikkan N nanti akan membuat verifikasi gagal.

Format penyimpanan: satu kolom `text`, dengan segmen dipisah `$`:

```
scrypt$<N>$<r>$<p>$<salt base64url>$<key base64url>
scrypt$16384$8$5$<22 karakter>$<43 karakter>            (83 karakter)
```

String ini menyimpan algoritma dan parameternya sendiri. Untuk mengganti parameter, cukup ubah konstanta di `src/auth.js`: hash baru memakai parameter baru, dan hash lama tetap diverifikasi dengan parameter yang tersimpan di string-nya. Tidak perlu migrasi skema. Prefiks `scrypt` memberi ruang untuk algoritma lain nanti. Rehash otomatis saat login berada di luar scope.

Verifikasi:

1. `split('$')`. Jika prefiks bukan `scrypt`, lempar error (data rusak, jadi 500, bukan input user).
2. `N`, `r`, `p` diubah dengan `Number()`, salt dan key di-decode dari base64url (`expected` = key), lalu `actual = await scrypt(password, salt, expected.length, {N, r, p, maxmem})`.
3. `crypto.timingSafeEqual(actual, expected)`. Panjangnya selalu sama karena `keylen` diambil dari `expected`, jadi `timingSafeEqual` tidak pernah melempar karena panjang berbeda.

Menyamakan waktu login untuk email tidak terdaftar:

- `src/auth.js` menghitung `DUMMY_HASH = await hashPassword(<16 byte acak>)` sekali saat modul di-import (top-level await), dengan parameter yang sama dengan hash baru.
- `verifyPassword(password, null)` menjalankan scrypt terhadap `DUMMY_HASH` dan selalu mengembalikan `false` (`timingSafeEqual(...) && stored !== null`).
- `app.js` selalu memanggil `verifyPassword(password, user?.passwordHash ?? null)`. Jalur "email tidak ada" dan "password salah" sama-sama menjalankan satu SELECT lewat index dan satu scrypt. Hasil ukur prototipe: 132 ms (dummy) dan 136 ms (hash asli).
- Dummy dihitung saat startup, bukan memakai konstanta literal. Konstanta akan tertinggal saat parameter berubah dan membuka perbedaan waktu lagi. Dummy juga tidak di-lazy-load, karena login pertama untuk email tidak terdaftar akan membayar dua scrypt.

### 5. Token sesi

- Pembuatan: `token = crypto.randomBytes(32).toString('base64url')`, yaitu 43 karakter `[A-Za-z0-9_-]` tanpa padding. Token ini hanya dikirim sekali, di respons `POST /sessions`.
- Hash: `tokenHash = createHash('sha256').update(token).digest('hex')`, yaitu 64 karakter hex. Yang di-hash adalah string token persis seperti yang dikirim klien (byte UTF-8), bukan hasil decode base64url-nya. Decoder base64url Node longgar: `QUJD`, `QU!JD==` dan `QU JD` di-decode ke byte yang sama (diverifikasi). Jika yang di-hash hasil decode, satu token jadi punya banyak representasi string yang valid.
- Simpan: hanya `tokenHash` di `sessions.token_hash`. Token asli tidak pernah disimpan atau di-log.
- Lookup: header → token → `hashToken(token)` → `WHERE token_hash = $1` lewat primary key. Perbandingan constant-time tidak diperlukan di sini. Yang dibandingkan di index adalah hash SHA-256, dan waktu lookup tidak membantu menebak token 256-bit.
- SHA-256 tanpa salt cukup, karena token sudah punya entropi 256 bit. Hash lambat atau salt hanya diperlukan untuk rahasia berentropi rendah seperti password.
- Tidak ada kedaluwarsa (keputusan user). Sesi berlaku sampai `DELETE /sessions/current`.

### 6. Skema DB dan migrasi

Tiga statement baru di `pgStore`, dijalankan setelah statement `todos` yang sudah ada. Setiap statement adalah satu `pool.query` terpisah, idempotent, satu per perubahan:

```sql
CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  email text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)
```

```sql
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email))
```

```sql
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
)
```

- `email` disimpan lowercase oleh `app.js`. Unique index pada `lower(email)` menjaga keunikan case-insensitive di level DB, walaupun ada penulis lain. Lookup login memakai `WHERE lower(email) = lower($1)`, ekspresi yang sama dengan index, sehingga planner memakai index (EXPLAIN: `Index Scan using users_email_lower_key`). Aturan cocok saat login juga identik dengan aturan unik saat registrasi.
- `sessions.token_hash` sebagai primary key: lookup dan delete memakai index ini, dan tidak ada konsumen untuk id sesi terpisah.
- `user_id` ber-FK ke `users(id)` dengan `ON DELETE CASCADE`: jika user dihapus (belum ada di scope), sesinya ikut terhapus. Index pada `sessions(user_id)` belum dibuat, karena belum ada query per user. Index itu perlu jika nanti ada "logout semua" atau hapus akun.
- `created_at` tidak dibaca oleh kode di story ini. Kolom ini disertakan karena waktu pembuatan sesi tidak bisa diisi mundur. Story kedaluwarsa sesi nanti membutuhkannya, dan tanpa kolom ini semua sesi lama akan terlihat "baru dibuat".
- `id serial` dikembalikan `pg` sebagai `number`, sesuai `{"id":<int>}` di AC1.
- Migrasi: tidak ada perubahan pada `todos` dan tidak ada data yang dipindahkan. Database dev yang sudah ada cukup mendapat dua tabel baru saat start. Statement kedua dan ketiga bergantung pada yang pertama, jadi urutannya harus seperti di atas. Jika proses mati di tengah, start berikutnya melanjutkan, karena semuanya `IF NOT EXISTS`.

Race dua registrasi dengan email yang sama: tidak ada SELECT sebelum INSERT, karena pola itu punya celah TOCTOU. Kedua request langsung INSERT. Unique index membuat salah satunya gagal dengan `23505`, dan `pgStore.createUser` memetakan error itu (`err.code === '23505' && err.constraint === 'users_email_lower_key'`) ke `null`. Error lain dilempar ulang (500). Hal ini sudah diverifikasi di Postgres 16: error `23505` membawa constraint name `users_email_lower_key`, `TRUNCATE users` saja ditolak karena FK, dan `TRUNCATE todos, sessions, users` berhasil.

### 7. Antarmuka `store.js`

Fungsi baru, dengan semantik sama di `memoryStore` dan `pgStore`:

```js
// email sudah dinormalisasi (trim + lowercase) oleh app.js; passwordHash berformat bagian 4; tokenHash 64 hex.
createUser(email, passwordHash)      → Promise<{ id, email } | null>                // null: email sudah terdaftar
findUserByEmail(email)               → Promise<{ id, email, passwordHash } | null>
createSession(userId, tokenHash)     → Promise<void>
findSessionUser(tokenHash)           → Promise<{ id, email } | null>                // null: sesi tidak ada
deleteSession(tokenHash)             → Promise<boolean>                             // true: tepat satu sesi dihapus
```

- `memoryStore`: array `users` dengan counter id sendiri, dan `Map` `tokenHash → userId` untuk sesi. Emailnya sudah dinormalisasi, jadi `createUser` dan `findUserByEmail` cukup membandingkan dengan `===`. Seperti fungsi yang ada, fungsi ini mengembalikan salinan, bukan referensi ke baris internal.
- `pgStore.findUserByEmail` mengembalikan `null` tanpa query jika email memuat U+0000, karena Postgres menolak karakter itu di parameter `text` dan akan menjadi 500. User dengan email seperti itu memang tidak mungkin ada (bagian 1). Kolom `password_hash` dipetakan ke `passwordHash` (`AS "passwordHash"`).
- `pgStore.findSessionUser`: `SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`.
- `pgStore.deleteSession`: `rowCount === 1`.
- `pgStore.reset()` menjadi `TRUNCATE todos, sessions, users RESTART IDENTITY`, satu statement. `TRUNCATE users` tanpa `sessions` ditolak Postgres karena FK. Jika PROJ1-3 menambah FK `todos.user_id`, statement ini tetap valid. `memoryStore` tetap tanpa `reset()`, karena unit test membuat store baru per server.
- `list()`, `create()` dan `close()` tidak berubah. `listPage()` dari PR #6 juga tidak berubah jika PR itu sudah merge.
- Semua query memakai parameter `$1`, `$2`.

### 8. Pembagian modul

- **`src/auth.js` (baru)**: hanya memakai `node:crypto`, tanpa HTTP dan tanpa store. Isinya `hashPassword(password) → Promise<string>`, `verifyPassword(password, stored | null) → Promise<boolean>`, `newToken() → { token, tokenHash }`, `hashToken(token) → string`. Konstanta parameter scrypt dan `DUMMY_HASH` bersifat privat di modul ini.
- **`src/app.js`**: route baru, validasi dan normalisasi email/password (lapisan validasi HTTP, seperti `invalid_title`), parsing header `bearerToken(req)`, error mapping, header respons, dan 204. Di dalam `createApp`, closure `authenticate(req) → Promise<{ id, email } | null>` (header → `hashToken` → `store.findSessionUser`) dipakai `GET /me`. PROJ1-3 cukup memanggil `authenticate(req)` di route `/todos` dan meneruskan `user.id` ke store.
- **`src/store.js`**: skema, query, dan pemetaan `23505` → `null`.
- **`package.json`**: script `lint` ditambah `&& node --check src/auth.js`. Lint sekarang mendaftar file satu per satu, jadi tanpa ini file baru tidak ikut dicek.
- `send(res, status, body, headers = {})` memakai signature dari PR #6. Jika PR #6 belum merge saat implementasi, tambahkan perubahan yang sama persis, supaya konflik merge-nya trivial. Respons 204 ditulis langsung dengan `res.writeHead(204); res.end()`.

### 9. `readJson`, `invalid_json` dan batas 10 kB

Kode `invalid_json`, pesannya, batas `raw.length > 10_000` dan perlakuan body kosong (`{}`) tidak berubah.

Satu perbaikan wajib: panggil `req.setEncoding('utf8')` sebelum loop `for await`. Sekarang setiap chunk Buffer diubah ke string sendiri-sendiri (`raw += chunk`), sehingga karakter multibyte yang terpotong di batas chunk TCP rusak menjadi U+FFFD. Hal ini sudah diverifikasi: body yang dikirim dalam dua write yang memotong `é` terbaca sebagai `kata-sandi-��-rahasia`. Untuk password, akibatnya hash saat registrasi dan saat login bisa berbeda, tergantung bagaimana TCP memotong body. Dengan `setEncoding`, Node memakai `StringDecoder` yang menyambung karakter terpotong dengan benar. Untuk input lain perilakunya tidak berubah, termasuk title todo.

### 10. Dampak ke test

Test yang ada lulus tanpa diubah:

- `test/unit/app.test.js`: `createApp(memoryStore())` tetap bekerja. `memoryStore` hanya mendapat fungsi baru, dan route `/health`, `/todos` serta 404 tidak berubah (AC8). Import `app.js` sekarang menunggu `DUMMY_HASH` (sekitar 0,1–0,3 detik, sekali per proses test).
- `test/integration/store.test.js`: `reset()` sekarang juga mengosongkan `users` dan `sessions`. Test ini hanya memakai `todos`.
- `test/e2e/api.test.js`: `start()` membuat tabel baru, dan `reset()` tetap berhasil.
- `test-integrity`: hanya ada file test baru, jadi jumlah assertion naik.

Test baru (file baru):

- `test/unit/auth.test.js`: lewat HTTP dengan `createApp(memoryStore())`, memakai pola `withServer` (helper disalin, karena tidak diekspor). Isinya tabel email/password dari bagian 1, urutan validasi (email dan password sama-sama salah → `invalid_email`), body `null`/`[]`/`"x"`, `invalid_json`, `email_taken` beda huruf, respons tanpa `password`, login sukses dengan email beda huruf dan spasi, empat kasus 401 dengan pesan identik, `cache-control`, tabel header dari bagian 3 (termasuk dua baris header via `http.request`), `www-authenticate`, logout 204 tanpa body lalu `/me` 401, sesi kedua tetap berlaku, dan logout kedua 401. Ada juga satu test body terpotong di tengah `é`: registrasi dan login dengan password itu berhasil.
- `test/unit/password.test.js`: memanggil `src/auth.js` langsung. Isinya format `scrypt$16384$8$5$...`, hash tidak memuat password, dua hash dari password yang sama berbeda (salt acak), verifikasi benar/salah, `verifyPassword(x, null) === false`, hash dengan parameter lain (mis. N = 2^15, string-nya dibuat manual di test dengan `crypto.scrypt`) tetap terverifikasi, token 43 karakter base64url, dan `hashToken` deterministik 64 hex.
- `test/integration/auth-store.test.js`: memanggil `reset()` di `before`. Isinya `createUser`, duplikat beda huruf → `null`, dua `createUser` bersamaan dengan email sama lewat `Promise.all` → tepat satu `null`, lookup email, siklus `createSession`/`findSessionUser`/`deleteSession` (kedua kalinya `false`), `findUserByEmail` dengan U+0000 → `null`, dan `reset()` mengosongkan user dan sesi.
- Tidak ada file e2e baru. `npm run test:e2e` berjalan tanpa `--test-concurrency=1`, jadi file e2e berjalan paralel. `api.test.js` memanggil `reset()` lalu mengharapkan daftar todo yang persis. File e2e lain yang memanggil `reset()` bisa membuatnya flaky. Di database baru, dua `pgStore()` yang start bersamaan juga bisa bentrok di `CREATE TABLE IF NOT EXISTS`. Jika QA menambah test e2e, test itu jangan memanggil `reset()` dan harus memakai email unik per run.
- Biaya waktu: setiap registrasi atau login sekitar 0,1 detik di M4. Buat user seperlunya per test.

### 11. API contract

Tidak ada file OpenAPI. Perubahan ini satu service tanpa konsumen lintas layer (tidak ada frontend atau klien hasil codegen), sama seperti PROJ1-1. Kontrak di ADR ini cukup.

## Alternatif yang ditolak

- **Token stateless (HMAC atau JWT)**: ditolak oleh user. Logout per sesi butuh daftar sesi di server.
- **bcrypt atau argon2**: butuh dependency. `crypto.argon2` tidak ada di Node 22. Batas 72 karakter di AC1 berasal dari bcrypt, tetapi scrypt tidak punya batas itu, jadi batas tersebut hanya aturan validasi.
- **PBKDF2**: tidak memory-hard.
- **scrypt 2^17/8/1**: 8 kali lebih banyak memori daripada 2^14/8/5 untuk kekuatan yang setara menurut OWASP.
- **Salt dan parameter di kolom terpisah**: setiap pergantian algoritma butuh migrasi skema. String yang mendeskripsikan dirinya sendiri tidak butuh itu.
- **PHC string persis (`$scrypt$ln=14,r=8,p=5$...`)**: tidak ada kebutuhan interoperabilitas, dan `split('$')` positional lebih sederhana.
- **Ekstensi `citext`**: butuh `CREATE EXTENSION` dengan hak lebih tinggi, hanya untuk satu kolom.
- **`UNIQUE (email)` + `CHECK (email = lower(email))`**: `toLowerCase()` di JS dan `lower()` di Postgres berbeda untuk sebagian karakter. Hasil verifikasi: JS mengubah `İ` menjadi `i̇` (2 code unit), sedangkan Postgres 16 Alpine mengubahnya menjadi `i`. Akibatnya CHECK bisa menolak email yang valid dengan 500. Index pada `lower(email)` tidak punya mode gagal ini.
- **SELECT lalu INSERT untuk `email_taken`**: ada race antara cek dan insert.
- **`INSERT ... ON CONFLICT ((lower(email))) DO NOTHING RETURNING`**: sama benarnya. Pemetaan `23505` dipilih karena diminta di brief, dan karena INSERT biasa tidak menyalin ekspresi index ke query. Kedua cara sama-sama terikat ke index tersebut.
- **Body JSON bukan object dianggap `invalid_json`**: pesannya salah untuk JSON yang valid, dan tidak konsisten dengan `/todos`.
- **Validasi format email/panjang password di login**: akan memberi 400 untuk kasus yang menurut AC3 harus 401 `invalid_credentials`.
- **Dummy hash sebagai literal di kode, atau lazy**: lihat bagian 4.
- **Hash token hasil decode base64url**: banyak string jadi valid untuk satu token (bagian 5).
- **Menyimpan token asli atau token terenkripsi**: kebocoran DB atau kunci akan langsung menjadi pencurian sesi.
- **`req.headers.authorization`**: header berulang diam-diam memakai baris pertama.
- **Skema `Bearer` case-sensitive dan tepat satu spasi**: bertentangan dengan RFC 9110 dan menolak klien yang valid tanpa manfaat.
- **Id sesi surrogate (`serial`)**: tidak ada konsumen. `token_hash` sudah unik.
- **File e2e untuk alur auth**: risiko flaky karena file e2e berjalan paralel (bagian 10). Alur HTTP diuji di unit, dan query pg diuji di integrasi.

## Konsekuensi

- Registrasi dan login masing-masing memakai sekitar 100 ms CPU dan 16 MiB, di threadpool libuv (default 4 thread). Throughput login per proses sekitar 40 per detik di M4. Tanpa rate limiting (di luar scope), endpoint ini mudah dipakai untuk DoS. Rate limiting adalah kandidat story berikutnya.
- Email terdaftar tetap bisa ditebak lewat 409 `email_taken` di `POST /users`, karena AC1 mewajibkannya. Dummy hash hanya menutup kebocoran waktu di `POST /sessions`.
- Setelah parameter scrypt diganti, login ke akun dengan hash lama punya waktu yang berbeda dari dummy. Hal ini ditutup dengan rehash saat login (story terpisah).
- Tabel `sessions` tumbuh tanpa batas: setiap login menambah satu baris, dan tidak ada kedaluwarsa. `created_at` sudah tersedia untuk story kedaluwarsa atau pembersihan nanti.
- Token adalah bearer credential. Server hanya listen di 127.0.0.1, jadi cukup untuk sandbox. Deployment sungguhan butuh TLS.
- Test unit menjadi beberapa detik lebih lambat karena scrypt.
- PROJ1-3 mendapat `authenticate(req)` di `app.js`, `users.id` integer sebagai target FK `todos.user_id`, dan `reset()` yang sudah mengosongkan ketiga tabel. Nasib todo lama tanpa pemilik diputuskan di ADR PROJ1-3.
- Perbaikan `readJson` juga menyelamatkan title todo dengan karakter multibyte yang terpotong chunk.

## Catatan untuk implementasi

- Branch dari `main` terbaru. Jika PR #6 sudah merge, pakai `send(..., headers)` yang ada. Jika belum, tambahkan perubahan `send()` yang sama. Konflik dengan PR #6 hanya tekstual (baris route dan objek store yang bersebelahan), dan diselesaikan dengan mempertahankan keduanya.
- Estimasi baris berubah:

| Bagian | Baris |
|---|---|
| `src/app.js` (4 route, validasi, `bearerToken`, `authenticate`, `setEncoding`) | ~60 |
| `src/store.js` (3 statement skema, 5 fungsi x 2 store, `reset`) | ~65 |
| `src/auth.js` (baru) | ~30 |
| `package.json` (lint) | 1 |
| **Kode** | **~155** |
| `test/unit/auth.test.js` | ~150 |
| `test/unit/password.test.js` | ~35 |
| `test/integration/auth-store.test.js` | ~50 |
| **Test** | **~235** |
| **Kode + test** | **~390** |
| ADR ini (dihitung terpisah, seperti PROJ1-1) | 363 |

- Muat dalam satu PR, dengan sedikit ruang. Pakai test berbasis tabel (loop atas kasus) untuk tabel di bagian 1 dan 3. Jika kode + test melewati sekitar 450 baris, rapatkan test-nya. Pecahan story tidak perlu.
