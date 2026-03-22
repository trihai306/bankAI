# TEST PLAN & TEST CASES - AI VOICE BOT BANKING SYSTEM
**Dự án:** AI Voice Bot - Hệ thống trả lời cuộc gọi tự động cho ngân hàng Việt Nam
**Phiên bản:** 1.0
**Ngày:** 2026-03-17
**Người soạn:** Tester Team

---

## PHẦN 1: TEST STRATEGY DOCUMENT

### 1.1 Phạm vi kiểm thử (Scope)

**Trong phạm vi:**
- Frontend: 8 trang React (Dashboard, CallCenter, VoiceTraining, TrainingData, ModelManager, Chat, History, Settings)
- Backend: Electron main process (IPC handlers, database operations)
- AI Services: F5-TTS (port 5111), Whisper STT, Qwen LLM qua Ollama
- Database: SQLite (better-sqlite3) - 4 bảng (settings, calls, models, voice_profiles)
- IPC Bridge: preload.js với 9 API nhóm (db, voice, call, model, training, tts, qwen, profile, edgeTTS)

**Ngoài phạm vi:**
- Tích hợp tổng đài viễn thông thực (SIP/VoIP)
- Triển khai production
- Bảo mật mạng nội bộ ngân hàng

### 1.2 Phương pháp kiểm thử (Approach)

| Cấp độ | Phương pháp | Trọng tâm |
|--------|-------------|-----------|
| Unit Test | Jest + React Testing Library | Logic xử lý dữ liệu, utility functions, store |
| Integration Test | Jest + Electron IPC mock | Luồng IPC React → preload → main → DB |
| E2E Test | Playwright | Luồng người dùng đầu-cuối trên Electron |
| Performance Test | Custom scripts + puppeteer | Độ trễ TTS (<1s Edge-TTS), LLM response time |
| Manual Test | Kiểm tra thủ công | UI/UX, Voice quality, AI conversation quality |

### 1.3 Môi trường kiểm thử (Test Environments)

| Môi trường | Mô tả |
|-----------|-------|
| Dev local | MacOS + Node.js 18+, Electron, Python venv với F5-TTS |
| CI/CD | GitHub Actions (unit + integration tests, không có AI services) |
| Staging | Máy có GPU, Ollama chạy Qwen, đủ RAM để chạy Whisper |

### 1.4 Công cụ kiểm thử (Tools)

- **Jest 29+**: Unit test cho JavaScript/React logic
- **React Testing Library**: Render component và tương tác UI
- **Playwright**: E2E test trên Electron
- **Pytest 7+**: Unit test cho Python TTS server
- **better-sqlite3 in-memory**: Test database operations không cần file thật
- **msw (Mock Service Worker)**: Mock HTTP calls đến Ollama API

### 1.5 Test Data Management

- Sử dụng SQLite in-memory database cho mỗi test suite
- Audio test files: file WAV ngắn (2-5 giây) chuẩn bị sẵn trong `tests/fixtures/`
- JSONL test data: file mẫu nhỏ cho training data tests
- Seed scripts: tạo dữ liệu call history chuẩn trước mỗi test run

---

## PHẦN 2: TEST CASES THEO MODULE

---

### 2.1 MODULE: DASHBOARD

#### TC-DASH-01
- **ID:** TC-DASH-01
- **Title:** Hiển thị thống kê khi chưa có dữ liệu cuộc gọi
- **Priority:** Medium
- **Precondition:** Database trống, không có bản ghi trong bảng `calls`
- **Steps:**
  1. Khởi động ứng dụng Electron
  2. Điều hướng đến trang Dashboard
  3. Chờ component render xong
- **Expected Result:** 4 stat cards hiển thị giá trị 0 (Cuộc gọi hôm nay: 0, Tổng cuộc gọi: 0, Thời gian TB: 0:00, Tỷ lệ thành công: 0%), khu vực "Cuộc gọi gần đây" hiển thị trạng thái "Chưa có dữ liệu"

#### TC-DASH-02
- **ID:** TC-DASH-02
- **Title:** Hiển thị thống kê đúng khi có dữ liệu cuộc gọi
- **Priority:** High
- **Precondition:** Database có 5 bản ghi calls: 3 completed, 2 missed, 2 trong ngày hôm nay
- **Steps:**
  1. Seed dữ liệu vào bảng `calls`
  2. Mở Dashboard
  3. Đọc giá trị các stat cards
- **Expected Result:** Tổng: 5, Hôm nay: 2, Tỷ lệ thành công: 60.0%, avgDuration tính đúng từ dữ liệu thực

#### TC-DASH-03
- **ID:** TC-DASH-03
- **Title:** Tự động refresh dữ liệu sau 30 giây
- **Priority:** Medium
- **Precondition:** Dashboard đang mở, không có cuộc gọi
- **Steps:**
  1. Mở Dashboard, ghi nhận stats ban đầu (0 calls)
  2. Thêm 1 bản ghi vào DB từ bên ngoài
  3. Chờ 31 giây
  4. Kiểm tra stat cards
- **Expected Result:** Stat cards cập nhật hiển thị 1 cuộc gọi mà không cần reload trang

#### TC-DASH-04
- **ID:** TC-DASH-04
- **Title:** Hiển thị danh sách cuộc gọi gần đây (tối đa 5)
- **Priority:** High
- **Precondition:** Database có 8 bản ghi calls
- **Steps:**
  1. Seed 8 bản ghi vào bảng `calls`
  2. Mở Dashboard
  3. Đếm số hàng trong bảng "Cuộc gọi gần đây"
- **Expected Result:** Chỉ hiển thị 5 bản ghi mới nhất (sắp xếp theo `start_time DESC`)

#### TC-DASH-05
- **ID:** TC-DASH-05
- **Title:** Badge trạng thái hiển thị đúng màu theo status
- **Priority:** Low
- **Precondition:** Dashboard có calls với status 'completed' và 'missed'
- **Steps:**
  1. Seed 1 call completed và 1 call missed
  2. Mở Dashboard
  3. Kiểm tra màu badge trạng thái
- **Expected Result:** 'completed' → badge màu xanh (emerald), 'missed' → badge màu đỏ (rose)

---

### 2.2 MODULE: CALL CENTER

