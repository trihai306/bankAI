#!/usr/bin/env python3
"""Generate training data cho Qwen banking model - format JSONL."""
import json
from pathlib import Path

OUTPUT = Path(__file__).parent.parent / "training-data" / "qwen_banking_chatml.jsonl"

# Đọc data hiện có
existing = []
td = Path(__file__).parent.parent / "training-data"
for f in td.glob("*.jsonl"):
    if f.name == "qwen_banking_chatml.jsonl":
        continue
    for line in open(f, encoding="utf-8"):
        line = line.strip()
        if line:
            try:
                existing.append(json.loads(line))
            except:
                pass

for f in td.glob("*.json"):
    try:
        data = json.loads(open(f, encoding="utf-8").read())
        if isinstance(data, list):
            existing.extend(data)
    except:
        pass

# Banking QA data
qa_data = [
    # === TÀI KHOẢN ===
    ("Mở tài khoản ngân hàng cần gì?", "Để mở tài khoản ngân hàng, bạn cần: 1) CMND/CCCD còn hạn, 2) Số điện thoại chính chủ. Mở tại quầy: mang CMND đến chi nhánh, mất 15-30 phút. Mở online qua eKYC: tải app ngân hàng, chụp CMND + video selfie, mất 5-10 phút."),
    ("Tài khoản thanh toán khác tiết kiệm thế nào?", "Tài khoản thanh toán: lãi suất thấp (0.1-0.5%/năm), rút tiền tự do, dùng chi tiêu hàng ngày. Tài khoản tiết kiệm: lãi suất cao (4-8%/năm), có kỳ hạn, rút trước hạn mất lãi, phù hợp tích lũy."),
    ("Số dư tối thiểu trong tài khoản là bao nhiêu?", "Số dư tối thiểu tùy ngân hàng: Vietcombank 50,000đ, BIDV 50,000đ, Techcombank 0đ, VPBank 0đ, TPBank 0đ. Nếu dưới mức tối thiểu, có thể bị thu phí duy trì tài khoản 10,000-30,000đ/tháng."),
    ("Đóng tài khoản ngân hàng như thế nào?", "Để đóng tài khoản: 1) Rút hết số dư, 2) Hủy các dịch vụ liên kết (auto-debit, thẻ), 3) Đến chi nhánh mang CMND yêu cầu đóng, 4) Ký đơn. Một số ngân hàng hỗ trợ đóng qua app."),
    ("Tài khoản bị đóng băng phải làm sao?", "Tài khoản bị đóng băng có thể do: nợ thuế, lệnh tòa án, giao dịch bất thường. Cách xử lý: 1) Liên hệ hotline ngân hàng xác nhận lý do, 2) Cung cấp giấy tờ theo yêu cầu, 3) Đến chi nhánh với CMND. Thời gian giải quyết 1-30 ngày tùy lý do."),
    ("Có thể mở bao nhiêu tài khoản tại 1 ngân hàng?", "Thông thường mỗi người chỉ mở được 1 tài khoản thanh toán tại 1 ngân hàng. Nhưng có thể mở nhiều sổ tiết kiệm. Bạn có thể mở tài khoản tại nhiều ngân hàng khác nhau, không giới hạn."),
    ("Làm sao đổi số điện thoại đăng ký ngân hàng?", "Đổi số điện thoại ngân hàng: 1) Cách nhanh nhất: Đến chi nhánh mang CMND + SIM mới, 2) Qua app: Một số ngân hàng cho đổi online nếu còn truy cập OTP cũ. Thời gian: ngay lập tức tại quầy, 1-2 ngày qua app."),
    ("eKYC là gì?", "eKYC (Electronic Know Your Customer) là xác minh danh tính online: chụp CMND/CCCD 2 mặt + video selfie. AI xác thực trong 30 giây. Cho phép mở tài khoản 100% online không cần đến ngân hàng. Hầu hết ngân hàng Việt Nam đều hỗ trợ."),
    ("Quên mật khẩu Internet Banking phải làm gì?", "Quên mật khẩu Internet Banking: 1) Trên app: Chọn 'Quên mật khẩu' → Xác thực OTP → Tạo mật khẩu mới, 2) Tại quầy: Mang CMND đến chi nhánh reset. Lưu ý: sau 5 lần nhập sai, tài khoản bị khóa tạm thời."),
    ("Chuyển đổi tài khoản số đẹp được không?", "Có, nhiều ngân hàng cho chọn số tài khoản đẹp khi mở mới: VPBank, Techcombank, MB Bank. Phí chọn số đẹp: 50,000đ - 500,000đ tùy loại số. Tài khoản đã mở thì không đổi được số."),
    # === THẺ ===
    ("Thẻ chip khác thẻ từ thế nào?", "Thẻ chip có chip điện tử bảo mật cao, khó sao chép. Thẻ từ dùng dải từ, dễ bị đánh cắp thông tin. Từ 2021 Việt Nam chuyển hoàn toàn sang thẻ chip. Miễn phí đổi thẻ từ sang chip tại hầu hết ngân hàng."),
    ("Mất thẻ ATM phải làm gì?", "Khi mất thẻ ATM: 1) Gọi hotline ngân hàng ngay để khóa thẻ (24/7), 2) Đến chi nhánh mang CMND báo mất và làm lại thẻ mới, 3) Phí làm lại: 50,000đ - 100,000đ. Thời gian nhận thẻ mới: 3-7 ngày."),
    ("Quên mã PIN thẻ ATM phải làm gì?", "Quên mã PIN: 1) Tại ATM: Không thử quá 3 lần (sẽ bị khóa thẻ), 2) Đến chi nhánh mang CMND + thẻ để cấp lại PIN mới, 3) Qua Internet Banking: Vào Quản lý thẻ → Đổi PIN. Phí cấp lại: miễn phí - 20,000đ."),
    ("Hạn mức rút tiền ATM một ngày là bao nhiêu?", "Hạn mức rút ATM tùy loại thẻ: Thẻ thường: 5-20 triệu/ngày, Thẻ vàng/bạch kim: 30-50 triệu/ngày. Mỗi lần rút tối đa 5 triệu (ATM nội mạng) hoặc 2-3 triệu (ATM ngoại mạng)."),
    ("Phí rút tiền ATM khác ngân hàng bao nhiêu?", "Phí rút ATM: Cùng ngân hàng: miễn phí. Khác ngân hàng: 1,100đ - 3,300đ/lần tùy ngân hàng. Một số ngân hàng miễn phí rút ngoại mạng: VPBank (3 lần/tháng), Techcombank (miễn phí hoàn toàn)."),
    ("Thẻ tín dụng có những loại nào?", "Thẻ tín dụng phổ biến: Visa Classic/Standard (hạn mức thấp), Visa Gold (hạn mức trung bình, ưu đãi hơn), Visa Platinum (hạn mức cao, nhiều đặc quyền), Visa Infinite (VIP). Mastercard cũng có các hạng tương tự."),
    ("Làm thẻ tín dụng cần điều kiện gì?", "Điều kiện làm thẻ tín dụng: 1) Tuổi 21-65, 2) Thu nhập tối thiểu 5-8 triệu/tháng, 3) CMND/CCCD + Giấy xác nhận thu nhập, 4) Không nợ xấu. Hạn mức = 2-5 lần thu nhập. Thời gian xét duyệt: 3-7 ngày."),
    ("Trả góp 0% qua thẻ tín dụng hoạt động thế nào?", "Trả góp 0%: Cửa hàng hỗ trợ phí trả góp, bạn trả đều hàng tháng không lãi. Ví dụ: Mua 12 triệu trả góp 12 tháng = 1 triệu/tháng. Lưu ý: Phải trả đúng hạn, trễ sẽ bị phí phạt 3-4%/tháng."),
    ("Phí thường niên thẻ tín dụng là gì?", "Phí thường niên là phí duy trì thẻ hàng năm: 200,000đ - 2,000,000đ tùy hạng thẻ. Nhiều ngân hàng miễn phí năm đầu hoặc miễn phí nếu chi tiêu đủ mức (ví dụ: chi tiêu 5 triệu/tháng được miễn phí)."),
    ("Thẻ contactless (không tiếp xúc) dùng thế nào?", "Thẻ contactless có biểu tượng sóng wifi: Chỉ cần chạm thẻ vào máy POS, không cần quẹt hay cắm. Giao dịch dưới 1 triệu không cần nhập PIN. Nhanh, tiện, an toàn. Hầu hết thẻ mới đều có tính năng này."),
    # === VAY ===
    ("Vay tín chấp khác vay thế chấp thế nào?", "Vay tín chấp: Không cần tài sản đảm bảo, xét duyệt theo thu nhập, lãi suất cao hơn (10-24%/năm), hạn mức thấp (20-500 triệu). Vay thế chấp: Cần nhà/đất/xe, lãi suất thấp (7-12%/năm), hạn mức cao (tỷ đồng)."),
    ("Lãi suất vay mua nhà hiện nay bao nhiêu?", "Lãi suất vay mua nhà: 8-12%/năm tùy ngân hàng. Ưu đãi 6-8%/năm trong 6-12 tháng đầu. Hỗ trợ vay tối đa 70-80% giá trị nhà, thời hạn lên đến 25-30 năm. Ngân hàng phổ biến: Vietcombank, BIDV, Agribank."),
    ("Hồ sơ vay ngân hàng cần gì?", "Hồ sơ vay gồm: 1) CMND/CCCD + Sổ hộ khẩu, 2) Giấy xác nhận thu nhập/hợp đồng lao động, 3) Sao kê lương 3-6 tháng, 4) Giấy tờ tài sản (nếu thế chấp). Vay online cần ít giấy tờ hơn nhưng lãi suất cao hơn."),
    ("Vay online có an toàn không?", "Vay online qua ngân hàng/công ty tài chính có giấy phép là an toàn. Dấu hiệu lừa đảo: 1) Yêu cầu chuyển tiền/phí trước, 2) Hứa duyệt 100%, 3) Không có giấy phép. Chỉ vay tại: Ngân hàng TMCP, FE Credit, Home Credit, HD Saison."),
    ("Trả nợ trước hạn có bị phạt không?", "Trả nợ trước hạn: Hầu hết ngân hàng tính phí trả trước hạn 1-3% số tiền trả trước. Một số ngân hàng miễn phí nếu đã trả được >50% thời hạn vay. Nên hỏi trước khi ký hợp đồng."),
    ("Nợ xấu ảnh hưởng thế nào?", "Nợ xấu (nợ quá hạn >90 ngày) lưu tại CIC trong 5 năm: 1) Không vay được tại mọi ngân hàng, 2) Không làm được thẻ tín dụng, 3) Khó xin visa, 4) Có thể ảnh hưởng xin việc. Để xóa nợ xấu: trả hết nợ và đợi 5 năm."),
    ("CIC là gì? Kiểm tra CIC ở đâu?", "CIC (Trung tâm Thông tin tín dụng) lưu trữ lịch sử vay/trả nợ của bạn. Kiểm tra CIC: 1) Online tại cic.gov.vn (miễn phí 1 lần/năm), 2) Qua app CIC, 3) Tại ngân hàng. Điểm CIC tốt giúp vay dễ hơn và lãi suất thấp hơn."),
    ("Vay mua xe cần điều kiện gì?", "Vay mua xe: 1) Tuổi 21-60, thu nhập ổn định, 2) Vay tối đa 70-80% giá xe, 3) Lãi suất 7-10%/năm, thời hạn 5-7 năm, 4) Xe là tài sản thế chấp. Hồ sơ: CMND, thu nhập, hợp đồng mua xe. Xét duyệt: 1-3 ngày."),
    # === TIẾT KIỆM ===
    ("Gửi tiết kiệm online có an toàn không?", "Tiết kiệm online an toàn và tiện lợi: 1) Bảo mật OTP + mật khẩu, 2) Được bảo hiểm tiền gửi DIV tối đa 125 triệu đồng/người/ngân hàng, 3) Lãi suất thường cao hơn gửi tại quầy 0.1-0.3%/năm."),
    ("Kỳ hạn gửi tiết kiệm nào lãi cao nhất?", "Lãi suất tăng theo kỳ hạn: 1-3 tháng: 2-3%/năm, 6 tháng: 4-5%/năm, 12 tháng: 5-6%/năm, 24 tháng: 5.5-6.5%/năm, 36 tháng: 6-7%/năm. Kỳ hạn 12-13 tháng thường là tối ưu nhất (lãi cao + linh hoạt)."),
    ("Rút tiết kiệm trước hạn mất gì?", "Rút tiết kiệm trước hạn: Mất lãi suất kỳ hạn, chỉ nhận lãi suất không kỳ hạn (0.1-0.5%/năm). Ví dụ: Gửi 100 triệu kỳ hạn 12 tháng lãi 6%/năm, rút sau 6 tháng chỉ được lãi 0.1-0.5%/năm thay vì 6%."),
    ("Lãi suất tiết kiệm ngân hàng nào cao nhất?", "Lãi suất tiết kiệm cao (tham khảo): NCB, BaoViet Bank, CBBank thường có lãi suất cao nhất nhóm (6-7%/năm kỳ hạn 12 tháng). Ngân hàng lớn (Vietcombank, BIDV): thấp hơn (4.5-5.5%) nhưng an toàn hơn."),
    ("Gửi tiết kiệm bao nhiêu là đủ bảo hiểm?", "Bảo hiểm tiền gửi tối đa 125 triệu đồng/người/ngân hàng. Nếu gửi nhiều hơn, nên chia ra nhiều ngân hàng. Ví dụ: gửi 500 triệu → chia 4 ngân hàng, mỗi nơi 125 triệu để được bảo hiểm toàn bộ."),
    # === CHUYỂN TIỀN ===
    ("Chuyển tiền quốc tế mất bao lâu?", "Chuyển tiền quốc tế qua SWIFT: 2-5 ngày làm việc. Phí: 10-50 USD + phí trung gian + phí chuyển đổi ngoại tệ. Dịch vụ nhanh hơn: Western Union (vài giờ), Wise/TransferWise (1-2 ngày), phí thấp hơn ngân hàng."),
    ("Chuyển khoản nhầm số tài khoản phải làm sao?", "Chuyển nhầm tiền: 1) Liên hệ hotline ngân hàng ngay (trong 24h), 2) Cung cấp mã giao dịch, thời gian, số tiền, 3) Ngân hàng sẽ liên hệ người nhận yêu cầu hoàn trả. Thời gian: 7-30 ngày. Nếu người nhận không hợp tác, có thể kiện."),
    ("Hạn mức chuyển khoản một ngày là bao nhiêu?", "Hạn mức chuyển khoản: Internet Banking: 200-500 triệu/ngày (tùy ngân hàng), Mobile Banking: 100-300 triệu/ngày. Tăng hạn mức: Đến chi nhánh đăng ký Smart OTP/Token, có thể lên 2-5 tỷ/ngày."),
    ("VietQR là gì?", "VietQR là chuẩn mã QR thanh toán liên ngân hàng Việt Nam: 1) Quét QR để chuyển khoản (không cần nhập số tài khoản), 2) Miễn phí, 3) Hỗ trợ tất cả ngân hàng Việt Nam, 4) Tạo QR tại app ngân hàng hoặc vietqr.io."),
    # === BẢO MẬT ===
    ("OTP là gì? Có mấy loại OTP?", "OTP (One Time Password) là mã xác thực 1 lần: 1) SMS OTP: Gửi qua tin nhắn (phổ biến nhất), 2) Smart OTP: Tạo trên app ngân hàng (an toàn hơn), 3) Token OTP: Thiết bị phần cứng riêng. KHÔNG BAO GIỜ chia sẻ OTP cho ai, kể cả nhân viên ngân hàng."),
    ("Làm sao biết tin nhắn ngân hàng giả?", "Dấu hiệu tin nhắn giả mạo ngân hàng: 1) Yêu cầu bấm link lạ, 2) Hỏi OTP/mật khẩu, 3) Đe dọa khóa tài khoản, 4) Số gửi không phải brandname ngân hàng. Ngân hàng KHÔNG BAO GIỜ gửi link yêu cầu nhập thông tin qua SMS."),
    ("Bị lừa chuyển tiền có lấy lại được không?", "Bị lừa chuyển tiền: 1) Gọi hotline ngân hàng YÊU CẦU PHONG TỎA ngay (trong vòng vài giờ), 2) Báo công an, 3) Giữ bằng chứng (tin nhắn, cuộc gọi). Khả năng lấy lại phụ thuộc vào tốc độ phong tỏa - càng nhanh càng tốt."),
    ("Tài khoản bị khóa vì nhập sai mật khẩu?", "Tài khoản bị khóa sau 5 lần nhập sai: 1) Đợi 30 phút tự mở khóa (một số ngân hàng), 2) Gọi hotline yêu cầu mở khóa, 3) Đến chi nhánh mang CMND. Thời gian: 10-30 phút. Lưu ý: Ghi nhớ mật khẩu hoặc dùng vân tay/face ID."),
    # === MOBILE BANKING ===
    ("App ngân hàng nào tốt nhất?", "App ngân hàng phổ biến và được đánh giá cao: 1) VCB Digibank (Vietcombank) - ổn định, 2) Techcombank Mobile - nhiều tính năng, 3) VPBank Neo - giao diện đẹp, 4) MB Bank - phí thấp, 5) TPBank eBank - nhanh. Chọn tùy nhu cầu và ngân hàng bạn dùng."),
    ("Đăng ký Mobile Banking cần gì?", "Đăng ký Mobile Banking: 1) Tải app ngân hàng trên CH Play/App Store, 2) Chọn 'Đăng ký mới', 3) Nhập số tài khoản/số thẻ + OTP, 4) Tạo username/mật khẩu, 5) Thiết lập sinh trắc học (vân tay/face ID). Miễn phí."),
    # === PHÍ DỊCH VỤ ===
    ("Phí duy trì tài khoản ngân hàng bao nhiêu?", "Phí duy trì tài khoản: Miễn phí (Techcombank, VPBank, TPBank) hoặc 10,000-30,000đ/tháng (Vietcombank, BIDV, Agribank nếu số dư dưới mức tối thiểu). Cách tránh phí: duy trì số dư tối thiểu hoặc chọn ngân hàng miễn phí."),
    ("Phí SMS Banking bao nhiêu?", "Phí SMS Banking: 8,000-11,000đ/tháng (trả cố định) hoặc 200-500đ/tin (tùy ngân hàng). Một số ngân hàng miễn phí: Techcombank, TPBank qua app. Khuyên dùng: Tắt SMS, bật thông báo app (push notification) - miễn phí và nhanh hơn."),
    # === KHIẾU NẠI ===
    ("Giao dịch bị trừ tiền nhưng không thành công?", "Giao dịch bị trừ tiền lỗi: 1) Đợi 24h - hệ thống có thể tự hoàn, 2) Nếu chưa hoàn: Gọi hotline cung cấp mã giao dịch, thời gian, số tiền, 3) Ngân hàng xác nhận và hoàn tiền trong 7-15 ngày. Lưu lại screenshot giao dịch."),
    ("Hotline các ngân hàng lớn là gì?", "Hotline ngân hàng (24/7): Vietcombank: 1900 545413, BIDV: 1900 9247, Agribank: 1900 558818, Techcombank: 1800 588822, VPBank: 1900 545415, MB Bank: 1900 545426, TPBank: 1900 6060."),
    # === THÊM CÂU HỎI ĐA DẠNG ===
    ("Ngân hàng số là gì?", "Ngân hàng số (digital bank) là ngân hàng hoạt động hoàn toàn trên nền tảng số, không có chi nhánh vật lý. Tại Việt Nam: Timo, TNEX, Cake by VPBank, VNPT Money. Ưu điểm: miễn phí, tiện lợi, lãi suất tốt. Nhược điểm: hạn chế giao dịch tiền mặt."),
    ("Thẻ Napas khác Visa/Mastercard thế nào?", "Thẻ Napas (nội địa): Chỉ dùng trong Việt Nam, phí thấp, rút ATM miễn phí cùng hệ thống. Thẻ Visa/Mastercard (quốc tế): Dùng toàn cầu, thanh toán online quốc tế, phí cao hơn. Nên có cả 2 loại."),
    ("Lãi suất kép là gì?", "Lãi suất kép (compound interest) là lãi tính trên cả gốc và lãi đã sinh ra. Ví dụ: Gửi 100 triệu, lãi 6%/năm, sau 1 năm = 106 triệu, năm 2 lãi tính trên 106 triệu. Tiết kiệm dài hạn hưởng lợi lớn từ lãi kép."),
    ("Bảo hiểm nhân thọ qua ngân hàng (bancassurance) là gì?", "Bancassurance là ngân hàng bán bảo hiểm nhân thọ. Lưu ý: 1) Đây là sản phẩm bảo hiểm, KHÔNG PHẢI tiết kiệm, 2) Không được bảo hiểm tiền gửi, 3) Phí cao, 4) Nên đọc kỹ hợp đồng. Không bắt buộc khi vay ngân hàng."),
    ("Fintech là gì? Có an toàn không?", "Fintech là công nghệ tài chính: Ví điện tử (MoMo, ZaloPay, VNPay), cho vay online, đầu tư. An toàn nếu: 1) Được NHNN cấp phép, 2) Có chính sách bảo mật rõ ràng. Kiểm tra giấy phép tại website NHNN trước khi sử dụng."),
    ("Mở sổ tiết kiệm cho con được không?", "Có thể mở sổ tiết kiệm cho con (dưới 18 tuổi): 1) Bố/mẹ đứng tên mở, 2) Mang CMND bố/mẹ + Giấy khai sinh con, 3) Tiền gửi vẫn được bảo hiểm. Khi con đủ 18 tuổi có thể chuyển quyền sở hữu."),
    ("Tỷ giá ngoại tệ ngân hàng khác thị trường tự do?", "Tỷ giá ngân hàng do NHNN quản lý, thường thấp hơn thị trường tự do 0.5-2%. Mua USD: ngân hàng cần chứng minh mục đích (du học, du lịch). Mua EUR, JPY: tự do hơn. Chênh lệch mua-bán: 50-200 đồng/USD."),
    ("Ví điện tử MoMo có liên kết ngân hàng được không?", "MoMo liên kết được với hầu hết ngân hàng Việt Nam: Vietcombank, BIDV, Techcombank, VPBank, MB Bank... Cách liên kết: Mở MoMo → Liên kết ngân hàng → Chọn ngân hàng → Xác thực OTP. Hạn mức: 20-50 triệu/ngày."),
    ("Đầu tư chứng khoán qua ngân hàng được không?", "Ngân hàng không trực tiếp giao dịch chứng khoán nhưng có công ty chứng khoán liên kết: VCBS (Vietcombank), BSC (BIDV), TCBS (Techcombank). Mở tài khoản chứng khoán online: 5-10 phút qua eKYC, nạp tiền từ tài khoản ngân hàng."),
    ("Gửi tiết kiệm VND hay USD tốt hơn?", "Gửi VND lãi suất cao hơn (4-7%/năm) so với USD (0-0.5%/năm). Nhưng VND có rủi ro mất giá so với USD. Khuyến nghị: Gửi VND cho nhu cầu ngắn hạn. Nếu muốn bảo vệ giá trị dài hạn, đa dạng hóa: 70% VND + 30% USD/vàng."),
]

