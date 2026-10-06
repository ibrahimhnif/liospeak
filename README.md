# 🎙️ LioSpeak

**LioSpeak** adalah aplikasi *voice dictation* (pengetikan suara cerdas) cross-platform yang memungkinkan Anda mengetik dengan suara di aplikasi dan kolom input apapun di **macOS, Windows, dan Linux**.

Dibangun menggunakan **Tauri v2**, **Bun**, dan **Rust**, LioSpeak sangat ringan (~15 MB), cepat, dan hemat sumber daya dibandingkan aplikasi berbasis Electron atau Python.

---

## ✨ Fitur Utama

- 🌐 **Cross-Platform Murni**: Berjalan mulus di macOS, Windows, dan Linux.
- ⚡ **Global Shortcut**: Tekan kombinasi tombol (default: `Cmd/Ctrl + Shift + Space`) di mana saja untuk mulai mengetik dengan suara.
- 🎯 **Ketik di Mana Saja (Auto-Paste)**: Hasil transkripsi langsung otomatis ditempelkan ke kursor/aplikasi aktif Anda (VS Code, browser, terminal, Slack, WhatsApp, Word, dll).
- 🧠 **Dukungan AI Cerdas (Indonesian & English)**:
  - **Google Gemini 2.0 Flash**: Model multimodal yang sangat pintar memahami percakapan campur (*code-switching*) bahasa Indonesia gaul + istilah teknis bahasa Inggris (*"tolong push branch ini ke github"*). Otomatis merapikan tanda baca (*punctuation*), kapitalisasi, dan membuang kata gumam (*"um"*, *"eh"*, *"anu"*).
  - **Groq Whisper Large v3**: Model Whisper OpenAI v3 bertenaga chip LPU Groq untuk transkripsi kilat dengan latensi sub-detik (~250ms).
- 💰 **Sangat Hemat & Ada Free Tier**:
  - **Google AI Studio**: Menyediakan Free Tier hingga 15 Request Per Menit (RPM) gratis setiap hari. Paid tier hanya ~$0.70 per 1M token audio (~Rp 1.100 per jam audio nonstop).
  - **Groq**: Menyediakan Free Tier gratis, atau paid tier hanya $0.04 per jam audio (~Rp 650/jam).
- 🎛️ **Mode Pemicu Fleksibel**:
  - **Toggle**: Tekan sekali untuk mulai, tekan sekali lagi untuk selesai.
  - **Push-to-Talk**: Tahan tombol saat berbicara, lepaskan untuk langsung mengetik.
- 🎨 **Floating HUD Melayang**: Indikator kapsul modern yang melayang saat mendikte dan otomatis menghilang setelah teks ditempelkan.
- 📋 **Riwayat Dikte**: Riwayat transkripsi tersimpan lokal di perangkat Anda.

---

## 🚀 Menjalankan Aplikasi

### Kebutuhan Sistem
- **Bun** (atau Node.js LTS via NVM)
- **Rust & Cargo**

### Mode Development
Jalankan perintah berikut di root folder project:
```bash
# Jalankan mode pengembangan desktop
bun run tauri dev
```

### Membuat Installer / Bundle Produksi
Untuk mengompilasi file executable & installer native:
```bash
# Build binary & installer untuk OS Anda saat ini
bun run tauri build
```
Hasil build akan berada di folder `src-tauri/target/release/bundle/`:
- **macOS**: `.dmg` dan `.app`
- **Windows**: `.msi` dan `.exe`
- **Linux**: `.deb` dan `.AppImage`

---

## ⚙️ Cara Menggunakan

1. Buka aplikasi **LioSpeak**.
2. Masuk ke tab **Model AI & Biaya**:
   - Dapatkan API Key gratis di [Google AI Studio](https://aistudio.google.com/app/apikey) (untuk Gemini) atau [Groq Console](https://console.groq.com/keys) (untuk Groq).
   - Masukkan API Key dan klik **Uji Koneksi API**.
3. Di tab **Shortcut & Kontrol**, pilih kombinasi shortcut yang Anda sukai (misal: `Cmd+Shift+Space` atau `Ctrl+Shift+D`).
4. Klik tombol **Minimize** atau tutup jendela untuk menyembunyikan aplikasi ke **Menu Bar / System Tray**.
5. Buka aplikasi apapun (misal browser atau text editor), posisikan kursor di kolom teks, lalu tekan shortcut Anda dan mulailah berbicara!

---

## 🔒 Privasi & Keamanan

- Rekaman audio Anda tidak pernah disimpan di server perantara pihak ketiga manapun.
- Audio dikirimkan langsung dari perangkat Anda ke endpoint resmi penyedia AI pilihan Anda (Google AI Studio / Groq) menggunakan API key milik Anda sendiri.
