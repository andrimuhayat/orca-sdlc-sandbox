---
name: architect-design
description: ADR dan API contract untuk story yang signifikan secara arsitektur
---
# Architecture design
1. Baca story, AGENTS.md dan docs/adr. Jangan ubah kode aplikasi.
2. Tulis ADR (konteks, keputusan, alternatif, konsekuensi) di docs/adr/<KEY>.md; API contract (OpenAPI) jika lintas layer.
3. Tentukan perubahan data, urutan migrasi, format error, aturan auth.
4. worker_done dengan path ADR dan contract. Story terlalu besar: outcome failed dengan usulan pemecahan.