#### TC-CALL-01
- **ID:** TC-CALL-01
- **Title:** Khởi tạo cuộc gọi với số điện thoại hợp lệ
- **Priority:** Critical
- **Precondition:** Ứng dụng mở, F5-TTS server đang chạy (port 5111), có ít nhất 1 ref voice
- **Steps:**
  1. Điều hướng đến CallCenter
  2. Nhập số điện thoại "0987654321" vào input
  3. Click button "Gọi"
  4. Quan sát trạng thái UI
- **Expected Result:**
  - `isCallActive` chuyển thành `true`
  - Hiển thị timer bắt đầu đếm từ 00:00
  - Tin nhắn chào "Xin chào! Tôi là trợ lý ngân hàng AI..." xuất hiện trong conversation
  - Button "Gọi" bị ẩn, hiển thị button "Cúp máy"

#### TC-CALL-02
- **ID:** TC-CALL-02
- **Title:** Button "Gọi" bị vô hiệu hóa khi số điện thoại < 3 ký tự
- **Priority:** High
- **Precondition:** CallCenter đang mở
- **Steps:**
  1. Để trống input số điện thoại
  2. Nhập "09" (2 ký tự)
  3. Kiểm tra trạng thái button "Gọi"
- **Expected Result:** Button "Gọi" có attribute `disabled`, không thể click

#### TC-CALL-03
- **ID:** TC-CALL-03
- **Title:** Quick Test - Bắt đầu cuộc gọi không cần nhập số điện thoại
- **Priority:** High
- **Precondition:** CallCenter đang mở
- **Steps:**
  1. Click button "Test Voice AI ngay" (màu violet)
  2. Quan sát trạng thái
- **Expected Result:**
  - `phoneNumber` được set thành "AI-Test"
  - Cuộc gọi bắt đầu, hiển thị timer
  - Tin nhắn chào xuất hiện

#### TC-CALL-04
- **ID:** TC-CALL-04
- **Title:** Kết thúc cuộc gọi (Cúp máy)
- **Priority:** Critical
- **Precondition:** Đang có cuộc gọi active
- **Steps:**
  1. Bắt đầu cuộc gọi (TC-CALL-01)
  2. Click button "Cúp máy"
  3. Quan sát trạng thái
- **Expected Result:**
  - `isCallActive` chuyển về `false`
  - Timer reset về 00:00
  - MediaRecorder dừng recording
  - `aiStatus` về 'idle'
  - `liveText` được xóa

#### TC-CALL-05
- **ID:** TC-CALL-05
- **Title:** Toggle Mute microphone trong cuộc gọi
- **Priority:** High
- **Precondition:** Đang có cuộc gọi active
- **Steps:**
  1. Bắt đầu cuộc gọi
  2. Click button Mic (mute)
  3. Kiểm tra trạng thái
  4. Click lại button Mic (unmute)
- **Expected Result:**
  - Sau mute: button đổi sang màu đỏ (rose), icon chuyển sang MicOff
  - Sau unmute: button trở về màu trắng, icon là Mic
  - Khi muted, `startListening()` không được gọi

#### TC-CALL-06
- **ID:** TC-CALL-06
- **Title:** Toggle Speaker (tắt/bật âm thanh AI)
- **Priority:** Medium
- **Precondition:** Đang có cuộc gọi active
- **Steps:**
  1. Bắt đầu cuộc gọi
  2. Click button Volume (tắt loa)
  3. Kiểm tra trạng thái
- **Expected Result:**
  - `isSpeakerOn` chuyển về `false`
  - Button đổi sang màu đỏ (rose), icon VolumeX
  - `speakText()` skip khi speaker off (`if (!isSpeakerOn) return`)

#### TC-CALL-07
- **ID:** TC-CALL-07
- **Title:** Dropdown chọn giọng AI hiển thị danh sách ref voices
- **Priority:** High
- **Precondition:** Có ít nhất 2 file ref audio trong hệ thống
- **Steps:**
  1. Điều hướng đến CallCenter
  2. Quan sát dropdown "Giọng AI (F5-TTS)"
  3. Mở dropdown, kiểm tra options
- **Expected Result:** Dropdown liệt kê tất cả ref voices từ `tts.listRefs()`, option đầu tiên được chọn mặc định

#### TC-CALL-08
- **ID:** TC-CALL-08
- **Title:** Pipeline status indicator cập nhật theo aiStatus
- **Priority:** Medium
- **Precondition:** Đang có cuộc gọi active
- **Steps:**
  1. Bắt đầu cuộc gọi, quan sát pipeline panel
  2. Khi AI đang nghe (aiStatus = 'listening')
  3. Khi AI đang xử lý (aiStatus = 'thinking')
  4. Khi AI đang nói (aiStatus = 'speaking')
- **Expected Result:**
  - 'listening': STT row sáng, dot pulse màu violet
  - 'thinking': LLM row sáng
  - 'speaking': TTS row sáng

#### TC-CALL-09
- **ID:** TC-CALL-09
- **Title:** Thông báo "Không nghe rõ" khi STT không nhận diện được
- **Priority:** Medium
- **Precondition:** Đang có cuộc gọi, Whisper trả về text rỗng
- **Steps:**
  1. Bắt đầu cuộc gọi
  2. Mock `tts.transcribeAudio()` trả về `{ success: true, text: '' }`
  3. Kích hoạt processRecording
- **Expected Result:** System message "Không nghe rõ, thử nói lại" hiển thị trong 2 giây rồi tự xóa, tiếp tục startListening()

#### TC-CALL-10
- **ID:** TC-CALL-10
- **Title:** Max recording timeout - tự dừng sau 12 giây
- **Priority:** High
- **Precondition:** Đang có cuộc gọi, aiStatus = 'listening'
- **Steps:**
  1. Bắt đầu cuộc gọi
  2. Bắt đầu listening
  3. Chờ 12 giây không nói gì (không kích hoạt VAD)
- **Expected Result:** MediaRecorder.stop() được gọi sau 12 giây (safety timeout)

---

### 2.3 MODULE: VOICE TRAINING

#### TC-VT-01
- **ID:** TC-VT-01
- **Title:** Tạo voice profile mới
- **Priority:** Critical
- **Precondition:** Tab "Profiles" đang active, không có profile nào
- **Steps:**
  1. Điều hướng đến VoiceTraining > tab Profiles
  2. Click "Tạo Profile mới" / plus button
  3. Nhập tên profile "Test Profile 01"
  4. Confirm tạo
