# Hướng dẫn cài đặt AI — AI Voice Bot

Tài liệu hướng dẫn cài đặt đầy đủ các thành phần AI cho ứng dụng AI Voice Bot.

| Thành phần | Công nghệ | Runtime | Chức năng |
|---|---|---|---|
| **Whisper** | whisper.cpp (nodejs-whisper) | Node.js (native) | Speech-to-Text |
| **F5-TTS** | F5-TTS-Vietnamese | Python 3.12 | Text-to-Speech tiếng Việt |
| **Qwen3 LLM** | node-llama-cpp | Node.js (native) | Mô hình ngôn ngữ local |

---

## Yêu cầu hệ thống

| Thành phần | Yêu cầu tối thiểu | Khuyến nghị |
|---|---|---|
| **OS** | Ubuntu 22.04 / Windows 10 / macOS 12+ | Ubuntu 22.04+ |
| **CPU** | x86_64 hoặc ARM64 | x86_64 |
| **RAM** | 8 GB | 16 GB+ |
| **GPU** | Không bắt buộc (CPU mode) | NVIDIA GPU với CUDA |
| **Ổ đĩa** | 10 GB trống | 20 GB+ |
| **Node.js** | v18+ | v20+ |
| **Python** | 3.12+ (cho F5-TTS) | 3.12 |

---

## Kiến trúc tổng quan

```
┌──────────────────────────────────────────────────────────────┐
│  Electron App (React Frontend)                               │
│  ├── VoiceTraining.jsx  → Thu âm + TTS                      │
│  ├── Chat.jsx           → Chat AI + Transcription            │
│  └── Settings.jsx       → Quản lý Python env                │
└────────────────┬─────────────────────────────────────────────┘
                 │ IPC (inter-process communication)
                 ▼
┌──────────────────────────────────────────────────────────────┐
│  Electron Main Process (main.js)                             │
│  ├── whisper.cpp (nodejs-whisper)  → Speech-to-Text   [Node] │
│  ├── node-llama-cpp (Qwen3)       → Local LLM         [Node] │
│  └── spawn Python                 → F5-TTS          [Python] │
└──────────────────────────────────────────────────────────────┘
```

---

# PHẦN 1: Whisper — Speech-to-Text (whisper.cpp)

Whisper chạy **native trong Node.js** qua `nodejs-whisper`. **Không cần Python.**

---

## 1.1. Cài đặt Build Tools

### 🐧 Linux (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install build-essential cmake -y
```

### 🍎 macOS

```bash
xcode-select --install
brew install cmake
```

### 🪟 Windows

Xem hướng dẫn cài đặt thủ công chi tiết bên dưới.

---

#### Cài đặt thủ công

<details>
<summary>📋 Bấm để xem hướng dẫn cài đặt thủ công chi tiết</summary>

---

##### Bước 1: Cài Visual Studio Build Tools 2022

Visual Studio Build Tools cung cấp **MSVC compiler** (`cl.exe`) — bắt buộc để compile native Node.js modules (whisper.cpp, better-sqlite3, node-llama-cpp...).

**Tải về:**

1. Truy cập [https://visualstudio.microsoft.com/visual-cpp-build-tools/](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
2. Nhấn nút **"Download Build Tools"** → tải file `vs_BuildTools.exe`

**Cài đặt:**

3. Chạy `vs_BuildTools.exe` (có thể cần quyền Administrator)
4. Đợi Visual Studio Installer khởi động
5. Trong tab **Workloads**, tick chọn **"Desktop development with C++"**
6. Ở panel **Installation details** (cột bên phải), đảm bảo các component sau đã được tick:

   | Component | Bắt buộc | Ghi chú |
   |---|---|---|
   | MSVC v143 - VS 2022 C++ x64/x86 build tools (Latest) | ✅ | Compiler chính |
   | Windows 10/11 SDK (bản mới nhất) | ✅ | Headers + Libraries |
   | C++ CMake tools for Windows | ✅ | CMake bundled |
   | C++ AddressSanitizer | ❌ | Không cần |

7. Nhấn **"Install"** → đợi download + cài đặt (~2-5 GB, 5-15 phút tùy mạng)
8. **Restart máy** sau khi cài xong (khuyến nghị)

**Verify:**

```powershell
# Mở PowerShell mới (sau khi restart)
# Cách 1: Kiểm tra thông qua npm
npm config set msvs_version 2022