# Sửa chính tả banking
correction_data = [
    ("ban can cung cap chung minh thu nhap va ho khau de vay", "Bạn cần cung cấp chứng minh thu nhập và hộ khẩu để vay."),
    ("han muc the tin dung cua toi la 10 trieu dong", "Hạn mức thẻ tín dụng của tôi là 10 triệu đồng."),
    ("ung dung ngan hang bi loi khong dang nhap duoc", "Ứng dụng ngân hàng bị lỗi, không đăng nhập được."),
    ("lai suat tiet kiem ky han 12 thang hien tai", "Lãi suất tiết kiệm kỳ hạn 12 tháng hiện tại."),
    ("toi muon rut tien tu tai khoan tiet kiem som", "Tôi muốn rút tiền từ tài khoản tiết kiệm sớm."),
    ("toi muon chuyen tien cho ban nhung quen mat khau", "Tôi muốn chuyển tiền cho bạn nhưng quên mật khẩu."),
    ("lam sao de mo tai khoan tiet kiem lai suat cao", "Làm sao để mở tài khoản tiết kiệm lãi suất cao?"),
    ("ngan hang nao cho vay tien mua nha tot nhat", "Ngân hàng nào cho vay tiền mua nhà tốt nhất?"),
    ("the tin dung co gioi han chi tieu khong", "Thẻ tín dụng có giới hạn chi tiêu không?"),
    ("bi mat the atm phai lam gi khong", "Bị mất thẻ ATM phải làm gì không?"),
    ("toi muon gui tiet kiem ky han 12 thang lai cao", "Tôi muốn gửi tiết kiệm kỳ hạn 12 tháng lãi cao."),
    ("ban co the huong dan cach mo tai khoan ngan hang khong", "Bạn có thể hướng dẫn cách mở tài khoản ngân hàng không?"),
    ("phi chuyen khoan lien ngan hang qua internet banking", "Phí chuyển khoản liên ngân hàng qua Internet Banking."),
    ("lam sao de kiem tra lich su giao dich the tin dung", "Làm sao để kiểm tra lịch sử giao dịch thẻ tín dụng?"),
    ("toi bi quen ma pin the atm phai lam gi day", "Tôi bị quên mã PIN thẻ ATM phải làm gì đây?"),
    ("cho toi biet so du tai khoan hien tai", "Cho tôi biết số dư tài khoản hiện tại."),
    ("toi can ho tro ve dich vu ngan hang dien tu", "Tôi cần hỗ trợ về dịch vụ ngân hàng điện tử."),
    ("phi rut tien o atm khac ngan hang la bao nhieu", "Phí rút tiền ở ATM khác ngân hàng là bao nhiêu?"),
    ("toi bi mat the tai khoan phai lam sao", "Tôi bị mất thẻ tài khoản phải làm sao?"),
    ("cach dang ky internet banking ngan hang vietcombank", "Cách đăng ký Internet Banking ngân hàng Vietcombank."),
    ("so tiet kiem ky han 6 thang co rut truoc duoc khong", "Sổ tiết kiệm kỳ hạn 6 tháng có rút trước được không?"),
    ("lam the nao de tang han muc the tin dung cua toi", "Làm thế nào để tăng hạn mức thẻ tín dụng của tôi?"),
    ("toi muon vay tien mua xe o to tra gop", "Tôi muốn vay tiền mua xe ô tô trả góp."),
    ("ngan hang co ho tro vay mua nha khong can the chap khong", "Ngân hàng có hỗ trợ vay mua nhà không cần thế chấp không?"),
    ("cach chuyen tien tu viet nam ra nuoc ngoai nhanh nhat", "Cách chuyển tiền từ Việt Nam ra nước ngoài nhanh nhất."),
    ("gui tien tiet kiem online co duoc bao hiem tien gui khong", "Gửi tiền tiết kiệm online có được bảo hiểm tiền gửi không?"),
    ("so tien bao hiem tien gui toi da la bao nhieu", "Số tiền bảo hiểm tiền gửi tối đa là bao nhiêu?"),
    ("toi muon mo the visa de mua hang online", "Tôi muốn mở thẻ Visa để mua hàng online."),
    ("cach kiem tra diem tin dung cic cua toi", "Cách kiểm tra điểm tín dụng CIC của tôi."),
    ("ngan hang bidv co ho tro vay sinh vien khong", "Ngân hàng BIDV có hỗ trợ vay sinh viên không?"),
    ("phi thuong nien the tin dung vietcombank la bao nhieu", "Phí thường niên thẻ tín dụng Vietcombank là bao nhiêu?"),
    ("toi bi lua chuyen tien vao tai khoan la phai lam gi", "Tôi bị lừa chuyển tiền vào tài khoản lạ phải làm gì?"),
    ("cach huy the tin dung ngan hang techcombank", "Cách hủy thẻ tín dụng ngân hàng Techcombank."),
    ("lam sao de biet tai khoan ngan hang co bi hack khong", "Làm sao để biết tài khoản ngân hàng có bị hack không?"),
    ("toi muon doi mat khau internet banking vpbank", "Tôi muốn đổi mật khẩu Internet Banking VPBank."),
    ("cach dang ky smart otp tren dien thoai moi", "Cách đăng ký Smart OTP trên điện thoại mới."),
    ("ngan hang nao mien phi chuyen khoan lien ngan hang", "Ngân hàng nào miễn phí chuyển khoản liên ngân hàng?"),
    ("the ghi no quoc te visa debit dung de lam gi", "Thẻ ghi nợ quốc tế Visa Debit dùng để làm gì?"),
    ("so cmnd cu co mo duoc tai khoan ngan hang khong", "Số CMND cũ có mở được tài khoản ngân hàng không?"),
    ("toi quen so tai khoan ngan hang cua minh", "Tôi quên số tài khoản ngân hàng của mình."),
]