- **Expected Result:**
  - `profile.create()` IPC được gọi với `{ name: 'Test Profile 01' }`
  - Profile mới xuất hiện trong danh sách
  - Profile được lưu vào SQLite (bảng `voice_profiles`)

#### TC-VT-02
- **ID:** TC-VT-02
- **Title:** Thu âm giọng nói mới qua microphone
- **Priority:** Critical
- **Precondition:** Tab "Thu âm" active, có profile active, microphone được cấp quyền
- **Steps:**
  1. Chọn tab "Thu âm"
  2. Click "Bắt đầu thu âm"
  3. Nói 5 giây
  4. Click "Dừng thu âm"
- **Expected Result:**
  - Timer đếm ngược trong khi recording
  - Sau dừng: file audio được upload qua `tts.uploadRef()`
  - File xuất hiện trong danh sách ref voices

#### TC-VT-03
- **ID:** TC-VT-03
- **Title:** Upload file audio từ máy tính
- **Priority:** High
- **Precondition:** Tab "Thu âm" active, có file WAV/MP3/WEBM sẵn
- **Steps:**
  1. Chọn tab "Thu âm"
  2. Click "Upload file" hoặc drag-drop file audio
  3. Chọn file hợp lệ (WAV, 5 giây)
- **Expected Result:**
  - File được upload thành công
  - Tên file xuất hiện trong danh sách
  - Có thể click Play để nghe lại

#### TC-VT-04
- **ID:** TC-VT-04
- **Title:** Transcribe audio file bằng Whisper
- **Priority:** High
- **Precondition:** Có file audio trong danh sách, Whisper service đang chạy
- **Steps:**
  1. Chọn một file audio từ danh sách
  2. Click "Transcribe" hoặc tương đương
  3. Chờ kết quả
- **Expected Result:**
  - `tts.transcribeAudio()` được gọi với đường dẫn file
  - Transcript text hiển thị trong input field
  - Transcript được lưu kèm file audio

#### TC-VT-05
- **ID:** TC-VT-05
- **Title:** Tạo giọng nói (Voice Generation) với F5-TTS
- **Priority:** Critical
- **Precondition:** Tab "Tạo giọng" active, có ít nhất 1 ref voice, TTS server running (port 5111)
- **Steps:**
  1. Chọn tab "Tạo giọng"
  2. Chọn ref voice từ dropdown
  3. Nhập text "xin chào khách hàng"
  4. Click "Tạo giọng"
- **Expected Result:**
  - `tts.generate()` được gọi với config đúng
  - Loading indicator hiển thị trong quá trình generate
  - Audio player xuất hiện với file đã tạo
  - Thời gian tạo (elapsed) hiển thị

#### TC-VT-06
- **ID:** TC-VT-06
- **Title:** Play/Pause audio trong danh sách ref voices
- **Priority:** Medium
- **Precondition:** Có ít nhất 1 file ref audio đã upload
- **Steps:**
  1. Chọn tab "Thu âm"
  2. Click button Play trên một file audio
  3. Click lại để Pause
- **Expected Result:**
  - Click Play: audio bắt đầu phát, icon đổi sang Pause
  - Click Pause: audio dừng, icon về Play
  - Chỉ 1 file phát tại một thời điểm

#### TC-VT-07
- **ID:** TC-VT-07
- **Title:** Xóa ref audio file
- **Priority:** Medium
- **Precondition:** Có ít nhất 1 file ref audio
- **Steps:**
  1. Click button Xóa (Trash) trên một file
  2. Confirm xóa (nếu có dialog)
- **Expected Result:**
  - `tts.deleteRef()` được gọi với filepath
  - File biến mất khỏi danh sách
  - Nếu file đang là selectedVoice, cần xử lý gracefully

#### TC-VT-08
- **ID:** TC-VT-08
- **Title:** Wizard thu âm guided - chạy qua nhiều câu
- **Priority:** High
- **Precondition:** Tab "Thu âm" active, wizard được kích hoạt
- **Steps:**
  1. Kích hoạt wizard thu âm
  2. Thu âm câu đầu tiên
  3. Nhập transcript
  4. Click "Tiếp theo"
  5. Thu âm câu thứ hai
- **Expected Result:**
  - wizardIndex tăng lên 1 sau mỗi câu
  - wizardPairs được cập nhật với {audio, transcript}
  - Progress hiển thị đúng vị trí trong wizard

#### TC-VT-09
- **ID:** TC-VT-09
- **Title:** Kiểm tra TTS server status khi chưa install
- **Priority:** High
- **Precondition:** TTS server chưa được cài đặt
- **Steps:**
  1. Điều hướng đến VoiceTraining
  2. Quan sát trạng thái TTS server
- **Expected Result:**
  - `tts.getStatus()` được gọi khi mount
  - Hiển thị thông báo "Chưa cài đặt" hoặc tương đương
  - Có button "Cài đặt" (Install)

#### TC-VT-10
- **ID:** TC-VT-10
- **Title:** A/B Test giọng nói - so sánh 2 ref voice
- **Priority:** Low
- **Precondition:** Có ít nhất 2 ref voice files
- **Steps:**
  1. Nhập text cho A/B test
  2. Chọn 2 ref voices khác nhau
  3. Click "Chạy A/B Test"
- **Expected Result:**
  - Gọi `tts.generate()` 2 lần với 2 ref voices khác nhau
  - Hiển thị 2 audio player để so sánh
  - Có thể play cả 2 để nghe

#### TC-VT-11
- **ID:** TC-VT-11
- **Title:** Train F5-TTS model từ dataset wizard
- **Priority:** High
- **Precondition:** Tab "Train" active, có ít nhất 5 cặp audio-transcript trong wizard
- **Steps:**
  1. Chọn tab "Train"
  2. Click "Bắt đầu Training"
  3. Theo dõi logs
- **Expected Result:**
  - `tts.buildDataset()` được gọi trước
  - `tts.finetune()` được gọi tiếp theo
  - trainStatus chuyển qua: null → 'dataset' → 'training' → 'done'
  - Log messages xuất hiện theo thời gian thực