# Cách 2: Tìm cl.exe
where.exe cl
# Nếu không tìm thấy ở PowerShell thường → mở "x64 Native Tools Command Prompt for VS 2022" từ Start Menu
# Trong đó gõ:
cl
# Microsoft (R) C/C++ Optimizing Compiler Version 19.xx.xxxxx for x64
```

> ⚠️ **Lưu ý:** `cl.exe` **không có** trong PATH của PowerShell thường. Bạn cần mở **"x64 Native Tools Command Prompt for VS 2022"** (tìm trong Start Menu) hoặc dùng **"Developer PowerShell for VS 2022"** để sử dụng trực tiếp.

---

##### Bước 2: Cài CMake

CMake là build system dùng để compile whisper.cpp và các native module khác.

> 💡 **Lưu ý:** Nếu bạn đã tick **"C++ CMake tools for Windows"** ở Bước 1, CMake đã được cài kèm VS Build Tools. Tuy nhiên, CMake này chỉ hoạt động trong VS terminal. Nếu muốn dùng CMake ở mọi nơi (PowerShell, CMD...), hãy cài thêm bản standalone.

**Tải về:**

1. Truy cập [https://cmake.org/download/](https://cmake.org/download/)
2. Tìm mục **"Latest Release"** → tải bản **Windows x64 Installer** (file `.msi`)
   - Ví dụ: `cmake-3.31.x-windows-x86_64.msi`

**Cài đặt:**

3. Chạy file `.msi` vừa tải
4. Trong bước **"Install Options"**, chọn một trong hai:
   - ✅ **"Add CMake to the system PATH for all users"** (khuyến nghị)
   - hoặc: **"Add CMake to the system PATH for the current user"**
   - ❌ **KHÔNG** chọn "Do not add CMake to the system PATH"
5. Nhấn **Next** → **Install** → **Finish**

**Verify:**

```powershell
# Mở PowerShell MỚI (đóng cửa sổ cũ, mở lại)
cmake --version
# Kết quả mong đợi:
# cmake version 3.31.x
# CMake suite maintained and supported by Kitware (kitware.com/cmake).
```

> ⚠️ **Nếu `cmake` vẫn không nhận sau khi cài:**
> 1. Đóng **tất cả** cửa sổ terminal/PowerShell và mở lại
> 2. Nếu vẫn không được, kiểm tra PATH thủ công:
>    ```powershell
>    # Kiểm tra CMake trong PATH
>    $env:PATH -split ';' | Where-Object { $_ -like '*cmake*' }
>    ```
> 3. Nếu không có kết quả, thêm thủ công:
>    - Mở **Settings** → **System** → **About** → **Advanced system settings**
>    - Nhấn **"Environment Variables..."**
>    - Ở **System variables** → tìm **Path** → nhấn **Edit**
>    - Nhấn **New** → thêm: `C:\Program Files\CMake\bin`
>    - Nhấn **OK** tất cả → mở lại PowerShell

---

##### Bước 3: Cài Git (nếu chưa có)

Git cần để clone repositories (F5-TTS, model...) và `git lfs` để tải model lớn.

**Tải về:**

1. Truy cập [https://git-scm.com/download/win](https://git-scm.com/download/win)
2. Trang sẽ tự tải bản installer phù hợp (64-bit Standalone Installer)

**Cài đặt:**

3. Chạy file installer (`Git-2.xx.x-64-bit.exe`)
4. Các bước cài, giữ **default settings** là ổn, nhưng lưu ý:
   - Bước **"Adjusting your PATH environment"**: chọn **"Git from the command line and also from 3rd-party software"** (mặc định - ✅ Giữ nguyên)
   - Bước **"Choosing the default editor"**: chọn editor bạn thích (Vim, VS Code, Notepad++...)
5. Nhấn **Install** → **Finish**

**Verify:**

```powershell
# Mở PowerShell mới
git --version
# git version 2.xx.x.windows.x

