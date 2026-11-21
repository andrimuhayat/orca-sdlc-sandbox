---
name: security-review
description: Review keamanan satu PR dengan scanner dan pembacaan diff
---
# Security review
1. gh pr checkout <nomor>. Jangan commit atau push.
2. Jalankan: trivy fs --scanners vuln,secret,misconfig --severity CRITICAL,HIGH,MEDIUM .  dan  semgrep scan --config p/default --metrics=off
3. Baca diff untuk: otorisasi yang hilang, injection (SQL, command, template), deserialisasi tidak aman, path traversal, secret atau data pribadi di log, crypto lemah, endpoint publik baru, CORS terlalu longgar.
4. Buang false positive dengan satu baris alasan. Beri severity critical / high / medium / low.
5. Satu komentar PR: tabel severity, file:line, masalah, perbaikan, versi tool.
6. worker_done: outcome failed jika ada critical atau high (cantumkan perbaikan yang diwajibkan), selain itu succeeded.