#### TC-VT-12
- **ID:** TC-VT-12
- **Title:** Set active voice profile
- **Priority:** High
- **Precondition:** Có ít nhất 2 voice profiles
- **Steps:**
  1. Tab "Profiles"
  2. Click "Đặt làm active" trên profile thứ 2
- **Expected Result:**
  - `profile.setActive()` được gọi với id profile
  - Trong DB: `is_active = 0` cho tất cả, `is_active = 1` cho profile đã chọn
  - UI hiển thị indicator "Active" trên profile đó

---

### 2.4 MODULE: TRAINING DATA

#### TC-TD-01
- **ID:** TC-TD-01
- **Title:** Load danh sách training files khi vào trang
- **Priority:** High
- **Precondition:** Thư mục training-data có một số file JSONL
- **Steps:**
  1. Điều hướng đến TrainingData
  2. Chờ component mount và load
- **Expected Result:**
  - `training.listFiles()` được gọi
  - Danh sách files hiển thị với tên, loại, kích thước, số dòng
  - Counter "Files: X" ở header cập nhật đúng

#### TC-TD-02
- **ID:** TC-TD-02
- **Title:** Upload file JSONL training data
- **Priority:** Critical
- **Precondition:** Tab "Training Files" active, có file JSONL sẵn
- **Steps:**
  1. Click "Chon files" trong upload area
  2. Chọn file JSONL hợp lệ
  3. Chờ upload
- **Expected Result:**
  - `training.uploadFile()` được gọi với array buffer và filename
  - Loading indicator hiển thị khi đang upload
  - Sau khi upload: file xuất hiện trong danh sách
  - Danh sách refresh tự động

#### TC-TD-03
- **ID:** TC-TD-03
- **Title:** Upload file bằng Drag & Drop
- **Priority:** Medium
- **Precondition:** Tab "Training Files" active
- **Steps:**
  1. Drag file JSONL vào khu vực upload
  2. Drop file
- **Expected Result:**
  - Khi dragOver: border đổi sang màu violet/50, background tint
  - Sau drop: upload được kích hoạt giống như click chọn file
  - File xuất hiện trong danh sách sau upload

#### TC-TD-04
- **ID:** TC-TD-04
- **Title:** Preview nội dung file JSONL
- **Priority:** High
- **Precondition:** Có ít nhất 1 file JSONL đã upload
- **Steps:**
  1. Click icon Eye trên một file JSONL
  2. Quan sát modal preview
- **Expected Result:**
  - `training.readFile()` được gọi
  - Modal hiển thị với tên file, kích thước
  - Hiển thị tối đa 20 mẫu đầu tiên
  - Dữ liệu JSONL được render dạng JSON với indentation

#### TC-TD-05
- **ID:** TC-TD-05
- **Title:** Xóa training file
- **Priority:** High
- **Precondition:** Có ít nhất 1 file trong danh sách
- **Steps:**
  1. Click icon Trash trên một file
  2. Xác nhận xóa trong confirm dialog
- **Expected Result:**
  - `training.deleteFile()` được gọi
  - File biến khỏi danh sách
  - Nếu file đang được preview, modal đóng lại
  - Counter "Files" giảm 1

#### TC-TD-06
- **ID:** TC-TD-06
- **Title:** Hủy bỏ xóa file (Cancel trong confirm dialog)
- **Priority:** Medium
- **Precondition:** Có ít nhất 1 file trong danh sách
- **Steps:**
  1. Click icon Trash trên một file
  2. Click Cancel/No trong confirm dialog
- **Expected Result:**
  - `training.deleteFile()` KHÔNG được gọi
  - File vẫn còn trong danh sách

#### TC-TD-07
- **ID:** TC-TD-07
- **Title:** Thêm cặp Q&A mới vào file JSONL (Quick Add)
- **Priority:** Critical
- **Precondition:** Tab "Quick Add Q&A" active, có ít nhất 1 file JSONL làm target
- **Steps:**
  1. Chọn tab "Quick Add Q&A"
  2. Chọn file target từ dropdown
  3. Nhập câu hỏi: "Phí chuyển khoản nội địa là bao nhiêu?"
  4. Nhập câu trả lời: "Phí chuyển khoản nội địa là 5,500 đồng/giao dịch"
  5. Click "Thêm Q&A"
- **Expected Result:**
  - `training.addSample()` được gọi với { question, answer, targetFile }
  - Sau thành công: fields question và answer được clear
  - `loadFiles()` được gọi để refresh file list
  - File target tăng số dòng lên 1

#### TC-TD-08
- **ID:** TC-TD-08
- **Title:** Button "Thêm Q&A" bị disable khi thiếu câu hỏi hoặc câu trả lời
- **Priority:** High
- **Precondition:** Tab "Quick Add Q&A" active
- **Steps:**
  1. Để trống cả 2 fields → kiểm tra button
  2. Nhập câu hỏi, để trống câu trả lời → kiểm tra button
  3. Để trống câu hỏi, nhập câu trả lời → kiểm tra button
- **Expected Result:** Button có `disabled` trong cả 3 trường hợp trên

#### TC-TD-09
- **ID:** TC-TD-09
- **Title:** Tạo file mới khi chọn "_new_" trong target dropdown
- **Priority:** Medium
- **Precondition:** Tab "Quick Add Q&A" active
- **Steps:**
  1. Chọn "+ Tạo file mới (training_custom.jsonl)" trong dropdown
  2. Nhập Q&A hợp lệ
  3. Click "Thêm Q&A"
- **Expected Result:**
  - `training.addSample()` được gọi với targetFile = '_new_'
  - File "training_custom.jsonl" mới được tạo
  - File xuất hiện trong danh sách

#### TC-TD-10
- **ID:** TC-TD-10
- **Title:** Train Qwen model từ training data
- **Priority:** Critical
- **Precondition:** Tab "Train Model" active, có ít nhất 1 file training data
- **Steps:**
  1. Chọn tab "Train Model"
  2. Kiểm tra danh sách files hiển thị trong stats
  3. Click "Bắt đầu Training"
  4. Theo dõi logs