# Kiểm tra git lfs (cần cho tải model)
git lfs --version
# git-lfs/3.x.x
```

> 💡 **Git LFS:** Từ Git 2.40+, `git lfs` được cài kèm mặc định. Nếu `git lfs` không nhận, cài riêng từ [git-lfs.github.com](https://git-lfs.github.com/).

---

##### ✅ Verify tất cả đã cài đúng

Sau khi hoàn tất cả 3 bước, **restart máy** rồi kiểm tra:

```powershell
# Mở PowerShell mới
cmake --version     # ✅ cmake version 3.x
git --version       # ✅ git version 2.x
node --version      # ✅ v20.x (phải cài trước)
npm --version       # ✅ 10.x
python --version    # ✅ Python 3.12.x (nếu cài cho TTS)
```

Nếu tất cả đều OK, bạn đã sẵn sàng để build native modules:

```powershell
# Quay về thư mục project
cd path\to\bankAI
npm install
```

##### 🔧 Build Whisper (Speech-to-Text)

```powershell
npx nodejs-whisper download
# Chọn model: medium (khuyến nghị)
# CUDA: y (nếu có NVIDIA GPU) hoặc n (CPU only)
```

##### 🔧 Build node-llama-cpp (LLM — Qwen3)

```powershell
# CPU only
npx --no node-llama-cpp source download

# Với CUDA GPU acceleration (cần CUDA Toolkit 12.x đã cài)
npx --no node-llama-cpp source download --gpu cuda
```

> 💡 **Tip:** Nếu build fail ở PowerShell, hãy mở **"x64 Native Tools Command Prompt for VS 2022"** từ Start Menu rồi chạy lại các lệnh trên.

</details>

---

## 1.2. Cài nodejs-whisper

```bash
# Trong thư mục project
cd bankAI
npm install nodejs-whisper
```

---

## 1.3. Tải model và build whisper.cpp

```bash
npx nodejs-whisper download
```

**Chương trình sẽ hỏi:**

1. **Chọn model**: Nhập `medium` → Enter

   | Model | Dung lượng | RAM cần | Ghi chú |
   |---|---|---|---|
   | `tiny` | 75 MB | ~390 MB | Nhanh nhất, chất lượng thấp |
   | `base` | 142 MB | ~500 MB | Cơ bản |
   | `small` | 466 MB | ~1.0 GB | Ổn cho tiếng Việt |
   | **`medium`** | **1.5 GB** | **~2.6 GB** | **⭐ Khuyến nghị** |
   | `large-v3-turbo` | 1.5 GB | ~2.6 GB | Chất lượng cao nhất |

2. **CUDA?**: Nhập `y` (có NVIDIA GPU) hoặc `n` (CPU only)

**Quá trình sẽ:**
- Tải model từ HuggingFace (~1.5GB cho medium)
- Build whisper.cpp bằng CMake
- Tạo executable `whisper-cli` (Linux/macOS) hoặc `whisper-cli.exe` (Windows)

---

## 1.4. CUDA Support (GPU Acceleration)

### 🐧 Linux

**Yêu cầu:**
| Thành phần | Version |
|---|---|
| NVIDIA Driver | 535+ |
| CUDA Toolkit (`nvcc`) | 12.x |
| GCC | 11 hoặc 12 |

**Kiểm tra:**
```bash
nvidia-smi            # Xem driver + max CUDA version
nvcc --version        # Xem CUDA Toolkit đã cài
```

**Cài CUDA Toolkit 12.x (nếu đang dùng 11.x):**
```bash
wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.1-1_all.deb
sudo dpkg -i cuda-keyring_1.1-1_all.deb
sudo apt update
sudo apt install cuda-toolkit-12-6 -y

# Thêm vào ~/.bashrc
echo 'export PATH=/usr/local/cuda/bin:$PATH' >> ~/.bashrc
echo 'export LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH' >> ~/.bashrc
source ~/.bashrc
```

> ⚠️ **Lưu ý quan trọng:** CUDA Toolkit 11.5 + GCC 11 sẽ gây lỗi build (`parameter packs not expanded`). Phải upgrade CUDA Toolkit lên 12.x.

### 🪟 Windows

**Yêu cầu:**
| Thành phần | Version |
|---|---|
| NVIDIA Driver | 535+ (tải từ [nvidia.com](https://www.nvidia.com/drivers)) |
| CUDA Toolkit | 12.x |
| Visual Studio Build Tools | 2022 |

**Cài CUDA Toolkit:**

1. Tải từ [developer.nvidia.com/cuda-downloads](https://developer.nvidia.com/cuda-downloads)
   - OS: Windows
   - Architecture: x86_64
   - Version: 10 hoặc 11
   - Installer Type: exe (network)
2. Chạy installer → chọn **Express Installation**
3. Restart máy
4. Verify:
   ```powershell
   nvcc --version
   # Cuda compilation tools, release 12.x
   
   nvidia-smi
   # Hiển thị GPU info
   ```

**Build whisper.cpp với CUDA trên Windows:**
```powershell
# Mở "x64 Native Tools Command Prompt for VS 2022"
# KHÔNG dùng PowerShell hoặc CMD thường

