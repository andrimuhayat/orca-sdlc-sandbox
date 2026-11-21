---
name: qa-accept
description: Acceptance test held-out dari kriteria story, lalu jalankan di branch PR
---
# QA acceptance
1. Dari kriteria di spec saja, tulis acceptance test di folder kerja sendiri (qa/<KEY>/), sebelum membaca diff.
2. Worktree Anda dibuat dari head PR, dan setup sudah membuat `.env` serta database. Jalankan seluruh test suite dari AGENTS.md, lalu acceptance test Anda.
3. Untuk setiap kriteria: lulus / gagal / tidak bisa diuji, dengan bukti.
4. Tulis hasil ke qa/<KEY>/report.md, lampirkan acceptance test sebagai blok kode, posting dengan `gh pr comment <nomor> --body-file qa/<KEY>/report.md`. Jangan push.
5. worker_done: outcome failed jika ada kriteria gagal.