- **Expected Result:**
  - Button disable khi không có files hoặc đang train
  - `training.buildModel()` được gọi
  - trainStatus = 'running', hiển thị spinner
  - Logs xuất hiện real-time (auto-scroll xuống cuối)
  - Khi thành công: trainStatus = 'success', badge "Thành công" màu xanh

#### TC-TD-11
- **ID:** TC-TD-11
- **Title:** Train model thất bại - hiển thị lỗi
- **Priority:** High
- **Precondition:** Tab "Train Model" active, Ollama không chạy
- **Steps:**
  1. Click "Bắt đầu Training" khi Ollama offline
- **Expected Result:**
  - trainStatus = 'error'
  - Badge "Lỗi" màu đỏ xuất hiện
  - Log dòng cuối hiển thị message lỗi màu rose

#### TC-TD-12
- **ID:** TC-TD-12
- **Title:** Test model qua Ollama
- **Priority:** High
- **Precondition:** Tab "Test Model" active, Ollama + Qwen đang chạy
- **Steps:**
  1. Chọn tab "Test Model"
  2. Nhập câu hỏi "Lãi suất tiết kiệm 12 tháng là bao nhiêu?"
  3. Click "Gửi" hoặc nhấn Enter
- **Expected Result:**
  - `training.testModel()` được gọi
  - Loading spinner hiển thị
  - Kết quả text từ Qwen xuất hiện trong response box

#### TC-TD-13
- **ID:** TC-TD-13
- **Title:** Refresh danh sách files
- **Priority:** Low
- **Precondition:** TrainingData đang mở
- **Steps:**
  1. Click button Refresh (RefreshCw icon)
- **Expected Result:**
  - `loadFiles()` được gọi lại
  - Icon spin trong khi loading
  - Danh sách cập nhật với trạng thái mới nhất

---

### 2.5 MODULE: MODEL MANAGER

#### TC-MM-01
- **ID:** TC-MM-01
- **Title:** Hiển thị danh sách tất cả models
- **Priority:** High
- **Precondition:** ModelManager mở, tab "Tất cả" active
- **Steps:**
  1. Điều hướng đến ModelManager
  2. Kiểm tra danh sách
- **Expected Result:**
  - 3 models hiển thị: Qwen 4B, Whisper Medium, F5-TTS Vietnamese
  - Mỗi card hiển thị: tên, type, kích thước, params, context, description
  - Counter "Đã cài: X/3" đúng

#### TC-MM-02
- **ID:** TC-MM-02
- **Title:** Filter model theo loại (LLM/TTS/STT)
- **Priority:** Medium
- **Precondition:** ModelManager mở
- **Steps:**
  1. Click tab "LLM"
  2. Click tab "TTS"
  3. Click tab "STT"
  4. Click tab "Tất cả"
- **Expected Result:**
  - "LLM": chỉ hiển thị Qwen 4B
  - "TTS": chỉ hiển thị F5-TTS Vietnamese
  - "STT": chỉ hiển thị Whisper Medium
  - "Tất cả": hiển thị đủ 3 models

#### TC-MM-03
- **ID:** TC-MM-03
- **Title:** Cài đặt model chưa được cài
- **Priority:** High
- **Precondition:** Có model với status 'not_installed'
- **Steps:**
  1. Click "Tải về" trên model chưa cài
- **Expected Result:**
  - Status chuyển sang 'downloading', spinner hiển thị
  - Sau 2 giây (simulate): status chuyển sang 'installed'
  - Badge đổi sang "Đã cài" màu xanh

#### TC-MM-04
- **ID:** TC-MM-04
- **Title:** Gỡ cài đặt model
- **Priority:** Medium
- **Precondition:** Có model với status 'installed'
- **Steps:**
  1. Click icon Trash trên model đã cài
- **Expected Result:**
  - Status model chuyển thành 'not_installed'
  - Button "Tải về" xuất hiện thay cho "Đang sử dụng"
  - Counter "Đã cài" giảm 1

#### TC-MM-05
- **ID:** TC-MM-05
- **Title:** Hiển thị empty state khi filter không có kết quả
- **Priority:** Low
- **Precondition:** Tất cả models đều là type LLM (scenario test)
- **Steps:**
  1. Click tab "TTS" khi không có model TTS nào
- **Expected Result:** Empty state component hiển thị "Không có model trong danh mục này"

---

### 2.6 MODULE: CHAT

#### TC-CHAT-01
- **ID:** TC-CHAT-01
- **Title:** Kiểm tra Ollama status khi mount
- **Priority:** High
- **Precondition:** Chat page mở
- **Steps:**
  1. Điều hướng đến Chat
  2. Quan sát status badge ngay khi load
- **Expected Result:**
  - Trạng thái 'checking' ban đầu (spinner + "Checking...")
  - Sau khi `fetch('http://localhost:11434/api/tags')` trả về: nếu có qwen model → "Qwen 4B Ready" màu xanh
  - Nếu không có → "Model Offline" màu đỏ

#### TC-CHAT-02
- **ID:** TC-CHAT-02
- **Title:** Gửi tin nhắn và nhận phản hồi từ Qwen
- **Priority:** Critical
- **Precondition:** Ollama + Qwen model đang chạy, modelStatus = 'ready'
- **Steps:**
  1. Nhập "Cho tôi biết lãi suất vay tiêu dùng"
  2. Click button "Gửi"
  3. Chờ phản hồi
- **Expected Result:**
  - Tin nhắn user xuất hiện bên phải với bubble màu violet
  - Loading dots (bounce) xuất hiện trong khi chờ
  - Phản hồi của assistant xuất hiện bên trái
  - Input field được clear sau khi gửi

#### TC-CHAT-03
- **ID:** TC-CHAT-03
- **Title:** Gửi tin nhắn bằng phím Enter
- **Priority:** Medium
- **Precondition:** modelStatus = 'ready', có text trong input
- **Steps:**
  1. Nhập "Hello" vào input
  2. Nhấn Enter
- **Expected Result:** `sendMessage()` được gọi, giống như click button "Gửi"

#### TC-CHAT-04
- **ID:** TC-CHAT-04
- **Title:** Button "Gửi" và input bị disable khi model offline
- **Priority:** High
- **Precondition:** Ollama offline, modelStatus = 'offline'
- **Steps:**
  1. Kiểm tra trạng thái input và button
