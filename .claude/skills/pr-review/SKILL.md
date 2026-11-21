---
name: pr-review
description: Review PR agent terhadap story, test dan konvensi tim
---
# PR review
1. Worktree Anda dibuat dari head PR. Catat `git rev-parse HEAD` dan `git status --porcelain`. HEAD harus sama dengan head commit di spec dan `gh pr view <nomor> --json headRefOid`; beda: worker_done failed dengan kedua nilai, stop.
2. gh pr diff <nomor>; baca setiap file yang berubah secara utuh, plus plan dari spec.
3. Cek: semua kriteria terpenuhi; ada test untuk perilaku baru; tidak ada test yang dihapus, di-skip atau dilemahkan; error handling; validasi input; tidak ada secret atau data pribadi; PR template terisi; di bawah ~400 baris.
4. Jalankan perintah test dari AGENTS.md. Setup worktree sudah membuat `.env` dan database.
5. Tulis temuan blocking / should-fix / nit dengan file:line ke `.agent-out/review.md`, posting dengan `gh pr comment <nomor> --body-file .agent-out/review.md`.
6. Pastikan `git status --porcelain` sama seperti langkah 1. Jangan commit atau push.
7. worker_done: outcome failed jika ada temuan blocking (cantumkan daftarnya), succeeded jika bersih.