cd path\to\bankAI
npx nodejs-whisper download
# Chọn model: medium
# CUDA: y
```

> 💡 **Tip:** Nếu build fail trên PowerShell, hãy mở **"x64 Native Tools Command Prompt for VS 2022"** từ Start Menu → chạy lại lệnh.

### 🍎 macOS

macOS không hỗ trợ CUDA. Whisper.cpp sẽ dùng **Metal GPU acceleration** tự động trên Apple Silicon (M1/M2/M3).

---

## 1.5. Verify Whisper Installation

### 🐧 Linux / 🍎 macOS
```bash
# Kiểm tra executable
ls -la node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/whisper-cli

# Kiểm tra model
ls -la node_modules/nodejs-whisper/cpp/whisper.cpp/models/ggml-medium.bin

# Test nhanh (nếu có sample audio)
node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/whisper-cli \
  -m node_modules/nodejs-whisper/cpp/whisper.cpp/models/ggml-medium.bin \
  -l vi -f path/to/test.wav
```

### 🪟 Windows
```powershell
# Kiểm tra executable
dir node_modules\nodejs-whisper\cpp\whisper.cpp\build\bin\Release\whisper-cli.exe

# Kiểm tra model
dir node_modules\nodejs-whisper\cpp\whisper.cpp\models\ggml-medium.bin
```

---

# PHẦN 2: F5-TTS — Text-to-Speech (Python)

F5-TTS tạo giọng nói tiếng Việt, hỗ trợ zero-shot voice cloning từ 3-30s audio mẫu.
**Cần Python 3.12+.**

---

## 2.1. Cài đặt Python 3.12

### 🐧 Linux (Ubuntu/Debian)
```bash
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt update
sudo apt install python3.12 python3.12-venv python3.12-dev -y

# Verify
python3.12 --version
# Python 3.12.x
```

### 🍎 macOS
```bash
brew install python@3.12

# Verify
python3.12 --version
```

### 🪟 Windows

1. Tải từ [python.org/downloads](https://www.python.org/downloads/) → chọn **Python 3.12.x**
2. Chạy installer:
   - ✅ Tick **"Add python.exe to PATH"** (quan trọng!)
   - ✅ Tick **"Install pip"**
   - Chọn **"Customize installation"** → tick tất cả optional features
   - Nhấn **Install**
3. Verify:
   ```powershell
   python --version
   # Python 3.12.x
   
   pip --version
   # pip 24.x from ...
   ```

> ⚠️ **Windows:** Nếu `python` không nhận, thử `python3` hoặc `py -3.12`.

---

## 2.2. Cài đặt thủ công

### 🐧 Linux / 🍎 macOS

```bash
cd python

# Tạo virtual environment
python3.12 -m venv venv

# Kích hoạt venv
source venv/bin/activate

# Upgrade pip
pip install --upgrade pip

# Cài dependencies
pip install -r requirements.txt

# Clone F5-TTS Vietnamese
git clone https://github.com/nguyenthienhy/F5-TTS-Vietnamese
cd F5-TTS-Vietnamese && pip install -e . && cd ..

# Tải model (~5GB)
git lfs install
git clone https://huggingface.co/hynt/F5-TTS-Vietnamese-ViVoice
```

### 🪟 Windows

```powershell
cd python

# Tạo virtual environment
python -m venv venv

# Kích hoạt venv
venv\Scripts\activate

# Upgrade pip
python -m pip install --upgrade pip

# Cài dependencies
pip install -r requirements.txt

# Clone F5-TTS Vietnamese
git clone https://github.com/nguyenthienhy/F5-TTS-Vietnamese
cd F5-TTS-Vietnamese
pip install -e .
cd ..

# Tải model (~5GB) - cần Git LFS
git lfs install
git clone https://huggingface.co/hynt/F5-TTS-Vietnamese-ViVoice
```

> ⚠️ **Windows — Lỗi numpy/C compiler:** Nếu gặp lỗi khi build numpy, cài trước:
> ```powershell
> pip install numpy --only-binary :all:
> ```

> ⚠️ **Windows — Git LFS:** Tải từ [git-lfs.github.com](https://git-lfs.github.com/) nếu `git lfs` chưa hoạt động.

---

## 2.4. Kiểm tra cài đặt F5-TTS

### 🐧 Linux / 🍎 macOS
```bash
cd python