- **Expected Result:**
  - Input có `disabled` attribute
  - Button "Gửi" có `disabled` attribute
  - Status badge màu đỏ "Model Offline"

#### TC-CHAT-05
- **ID:** TC-CHAT-05
- **Title:** Xóa lịch sử chat
- **Priority:** Medium
- **Precondition:** Có ít nhất 1 tin nhắn trong chat
- **Steps:**
  1. Gửi 1 tin nhắn
  2. Click button Trash (clear chat)
- **Expected Result:**
  - `messages` state reset về []
  - UI hiển thị empty state "Bắt đầu trò chuyện"
  - Button Trash biến mất (chỉ hiện khi có messages)

#### TC-CHAT-06
- **ID:** TC-CHAT-06
- **Title:** Hiển thị lỗi khi Qwen processText thất bại
- **Priority:** High
- **Precondition:** modelStatus = 'ready' nhưng IPC call thất bại
- **Steps:**
  1. Mock `qwen.processText()` throw error
  2. Gửi tin nhắn
- **Expected Result:**
  - Message lỗi xuất hiện với prefix "❌ Lỗi:" và style màu đỏ (rose)
  - `isLoading` về false

---

### 2.7 MODULE: HISTORY

#### TC-HIST-01
- **ID:** TC-HIST-01
- **Title:** Load toàn bộ lịch sử cuộc gọi
- **Priority:** High
- **Precondition:** Database có 10 bản ghi calls
- **Steps:**
  1. Điều hướng đến History
  2. Chờ load xong
- **Expected Result:**
  - `db.getAllCalls()` được gọi
  - 10 bản ghi hiển thị trong danh sách
  - Mỗi item hiển thị: tên khách, số điện thoại, ngày giờ, thời lượng, status badge

#### TC-HIST-02
- **ID:** TC-HIST-02
- **Title:** Tìm kiếm theo số điện thoại
- **Priority:** High
- **Precondition:** Có calls với nhiều số điện thoại khác nhau
- **Steps:**
  1. Nhập "0987" vào ô tìm kiếm
  2. Quan sát kết quả filter
- **Expected Result:**
  - Chỉ hiển thị calls có phone_number chứa "0987"
  - Client-side filter (không gọi API mới)
  - Kết quả cập nhật realtime khi gõ

#### TC-HIST-03
- **ID:** TC-HIST-03
- **Title:** Tìm kiếm theo tên khách hàng (case-insensitive)
- **Priority:** Medium
- **Precondition:** Có calls với tên khách hàng tiếng Việt
- **Steps:**
  1. Nhập "nguyen" (chữ thường)
  2. Quan sát kết quả
- **Expected Result:** Hiển thị calls có customer_name chứa "nguyen" (không phân biệt hoa/thường)

#### TC-HIST-04
- **ID:** TC-HIST-04
- **Title:** Expand xem transcript cuộc gọi
- **Priority:** High
- **Precondition:** Có calls với transcript JSON hợp lệ
- **Steps:**
  1. Click vào một call item trong danh sách
  2. Quan sát phần mở rộng
- **Expected Result:**
  - Call item expand, hiển thị "Nội dung hội thoại"
  - Messages được render với bubble AI (violet) và User (slate)
  - Click lại để collapse

#### TC-HIST-05
- **ID:** TC-HIST-05
- **Title:** Hiển thị "Không có nội dung" khi transcript rỗng
- **Priority:** Medium
- **Precondition:** Có call với transcript = null hoặc rỗng
- **Steps:**
  1. Click vào call không có transcript
- **Expected Result:** Hiển thị "Không có nội dung hội thoại" italic

#### TC-HIST-06
- **ID:** TC-HIST-06
- **Title:** Tìm kiếm không có kết quả
- **Priority:** Medium
- **Precondition:** Có call history
- **Steps:**
  1. Nhập chuỗi tìm kiếm không tồn tại "XYZABC123"
- **Expected Result:** Empty state với message "Không tìm thấy kết quả phù hợp."

---

### 2.8 MODULE: SETTINGS

#### TC-SETT-01
- **ID:** TC-SETT-01
- **Title:** Load settings từ database khi vào trang
- **Priority:** High
- **Precondition:** Database có settings đã lưu
- **Steps:**
  1. Lưu setting `language = 'en-US'` vào DB
  2. Mở Settings page
  3. Quan sát giá trị dropdown Ngôn ngữ
- **Expected Result:**
  - `db.getSettings()` được gọi khi mount
  - Dropdown Ngôn ngữ hiển thị "English" (en-US)
  - Các settings khác cũng load đúng từ DB

#### TC-SETT-02
- **ID:** TC-SETT-02
- **Title:** Lưu settings thành công
- **Priority:** Critical
- **Precondition:** Settings page mở
- **Steps:**
  1. Thay đổi Language sang "en-US"
  2. Bật Auto Answer
  3. Click "Lưu thay đổi"
- **Expected Result:**
  - `db.saveSetting()` được gọi cho mỗi key-value
  - Button đổi sang "Đang lưu..." khi đang save
  - Sau 2 giây: đổi sang "Đã lưu!" với icon Check màu xanh
  - Sau 2 giây tiếp: button về trạng thái bình thường

#### TC-SETT-03
- **ID:** TC-SETT-03
- **Title:** Toggle Auto Answer
- **Priority:** High
- **Precondition:** Settings page mở
- **Steps:**
  1. Quan sát trạng thái toggle "Tự động trả lời"
  2. Click toggle để bật
  3. Click toggle để tắt
- **Expected Result:**
  - Khi bật: toggle màu violet, indicator dịch sang phải
  - Khi tắt: toggle màu white/10, indicator dịch sang trái

#### TC-SETT-04
- **ID:** TC-SETT-04
- **Title:** Thay đổi Voice Engine
- **Priority:** Medium
- **Precondition:** Settings page mở
- **Steps:**
  1. Thay đổi Model TTS từ "VITS Vietnamese" sang "Edge TTS"
  2. Click "Lưu thay đổi"
- **Expected Result:**
  - State `voiceEngine` cập nhật thành 'edge'
  - Sau save: `db.saveSetting('voiceEngine', 'edge')` được gọi

