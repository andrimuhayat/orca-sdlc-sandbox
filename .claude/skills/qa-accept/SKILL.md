---
name: qa-accept
description: Acceptance test held-out dari kriteria story, lalu jalankan di branch PR
---
# QA acceptance
1. Dari kriteria di spec saja, tulis acceptance test di folder kerja sendiri (qa/<KEY>/), sebelum membaca diff.
2. gh pr checkout <nomor>. Jalankan seluruh test suite dari AGENTS.md, lalu acceptance test Anda.
3. Untuk setiap kriteria: lulus / gagal / tidak bisa diuji, dengan bukti.
4. Posting hasil sebagai komentar PR, lampirkan acceptance test sebagai blok kode. Jangan push.
5. worker_done: outcome failed jika ada kriteria gagal.