# Check toàn bộ environment
python setup_env.py check

# Check riêng F5-TTS
python f5_tts.py check
```

### 🪟 Windows
```powershell
cd python

# Check toàn bộ environment
python setup_env.py check

# Check riêng F5-TTS
python f5_tts.py check
```

**Output mẫu (khi mọi thứ OK):**
```json
{
  "event": "check_result",
  "venv_exists": true,
  "torch_installed": true,
  "f5_tts_installed": true,
  "cli_available": true,
  "ready": true
}
```

---

## 2.5. Cấu trúc thư mục Python

```
python/
├── f5_tts.py                       # CLI script cho TTS
├── setup_env.py                    # Auto setup script
├── requirements.txt                # Python dependencies
├── transcribe.py.bak               # Whisper Python (archived, không cần)
├── venv/                           # Virtual environment (tự tạo)
│   ├── bin/ (Linux/macOS)          # python, pip, f5-tts_infer-cli
│   └── Scripts/ (Windows)          # python.exe, pip.exe, f5-tts_infer-cli.exe
├── F5-TTS-Vietnamese/              # F5-TTS repo (git clone)
├── F5-TTS-Vietnamese-ViVoice/      # Model checkpoint (HuggingFace)
│   ├── model_last.pt               # ~1.5GB
│   └── vocab.txt
├── ref_audio/                      # Giọng mẫu (upload từ UI)
│   └── ref_170681234.wav
└── outputs/                        # Audio đã tạo
    └── generated_170681234.wav
```

---

# PHẦN 3: Qwen3 LLM — Local AI (node-llama-cpp)

Qwen3 chạy **native trong Node.js** qua `node-llama-cpp`. **Không cần Python.**

## 3.1. Cài đặt

Tự động — `node-llama-cpp` tải model GGUF khi khởi động lần đầu. Không cần thao tác.

## 3.2. Model info

| Thông số | Giá trị |
|---|---|
| Model | Qwen3 4B (GGUF Q4_K_M) |
| Kích thước | ~2.5 GB |
| RAM cần | ~4 GB |
| Tốc độ | ~10-30 tok/s (CPU) |

---

# PHẦN 4: Kiểm tra trạng thái tổng thể

## Qua UI (Khuyến nghị)

Mở **Settings** → card **Python Environment**:

| Badge | Ý nghĩa |
|---|---|
| ✅ **Whisper (native)** | Luôn sẵn sàng (Node.js) |
| ✅/❌ **Venv** | Python virtual environment |
| ✅/❌ **PyTorch** | ML framework cho TTS |
| ✅/❌ **F5-TTS** | Voice generation package |
| ✅/❌ **TTS CLI** | `f5-tts_infer-cli` executable |
| ✅/❌ **System Python** | Python 3.12+ trên hệ thống |

## Qua CLI

### 🐧 Linux / 🍎 macOS
```bash
# Python env
cd python && python setup_env.py check

# Whisper executable
ls node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/whisper-cli

# Whisper model
ls node_modules/nodejs-whisper/cpp/whisper.cpp/models/ggml-medium.bin
```

### 🪟 Windows
```powershell
# Python env
cd python
python setup_env.py check

# Whisper executable
dir node_modules\nodejs-whisper\cpp\whisper.cpp\build\bin\Release\whisper-cli.exe

# Whisper model
dir node_modules\nodejs-whisper\cpp\whisper.cpp\models\ggml-medium.bin
```

---

# PHẦN 5: Xử lý lỗi thường gặp

## Chung (tất cả OS)

### ❌ `whisper-cli executable not found`
```bash
# Xóa build cũ và rebuild
rm -rf node_modules/nodejs-whisper/cpp/whisper.cpp/build   # Linux/macOS
rd /s /q node_modules\nodejs-whisper\cpp\whisper.cpp\build  # Windows

npx nodejs-whisper download
```

### ❌ Model tải không xong / bị corrupt
```bash
# Xóa model và tải lại
rm node_modules/nodejs-whisper/cpp/whisper.cpp/models/ggml-medium.bin   # Linux
del node_modules\nodejs-whisper\cpp\whisper.cpp\models\ggml-medium.bin  # Windows