#### TC-SETT-05
- **ID:** TC-SETT-05
- **Title:** Kiểm tra kết nối API
- **Priority:** Medium
- **Precondition:** Settings page mở
- **Steps:**
  1. Nhập API endpoint "http://localhost:8000"
  2. Click "Kiểm tra kết nối"
- **Expected Result:** Button click được (không disable), request được gửi đến endpoint (hiện tại button chưa có handler - cần implement)

---

## PHẦN 3: INTEGRATION TEST CASES

### 3.1 IPC Flow Tests

#### TC-IPC-01
- **ID:** TC-IPC-01
- **Title:** Flow đầy đủ: React → preload → main → DB → response
- **Priority:** Critical
- **Precondition:** Electron app running
- **Steps:**
  1. Gọi `window.electronAPI.db.getStats()` từ renderer
  2. Kiểm tra IPC invoke 'db:stats' đến main
  3. Main gọi `dbAPI.getDashboardStats()`
  4. DB query được thực thi
  5. Response trả về renderer
- **Expected Result:**
  - Không có lỗi cross-context
  - Data types đúng (numbers, strings)
  - Response time < 100ms

#### TC-IPC-02
- **ID:** TC-IPC-02
- **Title:** IPC call với parameter: saveSetting
- **Priority:** High
- **Precondition:** DB initialized
- **Steps:**
  1. Gọi `window.electronAPI.db.saveSetting('testKey', 'testValue')`
  2. Ngay sau đó gọi `window.electronAPI.db.getSettings()`
  3. Kiểm tra 'testKey' trong kết quả
- **Expected Result:** 'testKey': 'testValue' xuất hiện trong settings object

#### TC-IPC-03
- **ID:** TC-IPC-03
- **Title:** IPC call đến TTS service (forward HTTP)
- **Priority:** High
- **Precondition:** TTS server chạy ở port 5111
- **Steps:**
  1. Gọi `window.electronAPI.tts.getStatus()`
  2. Kiểm tra response
- **Expected Result:** Response chứa `{ ready: true/false, installed: true/false }` hoặc tương đương

#### TC-IPC-04
- **ID:** TC-IPC-04
- **Title:** IPC error handling - TTS server offline
- **Priority:** High
- **Precondition:** TTS server không chạy (port 5111 không có service)
- **Steps:**
  1. Gọi `window.electronAPI.tts.generate(config)`
  2. Quan sát response
- **Expected Result:** Response `{ success: false, error: 'message' }` (không throw unhandled exception)

#### TC-IPC-05
- **ID:** TC-IPC-05
- **Title:** Concurrent IPC calls
- **Priority:** Medium
- **Precondition:** Electron app running
- **Steps:**
  1. Gửi 5 IPC calls đồng thời: `db.getStats()`, `db.getRecentCalls()`, `tts.listRefs()`, `profile.list()`, `model.list()`
- **Expected Result:**
  - Tất cả 5 calls resolve thành công
  - Không có data corruption hoặc deadlock
  - Kết quả đúng cho từng call

### 3.2 Database Integration Tests

#### TC-DB-01
- **ID:** TC-DB-01
- **Title:** Transaction setActiveProfile - atomic update
- **Priority:** Critical
- **Precondition:** DB có 3 voice profiles, profile ID 1 đang active
- **Steps:**
  1. Gọi `dbAPI.setActiveProfile(3)`
  2. Query kiểm tra
- **Expected Result:**
  - Profile 1: `is_active = 0`
  - Profile 2: `is_active = 0`
  - Profile 3: `is_active = 1`
  - Transaction thực hiện atomically (không có trạng thái partial)

#### TC-DB-02
- **ID:** TC-DB-02
- **Title:** getDashboardStats tính toán đúng từ dữ liệu thực
- **Priority:** High
- **Precondition:** DB có calls: 3 completed (duration 2:00, 3:00, 1:00), 1 missed
- **Steps:**
  1. Gọi `dbAPI.getDashboardStats()`
- **Expected Result:**
  - totalCalls: 4
  - completedCalls: 3
  - successRate: 75.0
  - avgDuration: '2:00' (trung bình 2 phút)

#### TC-DB-03
- **ID:** TC-DB-03
- **Title:** WAL mode - concurrent read/write
- **Priority:** Medium
- **Precondition:** DB initialized với WAL mode
- **Steps:**
  1. Bắt đầu read query dài (SELECT nhiều records)
  2. Đồng thời execute write query (INSERT)
- **Expected Result:** Không có lỗi "database is locked", cả 2 operations hoàn thành thành công

### 3.3 Python Service Integration Tests

#### TC-PY-01
- **ID:** TC-PY-01
- **Title:** F5-TTS server khởi động và health check
- **Priority:** Critical
- **Precondition:** Python venv với F5-TTS được cài đặt
- **Steps:**
  1. Khởi động Electron app
  2. Chờ TTS server start (process spawn)
  3. Gọi health check endpoint
- **Expected Result:**
  - TTS server process được spawn với đúng args
  - HTTP GET đến `http://127.0.0.1:5111/health` trả về 200
  - Server ready trong vòng 30 giây

#### TC-PY-02
- **ID:** TC-PY-02
- **Title:** TTS auto-restart sau crash
- **Priority:** High
- **Precondition:** TTS server đang chạy
- **Steps:**
  1. Kill TTS server process (SIGKILL)
  2. Chờ 5 giây
  3. Kiểm tra TTS server
- **Expected Result:**
  - Main process detect `close` event với non-zero exit code
  - `startTTSServer()` được gọi lại tự động
  - Server online lại sau restart

#### TC-PY-03
- **ID:** TC-PY-03
- **Title:** Qwen LLM qua Ollama HTTP API
- **Priority:** Critical
- **Precondition:** Ollama service running, qwen model installed
- **Steps:**
  1. Gọi `window.electronAPI.qwen.streamChat('Xin chào', [])`
  2. Kiểm tra response
- **Expected Result:**
  - HTTP POST đến `http://localhost:11434/api/generate`
  - Response `{ success: true, text: '...', sentences: [...] }`
  - Response time < 10 giây cho câu ngắn

---

## PHẦN 4: PERFORMANCE TEST CASES

#### TC-PERF-01
- **ID:** TC-PERF-01
- **Title:** Edge-TTS generation latency (< 1 giây)
- **Priority:** High
- **Steps:**
  1. Gọi `edgeTTS.generate()` với text 20 từ
  2. Đo thời gian từ call đến khi có audio data