SYS_QA = "Bạn là trợ lý ngân hàng AI chuyên nghiệp, trả lời bằng tiếng Việt."
SYS_CORRECT = "Bạn là trợ lý AI chuyên sửa lỗi chính tả tiếng Việt. Chỉ trả về văn bản đã sửa."

samples = []

# Convert existing
for item in existing:
    q = item.get("input", "")
    a = item.get("output", "")
    inst = item.get("instruction", "")
    if not q or not a:
        continue
    is_correction = "sửa lỗi" in inst.lower() or "correction" in inst.lower()
    sys_prompt = SYS_CORRECT if is_correction else SYS_QA
    samples.append({"messages": [
        {"role": "system", "content": sys_prompt},
        {"role": "user", "content": q},
        {"role": "assistant", "content": a},
    ]})

# Add new QA
for q, a in qa_data:
    samples.append({"messages": [
        {"role": "system", "content": SYS_QA},
        {"role": "user", "content": q},
        {"role": "assistant", "content": a},
    ]})

# Add corrections
for inp, out in correction_data:
    samples.append({"messages": [
        {"role": "system", "content": SYS_CORRECT},
        {"role": "user", "content": inp},
        {"role": "assistant", "content": out},
    ]})

# Deduplicate by user content
seen = set()
unique = []
for s in samples:
    key = s["messages"][1]["content"]
    if key not in seen:
        seen.add(key)
        unique.append(s)

# Write JSONL
with open(OUTPUT, "w", encoding="utf-8") as f:
    for s in unique:
        f.write(json.dumps(s, ensure_ascii=False) + "\n")

print(f"Generated {len(unique)} samples → {OUTPUT}")