npx nodejs-whisper download
```

---

## 🐧 Linux

### ❌ CUDA build fail — `parameter packs not expanded`
**Nguyên nhân:** CUDA Toolkit 11.x + GCC 11 không tương thích.
**Fix:** Upgrade CUDA Toolkit lên 12.x:
```bash
wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.1-1_all.deb
sudo dpkg -i cuda-keyring_1.1-1_all.deb
sudo apt update
sudo apt install cuda-toolkit-12-6 -y
echo 'export PATH=/usr/local/cuda/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```
Sau đó xóa build cũ và build lại.

### ❌ `cmake: not found`
```bash
sudo apt install cmake -y
```

### ❌ `Python 3.12+ not found on system`
```bash
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt update
sudo apt install python3.12 python3.12-venv python3.12-dev -y
```

---

## 🪟 Windows

### ❌ CUDA build fail — `cl.exe not found`
**Nguyên nhân:** Không chạy đúng terminal.
**Fix:** Mở **"x64 Native Tools Command Prompt for VS 2022"** từ Start Menu → chạy lại lệnh.

### ❌ `cmake is not recognized`
**Fix:**
1. Tải CMake từ [cmake.org/download](https://cmake.org/download/)
2. Khi cài chọn **"Add CMake to system PATH"**
3. Restart terminal

### ❌ `python is not recognized`
**Fix:**
1. Mở Settings → Apps → **App execution aliases** → Tắt "python.exe" alias (của Microsoft Store)
2. Cài lại Python từ python.org → tick **"Add to PATH"**
3. Hoặc thử: `py -3.12 --version`

### ❌ `pip install` lỗi numpy — `Meson build failed, no C compiler`
**Nguyên nhân:** Thiếu Visual Studio Build Tools.
**Fix:**
```powershell
# Cách 1: Cài pre-built binary
pip install numpy --only-binary :all:

# Cách 2: Cài Visual Studio Build Tools (xem mục 1.1)
```

### ❌ `ERROR: Cannot create symbolic link` khi build Electron
**Nguyên nhân:** Thiếu quyền tạo symlink.
**Fix:**
1. Chạy terminal với **Administrator**
2. Hoặc: Settings → Developer Settings → bật **Developer Mode**

### ❌ `ERR_DLOPEN_FAILED` — Node module version mismatch
**Nguyên nhân:** `better-sqlite3` hoặc native module build với Node khác.
**Fix:**
```powershell
npm rebuild
# hoặc
rm -rf node_modules && npm install
```

---

# PHẦN 6: Tham chiếu nhanh

## Cross-Platform Path Mapping

| Thành phần | Linux/macOS | Windows |
|---|---|---|
| Python venv | `venv/bin/python` | `venv\Scripts\python.exe` |
| Pip | `venv/bin/pip` | `venv\Scripts\pip.exe` |
| TTS CLI | `venv/bin/f5-tts_infer-cli` | `venv\Scripts\f5-tts_infer-cli.exe` |
| Whisper CLI | `build/bin/whisper-cli` | `build\bin\Release\whisper-cli.exe` |

App tự detect OS qua:
- `electron/main.js` → `getPythonPaths()` dùng `process.platform`
- `python/setup_env.py` → `platform.system()`
- `python/f5_tts.py` → `IS_WINDOWS` constant

## Tổng kết cài đặt

| # | Bước | Thời gian | Bắt buộc? |
|---|---|---|---|
| 1 | Cài Node.js 18+ | 2 phút | ✅ |
| 2 | Cài build tools (gcc/cmake hoặc VS Build Tools) | 5 phút | ✅ |
| 3 | `npm install` | 2 phút | ✅ |
| 4 | `npx nodejs-whisper download` (model + build) | 3-10 phút | ✅ |
| 5 | Cài CUDA Toolkit 12.x (optional, cho GPU) | 5-10 phút | ❌ Tùy chọn |
| 6 | Cài Python 3.12 | 2 phút | Cho TTS |
| 7 | Cài đặt Python env (thủ công) | 10-30 phút | Cho TTS |
| 8 | Clone F5-TTS + tải model | 10-15 phút | Cho TTS |

---

## Phiên bản đã test

| OS | Version | Trạng thái |
|---|---|---|
| Ubuntu | 22.04 LTS | ✅ Tested |
| Windows | 10/11 | 🔧 Supported |
| macOS | 12+ (Monterey) | 🔧 Supported |

| Runtime | Version |
|---|---|
| Node.js | v20+ |
| Python | 3.12.12 |
| CUDA Toolkit | 12.6 |
| NVIDIA Driver | 580.126.09 |
| GCC | 9.5 / 11.4 |