- **Expected Result:** Latency < 1000ms (yêu cầu cho real-time call)

#### TC-PERF-02
- **ID:** TC-PERF-02
- **Title:** Dashboard load time
- **Priority:** Medium
- **Steps:**
  1. DB có 1000 bản ghi calls
  2. Đo thời gian render Dashboard
- **Expected Result:** Load time < 500ms

#### TC-PERF-03
- **ID:** TC-PERF-03
- **Title:** Whisper STT - latency cho audio 5 giây
- **Priority:** High
- **Steps:**
  1. Upload file WAV 5 giây
  2. Gọi `tts.transcribeAudio()`
  3. Đo thời gian đến khi nhận transcript
- **Expected Result:** Response time < 5 giây

---

## PHẦN 5: TEST AUTOMATION RECOMMENDATIONS

### 5.1 Cấu trúc thư mục tests

```
tests/
├── unit/
│   ├── db.test.js          # dbAPI functions
│   ├── store.test.js       # Zustand store
│   ├── utils.test.js       # formatDuration, formatTime, etc.
│   └── components/
│       ├── Dashboard.test.jsx
│       ├── CallCenter.test.jsx
│       └── ...
├── integration/
│   ├── ipc.test.js         # IPC flow tests
│   ├── db-integration.test.js
│   └── python-service.test.js
├── e2e/
│   ├── call-flow.spec.ts   # Playwright E2E
│   ├── voice-training.spec.ts
│   └── settings.spec.ts
├── fixtures/
│   ├── sample_audio.wav
│   ├── test_training.jsonl
│   └── seed-db.js
└── pytest/
    ├── test_tts_server.py
    └── test_transcribe.py
```

### 5.2 Cấu hình Jest

```json
// package.json (test section)
{
  "jest": {
    "testEnvironment": "jsdom",
    "setupFilesAfterFramework": ["@testing-library/jest-dom"],
    "moduleNameMapper": {
      "^electron$": "<rootDir>/tests/__mocks__/electron.js"
    },
    "collectCoverageFrom": [
      "src/**/*.{js,jsx}",
      "electron/**/*.js",
      "!**/node_modules/**"
    ],
    "coverageThreshold": {
      "global": {
        "branches": 60,
        "functions": 70,
        "lines": 70
      }
    }
  }
}
```

### 5.3 Electron Mock cho unit tests

```javascript
// tests/__mocks__/electron.js
const electronAPI = {
  db: {
    getStats: jest.fn().mockResolvedValue({ totalCalls: 0, ... }),
    getRecentCalls: jest.fn().mockResolvedValue([]),
    getSettings: jest.fn().mockResolvedValue({}),
    saveSetting: jest.fn().mockResolvedValue(true),
  },
  tts: {
    listRefs: jest.fn().mockResolvedValue([]),
    generate: jest.fn().mockResolvedValue({ success: true, audioPath: '/tmp/test.wav' }),
    transcribeAudio: jest.fn().mockResolvedValue({ success: true, text: 'test text' }),
  },
  qwen: {
    processText: jest.fn().mockResolvedValue({ success: true, text: 'response' }),
    streamChat: jest.fn().mockResolvedValue({ success: true, text: 'response', sentences: [] }),
  }
}
window.electronAPI = electronAPI
```

### 5.4 Playwright E2E Setup cho Electron

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e',
  use: {
    // Electron support qua playwright-electron
  },
  projects: [
    { name: 'electron', use: { ...devices['Desktop Chrome'] } }
  ]
})
```

### 5.5 Pytest cho Python TTS Server

```python
# tests/pytest/test_tts_server.py
import requests
import pytest

BASE_URL = "http://127.0.0.1:5111"

def test_health_check():
    resp = requests.get(f"{BASE_URL}/health")
    assert resp.status_code == 200

def test_generate_audio():
    payload = {
        "ref_audio": "path/to/ref.wav",
        "ref_text": "",
        "gen_text": "xin chào",
        "speed": 1.0
    }
    resp = requests.post(f"{BASE_URL}/generate", json=payload)
    assert resp.status_code == 200
    assert "audio_path" in resp.json()
```

### 5.6 CI/CD Integration Strategy

```yaml
# .github/workflows/test.yml
name: Test Suite
on: [push, pull_request]
jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with: { node-version: '18' }
      - run: npm ci
      - run: npm test -- --coverage
      - uses: codecov/codecov-action@v3

  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - run: npm run test:integration

  python-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-python@v4
        with: { python-version: '3.11' }
      - run: pip install pytest requests
      - run: pytest tests/pytest/ -v

  e2e-tests:
    runs-on: macos-latest  # E2E cần chạy trên macOS/Windows vì Electron
    steps:
      - run: npm run test:e2e
```

---

## PHỤ LỤC: MA TRẬN TEST COVERAGE

| Module | Unit Tests | Integration Tests | E2E Tests | Manual Tests |
|--------|-----------|------------------|-----------|-------------|
| Dashboard | TC-DASH-01~05 | TC-IPC-01, TC-DB-02 | E2E-01 | Visual check |
| CallCenter | TC-CALL-01~10 | TC-IPC-03, TC-PY-01~03 | E2E-02 | Voice quality |
| VoiceTraining | TC-VT-01~12 | TC-IPC-03~04, TC-PY-01 | E2E-03 | Audio quality |
| TrainingData | TC-TD-01~13 | TC-IPC-01, TC-PY-03 | E2E-04 | Data accuracy |
| ModelManager | TC-MM-01~05 | - | E2E-05 | Download speed |
| Chat | TC-CHAT-01~06 | TC-PY-03 | E2E-06 | Response quality |
| History | TC-HIST-01~06 | TC-DB-01~03 | E2E-07 | UI layout |
| Settings | TC-SETT-01~05 | TC-IPC-02 | E2E-08 | Persistence |

**Tổng số test cases:**
- Module-level: 66 test cases
- Integration: 11 test cases
- Performance: 3 test cases
- **Tổng: 80 test cases**

---

*Tài liệu này được tạo dựa trên phân tích toàn bộ source code của dự án AI Voice Bot.*
*Version: 1.0 | 2026-03-17*
